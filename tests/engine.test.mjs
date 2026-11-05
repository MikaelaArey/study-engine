// Unit tests for the local engine: text utilities, spelling and rules.
// Run: node --test tests/engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension');
for (const f of ['lib/text.js', 'lib/spell.js', 'lib/rules.js']) runInThisContext(readFileSync(join(root, f), 'utf8'), { filename: f });
const SE = globalThis.StudyEngine;
const speller = new SE.Speller();
speller.load(readFileSync(join(root, 'data/dict-en-US.txt'), 'utf8'));

const check = (text, goal = 'general') => SE.rules.check(text, { goal });
function flags(text, rule, { goal = 'general', original, replacement } = {}) {
  const issues = check(text, goal);
  const hit = issues.find((i) => i.rule === rule);
  assert.ok(hit, `expected ${rule} in: ${text}\n got: ${JSON.stringify(issues.map((i) => [i.rule, i.original]))}`);
  if (original !== undefined) assert.equal(hit.original, original, `original for ${rule} in: ${text}`);
  if (replacement !== undefined) assert.equal(hit.replacements[0], replacement, `replacement for ${rule} in: ${text}`);
  return hit;
}
function clean(text, goal = 'general', allow = []) {
  const issues = check(text, goal).filter((i) => !allow.includes(i.rule));
  assert.deepEqual(issues.map((i) => `${i.rule}: “${i.original}”`), [], `expected no issues (${goal}) in: ${text}`);
}

test('sentences handle abbreviations, initials, decimals and ellipses', () => {
  const s = (t) => SE.text.sentences(t).map((x) => x.text);
  assert.deepEqual(s('Dr. Smith arrived at 3.5 p.m. on time. Then he left.'), ['Dr. Smith arrived at 3.5 p.m. on time.', 'Then he left.']);
  assert.deepEqual(s('J. K. Rowling wrote it. It sold well!'), ['J. K. Rowling wrote it.', 'It sold well!']);
  assert.deepEqual(s('Wait... what happened? Nobody knows.'), ['Wait... what happened?', 'Nobody knows.']);
  assert.deepEqual(s('Bring pens, paper, etc. and a ruler.'), ['Bring pens, paper, etc. and a ruler.']);
  assert.deepEqual(s('He said "Stop." She did.'), ['He said "Stop."', 'She did.']);
  assert.deepEqual(s('Line one\nline two'), ['Line one', 'line two']);
  assert.deepEqual(s('See e.g. the appendix. Done.'), ['See e.g. the appendix.', 'Done.']);
});

test('masks skip links, emails, handles and file names', () => {
  const text = 'Mail me at maya.lee@school.edu or see https://example.com/teh-page and @thier #recieve and notes.docx';
  const m = SE.text.maskRanges(text);
  const masked = (w) => { const i = text.indexOf(w); return SE.text.overlapsAny(m, i, i + w.length); };
  for (const w of ['maya.lee@school.edu', 'https://example.com/teh-page', '@thier', '#recieve', 'notes.docx']) assert.ok(masked(w), w);
  assert.ok(!masked('Mail'));
});

test('stats', () => {
  const st = SE.text.stats('The cat sat on the mat. It was happy.');
  assert.equal(st.words, 9);
  assert.equal(st.sentences, 2);
  assert.ok(st.readingEase > 90);
});

test('spelling: misspellings get the right first suggestion', () => {
  const cases = {
    teh: 'the', recieve: 'receive', definately: 'definitely', alot: 'a lot', goverment: 'government', tommorow: 'tomorrow',
    wierd: 'weird', thier: 'their', becuase: 'because', accomodate: 'accommodate', occured: 'occurred', seperate: 'separate',
    untill: 'until', beleive: 'believe', langauge: 'language', experiance: 'experience', beautful: 'beautiful', probelm: 'problem',
    acess: 'access', comittee: 'committee', knowlege: 'knowledge', neccessary: 'necessary', suprise: 'surprise', writting: 'writing',
    thankyou: 'thank you', infact: 'in fact', inorder: 'in order', enviroment: 'environment', arguement: 'argument', truely: 'truly',
    begining: 'beginning', freind: 'friend', wich: 'which', adn: 'and', realy: 'really', finaly: 'finally', speach: 'speech',
    studnet: 'student', teacher: null, photosynthesis: null, recieved: 'received', happend: 'happened', hapen: 'happen',
  };
  for (const [word, want] of Object.entries(cases)) {
    const r = speller.check(word);
    if (want === null) {
      assert.equal(r, null, `${word} should be known`);
      continue;
    }
    assert.ok(r, `${word} should be flagged`);
    assert.equal(r.suggestions[0], want, `${word} → ${r.suggestions.join(', ')}`);
  }
});

