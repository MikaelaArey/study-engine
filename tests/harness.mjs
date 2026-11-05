// Test harness: headless Chrome with Study Engine loaded, a static server for test pages, and
// a stand-in for the Anthropic API. Chrome is driven over the DevTools protocol on a pipe.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const EXTENSION = join(here, '..', 'extension');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

// Static files from tests/pages.
export function startStatic() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const path = join(here, 'pages', decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!path.startsWith(join(here, 'pages')) || !existsSync(path)) {
        res.writeHead(404).end('not found');
        return;
      }
      const headers = { 'content-type': TYPES[extname(path)] || 'application/octet-stream' };
      // Pages named *.csp.html get a strict policy that blocks inline <style> elements.
      if (path.endsWith('.csp.html')) headers['content-security-policy'] = "default-src 'self'; style-src 'self'; script-src 'self'";
      res.writeHead(200, headers);
      res.end(readFileSync(path));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

/*
 * A stand-in for POST /v1/messages. `respond(body)` returns the Messages API response for a
 * request body (or { status, json } for an error). Every request is recorded.
 */
export function startMockApi(respond) {
  const requests = [];
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-expose-headers': 'retry-after',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors).end();
        return;
      }
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', async () => {
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {}
        requests.push({ path: req.url, headers: req.headers, body });
        let out;
        try {
          out = await respond(body, req);
        } catch (e) {
          out = { status: 500, json: { type: 'error', error: { type: 'api_error', message: String(e) } } };
        }
        const status = out?.status || 200;
        const json = out?.json || out;
        res.writeHead(status, { 'content-type': 'application/json', ...cors, ...(out?.headers || {}) });
        res.end(JSON.stringify(json));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// A Messages API reply whose text is `json`.
export const reply = (json, extra = {}) => ({
  id: `msg_${Math.random().toString(36).slice(2)}`, type: 'message', role: 'assistant', model: extra.model || 'claude-test',
  content: [...(extra.before || []), { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
  stop_reason: extra.stop_reason || 'end_turn', usage: { input_tokens: 100, output_tokens: 50, ...(extra.usage || {}) },
});

export async function launch({ width = 1280, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'se-test-'));
  const proc = spawn(CHROME, [
    '--headless', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-features=Translate,MediaRouter', `--window-size=${width},${height}`,
    '--hide-scrollbars', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const out = proc.stdio[3];
  const inp = proc.stdio[4];
  let id = 0;
  let buf = '';
  const pending = new Map();
  const listeners = new Set();
  inp.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data || ''}`));
        else resolve(msg.result);
      } else for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const mid = ++id;
    const timer = setTimeout(() => {
      pending.delete(mid);
      reject(new Error(`CDP ${method} timed out`));
    }, 20000);
    pending.set(mid, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    out.write(`${JSON.stringify({ id: mid, method, params, sessionId })}\0`);
  });
  const on = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };
  const waitFor = (pred, timeout = 10000) => new Promise((resolve, reject) => {
    const off = on((m) => {
      if (pred(m)) {
        off();
        clearTimeout(t);
        resolve(m);
      }
    });
    const t = setTimeout(() => {
      off();
      reject(new Error('timed out waiting for event'));
    }, timeout);
  });

  await send('Target.setDiscoverTargets', { discover: true });
  const { id: extId } = await send('Extensions.loadUnpacked', { path: EXTENSION });

  const browser = {
    proc, send, on, waitFor, extId,
    async close() {
      try {
        await send('Browser.close');
      } catch {}
      proc.kill();
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {}
    },
    // The extension's service worker, for setting the API key and test overrides.
    async serviceWorker() {
      for (let i = 0; i < 50; i++) {
        const { targetInfos } = await send('Target.getTargets');
        const sw = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${extId}/`));
        if (sw) {
          const { sessionId } = await send('Target.attachToTarget', { targetId: sw.targetId, flatten: true });
          await send('Runtime.enable', {}, sessionId);
          const evaluate = async (expression) => {
            const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
            if (r.exceptionDetails) throw new Error(`SW: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
            return r.result.value;
          };
          return { sessionId, evaluate };
        }
        await sleep(100);
      }
      throw new Error('no service worker');
    },
    async open(url) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      const contexts = new Map();
      const off = on((m) => {
        if (m.sessionId !== sessionId) return;
        if (m.method === 'Runtime.executionContextCreated') contexts.set(m.params.context.id, m.params.context);
        if (m.method === 'Runtime.executionContextDestroyed') contexts.delete(m.params.executionContextId);
        if (m.method === 'Runtime.executionContextsCleared') contexts.clear();
      });
      await send('Runtime.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId);
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      // The settings tab that opens on install would otherwise keep this one in the background,
      // where requestAnimationFrame doesn't run.
      await send('Target.activateTarget', { targetId });
      await send('Page.bringToFront', {}, sessionId);
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
      const page = new Page(browser, targetId, sessionId, contexts, off);
      if (url) await page.goto(url);
      return page;
    },
  };
  return browser;
}

class Page {
  constructor(browser, targetId, sessionId, contexts, off) {
    Object.assign(this, { browser, targetId, sessionId, contexts, off });
  }

  send(method, params) {
    return this.browser.send(method, params, this.sessionId);
  }

  async goto(url) {
    const loaded = this.browser.waitFor((m) => m.sessionId === this.sessionId && m.method === 'Page.loadEventFired', 15000);
    await this.send('Page.navigate', { url });
    await loaded;
    await sleep(150);
  }

  // Runs in the page's own JavaScript world.
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  // Runs in Study Engine's content-script world (the top frame).
  async se(expression) {
    let ctx = null;
    for (let i = 0; i < 50 && !ctx; i++) {
      ctx = [...this.contexts.values()].find((c) => c.auxData?.type === 'isolated' && c.origin?.startsWith(`chrome-extension://${this.browser.extId}`) && c.auxData?.frameId === this.targetId);
      if (!ctx) await sleep(100);
    }
    if (!ctx) throw new Error('content script world not found');
    const r = await this.send('Runtime.evaluate', { expression, contextId: ctx.id, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`content: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    return r.result.value;
  }

  async focus(selector) {
    await this.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({block:'center'}); el.focus(); })()`);
    await sleep(80);
  }

  // Types text like a person: one key event per character.
  async type(text, { delay = 0 } = {}) {
    for (const ch of text) {
      if (ch === '\n') {
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      } else {
        await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
        await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
      if (delay) await sleep(delay);
    }
  }

  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  async key(key, { code, keyCode, modifiers = 0 } = {}) {
    const k = { type: 'keyDown', key, code: code || key, windowsVirtualKeyCode: keyCode || 0, modifiers };
    await this.send('Input.dispatchKeyEvent', k);
    await this.send('Input.dispatchKeyEvent', { ...k, type: 'keyUp' });
  }

  async mouse(type, x, y, button = 'left') {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: type === 'mouseMoved' ? 0 : 1 });
  }

  async click(x, y) {
    await this.mouse('mouseMoved', x, y);
    await this.mouse('mousePressed', x, y);
    await this.mouse('mouseReleased', x, y);
  }

  async screenshot(path, clip) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));
    return path;
  }

  async waitFor(fn, { timeout = 8000, every = 100, world = 'se' } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      last = await (world === 'se' ? this.se(fn) : this.eval(fn));
      if (last) return last;
      await sleep(every);
    }
    throw new Error(`timed out: ${fn} (last: ${JSON.stringify(last)})`);
  }

  async close() {
    this.off();
    await this.browser.send('Target.closeTarget', { targetId: this.targetId });
  }
}
