/*
 * Study Engine: service worker.
 *
 * - Spelling for every tab, with the dictionary loaded once (lib/spell.js).
 * - All calls to Claude (the Anthropic Messages API), with the key from lib/secrets.js:
 *   writing checks, fact checks with web search, study questions, grading, and the editor's
 *   own prompts. Results are cached for the browser session, identical requests share one
 *   call, and at most a few run at once.
 * - Opening the editor, from the toolbar, a right-click on selected text, or a page's
 *   "Open in Study Engine".
 *
 * Privacy: the only network requests go to api.anthropic.com, and only after you add a key.
 * Nothing is logged or sent anywhere else.
 */
'use strict';

importScripts('lib/text.js', 'lib/spell.js', 'lib/rules.js', 'lib/prompts.js', 'lib/settings.js', 'lib/secrets.js');

const SE = self.StudyEngine;
const T = SE.text;
const P = SE.prompts;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

let settings = null;
async function getSettings() {
  if (!settings) settings = await SE.settings.load();
  return settings;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const prev = settings;
    settings = SE.settings.withDefaults(changes.settings.newValue);
    if (prev && prev.dialect !== settings.dialect) speller = null;
    refreshAiStatus();
  }
  if (changes.personalDictionary && speller) speller.setPersonal(changes.personalDictionary.newValue || []);
});

// ---------------------------------------------------------------------------
// Spelling
// ---------------------------------------------------------------------------

let speller = null;
let spellerLoading = null;
async function getSpeller() {
  if (speller) return speller;
  if (!spellerLoading) {
    spellerLoading = (async () => {
      const s = await getSettings();
      const dialect = s.dialect === 'en-GB' ? 'en-GB' : 'en-US';
      const other = dialect === 'en-GB' ? 'en-US' : 'en-GB';
      const [text, extra, variants] = await Promise.all([`data/dict-${dialect}.txt`, 'data/extra-words.txt', `data/variants-${other}.txt`].map(async (f) => (await fetch(chrome.runtime.getURL(f))).text()));
      const sp = new SE.Speller();
      sp.load(text, dialect);
      sp.load(extra, dialect, { append: true });
      sp.loadVariants(variants);
      const { personalDictionary } = await chrome.storage.local.get('personalDictionary');
      sp.setPersonal(personalDictionary || []);
      speller = sp;
      return sp;
    })().finally(() => {
      spellerLoading = null;
    });
  }
  return spellerLoading;
}

async function onSpell(msg) {
  const sp = await getSpeller();
  const words = Array.isArray(msg.words) ? msg.words.slice(0, 3000) : [];
  return { results: words.map((x) => sp.check(String(x.w || ''), { sentenceStart: !!x.s, repeats: Number(x.r) || 1 })) };
}

async function onDictAdd(msg) {
  const word = String(msg.word || '').trim().replace(/’/g, "'");
  if (!word || word.length > 60 || /\s/.test(word)) throw coded('invalid', 'That can’t be added to the dictionary.');
  const { personalDictionary = [] } = await chrome.storage.local.get('personalDictionary');
  if (!personalDictionary.some((w) => w.toLowerCase() === word.toLowerCase())) {
    personalDictionary.push(word);
    personalDictionary.sort((a, b) => a.localeCompare(b));
    await chrome.storage.local.set({ personalDictionary });
  }
  return { word };
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------

const coded = (code, message, extra) => Object.assign(new Error(message || code), { code, ...extra });

let keyCache;
async function apiKey() {
  if (keyCache === undefined) keyCache = (await SE.secrets.get('anthropicKey').catch(() => '')) || '';
  return keyCache;
}

let webSearchOff = false; // set when the organization has web search turned off

async function refreshAiStatus() {
  const key = await apiKey();
  const s = await getSettings();
  await chrome.storage.local.set({ aiStatus: { keyAdded: !!key, ready: !!key && s.ai.enabled !== false, webSearch: !webSearchOff && s.ai.webSearch !== false } });
}

// Requests to a local test server are allowed only in unpacked (development) installs.
async function apiBase() {
  if (!chrome.runtime.getManifest().update_url) {
    const { devApiBase } = await chrome.storage.local.get('devApiBase');
    if (typeof devApiBase === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(devApiBase)) return devApiBase;
  }
  return 'https://api.anthropic.com';
}

// Keeps the service worker alive while a long request (such as a fact check with web
// searches) is waiting. Calling an extension API resets Chrome's idle timer.
let holds = 0;
let holdTimer = 0;
function holdAlive() {
  if (holds++ === 0) holdTimer = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds === 0) clearInterval(holdTimer);
  };
}

