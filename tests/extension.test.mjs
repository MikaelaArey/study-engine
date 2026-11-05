// End-to-end tests: Study Engine loaded in headless Chrome, with a stand-in Anthropic API.
// Run: node --test --test-concurrency=1 tests/extension.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, startStatic, startMockApi, reply, sleep } from './harness.mjs';

// ---------------------------------------------------------------------------
// The stand-in API: answers each kind of prompt the way Claude would for the test texts.
// ---------------------------------------------------------------------------

const sentencesOf = (prompt) => [...prompt.matchAll(/^\[(d\d+)\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] }));
const find = (prompt, needle) => sentencesOf(prompt).find((s) => s.text.includes(needle));
let apiMode = 'ok'; // 'ok' | 'auth' | 'ratelimit'

function respond(body) {
  if (apiMode === 'auth') return { status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  if (apiMode === 'ratelimit') return { status: 429, headers: { 'retry-after': '1' }, json: { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } } };
  const prompt = body.messages[0].content;
  const system = body.system || '';
  if (prompt === 'Reply with the word OK.') return reply('OK', { model: body.model });
  if (prompt.startsWith('Task: check this writing')) {
    const issues = [];
    const s1 = find(prompt, 'conditions was');
    if (s1) issues.push({ sentence: s1.id, quote: 'conditions was', category: 'correctness', title: 'Subject-verb agreement', replacement: 'conditions were', explanation: 'A plural subject takes “were”.' });
    const s2 = find(prompt, 'kind of a big deal');
    if (s2) issues.push({ sentence: s2.id, quote: 'kind of a big deal', category: 'tone', title: 'Informal phrase', replacement: 'significant', explanation: 'This reads as casual for an academic paper.' });
    const s3 = find(prompt, 'not exist quote');
    if (s3) issues.push({ sentence: s3.id, quote: 'words that are not in the text', category: 'clarity', title: 'Bad quote', replacement: 'x', explanation: 'Should be dropped.' });
    return reply({ issues, tone: ['formal', 'analytical'] });
  }
  if (prompt.startsWith('Task: check the factual claims')) {
    const claims = [];
    const s = find(prompt, 'completed in 1899');
    if (s) claims.push({ sentence: s.id, quote: 'completed in 1899', verdict: 'incorrect', issue: 'Sources say the Eiffel Tower was completed in 1889, for the World’s Fair.', correction: '1889', sources: [{ title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }, { title: 'Bad link', url: 'javascript:alert(1)' }] });
    const searched = !!body.tools?.some((t) => t.type?.startsWith('web_search'));
    const before = searched ? [
      { type: 'text', text: 'I’ll check the dates.' },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: { query: 'Eiffel Tower completed year' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower', title: 'Eiffel Tower', encrypted_content: 'x', page_age: null }] },
    ] : [];
    return reply({ claims }, { before, usage: { server_tool_use: { web_search_requests: searched ? 1 : 0 } } });
  }
  if (prompt.startsWith('Task: find up to')) {
    const questions = [];
    const s = find(prompt, 'lots of coal');
    if (s) questions.push({ sentence: s.id, quote: 'because Britain had lots of coal', kind: 'reason', title: 'Coal is one reason', question: 'Coal is one reason. What else did Britain have that other countries didn’t?', key_points: ['Colonies', 'Capital to invest'], hint: 'Think about money and trade.', reveal: 'Colonies for raw materials and markets, and capital to invest.', word: '', definition: '', why: '' });
    const w = find(prompt, 'enzymes broke');
    if (w) questions.push({ sentence: w.id, quote: 'broke', kind: 'words', title: 'A precise word for broke', question: 'There’s a biology term for what heat does to an enzyme’s shape. Can you name it?', key_points: [], hint: '', reveal: '', word: 'denatured', definition: 'Changed shape so it no longer works.', why: 'The enzymes changed shape; they didn’t break apart.' });
    return reply({ safety: prompt.includes('I want to hurt myself') ? 'support' : 'ok', questions });
  }
  if (prompt.startsWith('Task: mark one student answer')) {
    const answer = /<answer[^>]*>\n([\s\S]*?)\n<\/answer>/.exec(prompt)?.[1] || '';
    return reply(/colon/i.test(answer) ? { verdict: 'correct', feedback: 'Yes: colonies gave Britain raw materials and markets.', hint: '' } : { verdict: 'incorrect', feedback: 'Not quite yet.', hint: 'Think about trade.' });
  }
  if (system.startsWith('You are the AI inside Study Engine')) {
    // The editor's "Ask me questions" (its own JSON array format).
    if (prompt.includes('find up to 6 places')) return reply([{ kind: 'reason', quote: 'the most important was coal', title: 'Why coal?', question: 'Why did coal matter so much?', keyPoints: ['Powered steam engines'], hint: 'Think about engines.', reveal: 'Coal powered the steam engines that ran factories.' }]);
    return reply({});
  }
  return reply({});
}

let b;
let web;
let api;
let sw;
const ctx = {};

before(async () => {
  web = await startStatic();
  api = await startMockApi(respond);
  b = await launch();
  sw = await b.serviceWorker();
  await sw.evaluate(`chrome.storage.local.set({ devApiBase: ${JSON.stringify(api.url)} })`);
});

after(async () => {
  await b?.close();
  web?.server.close();
  api?.server.close();
});

async function setKey(on = true) {
  await sw.evaluate(on ? `StudyEngine.secrets.set('anthropicKey', 'sk-ant-test-0123456789abcdefghij')` : `StudyEngine.secrets.remove('anthropicKey')`);
  await sw.evaluate(`(async () => { keyCache = undefined; webSearchOff = false; cache.clear(); await chrome.storage.session.clear(); await refreshAiStatus(); })()`);
}
async function resetSettings(patch = {}) {
  await sw.evaluate(`chrome.storage.local.set({ settings: ${JSON.stringify(patch)}, personalDictionary: [], glossary: [] })`);
  await sw.evaluate(`(async () => { cache.clear(); await chrome.storage.session.clear(); })()`);
  await sleep(100);
}
const session = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); return StudyEngine.content.state.sessions.get(el) || null; })()`;
const issuesOf = (p, sel) => p.se(`(() => { const s = ${session(sel)}; return s ? s.issues.map((i) => ({ rule: i.rule, category: i.category, original: i.original, replacements: i.replacements, source: i.source })) : null; })()`);

// ---------------------------------------------------------------------------
// Local checks
// ---------------------------------------------------------------------------

test('textarea: spelling and rules are underlined, no network', async () => {
  await setKey(false);
  await resetSettings();
  const before = api.requests.length;
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#ta');
  await p.insertText('I recieve teh letter yesterday. Their is a apple on the the table.');
  const issues = await p.waitFor(`(() => { const s = ${session('#ta')}; return s && s.issues.length >= 5 && s.issues; })()`);
  const rules = issues.map((i) => i.rule);
  for (const r of ['spelling', 'there-is', 'a-an', 'repeated-word']) assert.ok(rules.includes(r), r);
  const marks = await p.se(`[...${session('#ta')}.overlay.marks.keys()].length`);
  assert.equal(marks, issues.length);
  assert.equal(api.requests.length, before, 'no AI requests without a key');
  await p.close();
});

test('accepting a fix edits the textarea, and undo brings it back', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#ta');
  await p.insertText('I recieve teh letter.');
  await p.waitFor(`${session('#ta')}?.issues.some((i) => i.original === 'teh')`);
  await p.se(`(() => { const s = ${session('#ta')}; const i = s.issues.find((x) => x.original === 'teh'); s.accept(i, i.replacements[0]); })()`);
  assert.equal(await p.eval(`document.querySelector('#ta').value`), 'I recieve the letter.');
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'z', code: 'KeyZ', modifiers: 4, commands: ['undo'] });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'z', code: 'KeyZ', modifiers: 4 });
  await sleep(100);
  assert.equal(await p.eval(`document.querySelector('#ta').value`), 'I recieve teh letter.');
  await p.close();
});

test('text input and contenteditable both work, and fixes edit the rich editor', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#txt');
  await p.insertText('Their is a apple');
  await p.waitFor(`${session('#txt')}?.issues.length >= 2`);
  await p.focus('#ce');
  await p.insertText('Yesterday i went too the store.');
  const ce = await p.waitFor(`(() => { const s = ${session('#ce')}; return s && s.issues.length >= 2 && s.issues.map((i) => i.rule); })()`);
  assert.ok(ce.includes('lowercase-i') && ce.includes('too-to'));
  const hl = await p.se(`[...CSS.highlights.keys()]`);
  assert.ok(hl.includes('se-correctness'));
  await p.se(`(() => { const s = ${session('#ce')}; const i = s.issues.find((x) => x.rule === 'too-to'); s.accept(i, 'to'); })()`);
  assert.equal(await p.eval(`document.querySelector('#ce').textContent`), 'Yesterday i went to the store.');
  await p.close();
});

test('a real rich-text editor (Quill): fixes go through its own model', async () => {
  const p = await b.open(`${web.url}/quill.html`);
  await p.focus('.ql-editor');
  await p.insertText('I recieve teh letter. Their is a apple.');
  await p.waitFor(`${session('.ql-editor')}?.issues.length >= 4`);
  await p.se(`(() => { const s = ${session('.ql-editor')}; const i = s.issues.find((x) => x.original === 'recieve'); s.accept(i, 'receive'); })()`);
  await sleep(100);
  assert.equal(await p.eval(`q.getText().trim()`), 'I receive teh letter. Their is a apple.');
  await p.waitFor(`${session('.ql-editor')}?.issues.some((i) => i.original === 'teh')`);
  await p.se(`(() => { const s = ${session('.ql-editor')}; s.acceptAll(s.issues.filter((i) => i.category === 'correctness' && i.replacements.length)); })()`);
  await sleep(150);
  assert.equal(await p.eval(`q.getText().trim()`), 'I receive the letter. There is an apple.');
  await p.close();
});

test('search boxes and name or email fields are not checked', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.eval(`(() => {
    const add = (html) => { const d = document.createElement('div'); d.innerHTML = html; document.querySelector('main').prepend(d); };
    add('<input id="s1" type="search" style="width:300px">');
    add('<input id="s2" type="text" name="q" style="width:300px">');
    add('<input id="s3" type="text" autocomplete="name" style="width:300px">');
    add('<input id="s4" type="text" placeholder="Search the docs" style="width:300px">');
  })()`);
  for (const sel of ['#s1', '#s2', '#s3', '#s4']) {
    await p.focus(sel);
    await p.insertText('teh');
    await sleep(200);
    assert.equal(await p.se(session(sel)), null, sel);
  }
  await p.close();
});

test('email-style editor: signature and quoted reply are not checked', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.eval(`(() => { const d = document.querySelector('#gm'); d.focus(); const s = getSelection(); s.selectAllChildren(d.children[2]); s.collapseToEnd(); })()`);
  await sleep(100);
  await p.insertText(' I recieved them.');
  const issues = await p.waitFor(`(() => { const s = ${session('#gm')}; return s && s.issues.length && s.issues.map((i) => i.original); })()`);
  assert.ok(issues.includes('recieved'));
  assert.ok(!issues.includes('Studnet'), 'signature skipped');
  assert.ok(!issues.includes('teh'), 'quoted reply skipped');
  await p.close();
});

test('passwords, opted-out fields and code editors are left alone', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  for (const sel of ['#pw', '#opt', '#code']) {
    await p.focus(sel);
    await p.insertText(' teh');
    await sleep(250);
    assert.equal(await p.se(session(sel)), null, sel);
  }
  await p.close();
});

test('dismiss, add to dictionary, and the dictionary applies everywhere', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#ta');
  // A capitalised unknown word is taken for a name; a lowercase one is flagged.
  await p.insertText('Zorbling is great. I like zorbling a lot. I recieve it.');
  await p.waitFor(`${session('#ta')}?.issues.some((i) => i.original === 'zorbling')`);
  assert.ok(!(await issuesOf(p, '#ta')).some((i) => i.original === 'Zorbling'), 'names are left alone');
  await p.se(`(() => { const s = ${session('#ta')}; s.dismiss(s.issues.find((x) => x.original === 'recieve')); })()`);
  assert.ok(!(await issuesOf(p, '#ta')).some((i) => i.original === 'recieve'));
  await p.se(`(() => { const s = ${session('#ta')}; return s.addWord(s.issues.find((x) => x.original === 'zorbling')); })()`);
  await p.waitFor(`!${session('#ta')}.issues.some((i) => i.original === 'zorbling')`);
  await p.focus('#ce');
  await p.insertText('More zorbling here.');
  await sleep(500);
  assert.ok(!(await issuesOf(p, '#ce')).some((i) => /zorbling/i.test(i.original)));
  assert.deepEqual(await sw.evaluate(`chrome.storage.local.get('personalDictionary').then((r) => r.personalDictionary)`), ['zorbling']);
  await p.close();
  await resetSettings();
});

test('goals: academic flags contractions; turning a site off removes everything', async () => {
  await resetSettings({ siteGoals: { '127.0.0.1': 'academic' } });
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#ta');
  await p.insertText('The data don’t support it.');
  const rules = await p.waitFor(`(() => { const s = ${session('#ta')}; return s && s.issues.length && s.issues.map((i) => i.rule); })()`);
  assert.ok(rules.includes('contraction'));
  await sw.evaluate(`StudyEngine.settings.update({ disabledSites: ['127.0.0.1'] })`);
  await p.waitFor(`StudyEngine.content.state.sessions.size === 0`);
  await p.focus('#ta');
  await p.insertText(' teh');
  await sleep(300);
  assert.equal(await p.se(`StudyEngine.content.state.sessions.size`), 0);
  await p.close();
  await resetSettings();
});

test('hostile page CSS does not hide or restyle the interface', async () => {
  const p = await b.open(`${web.url}/fields.html`);
  await p.eval(`document.getElementById('hostile').media = 'all'`);
  await p.focus('#ta');
  await p.insertText('I recieve it.');
  await p.waitFor(`${session('#ta')}?.issues.length > 0`);
  const display = await p.eval(`getComputedStyle(document.querySelector('study-engine-ui')).display`);
  assert.equal(display, 'block');
  await p.close();
});

test('a strict Content-Security-Policy does not unstyle the interface or the underlines', async () => {
  const p = await b.open(`${web.url}/strict.csp.html`);
  // The policy really does block inline styles on this page.
  const blocked = await p.eval(`(() => { const s = document.createElement('style'); s.textContent = 'body { margin: 77px }'; document.head.append(s); return getComputedStyle(document.body).marginTop !== '77px'; })()`);
  assert.ok(blocked, 'inline styles are blocked');
  await p.focus('#ta');
  await p.insertText('I recieve teh letter.');
  await p.waitFor(`${session('#ta')}?.issues.length >= 2`);
  assert.equal(await p.se(`getComputedStyle(${session('#ta')}.badgeEl).borderTopLeftRadius`), '50%');
  await p.focus('#ce');
  await p.insertText('Their is a apple.');
  await p.waitFor(`${session('#ce')}?.issues.length >= 2`);
  assert.ok(await p.se(`document.adoptedStyleSheets.some((s) => [...s.cssRules].some((r) => r.cssText.includes('highlight(se-correctness)')))`));
  await p.close();
});

test('fields inside iframes get checked', async () => {
  const p = await b.open(`${web.url}/frame.html`);
  await sleep(400);
  await p.eval(`document.getElementById('f').contentDocument.getElementById('inner').focus()`);
  await p.insertText('I recieve teh letter.');
  await sleep(800);
  // The frame's own content script draws inside the frame; check its mirror there.
  const marks = await p.eval(`(() => { const host = document.getElementById('f').contentDocument.querySelector('study-engine-ui'); return !!host; })()`);
  assert.ok(marks, 'Study Engine layer in the frame');
  await p.close();
});

test('the glossary from Live Definitions: card, then Tab inserts the definition', async () => {
  await sw.evaluate(`chrome.storage.local.set({ glossary: [{ id: 'g1', term: 'churn rate', definition: 'the percentage of customers who stop using a product during a given period.', notes: '' }] })`);
  const p = await b.open(`${web.url}/fields.html`);
  await p.focus('#ta');
  await p.type('Our churn rate is ');
  await p.waitFor(`StudyEngine.content.glossary.showing()`);
  await p.key('Tab', { code: 'Tab', keyCode: 9 });
  await sleep(150);
  assert.equal(await p.eval(`document.querySelector('#ta').value`), 'Our churn rate is the percentage of customers who stop using a product during a given period.');
  await p.close();
  await resetSettings();
});

// ---------------------------------------------------------------------------
// AI checks (with the stand-in API)
// ---------------------------------------------------------------------------

test('AI writing check: request shape, structured output, and the suggestion appears', async () => {
  await resetSettings();
  await setKey(true);
  const start = api.requests.length;
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('Working conditions was dangerous in many mills. Children worked long hours.');
  const ai = await p.waitFor(`(() => { const s = ${session('#paper')}; return s && s.issues.find((i) => i.source === 'ai'); })()`, { timeout: 10000 });
  assert.equal(ai.original, 'conditions was');
  assert.deepEqual(ai.replacements, ['conditions were']);
  const req = api.requests.slice(start).find((r) => r.body?.messages?.[0]?.content.startsWith('Task: check this writing'));
  assert.ok(req, 'a writing check was sent');
  assert.equal(req.headers['x-api-key'], 'sk-ant-test-0123456789abcdefghij');
  assert.equal(req.headers['anthropic-version'], '2023-06-01');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.body.model, 'claude-haiku-5-5');
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.effort, 'low');
  assert.equal(req.body.max_tokens, 5500, 'room for thinking on top of the answer');
  assert.match(req.body.system, /writing checker inside Study Engine/);
  assert.match(req.body.messages[0].content, /\[d1\] Working conditions was dangerous/);
  const tone = await p.se(`${session('#paper')}.tone()`);
  assert.deepEqual(tone, ['formal', 'analytical']);
  await p.close();
});

test('AI suggestions whose quote is not in the text are dropped', async () => {
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('This sentence has a not exist quote marker in it, and nothing else.');
  await sleep(2200);
  const issues = await issuesOf(p, '#paper');
  assert.ok(!issues.some((i) => i.source === 'ai'), JSON.stringify(issues));
  await p.close();
});

test('fact check runs on settled paragraphs, with web search and sources', async () => {
  const start = api.requests.length;
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('The Eiffel Tower in Paris was completed in 1899 and was the tallest structure in the world for decades. Gustave Eiffel’s company designed and built it for the World’s Fair.\n\nToday millions of tourists visit it every year, and it remains a symbol of France and of engineering.');
  const fact = await p.waitFor(`(() => { const s = ${session('#paper')}; return s && s.issues.find((i) => i.category === 'facts'); })()`, { timeout: 15000 });
  assert.equal(fact.original, 'completed in 1899');
  const full = await p.se(`${session('#paper')}.issues.find((i) => i.category === 'facts')`);
  assert.equal(full.verdict, 'incorrect');
  assert.equal(full.correction, '1889');
  assert.deepEqual(full.sources.map((s) => s.url), ['https://en.wikipedia.org/wiki/Eiffel_Tower'], 'unsafe link dropped');
  assert.deepEqual(full.replacements, [], 'facts are never auto-replaced');
  const req = api.requests.slice(start).find((r) => r.body?.messages?.[0]?.content.startsWith('Task: check the factual claims'));
  assert.ok(req.body.tools.some((t) => t.type === 'web_search_20250305' && t.name === 'web_search'));
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  assert.equal(req.body.output_config.effort, 'medium');
  assert.equal(req.body.max_tokens, 11000, 'room for thinking between searches');
  // The card for it.
  const r = await p.se(`(() => { const s = ${session('#paper')}; const i = s.issues.find((x) => x.category === 'facts'); const r = s.overlay.rects(i.id)[0]; return { x: r.left + 4, y: r.top + r.height / 2 }; })()`);
  await p.click(r.x, r.y);
  await sleep(300);
  assert.equal(await p.se(`StudyEngine.content.ui.cardFor()?.issue.category`), 'facts');
  await p.close();
});

test('manual fact check from the panel', async () => {
  await resetSettings({ ai: { facts: 'manual' } });
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('The Eiffel Tower was completed in 1899 for the fair.');
  await sleep(6500);
  assert.ok(!(await issuesOf(p, '#paper')).some((i) => i.category === 'facts'), 'not automatic in manual mode');
  await p.se(`${session('#paper')}.checkFacts()`);
  await p.waitFor(`${session('#paper')}.issues.some((i) => i.category === 'facts')`, { timeout: 10000 });
  await p.close();
  await resetSettings();
});

test('study mode: questions instead of fixes, and answers are graded', async () => {
  await resetSettings({ studySites: ['127.0.0.1'] });
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('The Industrial Revolution started in Britain because Britain had lots of coal. It changed how goods were made in factories.\n\nLater paragraph so the first one is finished.');
  const q = await p.waitFor(`(() => { const s = ${session('#paper')}; return s && s.issues.find((i) => i.category === 'study'); })()`, { timeout: 15000 });
  assert.equal(q.original, 'because Britain had lots of coal');
  const writeReq = api.requests.filter((r) => r.body?.messages?.[0]?.content.startsWith('Task: check this writing')).at(-1);
  assert.match(writeReq.body.messages[0].content, /mode: study/);
  await p.se(`(() => { const s = ${session('#paper')}; const i = s.issues.find((x) => x.category === 'study'); i.study.answer = 'They had colonies'; return s.answer(i); })()`);
  const st = await p.se(`${session('#paper')}.issues.find((x) => x.category === 'study').study`);
  assert.equal(st.result.verdict, 'correct');
  assert.equal(st.done, true);
  await p.close();
  await resetSettings();
});

test('safety: a support signal pauses study questions and shows help', async () => {
  await resetSettings({ studySites: ['127.0.0.1'] });
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('Some days I want to hurt myself and I do not know who to tell about it at school.\n\nAnother paragraph.');
  await p.waitFor(`${session('#paper')}?.safety === true`, { timeout: 15000 });
  await p.close();
  await resetSettings();
});

test('AI errors: a refused key stops AI checks with a clear message', async () => {
  apiMode = 'auth';
  await setKey(true);
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('Working conditions was dangerous. Children worked long hours in the mills.');
  const info = await p.waitFor(`(() => { const s = ${session('#paper')}; const a = s && s.aiInfo(); return a && a.state === 'off' && a; })()`, { timeout: 10000 });
  assert.match(info.reason, /didn’t accept your API key/);
  const n = api.requests.length;
  await p.insertText(' More text here now.');
  await sleep(2000);
  assert.equal(api.requests.length, n, 'no more requests after a refused key');
  apiMode = 'ok';
  await p.close();
});

test('rate limits are temporary', async () => {
  apiMode = 'ratelimit';
  await setKey(true);
  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('A different paragraph about factories and wages in the nineteenth century.');
  const err = await p.waitFor(`${session('#paper')}?.aiError`, { timeout: 10000 });
  assert.equal(err.code, 'rate_limited');
  assert.equal(await p.se(`${session('#paper')}.aiInfo().state`), 'on');
  // The service worker waits as long as the API's retry-after header says (1 second here).
  assert.ok(await sw.evaluate(`cooldownUntil - Date.now() <= 1000`));
  apiMode = 'ok';
  await sleep(1100);
  await p.close();
});

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

test('the API key never reaches web pages or content scripts', async () => {
  await setKey(true);
  const p = await b.open(`${web.url}/fields.html`);
  const all = await p.se(`chrome.storage.local.get(null).then((r) => JSON.stringify(r))`);
  assert.ok(!all.includes('sk-ant-test'), 'not in chrome.storage.local');
  assert.equal(await p.se(`typeof StudyEngine.secrets`), 'undefined');
  assert.equal(await p.eval(`typeof window.StudyEngine`), 'undefined', 'page world can’t see Study Engine');
  const r = await p.se(`new Promise((res) => chrome.runtime.sendMessage({ type: 'se:test-key' }, res))`);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'forbidden');
  await p.close();
});

// ---------------------------------------------------------------------------
// Extension pages
// ---------------------------------------------------------------------------

test('settings page: saving, testing and removing a key', async () => {
  await setKey(false);
  const p = await b.open(`chrome-extension://${b.extId}/options/options.html`);
  await sleep(300);
  await p.eval(`document.querySelector('#key').value = 'not a key'; document.querySelector('#key-save').click()`);
  await sleep(100);
  assert.match(await p.eval(`document.querySelector('#key-status').textContent`), /doesn’t look like/);
  await p.eval(`document.querySelector('#key').value = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'; document.querySelector('#key-save').click()`);
  await p.waitFor(`/Connected/.test(document.querySelector('#key-status').textContent)`, { world: 'page' });
  assert.equal(await sw.evaluate(`StudyEngine.secrets.get('anthropicKey')`), 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  assert.equal(await sw.evaluate(`chrome.storage.local.get('aiStatus').then((r) => r.aiStatus.ready)`), true);
  assert.match(await p.eval(`document.querySelector('#key-masked').textContent`), /^sk-ant-…2345$/);
  await p.eval(`window.confirm = () => true; document.querySelector('#key-remove').click()`);
  await sleep(300);
  assert.equal(await sw.evaluate(`StudyEngine.secrets.get('anthropicKey')`), undefined);
  // A rule turned off here stops in pages.
  await p.eval(`[...document.querySelectorAll('#rules label')].find((l) => l.textContent.includes('Remove the repeated word')).querySelector('input').click()`);
  await sleep(150);
  assert.deepEqual(await sw.evaluate(`StudyEngine.settings.load().then((s) => s.disabledRules)`), ['repeated-word']);
  await p.close();
  await resetSettings();
});

