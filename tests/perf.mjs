// How long a keystroke takes in a long document (local checks and drawing, no AI).
import { launch, startStatic, sleep } from './harness.mjs';
const web = await startStatic();
const b = await launch();
try {
  const p = await b.open(`${web.url}/paper.html`);
  const para = 'The Industrial Revolution began in Britain in the late eighteenth century, and it changed how people lived and worked. Factories grew quickly, and in order to find work many families moved to cities. Their is evidence that wages rose for some workers, but conditions were very bad for others. ';
  const text = (para + '\n\n').repeat(140);
  await p.eval(`(() => { const t = document.querySelector('#paper'); t.value = ${JSON.stringify(text)}; t.focus(); t.setSelectionRange(t.value.length, t.value.length); })()`);
  await p.insertText(' ');
  await sleep(2500);
  const r = await p.se(`(() => {
    const s = StudyEngine.content.state.sessions.get(document.querySelector('#paper'));
    const times = [];
    for (let i = 0; i < 20; i++) {
      const t = document.querySelector('#paper');
      t.setRangeText(i % 2 ? 'x' : '', t.value.length - (i % 2 ? 0 : 1), t.value.length, 'end');
      const t0 = performance.now();
      s.changed('input');
      s.runLocal(); // the checks and the redraw that follow a keystroke
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return { words: StudyEngine.text.wordCount(s.text), issues: s.issues.length, median: times[10].toFixed(1), worst: times[19].toFixed(1) };
  })()`);
  console.log(JSON.stringify(r));
} finally {
  await b.close();
  web.server.close();
}