// At most MAX_ACTIVE calls at once; the rest wait their turn.
const MAX_ACTIVE = 3;
let active = 0;
const waiting = [];
async function slot() {
  if (active < MAX_ACTIVE) {
    active++;
    return;
  }
  await new Promise((resolve) => waiting.push(resolve));
  active++;
}
function release() {
  active--;
  waiting.shift()?.();
}

// A local cap on calls per minute, so a runaway page can't run up a bill.
const recent = [];
function spend() {
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= 45) throw coded('busy', 'Study Engine paused AI checks for a minute to keep usage down. They start again on their own.');
  recent.push(now);
}

let cooldownUntil = 0;

// Session cache: the same request within this browser session returns the same answer.
const cache = new Map();
const inflight = new Map();
const CACHE_MAX = 300;
async function cacheGet(key) {
  if (cache.has(key)) return cache.get(key);
  const stored = await chrome.storage.session.get(`c:${key}`).catch(() => ({}));
  return stored[`c:${key}`];
}
function cachePut(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.delete(first);
    chrome.storage.session.remove(`c:${first}`).catch(() => {});
  }
  chrome.storage.session.set({ [`c:${key}`]: value }).catch(() => {});
}

function parseJson(text) {
  const t = String(text || '').trim();
  const attempts = [t];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) attempts.push(fence[1]);
  const first = t.search(/[[{]/);
  const last = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (first >= 0 && last > first) attempts.push(t.slice(first, last + 1));
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {}
  }
  return undefined;
}

// A JSON example of a schema, for the fallback when structured output isn't accepted.
function example(schema) {
  if (!schema) return null;
  if (schema.enum) return schema.enum.join(' | ');
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([k, v]) => [k, example(v)]));
  if (schema.type === 'array') return [example(schema.items)];
  return schema.type === 'string' ? '...' : schema.type;
}

async function recordUsage(kind, usage) {
  if (!usage) return;
  const month = new Date().toISOString().slice(0, 7);
  const { usage: u } = await chrome.storage.local.get('usage');
  const cur = u && u.month === month ? u : { month, requests: 0, inputTokens: 0, outputTokens: 0, searches: 0, byKind: {} };
  cur.requests += 1;
  cur.inputTokens += (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  cur.outputTokens += usage.output_tokens || 0;
  cur.searches += usage.server_tool_use?.web_search_requests || 0;
  cur.byKind[kind] = (cur.byKind[kind] || 0) + 1;
  await chrome.storage.local.set({ usage: cur });
}

async function post(body, kind, { timeout = 90000 } = {}) {
  const key = await apiKey();
  if (!key) throw coded('not_configured', 'Add your Anthropic API key in Study Engine’s settings to turn on AI checks.');
  if (Date.now() < cooldownUntil) throw coded('rate_limited', 'Anthropic asked Study Engine to slow down. AI checks start again shortly.');
  const base = await apiBase();
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      clearTimeout(timer);
      if (ctrl.signal.aborted) throw coded('timeout', 'Claude took too long to answer. Try again.');
      throw coded('offline', 'Couldn’t reach Anthropic. Check your internet connection.');
    }
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      recordUsage(kind, data.usage).catch(() => {});
      return data;
    }
    const message = String(data?.error?.message || `HTTP ${res.status}`);
    if ((res.status === 529 || res.status >= 500) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (res.status === 401) throw coded('auth_failed', 'Anthropic didn’t accept your API key. Check it in Study Engine’s settings.');
    if (res.status === 403) throw coded('forbidden', `Your API key isn’t allowed to do this: ${message}`);
    if (res.status === 404) throw coded('model_not_found', `That Claude model isn’t available to your account: ${message}`);
    if (res.status === 413) throw coded('prompt_too_large', 'That’s too much text for one check.');
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after')) || 30;
      cooldownUntil = Date.now() + Math.min(wait, 120) * 1000;
      throw coded('rate_limited', 'Anthropic’s rate limit was reached. AI checks start again shortly.');
    }
    if (res.status === 400) {
      if (/credit balance/i.test(message)) throw coded('no_credit', 'Your Anthropic account is out of credit. Add credit in the Anthropic Console.');
      if (/web.?search/i.test(message) && /not (?:been )?enabled|disabled|not available|not supported/i.test(message)) throw coded('web_search_disabled', message);
      if (/output_config|json_schema|structured output|output format/i.test(message)) throw coded('schema_unsupported', message);
      throw coded('invalid_request', message);
    }
    if (res.status >= 500) throw coded('overloaded', 'Claude is busy right now. Try again in a moment.');
    throw coded('upstream_error', message);
  }
  throw coded('overloaded', 'Claude is busy right now. Try again in a moment.');
}