test('spelling: names, brands, acronyms and contractions are left alone', () => {
  for (const w of ['Mikaela', "Mikaela's", "don't", 'it’s', "o'clock", 'COVID', 'iPhone', 'NASA', 'café', 'mitochondria', 'Gmail', 'ChatGPT', 'Fraser', 'Okonkwo', 'Bangalore', "students"]) {
    assert.equal(speller.check(w), null, w);
  }
});

test('spelling: capitalization and capitalized typos', () => {
  assert.deepEqual(speller.check('february'), { type: 'capitalization', suggestions: ['February'] });
  assert.equal(speller.check('monday').suggestions[0], 'Monday');
  assert.equal(speller.check('Gmail'), null);
  assert.equal(speller.check('Febuary').suggestions[0], 'February');
  assert.equal(speller.check('Teh', { sentenceStart: true }).suggestions[0], 'The');
  assert.equal(speller.check('Recieve', { sentenceStart: true }).suggestions[0], 'Receive');
  // A repeated capitalised unknown word is a name.
  assert.equal(speller.check('Kemal', { repeats: 3 }), null);
});

test('spelling: personal dictionary', () => {
  const s = new SE.Speller();
  s.load(readFileSync(join(root, 'data/dict-en-US.txt'), 'utf8'));
  assert.ok(s.check('zorbling'));
  s.setPersonal(['zorbling']);
  assert.equal(s.check('zorbling'), null);
  assert.equal(s.check('Zorbling'), null);
});

test('spelling: suggestions are fast enough', () => {
  const s = new SE.Speller();
  s.load(readFileSync(join(root, 'data/dict-en-US.txt'), 'utf8'));
  const words = ['qwertyuiop', 'accomodation', 'mispelling', 'extraordinery', 'responsibilty', 'pharmaceutcal', 'intellectualy', 'zzzzzzzzzz'];
  const t0 = performance.now();
  for (const w of words) s.check(w);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `took ${ms.toFixed(0)} ms`);
});

test('correctness: articles', () => {
  flags('She ate a apple.', 'a-an', { original: 'a', replacement: 'an' });
  flags('It took an hour and a hour.', 'a-an', { replacement: 'an' });
  flags('He is an university student.', 'a-an', { replacement: 'a' });
  flags('An European city.', 'a-an', { replacement: 'A' });
  flags('She is a FBI agent.', 'a-an', { replacement: 'an' });
  flags('It was a 8-hour shift.', 'a-an', { replacement: 'an' });
  clean('An hour, a university, a European, an FBI agent, a NASA mission, an MBA, a one-time fee, an 18-year-old, a USB drive.');
  clean('Vitamin A is important. Plan A and plan B. Type A personalities.');
  clean('An honest answer, a historic day, an historic day, a herb, an herb, a hotel.');
  clean('An unusual umbrella, an unimportant detail, an uninformed guess, a unicorn, a unique user, a utopia, an utter mess.');
});

test('correctness: repeated words, I, capitals', () => {
  flags('I went to the the store.', 'repeated-word', { original: 'the the', replacement: 'the' });
  clean('I had had enough. I knew that that was true.');
  flags('Yesterday i went home.', 'lowercase-i', { replacement: 'I' });
  flags('Then i’m going home.', 'lowercase-i');
  clean('See part (i) and i.e. the rest.');
  clean('for i in range(10): print(i)');
  flags('It was late. the bus was gone.', 'capital-start', { original: 'the', replacement: 'The' });
  clean('It was late. The bus was gone.');
  clean('- buy milk\n- call mom');
  clean('iPhone sales rose. eBay did too.');
  flags('we met on may 5 to plan.', 'month-capital', { original: 'may', replacement: 'May' });
  flags('My english class starts soon.', 'proper-capital', { original: 'english', replacement: 'English' });
  clean('My English class and the French Revolution.');
  clean('You may 2x the speed? We may go.', 'general', ['capital-start']);
});

