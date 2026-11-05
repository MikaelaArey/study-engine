#!/usr/bin/env node
// Study Engine's local server. It serves the app from public/ and, when an Anthropic API key
// is set in .env, answers the app's live AI requests at /api/ai. It listens on this computer
// only. No packages to install: it uses Node's built-in modules.
//
//   node server.js          start on http://localhost:3001 (or the next free port)
//   node server.js --open   ...and open it in the browser

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
loadEnv(path.join(ROOT, '.env'));

const KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const API = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
const MODELS = {
  default: process.env.STUDY_ENGINE_MODEL || 'claude-sonnet-5-5',
  quick: process.env.STUDY_ENGINE_QUICK_MODEL || 'claude-haiku-4-5-20251001',
};
const MAX_TOKENS = { default: 4096, quick: 1024 };
const FIRST_PORT = Number(process.env.PORT) || 3001;
const OPEN = process.argv.includes('--open');
const MAX_BODY = 300 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Reads KEY=value lines from .env without overriding variables that are already set.
function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(line)) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function serveFile(req, res) {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { code: 'prompt_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// The reply as one JSON value: the whole text, else a fenced block, else first bracket to last.
function parseJson(text) {
  const tries = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (start !== -1 && end > start) tries.push(text.slice(start, end + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  return undefined;
}

// Only this app's own pages may use the API route, so another website open in the
// browser can't spend the API key.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    return (o.hostname === 'localhost' || o.hostname === '127.0.0.1') && o.port === String(req.socket.localPort);
  } catch {
    return false;
  }
}

async function handleAi(req, res) {
  if (!sameOrigin(req)) return send(res, 403, { code: 'forbidden', message: 'Requests must come from Study Engine.' });
  if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return send(res, 415, { code: 'invalid_request', message: 'Send JSON.' });
  if (!KEY) return send(res, 503, { code: 'not_configured', message: 'Set ANTHROPIC_API_KEY in .env to turn on live AI.' });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (e) {
    return e.code === 'prompt_too_large'
      ? send(res, 413, { code: 'prompt_too_large', message: 'That prompt is too long.' })
      : send(res, 400, { code: 'invalid_request', message: 'The request wasn’t valid JSON.' });
  }
  const prompt = typeof body?.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return send(res, 400, { code: 'invalid_request', message: 'The prompt is empty.' });
  const tier = body.tier === 'quick' ? 'quick' : 'default';

  let upstream;
  let data = null;
  try {
    upstream = await fetch(`${API}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELS[tier],
        max_tokens: MAX_TOKENS[tier],
        system: 'You are the study coach inside a study app. When asked for JSON, reply with only that JSON and no other text.',
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(150000),
    });
    data = await upstream.json().catch(() => null);
  } catch {
    return send(res, 502, { code: 'upstream_error', message: 'Couldn’t reach the Anthropic API. Check the internet connection.' });
  }
  if (!upstream.ok) {
    const s = upstream.status;
    const code = s === 401 || s === 403 ? 'auth_failed' : s === 429 || s === 529 ? 'rate_limited' : s === 413 ? 'prompt_too_large' : 'upstream_error';
    console.warn(`Anthropic API error ${s}: ${data?.error?.message || 'no details'}`);
    return send(res, code === 'auth_failed' ? 401 : 502, { code, message: data?.error?.message || `Anthropic API error ${s}` });
  }
  const text = (data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const value = parseJson(text);
  if (value === undefined) {
    return send(res, 502, { code: 'invalid_json', message: data?.stop_reason === 'max_tokens' ? 'The answer was cut short.' : 'The answer wasn’t valid JSON.' });
  }
  send(res, 200, { json: value, model: data.model });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/status' && req.method === 'GET') return send(res, 200, { app: 'study-engine', ai: !!KEY, models: KEY ? MODELS : null });
  if (pathname === '/api/ai') {
    if (req.method !== 'POST') return send(res, 405, { code: 'invalid_request', message: 'Use POST.' });
    return handleAi(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) send(res, 500, { code: 'upstream_error', message: 'Something went wrong in the local server.' });
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
  serveFile(req, res);
});

function openBrowser(url) {
  if (!OPEN) return;
  const cmd = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}

// Is Study Engine already answering on this port? Then just open it.
async function alreadyRunning(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) });
    return (await r.json())?.app === 'study-engine';
  } catch {
    return false;
  }
}

function listen(port, triesLeft) {
  server.once('error', async (err) => {
    if (err.code !== 'EADDRINUSE') throw err;
    if (await alreadyRunning(port)) {
      const url = `http://localhost:${port}`;
      console.log(`Study Engine is already running. Opening ${url}`);
      openBrowser(url);
      process.exit(0);
    }
    if (triesLeft > 0) return listen(port + 1, triesLeft - 1);
    console.error(`Ports ${FIRST_PORT} to ${port} are all in use. Set PORT in .env to a free one.`);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(`\nStudy Engine is running at ${url}`);
    console.log(KEY ? `Live AI: on (${MODELS.default}, ${MODELS.quick} for quick checks)` : 'Live AI: off. Add ANTHROPIC_API_KEY to .env and restart to turn it on. The sample documents work without it.');
    console.log('Keep this window open while you use it. Press Ctrl+C to stop.\n');
    openBrowser(url);
  });
}

process.on('SIGINT', () => {
  console.log('\nStudy Engine stopped.');
  process.exit(0);
});

listen(FIRST_PORT, 9);