/*
 * Claude 4.6 and later models think before they answer, and thinking counts
 * toward max_tokens. Each kind of check sets how hard Claude works, and models
 * that take `effort` get room to think. Haiku 4.5 doesn't take `effort`.
 */
const EFFORT = { write: 'low', grade: 'low', facts: 'medium', study: 'medium' };
const takesEffort = (model) => /^claude-(?:haiku-5|sonnet-5|opus-5|fable-5|mythos|sonnet-4-6|opus-4-[5-8])/.test(model);

/*
 * One call to Claude. Returns { json, text, citations, searches }.
 * `schema` turns on structured output; `tools` adds server tools such as web search.
 */
async function claude({ kind, model, system, prompt, schema, maxTokens = 2000, tools, timeout }) {
  const effort = takesEffort(model) ? EFFORT[kind] || 'medium' : null;
  const limit = effort ? maxTokens + (effort === 'low' ? 3000 : 8000) : maxTokens;
  const cacheKey = T.hash(JSON.stringify([kind, model, system.length, T.hash(system), prompt, tools ? 1 : 0]));
  const hit = await cacheGet(cacheKey);
  if (hit) return hit;
  if (inflight.has(cacheKey)) return inflight.get(cacheKey);
  const job = (async () => {
    await slot();
    const done = holdAlive();
    try {
      spend();
      // `full` sends output_config (effort and the JSON schema). If the API rejects it, the retry leaves it out.
      const run = async (full) => {
        const body = { model, max_tokens: limit, system, messages: [{ role: 'user', content: full || !schema ? prompt : `${prompt}\n\nReply with only JSON in this shape:\n${JSON.stringify(example(schema))}` }] };
        if (full && (schema || effort)) body.output_config = { ...(effort && { effort }), ...(schema && { format: { type: 'json_schema', schema } }) };
        if (tools) body.tools = tools;
        let data = await post(body, kind, { timeout });
        const content = [...(data.content || [])];
        // A long turn with server tools can pause; send it back to let it finish.
        for (let i = 0; i < 3 && data.stop_reason === 'pause_turn'; i++) {
          body.messages = [body.messages[0], { role: 'assistant', content }];
          data = await post(body, kind, { timeout });
          content.push(...(data.content || []));
        }
        return { data, content };
      };
      let r;
      try {
        r = await run(true);
      } catch (e) {
        if (e.code !== 'schema_unsupported') throw e;
        r = await run(false);
      }
      const { data, content } = r;
      if (data.stop_reason === 'refusal') throw coded('refused', 'Claude declined to check this text.');
      // With web search, the answer is the text after the last search result.
      let lastTool = -1;
      content.forEach((b, i) => {
        if (b.type === 'server_tool_use' || b.type === 'web_search_tool_result') lastTool = i;
      });
      const finalText = content.slice(lastTool + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const allText = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const json = parseJson(finalText) ?? parseJson(allText);
      if (json === undefined) throw coded(data.stop_reason === 'max_tokens' ? 'truncated' : 'invalid_json', 'The answer came back in an unexpected shape. Try again.');
      const citations = [];
      for (const b of content) for (const c of b.citations || []) if (c.url && !citations.some((x) => x.url === c.url)) citations.push({ url: c.url, title: c.title || c.url });
      const searches = content.filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').length;
      const result = { json, citations, searches };
      cachePut(cacheKey, result);
      return result;
    } finally {
      done();
      release();
    }
  })();
  inflight.set(cacheKey, job);
  try {
    return await job;
  } finally {
    inflight.delete(cacheKey);
  }
}

async function assertAi() {
  const s = await getSettings();
  if (s.ai.enabled === false) throw coded('ai_off', 'AI checks are turned off in Study Engine’s settings.');
  if (!(await apiKey())) throw coded('not_configured', 'Add your Anthropic API key in Study Engine’s settings to turn on AI checks.');
  return s;
}

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const CATS = new Set(['correctness', 'clarity', 'engagement', 'tone']);

async function onWriteCheck(msg) {
  const s = await assertAi();
  const text = String(msg.text || '').slice(0, 6000);
  if (T.wordCount(text) < 2) return { issues: [], tone: [] };
  const p = P.writingCheck({ text, goal: msg.goal, dialect: s.dialect, mode: msg.mode, site: clip(msg.site, 80), flagged: Array.isArray(msg.flagged) ? msg.flagged : [] });
  const { json } = await claude({ kind: 'write', model: s.ai.writingModel, ...p });
  const issues = [];
  for (const it of (Array.isArray(json?.issues) ? json.issues : []).slice(0, 25)) {
    const loc = P.locate(text, p.sentences, it?.sentence, it?.quote);
    if (!loc) continue;
    const original = text.slice(loc.start, loc.end);
    const category = CATS.has(it.category) ? it.category : 'correctness';
    let replacement = typeof it.replacement === 'string' ? it.replacement : '';
    if (replacement === original || (msg.mode === 'study' && category !== 'correctness')) replacement = '';
    if (replacement.length > original.length * 3 + 40) replacement = ''; // a rewrite, not a fix
    issues.push({ start: loc.start, end: loc.end, original, category, title: clip(it.title, 60) || 'Suggestion', message: clip(it.explanation, 240), replacements: replacement ? [replacement] : [] });
  }
  const tone = (Array.isArray(json?.tone) ? json.tone : []).filter((t) => P.TONES.includes(t)).slice(0, 3);
  return { issues, tone };
}

const safeUrl = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};