test('correctness: confused words', () => {
  flags('The dog wagged it’s own tail.', 'its-own', { replacement: 'its' });
  flags('I think its a good idea.', 'its-contraction', { replacement: 'it’s' });
  clean('The company and its so-called experts. The tree lost its leaves. Its very existence matters.');
  flags('Your going to love it.', 'youre', { replacement: 'You’re' });
  flags('Thanks! Your welcome.', 'youre-welcome');
  clean('Your welcome message was nice. Your going-away party was fun. It was your doing.');
  flags('Their is no time.', 'there-is', { replacement: 'There' });
  flags('They did it there own way.', 'their-own', { replacement: 'their' });
  clean('Is there going to be a test? Their dog barked.');
  flags('This is better then that.', 'then-than', { replacement: 'than' });
  clean('I will see you later then. First this, then that.');
  flags('I could of done it.', 'modal-of', { replacement: 'have' });
  clean('You could of course try. It happened in May of 2020.');
  flags('She has went home.', 'past-participle', { replacement: 'gone' });
  flags('They had ran out.', 'past-participle', { replacement: 'run' });
  flags('This has lead to problems.', 'led', { replacement: 'led' });
  flags('Try not to loose your keys.', 'lose', { replacement: 'lose' });
  flags('I want to loose weight.', 'lose');
  clean('The screw is loose. A loose fit.');
  flags('It had a big affect on me.', 'effect-noun', { replacement: 'effect' });
  flags('This will effect the results.', 'affect-verb', { replacement: 'affect' });
  clean('We want to effect change. The effect was clear. It may affect us.');
  flags('We were effected by the storm.', 'affected');
  flags('There are less people here.', 'fewer', { replacement: 'fewer' });
  clean('Less water, less time, less than five people.');
  flags('The amount of students grew.', 'number-of', { replacement: 'number' });
  flags('Keep it between you and I.', 'between-you-and-me', { replacement: 'me' });
  flags('She don’t care.', 'doesnt', { replacement: 'doesn’t' });
  flags('They was late.', 'were', { replacement: 'were' });
  flags('There’s many reasons.', 'there-are', { replacement: 'There are' });
  clean('There’s a lot of water. There’s plenty of time.');
  flags('She have a dog.', 'he-has', { replacement: 'has' });
  clean('Does she have a dog? Did he have time? Let it have a rest. If she have', 'general', ['he-has']);
  clean('Does she have a dog? Did he have time? Should it have worked?');
  flags('I don’t know nothing about it.', 'double-negative', { replacement: 'anything' });
  flags('We don’t have no money.', 'double-negative', { replacement: 'any' });
  clean('I can’t say no to her.');
  flags('Whose going first?', 'whos');
  flags('Who’s car is this?', 'whose');
  flags('It is to late.', 'to-too', { replacement: 'too' });
  clean('The award went to much acclaim.');
  flags('We went too the store.', 'too-to', { replacement: 'to' });
  flags('I accept. I will except your offer.', 'accept');
  flags('I advice you to rest.', 'advise');
  flags('Thanks for the advise.', 'advice');
  flags('I can’t breath in here.', 'breathe');
  flags('Take a deep breathe.', 'breath');
  flags('He turned of the light.', 'off');
  clean('At the turn of the century. The back of the room.');
  flags('You are suppose to go.', 'supposed-to');
  flags('I run everyday.', 'every-day');
  clean('Everyday life is busy.');
  flags('Irregardless, I could care less.', 'idiom');
  flags('For all intensive purposes it works.', 'idiom', { replacement: 'For all intents and purposes' });
});

test('correctness: punctuation and spacing', () => {
  flags('Wait , what?', 'space-before-punct', { replacement: ',' });
  clean('Wait ... what? Great :) See you.');
  flags('Bring bread,milk and eggs.', 'space-after-punct', { replacement: ', ' });
  flags('It ended.Then we left.', 'space-after-punct');
  clean('Visit example.com or Next.js at 10:30 for 1,000 people. U.S. data.');
  flags('This is  odd.', 'extra-space', { replacement: ' ' });
  clean('Name    Age    City');
  flags('Yes,, really.', 'double-punct', { replacement: ',' });
  flags('The end..', 'double-punct', { replacement: '.' });
  clean('Count 1..10 in ../src and wait...');
  flags('It rained. However the game went on.', 'intro-comma', { replacement: 'However,' });
  flags('Finally the results came in.', 'intro-comma', { replacement: 'Finally,' });
  clean('However you look at it, it works. However hard he tried, he failed.');
});