test('popup renders and its switch turns checking off everywhere', async () => {
  const p = await b.open(`chrome-extension://${b.extId}/popup/popup.html`);
  await sleep(300);
  assert.equal(await p.eval(`document.querySelector('h1').textContent`), 'Study Engine');
  await p.eval(`document.querySelector('#enabled').click()`);
  await sleep(150);
  assert.equal(await sw.evaluate(`StudyEngine.settings.load().then((s) => s.enabled)`), false);
  await p.close();
  await resetSettings();
});

test('editor: review with AI, questions, and text handed over from a page', async () => {
  await setKey(true);
  const p = await b.open(`chrome-extension://${b.extId}/editor/index.html`);
  await sleep(500);
  await p.eval(`document.querySelector('#welcome-start').click()`);
  await p.focus('#doc-text');
  await p.insertText('The Industrial Revolution began in Britain, and the most important was coal.\n\nWorking conditions was dangerous in the mills.');
  await p.waitFor(`[...document.querySelectorAll('.rv-card .title')].some((t) => t.textContent === 'Subject-verb agreement')`, { world: 'page', timeout: 10000 });
  await p.eval(`document.querySelector('#live-check').click()`);
  await p.waitFor(`/Found 1 thing/.test(document.querySelector('#foot-status').textContent)`, { world: 'page', timeout: 10000 });
  await p.close();
  // "Open in Study Engine" from a page.
  const page = await b.open(`${web.url}/fields.html`);
  await page.focus('#ta');
  await page.insertText('Handed over text with a mistake: teh end.');
  await page.waitFor(`${session('#ta')}?.issues.length > 0`);
  const targetsBefore = (await b.send('Target.getTargets')).targetInfos.length;
  await page.se(`${session('#ta')}.openInEditor()`);
  let editor = null;
  for (let i = 0; i < 40 && !editor; i++) {
    await sleep(100);
    const { targetInfos } = await b.send('Target.getTargets');
    editor = targetInfos.find((t) => t.type === 'page' && t.url.includes('/editor/index.html'));
  }
  assert.ok(editor, `editor tab opened (targets ${targetsBefore})`);
  const { sessionId } = await b.send('Target.attachToTarget', { targetId: editor.targetId, flatten: true });
  await sleep(800);
  const r = await b.send('Runtime.evaluate', { expression: `document.querySelector('#doc-text').value`, returnByValue: true }, sessionId);
  assert.equal(r.result.value, 'Handed over text with a mistake: teh end.');
  await page.close();
});