async function onFactCheck(msg) {
  const s = await assertAi();
  const text = String(msg.text || '').slice(0, 8000);
  if (T.wordCount(text) < 4) return { claims: [], searched: false };
  const today = new Date().toISOString().slice(0, 10);
  const wantSearch = s.ai.webSearch !== false && !webSearchOff;
  const attempt = async (search) => {
    const p = P.factCheck({ text, context: clip(msg.context, 400), site: clip(msg.site, 80), search, today });
    const tools = search ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] : undefined;
    const r = await claude({ kind: 'facts', model: s.ai.factModel, ...p, tools, timeout: 180000 });
    return { p, r, search };
  };
  let out;
  try {
    out = await attempt(wantSearch);
  } catch (e) {
    if (e.code !== 'web_search_disabled') throw e;
    webSearchOff = true;
    refreshAiStatus();
    out = await attempt(false);
  }
  const { p, r, search } = out;
  const claims = [];
  for (const c of (Array.isArray(r.json?.claims) ? r.json.claims : []).slice(0, 12)) {
    if (!['incorrect', 'misleading', 'unverified'].includes(c?.verdict)) continue;
    const loc = P.locate(text, p.sentences, c.sentence, c.quote);
    if (!loc) continue;
    let sources = (Array.isArray(c.sources) ? c.sources : []).map((x) => ({ url: safeUrl(x?.url), title: clip(x?.title, 120) })).filter((x) => x.url).slice(0, 3);
    if (!sources.length && search) sources = r.citations.slice(0, 2).map((x) => ({ url: safeUrl(x.url), title: clip(x.title, 120) })).filter((x) => x.url);
    for (const src of sources) if (!src.title) src.title = new URL(src.url).hostname;
    claims.push({ start: loc.start, end: loc.end, original: text.slice(loc.start, loc.end), verdict: c.verdict, message: clip(c.issue, 320), correction: clip(c.correction, 120), sources });
  }
  return { claims, searched: search && r.searches > 0, webSearch: search };
}

async function onStudy(msg) {
  const s = await assertAi();
  const text = String(msg.text || '').slice(0, 6000);
  if (T.wordCount(text) < 8) return { safety: 'ok', questions: [] };
  const p = P.studyQuestions({ text, goal: msg.goal, site: clip(msg.site, 80), max: Math.min(5, Number(msg.max) || 3), recent: Array.isArray(msg.recent) ? msg.recent.map((q) => clip(q, 160)) : [] });
  const { json } = await claude({ kind: 'study', model: s.ai.studyModel, ...p });
  if (json?.safety === 'support') return { safety: 'support', questions: [] };
  const questions = [];
  for (const q of (Array.isArray(json?.questions) ? json.questions : []).slice(0, 6)) {
    const loc = P.locate(text, p.sentences, q?.sentence, q?.quote);
    if (!loc || !q.question) continue;
    questions.push({
      start: loc.start, end: loc.end, original: text.slice(loc.start, loc.end),
      kind: ['remember', 'reason', 'words'].includes(q.kind) ? q.kind : 'reason',
      title: clip(q.title, 60) || 'Question', question: clip(q.question, 240),
      keyPoints: (Array.isArray(q.key_points) ? q.key_points : []).slice(0, 3).map((k) => clip(k, 160)),
      hint: clip(q.hint, 200), reveal: clip(q.reveal, 400),
      word: clip(q.word, 40), definition: clip(q.definition, 200), why: clip(q.why, 240),
    });
  }
  return { safety: 'ok', questions };
}