test('clarity: wordiness, redundancy, length, passive', () => {
  flags('We met in order to plan.', 'wordy', { original: 'in order to', replacement: 'to' });
  flags('Due to the fact that it rained, we stayed.', 'wordy', { replacement: 'Because' });
  flags('It is important to note that the results vary.', 'wordy', { replacement: 'T' });
  flags('I can’t decide whether or not to go.', 'wordy', { replacement: 'whether' });
  clean('I will go whether or not it rains.', 'general');
  clean('Glucose is made in the process of photosynthesis.');
  flags('We are in the process of reviewing it.', 'wordy');
  flags('The end result was good.', 'redundant', { replacement: 'result' });
  flags('The majority of the students agreed.', 'the-majority-of', { replacement: 'Most of' });
  flags('The majority of voters agreed.', 'the-majority-of', { replacement: 'Most' });
  const long = 'The committee, after a long series of meetings that went on for many weeks and involved dozens of experts from around the country, finally decided that the new policy would take effect at the start of the next school year.';
  flags(long, 'long-sentence');
  clean(long, 'errors');
  flags('The ball was thrown by the pitcher.', 'passive');
  flags('The results were analyzed by the team.', 'passive');
  clean('The ball was thrown far. He was surrounded by friends by far.', 'technical');
  clean('By far the best. It was done by hand.');
});

test('engagement: weak intensifiers and clichés', () => {
  const hit = flags('The test was very difficult.', 'weak-intensifier', { replacement: 'challenging' });
  assert.deepEqual(hit.replacements, ['challenging', 'arduous']);
  clean('The test was not very good.');
  clean('She worked very hard and ran very fast.');
  flags('At the end of the day, it works.', 'cliche', { replacement: 'Ultimately' });
  flags('In today’s society, phones matter.', 'cliche', { replacement: 'Today' });
  clean('The test was very difficult.', 'errors');
});

test('tone: academic and professional', () => {
  flags('The data don’t support it.', 'contraction', { goal: 'academic', replacement: 'do not' });
  flags('It’s been shown before.', 'contraction', { goal: 'academic', replacement: 'It has' });
  clean('The data don’t support it.', 'general');
  clean('As Smith wrote, "it’s complicated."', 'academic', ['contraction']);
  const quoted = check('As Smith wrote, "it’s complicated."', 'academic').filter((i) => i.rule === 'contraction');
  assert.equal(quoted.length, 0);
  flags('We are gonna win.', 'informal', { goal: 'professional', replacement: 'going to' });
  flags('A lot of kids agree.', 'informal', { goal: 'academic' });
  clean('A lot of kids agree.', 'professional', ['weak-intensifier']);
  flags('I just wanted to check in.', 'hedging', { goal: 'professional', replacement: 'I wanted to' });
  flags('Factories always paid well.', 'absolute', { goal: 'academic', replacement: 'often' });
  clean('The treaty was never ratified.', 'academic');
  flags('Oceans store a lot of heat.', 'informal', { goal: 'academic', replacement: 'much' });
  flags('A lot of students agree.', 'informal', { goal: 'academic', replacement: 'Many' });
  clean('As always, never mind.', 'academic');
  flags('We won!!', 'exclamation', { goal: 'professional', replacement: '!' });
  flags('The results were remarkable!', 'exclamation-academic', { goal: 'academic', replacement: '.' });
});

test('goals: casual is lenient', () => {
  clean('lol ok see u there', 'casual');
  clean('hey are you coming tonight? bring snacks', 'casual');
});

test('no false positives on well-written text', () => {
  const samples = [
    'The Industrial Revolution began in Britain in the late eighteenth century. Historians point to coal, capital and colonies as causes.',
    'Cellular respiration releases energy from glucose. Glycolysis happens in the cytoplasm, while the Krebs cycle runs in the mitochondria.',
    'Dear Ms. Patel, thank you for meeting with me on Tuesday. I have attached the revised budget, which reflects the changes we discussed.',
    'Hi team, the launch moved to March 14. Please send your updates by Friday so we can finalize the plan.',
    'In 1969, Apollo 11 landed on the Moon. Neil Armstrong and Buzz Aldrin walked on the surface while Michael Collins orbited above.',
    'My grandmother, who grew up in Lagos, taught me to cook jollof rice. Every Sunday we cooked together, and she told stories about her childhood.',
    'Although the experiment failed twice, the third trial produced consistent results. We measured the rate of reaction at five temperatures.',
    'Can you send me the link? I want to read it before class tomorrow.',
    'Our analysis suggests that rising temperatures may reduce crop yields, but the effect varies by region and by crop.',
    'She asked whether the museum was open on Mondays, and the guard said it was not.',
  ];
  for (const s of samples) {
    clean(s, 'general');
    clean(s, 'academic', ['contraction']);
    clean(s, 'professional');
  }
});

