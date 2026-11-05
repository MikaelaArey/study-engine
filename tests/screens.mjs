// Screenshots of the AI features with the stand-in API: a fact-check card, the panel with
// AI on, a study-mode question, and the editor's review. Usage: node tests/screens.mjs <dir>
import { launch, startStatic, startMockApi, reply, sleep } from './harness.mjs';

const dir = process.argv[2] || '/tmp';
const find = (prompt, needle) => [...prompt.matchAll(/^\[(d\d+)\] (.*)$/gm)].map((m) => ({ id: m[1], text: m[2] })).find((s) => s.text.includes(needle));

function respond(body) {
  const prompt = body.messages[0].content;
  if (prompt.startsWith('Task: check this writing')) {
    const issues = [];
    const a = find(prompt, 'conditions was');
    if (a) issues.push({ sentence: a.id, quote: 'conditions was', category: 'correctness', title: 'Subject-verb agreement', replacement: 'conditions were', explanation: 'A plural subject takes “were”.' });
    const b = find(prompt, 'kind of a big deal');
    if (b) issues.push({ sentence: b.id, quote: 'kind of a big deal', category: 'tone', title: 'Informal phrase', replacement: 'significant', explanation: 'This reads as casual for an academic paper.' });
    return reply({ issues, tone: ['analytical', 'formal'] });
  }
  if (prompt.startsWith('Task: check the factual claims')) {
    const s = find(prompt, 'completed in 1899');
    const claims = s ? [{ sentence: s.id, quote: 'completed in 1899', verdict: 'incorrect', issue: 'Sources say the Eiffel Tower was completed in 1889, for the Exposition Universelle (World’s Fair) in Paris.', correction: '1889', sources: [{ title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }, { title: 'Eiffel Tower | History, Height, & Facts', url: 'https://www.britannica.com/topic/Eiffel-Tower-Paris-France' }] }] : [];
    const m = find(prompt, '330 meters');
    if (m) claims.push({ sentence: m.id, quote: 'about 330 meters tall', verdict: 'misleading', issue: 'Sources give 330 meters today, including antennas added later; it was 300 meters when it opened.', correction: '', sources: [{ title: 'Eiffel Tower', url: 'https://en.wikipedia.org/wiki/Eiffel_Tower' }] });
    return reply({ claims });
  }
  if (prompt.startsWith('Task: find up to')) {
    const s = find(prompt, 'lots of coal');
    return reply({ safety: 'ok', questions: s ? [{ sentence: s.id, quote: 'because Britain had lots of coal', kind: 'reason', title: 'Coal is one reason', question: 'Coal is one reason. What else did Britain have that other countries didn’t? Name two.', key_points: ['Colonies', 'Capital to invest'], hint: 'Think about money, land and people.', reveal: 'Colonies for raw materials and markets, capital to invest, and workers freed up by enclosure.', word: '', definition: '', why: '' }] : [] });
  }
  if (prompt.startsWith('Task: mark one student answer')) return reply({ verdict: 'partial', feedback: 'Colonies, yes: they gave Britain raw materials and markets. There’s one more cause in your notes.', hint: 'Think about money people could invest.' });
  return reply({});
}

const web = await startStatic();
const api = await startMockApi(respond);
const b = await launch({ width: 1280, height: 860 });
try {
  const sw = await b.serviceWorker();
  await sw.evaluate(`chrome.storage.local.set({ devApiBase: ${JSON.stringify(api.url)} })`);
  await sw.evaluate(`StudyEngine.secrets.set('anthropicKey', 'sk-ant-test-0123456789abcdefghij')`);
  await sw.evaluate(`(async () => { keyCache = undefined; await refreshAiStatus(); })()`);

  const p = await b.open(`${web.url}/paper.html`);
  await p.focus('#paper');
  await p.insertText('The Eiffel Tower in Paris was completed in 1899 and is about 330 meters tall. Gustave Eiffel’s company designed and built it, and it was kind of a big deal at the time.\n\nWorking conditions was dangerous for the builders, but only one worker died during construction.');
  const sel = `(() => { const el = document.querySelector('#paper'); return StudyEngine.content.state.sessions.get(el); })()`;
  await p.waitFor(`${sel}?.issues.some((i) => i.category === 'facts')`, { timeout: 20000 });
  await sleep(400);
  const r = await p.se(`(() => { const s = ${sel}; const i = s.issues.find((x) => x.category === 'facts' && x.verdict === 'incorrect'); const r = s.overlay.rects(i.id)[0]; return { x: r.left + 6, y: r.top + r.height / 2 }; })()`);
  await p.click(r.x, r.y);
  await sleep(400);
  await p.screenshot(`${dir}/ai-fact-card.png`, { x: 230, y: 40, width: 800, height: 560 });
  await p.se(`StudyEngine.content.ui.hideCard()`);
  await p.se(`StudyEngine.content.ui.openPanel(${sel})`);
  await sleep(300);
  await p.screenshot(`${dir}/ai-panel.png`);
  await p.close();

  await sw.evaluate(`StudyEngine.settings.update({ studySites: ['127.0.0.1'] })`);
  const q = await b.open(`${web.url}/paper.html`);
  await q.focus('#paper');
  await q.insertText('The Industrial Revolution started in Britain because Britain had lots of coal. It changed how goods were made.\n\nFactories grew in the cities.');
  await q.waitFor(`(() => { const el = document.querySelector('#paper'); const s = StudyEngine.content.state.sessions.get(el); return s && s.issues.some((i) => i.category === 'study'); })()`, { timeout: 20000 });
  const qr = await q.se(`(() => { const s = StudyEngine.content.state.sessions.get(document.querySelector('#paper')); const i = s.issues.find((x) => x.category === 'study'); const r = s.overlay.rects(i.id)[0]; return { x: r.left + 10, y: r.top + r.height / 2 }; })()`);
  await q.click(qr.x, qr.y);
  await sleep(300);
  await q.se(`(() => { const c = StudyEngine.content.ui.cardFor(); c.issue.study.answer = 'They had colonies.'; return c.S.answer(c.issue); })()`);
  await sleep(300);
  await q.screenshot(`${dir}/ai-study-card.png`, { x: 230, y: 40, width: 800, height: 600 });
  await q.close();
  await sw.evaluate(`StudyEngine.settings.update({ studySites: [] })`);

  const e = await b.open(`chrome-extension://${b.extId}/editor/index.html`);
  await sleep(500);
  await e.eval(`document.querySelector('#welcome-start').click()`);
  await e.eval(`(() => { const t = document.querySelector('#doc-title'); t.value = 'The Eiffel Tower'; t.dispatchEvent(new Event('input')); })()`);
  await e.focus('#doc-text');
  await e.insertText('The Eiffel Tower in Paris was completed in 1899 and is about 330 meters tall. Gustave Eiffel’s company designed and built it, and it was kind of a big deal at the time.\n\nWorking conditions was dangerous for the builders, but only one worker died during construction.');
  await e.waitFor(`document.querySelectorAll('.rv-card.k-facts').length > 0`, { world: 'page', timeout: 20000 });
  await e.eval(`document.querySelector('.rv-card.k-facts .card-head').click()`);
  await sleep(300);
  await e.screenshot(`${dir}/ai-editor.png`);
} finally {
  await b.close();
  web.server.close();
  api.server.close();
}
console.log('saved to', dir);