async function onGrade(msg) {
  const s = await assertAi();
  const p = P.grade({ question: clip(msg.question, 400), keyPoints: (msg.keyPoints || []).slice(0, 5), reveal: clip(msg.reveal, 600), answer: msg.answer, attempt: Number(msg.attempt) || 1 });
  const { json } = await claude({ kind: 'grade', model: s.ai.writingModel, ...p });
  if (!['correct', 'partial', 'incorrect', 'no_attempt'].includes(json?.verdict)) throw coded('invalid_json', 'The answer came back in an unexpected shape. Try again.');
  return { verdict: json.verdict, feedback: clip(json.feedback, 400), hint: json.verdict === 'correct' ? '' : clip(json.hint, 300) };
}

async function onWordUsage(msg) {
  const s = await assertAi();
  const p = P.wordUsage({ word: clip(msg.word, 40), definition: clip(msg.definition, 200), sentence: clip(msg.sentence, 600) });
  const { json } = await claude({ kind: 'grade', model: s.ai.writingModel, ...p });
  return { verdict: json?.verdict || 'correct', feedback: clip(json?.feedback, 300) };
}

// The editor's own prompts (study guides, quiz grading, rubric audits), which ask for JSON
// in their text. "quick" runs on the writing model, everything else on the study model.
async function onAiJson(msg) {
  const s = await assertAi();
  const prompt = String(msg.prompt || '').slice(0, 60000);
  const model = msg.tier === 'quick' ? s.ai.writingModel : s.ai.studyModel;
  const system = 'You are the AI inside Study Engine, a writing and study assistant. Follow the task in the user message exactly, and reply with only the JSON it asks for: no prose, no code fences.';
  const { json } = await claude({ kind: msg.tier === 'quick' ? 'grade' : 'study', model, system, prompt, maxTokens: msg.tier === 'quick' ? 1024 : 4096 });
  return { json };
}

async function onTestKey(msg, sender) {
  if (!fromExtensionPage(sender)) throw coded('forbidden', 'Not allowed.');
  keyCache = undefined;
  const s = await getSettings();
  const data = await post({ model: s.ai.writingModel, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the word OK.' }] }, 'test', { timeout: 30000 });
  await refreshAiStatus();
  return { model: data.model || s.ai.writingModel };
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

async function openEditor({ text = '', title = '', goal = '', source = '' } = {}) {
  let hash = '';
  if (text) {
    const id = Math.random().toString(36).slice(2, 10);
    await chrome.storage.session.set({ [`handoff:${id}`]: { text: String(text).slice(0, 200000), title: clip(title, 120), goal, source: clip(source, 120), at: Date.now() } });
    hash = `#handoff=${id}`;
  }
  await chrome.tabs.create({ url: chrome.runtime.getURL(`editor/index.html${hash}`) });
  return {};
}

function setupMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'se-check-selection', title: 'Check with Study Engine', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'se-open-editor', title: 'Open the Study Engine editor', contexts: ['action'] });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'se-check-selection' && info.selectionText) {
    let host = '';
    try {
      host = new URL(tab?.url || info.pageUrl || '').hostname;
    } catch {}
    openEditor({ text: info.selectionText, title: 'Selected text', source: host });
  } else if (info.menuItemId === 'se-open-editor') {
    openEditor();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  setupMenus();
  refreshAiStatus();
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => {
  setupMenus();
  refreshAiStatus();
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const fromExtensionPage = (sender) => sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));

const HANDLERS = {
  'se:spell': onSpell,
  'se:dict-add': onDictAdd,
  'se:write-check': onWriteCheck,
  'se:fact-check': onFactCheck,
  'se:study': onStudy,
  'se:grade': onGrade,
  'se:word-usage': onWordUsage,
  'se:ai-json': onAiJson,
  'se:test-key': onTestKey,
  'se:open-editor': (msg) => openEditor(msg),
  'se:open-options': async () => {
    await chrome.runtime.openOptionsPage();
    return {};
  },
  'se:key-changed': async (msg, sender) => {
    if (!fromExtensionPage(sender)) throw coded('forbidden', 'Not allowed.');
    keyCache = undefined;
    webSearchOff = false;
    cache.clear();
    await refreshAiStatus();
    return {};
  },
  'se:status': async () => {
    const { aiStatus, usage } = await chrome.storage.local.get(['aiStatus', 'usage']);
    return { aiStatus: aiStatus || null, usage: usage || null, dictionary: speller ? speller.size : 0 };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(
      (result) => sendResponse({ ok: true, ...result }),
      (e) => sendResponse({ ok: false, error: { code: e?.code || 'error', message: e?.message || String(e) } }),
    );
  return true;
});
