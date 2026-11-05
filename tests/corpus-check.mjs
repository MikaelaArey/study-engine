// Runs the rules and the spell checker over well-edited text (such as Wikipedia articles saved
// as MediaWiki API JSON) and reports what they flag, to find false positives.
// Usage: node tests/corpus-check.mjs <folder of .json or .txt files> [goal]
import { readFileSync, readdirSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
for (const f of ['lib/text.js', 'lib/spell.js', 'lib/rules.js']) runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const SE = globalThis.StudyEngine;
const speller = new SE.Speller();
speller.load(readFileSync(join(root, 'data/dict-en-US.txt'), 'utf8'));
speller.load(readFileSync(join(root, 'data/extra-words.txt'), 'utf8'), 'en-US', { append: true });
speller.loadVariants(readFileSync(join(root, 'data/variants-en-GB.txt'), 'utf8'));

const dir = process.argv[2];
const goal = process.argv[3] || 'general';
const byRule = new Map();
let words = 0;
const note = (rule, sample) => {
  if (!byRule.has(rule)) byRule.set(rule, []);
  byRule.get(rule).push(sample);
};

for (const f of readdirSync(dir)) {
  let text = readFileSync(join(dir, f), 'utf8');
  if (f.endsWith('.json')) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      continue; // an error page, not an article
    }
    text = Object.values(data.query?.pages || {}).map((p) => p.extract || '').join('\n\n');
  }
  // Drop headings and reference sections, which aren't prose.
  text = text.split(/\n== (?:See also|References|Notes|Further reading|External links|Bibliography|Sources|Citations) ==/)[0].replace(/^=+ .* =+$/gm, '');
  words += SE.text.wordCount(text);
  for (const para of text.split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    for (const i of SE.rules.check(para, { goal })) {
      if (i.rule === 'long-sentence') { note(i.rule, `${SE.text.wordCount(i.original)} words`); continue; }
      const s = Math.max(0, i.start - 30);
      note(i.rule, `…${para.slice(s, i.start)}[[${i.original}]]${para.slice(i.end, i.end + 30)}… → ${i.replacements[0] ?? ''}`);
    }
    const counts = new Map();
    for (const w of SE.text.words(para)) counts.set(w.w, (counts.get(w.w) || 0) + 1);
    const masks = SE.text.maskRanges(para);
    const sents = SE.text.sentences(para);
    const starts = new Set(sents.map((x) => x.start));
    for (const x of sents) if (SE.text.isForeign(x.text)) masks.push([x.start, x.end]);
    for (const w of SE.text.words(para)) {
      if (SE.text.overlapsAny(masks, w.start, w.end) || !/^(?:(?![\u0250-\u02af\u1d00-\u1dbf])[\p{Script=Latin}\p{M}'’])+$/u.test(w.w)) continue;
      if (/\d/.test(para[w.start - 1] || '') || /\d/.test(para[w.end] || '') || para[w.end] === '-') continue;
      const r = speller.check(w.w, { sentenceStart: starts.has(w.start), repeats: counts.get(w.w) });
      if (r) note(`spelling:${r.type}`, `${w.w} → ${r.suggestions.slice(0, 2).join(', ')}`);
    }
  }
}

console.log(`${words.toLocaleString()} words, goal ${goal}\n`);
for (const [rule, list] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${rule}: ${list.length} (${((list.length / words) * 1000).toFixed(2)} per 1,000 words)`);
  const uniq = [...new Set(list)];
  for (const s of uniq.slice(0, rule.startsWith('spelling') ? 60 : 14)) console.log(`   ${s}`);
  console.log();
}