test('regressions from real prose (Wikipedia)', () => {
  clean('La Niña events cause cooling. It was named part of a UNESCO World Heritage Site.');
  clean('A is the electron acceptor. The ratio is ATP : NADH, or 1 : 4.');
  clean('Muhamed Mehmedbašić and Kok’s S-state diagrams. In 1861, Pryce Pryce-Jones formed the first mail order business.');
  clean('The pigments in photosystem I are green. World War I was long.');
  clean('He shouted "Stop!" and ran. The papers read "Eiffel Suicide!" and "Gustave Eiffel Has Gone Mad".');
  clean('It wanted to alert Washington, D.C. to ongoing research. Nor is it known who Mr. W.H. was.');
  clean('Navajivan Publishing House. pp. v–vi. doi:10.1234/5678.');
  clean('Einstein was deeply impressed by Gandhi.');
  const speller2 = new SE.Speller();
  speller2.load(readFileSync(join(root, 'data/dict-en-US.txt'), 'utf8'));
  speller2.load(readFileSync(join(root, 'data/extra-words.txt'), 'utf8'), 'en-US', { append: true });
  speller2.loadVariants(readFileSync(join(root, 'data/variants-en-GB.txt'), 'utf8'));
  for (const [w, ctx] of [['Annus', { sentenceStart: true }], ['Jost', { sentenceStart: true }], ['Fabrik', {}], ['Rosen', {}], ['naïve', {}], ['nonlocal', {}], ['reimagining', {}], ['attaches', {}], ['feedbacks', {}], ['utopian', {}], ['synthase', {}], ['et', {}], ['nm', {}], ['Labour', {}]]) {
    assert.equal(speller2.check(w, ctx), null, w);
  }
  const dia = (w) => speller2.check(w);
  assert.deepEqual([dia('labour').type, dia('labour').suggestions[0]], ['dialect', 'labor']);
  assert.equal(dia('centred').suggestions[0], 'centered');
  assert.equal(dia('fibre').suggestions[0], 'fiber');
  assert.equal(dia('travelled').suggestions[0], 'traveled');
  assert.equal(dia('organised').suggestions[0], 'organized');
  assert.equal(speller2.check('Teh', { sentenceStart: true }).suggestions[0], 'The');
  assert.equal(speller2.check('inorder').suggestions[0], 'in order');
  assert.equal(SE.text.isForeign('Zur Elektrodynamik bewegter Körper und der Physik'), true);
  assert.equal(SE.text.isForeign('Smith et al. found that the results held.'), false);
});

test('issue shape and overlap handling', () => {
  const issues = check('Their is a apple in in the box.');
  for (const i of issues) {
    assert.ok(i.id && i.rule && i.category && i.title && i.message, JSON.stringify(i));
    assert.equal(i.original, 'Their is a apple in in the box.'.slice(i.start, i.end));
  }
  const ranges = issues.filter((i) => !i.whole).map((i) => [i.start, i.end]);
  for (let a = 0; a < ranges.length; a++) for (let b = a + 1; b < ranges.length; b++) assert.ok(ranges[a][1] <= ranges[b][0] || ranges[b][1] <= ranges[a][0], 'no overlaps');
  assert.deepEqual(issues.map((i) => i.rule), ['there-is', 'a-an', 'repeated-word']);
});

test('performance: a long essay checks quickly', () => {
  const para = 'The Industrial Revolution began in Britain in the late eighteenth century, and it changed how people lived and worked. Factories grew quickly, and in order to find work many families moved to cities. Their is evidence that wages rose for some workers, but conditions were very bad for others. ';
  const text = para.repeat(60);
  const t0 = performance.now();
  const issues = check(text, 'academic');
  const ms = performance.now() - t0;
  assert.ok(issues.length >= 120);
  assert.ok(ms < 400, `took ${ms.toFixed(0)} ms for ${text.length} characters`);
});
