/*
 * Study Engine: the local writing checker.
 *
 * Grammar, punctuation, clarity, word-choice and tone rules that run in the browser, with no
 * network, on every keystroke. Spelling is separate (spell.js). Rules aim for precision over
 * recall: each one has exclusions for the correct sentences it would otherwise flag, and the
 * AI check (when it's on) catches what rules can't.
 *
 * check(text, { goal, disabled }) returns issues:
 *   { id, rule, category, title, message, start, end, original, replacements, source: 'rules' }
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  if (SE.rules) return;
  const T = SE.text;

  const CATEGORIES = {
    correctness: { label: 'Correctness', blurb: 'Spelling, grammar and punctuation' },
    clarity: { label: 'Clarity', blurb: 'Wordiness, long sentences and passive voice' },
    engagement: { label: 'Engagement', blurb: 'Weak words and clichés' },
    tone: { label: 'Tone', blurb: 'Formality and confidence' },
    facts: { label: 'Facts', blurb: 'Claims to recheck' },
    study: { label: 'Study', blurb: 'Questions about your thinking' },
  };

  // Writing goals. The editor calls these registers; its five map onto these ids.
  const GOALS = [
    { id: 'general', name: 'General', for: 'Most writing', categories: ['correctness', 'clarity', 'engagement'], longSentence: 38 },
    { id: 'academic', name: 'Academic', for: 'Essays, research papers and reports', categories: ['correctness', 'clarity', 'engagement', 'tone'], longSentence: 40 },
    { id: 'professional', name: 'Professional', for: 'Work email and documents', categories: ['correctness', 'clarity', 'engagement', 'tone'], longSentence: 32 },
    { id: 'casual', name: 'Casual', for: 'Messages and chat', categories: ['correctness'], longSentence: 0 },
    { id: 'simple', name: 'Simplified', for: 'Explaining an idea, or learning English', categories: ['correctness', 'clarity', 'engagement'], longSentence: 22 },
    { id: 'technical', name: 'Technical', for: 'Lab reports and technical writing', categories: ['correctness', 'clarity'], longSentence: 45 },
    { id: 'errors', name: 'Errors only', for: 'Your natural voice: only clear mistakes', categories: ['correctness'], longSentence: 0 },
  ];
  const goalOf = (id) => GOALS.find((g) => g.id === id) || GOALS[0];

  // A starting goal for a site, before the person picks one.
  function goalForSite(host = '') {
    const h = String(host).toLowerCase();
    if (/(^|\.)(mail\.google\.com|outlook\.(live|office|office365)\.com|mail\.yahoo\.com|linkedin\.com)$/.test(h)) return 'professional';
    if (/(^|\.)(slack\.com|discord\.com|web\.whatsapp\.com|messenger\.com|teams\.microsoft\.com|x\.com|twitter\.com|reddit\.com)$/.test(h)) return 'casual';
    if (/(^|\.)(instructure\.com|canvas\.\w+|classroom\.google\.com|schoology\.com|blackboard\.com|moodle\.\w+|brightspace\.com|turnitin\.com)$/.test(h) || /\.edu$|\.ac\.\w+$/.test(h)) return 'academic';
    return 'general';
  }

  const RULES = [];
  const add = (rule) => RULES.push(rule);

  // Words that make a following "very good" mean less than it says.
  const NEGATED = /(?:\bnot|n['’]t|\bnever|\bhardly)\s+$/i;
  const before = (text, i, n = 30) => text.slice(Math.max(0, i - n), i);
  const sentenceStartAt = (text, i) => {
    const b = before(text, i, 6);
    return i === 0 || /(?:^|[.!?]["'”’)]?\s+|\n\s*)$/.test(b);
  };
  // Inside "double quotes" on the same line: quoted speech keeps its own wording.
  const inQuotes = (text, i) => {
    const lineStart = text.lastIndexOf('\n', i - 1) + 1;
    const seg = text.slice(lineStart, i);
    const straightQuotes = (seg.match(/"/g) || []).length;
    const open = (seg.match(/“/g) || []).length - (seg.match(/”/g) || []).length;
    return straightQuotes % 2 === 1 || open > 0;
  };

  // ---------------------------------------------------------------------------
  // Correctness: grammar and word usage
  // ---------------------------------------------------------------------------

  const DOUBLE_OK = new Set(['had', 'that', 'bye', 'ha', 'haha', 'no', 'yeah', 'yes', 'so', 'there', 'knock', 'blah', 'mm', 'tsk', 'chop', 'tut', 'yada', 'boo', 'la', 'do', 'go', 'hip', 'well', 'now']);
  add({
    id: 'repeated-word', category: 'correctness', title: 'Remove the repeated word',
    re: /(?<![\p{L}\p{N}_'’-])(\p{L}+)([ \t\u00a0]+)\1(?![\p{L}\p{N}_'’-])/giu,
    map(m) {
      const w = m[1].toLowerCase();
      if (DOUBLE_OK.has(w) || w.length < 2) return null;
      const second = m[0].slice(m[1].length + m[2].length);
      if (/^\p{Lu}/u.test(m[1]) && /^\p{Lu}/u.test(second)) return null; // names: "Pryce Pryce-Jones"
      return { start: m.index, end: m.index + m[0].length, replacements: [m[1]], message: `“${m[1]}” appears twice in a row.` };
    },
  });

  // a / an by the sound of the next word.
  const LETTER_VOWEL_SOUND = new Set('AEFHILMNORSX');
  const WORD_ACRONYMS = new Set(['NASA', 'NATO', 'UNICEF', 'UNESCO', 'OPEC', 'FEMA', 'FIFA', 'SWAT', 'SCUBA', 'LASER', 'RADAR', 'AIDS', 'GIF', 'JPEG', 'PIN', 'ZIP', 'ROM', 'RAM', 'LAN', 'WAN', 'NAFTA', 'OSHA', 'CAPTCHA', 'SIM', 'GIS', 'NASDAQ', 'ASCII', 'FAQ', 'GUI', 'WIFI', 'ICE', 'OPED']);
  // Words an article can't come before: "A is the acceptor" uses A as a letter or a variable.
  const NOT_AFTER_ARTICLE = new Set(['is', 'are', 'was', 'were', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'from', 'by', 'with', 'as', 'has', 'had', 'have', 'will', 'can', 'could', 'would', 'should', 'may', 'might', 'must', 'does', 'did', 'do', 'then', 'than', 'if', 'so', 'but', 'nor', 'not', 'equals', 'represents', 'stands']);
  function articleFor(word) {
    const w = word.replace(/['’].*$/, '');
    if (/^\d/.test(w)) return /^(?:8|11(?!\d)|18(?!\d))/.test(w) ? 'an' : 'a';
    const letters = /^[A-Za-z]+/.exec(w)?.[0] || '';
    if (!letters) return null;
    if (letters.length === 1) {
      if (letters !== letters.toUpperCase()) return null; // "a b c" lists
      return LETTER_VOWEL_SOUND.has(letters) ? 'an' : 'a';
    }
    if (letters === letters.toUpperCase() && letters.length <= 5 && !WORD_ACRONYMS.has(letters)) {
      return LETTER_VOWEL_SOUND.has(letters[0]) ? 'an' : 'a';
    }
    if (letters === 'SQL') return null; // "a sequel" and "an S-Q-L" are both said
    if (letters === 'UNESCO') return 'a';
    const lw = letters.toLowerCase();
    if (/^(?:herb|histor|hotel|heroic|homage)/.test(lw)) return null; // both are accepted
    if (/^(?:hour|honest|honor|honour|heir)/.test(lw)) return 'an';
    if (/^(?:uni[cfloqstv]|unanim|us[aeiu]|ut[eiou]|ur[aeio]|uru|eu|ewe|ubiq|uku|ukr|uvul|on(?:ce|e(?!r)))/.test(lw)) return 'a';
    return /^[aeiou]/.test(lw) ? 'an' : 'a';
  }
  add({
    id: 'a-an', category: 'correctness', title: 'Use the right article',
    re: /(?<![\p{L}\p{N}_'’-])(a|an)([ \t\u00a0]+)([A-Za-z0-9][\w'’-]*)/giu,
    map(m, ctx) {
      const art = m[1];
      if (NOT_AFTER_ARTICLE.has(m[3].toLowerCase())) return null;
      // "Vitamin A is", "Plan A and": a capital A mid-sentence is a letter, not an article.
      if (art === 'A' && !sentenceStartAt(ctx.text, m.index)) return null;
      // "a/an" after a hyphen or apostrophe is part of something else ("Ph.D.-a", "y'an").
      if (/[-'’.]$/.test(before(ctx.text, m.index, 1))) return null;
      const want = articleFor(m[3]);
      if (!want || want === art.toLowerCase()) return null;
      return { start: m.index, end: m.index + art.length, replacements: [T.matchCase(art, want)], message: want === 'an' ? `Use “an” before a vowel sound, as in “an ${m[3]}”.` : `Use “a” before a consonant sound, as in “a ${m[3]}”.` };
    },
  });

  const LOWER_STARTS = /^(?:iPhone|iPad|iPod|iOS|iCloud|iMac|macOS|eBay|eBook|e\.g\.|i\.e\.|etc\.|npm|git|http|www|e-mail|e-?commerce|vs\.?|et al)/;
  const LOOKS_LIKE_CODE = /[{}<>=;]|\w\(|\)\s*:|^\s*(?:for|if|while|def|function|const|let|var|return|import|from|class|select|sudo|cd|npm|pip)\s/;
  add({
    id: 'capital-start', category: 'correctness', title: 'Capitalize the first word',
    run(ctx) {
      const out = [];
      if (ctx.goal.id === 'casual') return out;
      for (const s of ctx.sentences()) {
        const m = /^([("“'‘]?)(\p{Ll}[\p{L}'’-]*)/u.exec(s.text);
        if (!m || LOWER_STARTS.test(s.text.slice(m[1].length))) continue;
        const word = m[2];
        if (/\p{Lu}/u.test(word)) continue; // eBay, iPhone-style names
        if (LOOKS_LIKE_CODE.test(s.text)) continue;
        const start = s.start + m[1].length;
        const ls = ctx.text.lastIndexOf('\n', start - 1) + 1;
        const lineStart = /^[\s("“'‘]*$/.test(ctx.text.slice(ls, start));
        // A new line can be a list item or a short note, so only flag it in longer lines.
        if (lineStart && T.wordCount(s.text) < 4) continue;
        if (T.wordCount(s.text) < 3) continue; // fragments: "doi:10.1000", "pp. v–vi"
        if (/^\p{L}+[.:]/u.test(s.text.slice(m[1].length))) continue; // labels and abbreviations
        if (/[!?]["”’]\s+$/.test(ctx.text.slice(Math.max(0, start - 4), start))) continue; // He shouted "Stop!" and ran
        if (/^\s*(?:[-*•>]|\d+[.)]|[a-z][.)])\s/.test(ctx.text.slice(ls, start + 3))) continue;
        if (!lineStart && !/[.!?…]["'”’)]?\s+$/.test(ctx.text.slice(Math.max(0, start - 4), start))) continue;
        out.push({ start, end: start + word.length, replacements: [word.charAt(0).toUpperCase() + word.slice(1)], message: 'Sentences start with a capital letter.' });
      }
      return out;
    },
  });

  add({
    id: 'lowercase-i', category: 'correctness', title: 'Capitalize “I”',
    re: /(?<![\p{L}\p{N}_'’.-])i(?=(?:['’](?:m|ve|ll|d))?(?![\p{L}\p{N}_'’-]))/gu,
    map(m, ctx) {
      const next = ctx.text.slice(m.index + 1, m.index + 3);
      if (/^\)|^\.\w|^\./.test(next) || before(ctx.text, m.index, 1) === '(') return null; // "(i)", "i.e."
      // Code: "for i in", "i = 0", "i++".
      if (/^\s*(?:=|\+\+|--|<|>|\bin\b|\[|\))/.test(ctx.text.slice(m.index + 1, m.index + 6)) || /\b(?:for|let|var|int)\s+$/.test(before(ctx.text, m.index, 6))) return null;
      return { start: m.index, end: m.index + 1, replacements: ['I'], message: 'The pronoun “I” is always a capital letter.' };
    },
  });

  // Months that are also ordinary words: only when they read as dates.
  add({
    id: 'month-capital', category: 'correctness', title: 'Capitalize the month',
    re: /\b(march|may|august)(?=\s+\d{1,4}\b|\s+(?:19|20)\d\d\b)|\bin\s+(march|may|august)(?=\s*[.,;]|\s+(?:19|20)\d\d\b)/g,
    map(m) {
      const word = m[1] || m[2];
      const start = m.index + m[0].lastIndexOf(word);
      return { start, end: start + word.length, replacements: [word.charAt(0).toUpperCase() + word.slice(1)], message: 'Month names start with a capital letter.' };
    },
  });

  // Languages, nationalities, religions and holidays. The dictionary accepts some of these in
  // lowercase ("english" is a billiards term), but in writing they're nearly always capitalised.
  const PROPER = ['english', 'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'russian', 'chinese', 'japanese', 'korean', 'arabic', 'hindi', 'latin', 'greek', 'hebrew', 'american', 'british', 'canadian', 'mexican', 'european', 'african', 'asian', 'australian', 'indian', 'irish', 'scottish', 'christian', 'muslim', 'jewish', 'hindu', 'buddhist', 'catholic', 'protestant', 'islam', 'christianity', 'judaism', 'buddhism', 'hinduism', 'christmas', 'easter', 'thanksgiving', 'ramadan', 'hanukkah', 'halloween'];
  add({
    id: 'proper-capital', category: 'correctness', title: 'Capitalize the name',
    re: new RegExp(`\\b(${PROPER.join('|')})\\b(?![-'’])`, 'g'),
    map(m) {
      return { start: m.index, end: m.index + m[1].length, replacements: [m[1].charAt(0).toUpperCase() + m[1].slice(1)], message: 'Names of languages, nationalities, religions and holidays start with a capital letter.' };
    },
  });

  // A rule whose regex captures the part to replace. The first capture group that matched is
  // the replaced part; it can sit anywhere in the match. `replace` and `message` get a match
  // whose [1] is that part.
  function groupRule(id, title, re, replace, message, extra = {}) {
    const rx = new RegExp(re.source, re.flags.includes('d') ? re.flags : `${re.flags}d`);
    add({
      id, category: 'correctness', title, re: rx,
      map(m, ctx) {
        if (extra.skip && extra.skip(m, ctx)) return null;
        let gi = 1;
        while (gi < m.length && m[gi] === undefined) gi++;
        if (gi >= m.length) return null;
        const g = m[gi];
        const s = m.indices[gi][0];
        const part = Object.assign([m[0], g], { index: m.index });
        const rep = typeof replace === 'function' ? replace(part, ctx) : replace;
        if (!rep) return null;
        return { start: s, end: s + g.length, replacements: (Array.isArray(rep) ? rep : [rep]).map((r) => T.matchCase(g, r)), message: typeof message === 'function' ? message(part) : message };
      },
    });
  }
  const NO_HYPHEN = '(?![-\\w\'’])';

  groupRule('its-own', 'Use “its” for possession', /\b(it['’]s)\s+own\b/gi, 'its', '“It’s” means “it is”. For belonging, use “its”, as in “its own”.');
  groupRule('its-contraction', 'Use “it’s” for “it is”', new RegExp(`\\b(its)\\s+(?:a|an|the|been|not|gonna|got|really|so|too|just|also|always|never|almost|okay|ok|because|like)${NO_HYPHEN}`, 'gi'), 'it’s', '“Its” shows belonging. Here you mean “it is” or “it has”: “it’s”.');
  groupRule('youre', 'Use “you’re” for “you are”', new RegExp(`\\b(your)\\s+(?:going|gonna|not|always|never|really|probably|definitely)${NO_HYPHEN}`, 'gi'), 'you’re', '“Your” shows belonging. Here you mean “you are”: “you’re”.');
  add({
    id: 'youre-welcome', category: 'correctness', title: 'Use “you’re” for “you are”',
    re: /\b(your)(\s+welcome)(?=\s*(?:[.!,;]|$))/gi,
    map(m) { return { start: m.index, end: m.index + 4, replacements: [T.matchCase(m[1], 'you’re')], message: 'In “you’re welcome”, “you’re” means “you are”.' }; },
  });
  groupRule('your-own', 'Use “your” for possession', /\b(you['’]re)\s+own\b/gi, 'your', '“You’re” means “you are”. For belonging, use “your”.');
  groupRule('there-is', 'Use “there” here', /\b(their)\s+(?:is|are|was|were)\b/gid, 'there', '“Their” shows belonging. To say something exists, use “there”: “there is”, “there are”.');
  groupRule('their-own', 'Use “their” for possession', /\b(there|they['’]re)\s+own\b/gid, 'their', '“Their” shows belonging, as in “their own”.');
  groupRule('theyre-going', 'Use “they’re” for “they are”', /\b(their)\s+going\s+to\b/gid, 'they’re', 'Here you mean “they are”: “they’re going to”.');
  groupRule('then-than', 'Use “than” to compare', /\b(?:more|less|better|worse|rather|other|greater|fewer|bigger|smaller|larger|higher|lower|older|younger|faster|slower|stronger|weaker|easier|harder|cheaper)\s+(then)\b/gid, 'than', 'Use “than” for comparisons and “then” for time.');
  groupRule('modal-of', 'Use “have”, not “of”', /\b(?:could|would|should|must|might|may)\s+(of)\b(?!\s+course)/gid, 'have', 'After could, would or should, write “have”: “could have”.', {
    skip: (m, ctx) => /^May/.test(m[0]) && !sentenceStartAt(ctx.text, m.index),
  });

  const PARTICIPLE = { went: 'gone', ate: 'eaten', ran: 'run', saw: 'seen', did: 'done', took: 'taken', wrote: 'written', drank: 'drunk', broke: 'broken', spoke: 'spoken', chose: 'chosen', gave: 'given', began: 'begun', swam: 'swum', sang: 'sung', drove: 'driven', rode: 'ridden', fell: 'fallen', forgot: 'forgotten', froze: 'frozen', stole: 'stolen', threw: 'thrown', grew: 'grown', knew: 'known', flew: 'flown', blew: 'blown', drew: 'drawn', wore: 'worn', tore: 'torn', shook: 'shaken', hid: 'hidden', came: 'come', became: 'become', sank: 'sunk', shrank: 'shrunk', stank: 'stunk', sprang: 'sprung' };
  groupRule('past-participle', 'Use the past participle', new RegExp(`\\b(?:have|has|had|having|['’]ve)\\s+(${Object.keys(PARTICIPLE).join('|')})\\b`, 'gid'), (m) => PARTICIPLE[m[1].toLowerCase()], (m) => `After “have” or “had”, use the past participle: “${PARTICIPLE[m[1].toLowerCase()]}”.`);
  groupRule('led', 'Use “led”', /\b(?:has|have|had|was|were|been)\s+(lead)\b(?=\s+(?:to|by|the|a|an|us|them|him|her|me|you|many|some|this|that)\b)/gid, 'led', 'The past tense of “lead” is “led”.');
  groupRule('lose', 'Use “lose”', /\b(?:to|will|would|could|can|might|may|must|should|not|never|don['’]t|didn['’]t|won['’]t|can['’]t|gonna)\s+(loose)\b|\b(loose)(?=\s+(?:weight|track|money|sleep|interest|hope|control|focus)\b)/gid, 'lose', '“Loose” means not tight. To misplace or fail to keep something, use “lose”.');
  groupRule('effect-noun', 'Use “effect” as a noun', /\b(?:an|the|no|any|positive|negative|side|great|greater|big|huge|lasting|major|significant|little|strong|direct|adverse|desired)\s+(affects?)\b/gid, (m) => (m[1].toLowerCase().endsWith('s') ? 'effects' : 'effect'), '“Effect” is usually the noun (the result); “affect” is usually the verb.');
  groupRule('affect-verb', 'Use “affect” as a verb', /\b(?:will|would|could|can|may|might|must|to|not|doesn['’]t|don['’]t|didn['’]t|won['’]t|can['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t)\s+(effect)\b(?!\s+(?:a\s+)?(?:change|changes|reform|reforms|cure|repairs|transformation))/gid, 'affect', '“Affect” is usually the verb (to influence); “effect” is usually the noun.');
  groupRule('affected', 'Use “affected”', /\b(?:was|were|is|are|be|been|being|get|got)\s+(effected)\b/gid, 'affected', 'To be influenced by something is to be “affected” by it.');

  const COUNT_NOUNS = 'people|students|children|kids|items|things|cars|books|words|times|days|hours|minutes|seconds|weeks|months|years|dollars|calories|mistakes|errors|options|choices|questions|problems|employees|workers|members|users|customers|countries|jobs|pages|steps|cases|deaths|patients|participants|votes|cells|trees|animals|houses';
  groupRule('fewer', 'Use “fewer” with things you count', new RegExp(`\\b(less)\\s+(?:${COUNT_NOUNS})${NO_HYPHEN}`, 'gid'), 'fewer', 'Use “fewer” for things you can count, and “less” for amounts.');
  groupRule('number-of', 'Use “number” with things you count', new RegExp(`\\b(amount)\\s+of\\s+(?:${COUNT_NOUNS})${NO_HYPHEN}`, 'gid'), 'number', 'Use “number of” for things you can count, and “amount of” for amounts.');
  groupRule('between-you-and-me', 'Use “me” after “between”', /\bbetween\s+you\s+and\s+(I)\b/gd, 'me', '“Between” takes the object form: “between you and me”.');
  groupRule('doesnt', 'Use “doesn’t” with he, she or it', /\b(?:he|she|it)\s+(don['’]t)\b/gid, (m) => (m[1].includes('’') ? 'doesn’t' : "doesn't"), 'With he, she or it, use “doesn’t”.');
  groupRule('dont', 'Use “don’t” with I, you, we or they', /\b(?:they|we|you|I)\s+(doesn['’]t)\b/gid, (m) => (m[1].includes('’') ? 'don’t' : "don't"), 'With I, you, we or they, use “don’t”.');
  groupRule('were', 'Use “were” with you, we or they', /\b(?:they|we|you)\s+(was)\b/gid, 'were', 'With you, we or they, use “were”.');
  groupRule('i-am', 'Use “am” with “I”', /\bI\s+(is|are)\b/gd, 'am', 'With “I”, use “am”.', {
    // "photosystem I are", "World War I is": a Roman numeral after a name or a noun.
    skip: (m, ctx) => !sentenceStartAt(ctx.text, m.index) && !/\b(?:and|but|so|then|because|that|when|if|while|where|after|before|since|as|or)\s+$/i.test(before(ctx.text, m.index, 12)),
  });
  groupRule('there-are', 'Use “there are” with plurals', /\b((?:there|here)['’]s)\s+(?:many|several|two|three|four|five|six|seven|eight|nine|ten|few|numerous|various)\b/gid, (m) => (/^here/i.test(m[1]) ? 'here are' : 'there are'), 'A plural needs “are”: “there are many”.');
  const AUX_BEFORE = /\b(?:do|does|did|should|would|could|can|will|shall|might|must|may|to|let|lets|make|makes|made|help|helps|helped|nor|doesn['’]t|didn['’]t|don['’]t|won['’]t|can['’]t|shouldn['’]t|wouldn['’]t|couldn['’]t|mustn['’]t|if)\s+$/i;
  groupRule('he-has', 'Use “has” with he, she or it', /\b(?:he|she|it)\s+(have)\b/gid, 'has', 'With he, she or it, use “has”.', {
    skip: (m, ctx) => AUX_BEFORE.test(before(ctx.text, m.index, 20)),
  });
  add({
    id: 'double-negative', category: 'correctness', title: 'Avoid the double negative',
    re: /\b(?:don['’]t|doesn['’]t|didn['’]t|can['’]t|cannot|won['’]t|isn['’]t|wasn['’]t|aren['’]t|weren['’]t|haven['’]t|hasn['’]t|ain['’]t)\s+(?:[a-z]+\s+)?(nothing|nobody|nowhere|none)\b|\b(?:don['’]t|doesn['’]t|didn['’]t|haven['’]t|hasn['’]t)\s+(?:have|got|need|want)\s+(no)\b/gid,
    map(m) {
      const g = m[1] ? 1 : 2;
      const word = m[g];
      const fix = { nothing: 'anything', nobody: 'anybody', nowhere: 'anywhere', none: 'any', no: 'any' }[word.toLowerCase()];
      const s = m.indices[g][0];
      return { start: s, end: s + word.length, replacements: [fix], message: `Two negatives cancel out. With “n’t”, use “${fix}”.` };
    },
  });
  groupRule('whos', 'Use “who’s” for “who is”', /\b(whose)\s+(?:going|coming|been|gonna)\b/gid, 'who’s', '“Whose” shows belonging. Here you mean “who is”: “who’s”.');
  groupRule('whose', 'Use “whose” for possession', /\b(who['’]s)\s+(?:car|house|book|turn|fault|idea|name|job|phone|dog|money|bag|coat|seat)\b/gid, 'whose', '“Who’s” means “who is”. For belonging, use “whose”.');
  groupRule('to-too', 'Use “too” for “excessively”', /\b(to)\s+(?:much|many|late|early|soon|bad|big|small|hard|fast|long|often|little)(?=\s*[.!?,;]|\s+(?:to|for)\b)/gid, 'too', '“Too” means more than enough, as in “too late”.');
  groupRule('too-to', 'Use “to” for direction', /\b(?:went|go|going|goes|come|came|walked|drove|back)\s+(too)\s+(?:the|a|my|your|school|work|bed)\b/gid, 'to', '“To” shows direction, as in “went to the store”.');
  groupRule('accept', 'Use “accept”', /\b(?:to|will|would|could|can|please|I|we|they|you|didn['’]t|don['’]t)\s+(except)\s+(?:your|the|my|our|this|that|an?|their|his|her)\s+(?:offer|invitation|apology|award|responsibility|terms|job|position|challenge|proposal|request|nomination)/gid, 'accept', '“Accept” means to receive or agree to; “except” means excluding.');
  groupRule('advise', 'Use “advise” as a verb', /\b(?:I|we|you|they|would|will|strongly|to)\s+(advice)\b(?!\s+(?:is|was|on|for|about|from)\b)/gid, 'advise', '“Advise” is the verb; “advice” is the noun.');
  groupRule('advice', 'Use “advice” as a noun', /\b(?:some|good|bad|your|my|his|her|their|our|of|for|any|the|great|expert|legal|medical|financial)\s+(advise)\b/gid, 'advice', '“Advice” is the noun; “advise” is the verb.');
  groupRule('breathe', 'Use “breathe” as a verb', /\b(?:to|can['’]t|cannot|couldn['’]t|could|can|will|must|just)\s+(breath)\b/gid, 'breathe', '“Breathe” is the verb; “breath” is the noun.');
  groupRule('breath', 'Use “breath” as a noun', /\b(?:a|my|your|his|her|their|our|deep|of)\s+(breathe)\b/gid, 'breath', '“Breath” is the noun; “breathe” is the verb.');
  groupRule('off', 'Use “off”', /\b(?:log|logged|logging|switch|switched|shut|kick|kicked|turned)\s+(of)\s+(?:the|it|your|my|his|her|their|our)\b/gid, 'off', 'Here you mean “off”, as in “turned off the light”.');
  groupRule('supposed-to', 'Use “supposed to”', /\b(?:am|is|are|was|were|be|been|['’]m|['’]re|['’]s)\s+(suppose)\s+to\b/gid, 'supposed', 'The phrase is “supposed to”.');
  groupRule('every-day', 'Use “every day” as an adverb', /\b(everyday)(?=\s*(?:[.!?,;:]|$))/gid, 'every day', '“Everyday” is an adjective (everyday life). For how often, write “every day”.');

  // Fixed phrases people often get wrong.
  const IDIOMS = [
    ['could care less', 'couldn’t care less', 'The phrase is “couldn’t care less”.'],
    ['for all intensive purposes', 'for all intents and purposes', 'The phrase is “for all intents and purposes”.'],
    ['irregardless', 'regardless', '“Irregardless” isn’t standard. Use “regardless”.'],
    ['supposably', 'supposedly', 'The word is “supposedly”.'],
    ['per say', 'per se', 'The Latin phrase is “per se”.'],
    ['case and point', 'case in point', 'The phrase is “case in point”.'],
    ['deep seeded', 'deep-seated', 'The phrase is “deep-seated”.'],
    ['deep-seeded', 'deep-seated', 'The phrase is “deep-seated”.'],
    ['escape goat', 'scapegoat', 'The word is “scapegoat”.'],
    ['mute point', 'moot point', 'The phrase is “moot point”.'],
    ['peaked my interest', 'piqued my interest', 'To arouse interest is to “pique” it.'],
    ['peaked his interest', 'piqued his interest', 'To arouse interest is to “pique” it.'],
    ['peaked her interest', 'piqued her interest', 'To arouse interest is to “pique” it.'],
    ['peaked their interest', 'piqued their interest', 'To arouse interest is to “pique” it.'],
    ['sneak peak', 'sneak peek', 'A quick look is a “peek”.'],
    ['wreck havoc', 'wreak havoc', 'The phrase is “wreak havoc”.'],
    ['statue of limitations', 'statute of limitations', 'The phrase is “statute of limitations”.'],
    ['one in the same', 'one and the same', 'The phrase is “one and the same”.'],
    ['a whole nother', 'a whole other', 'Write “a whole other”.'],
    ['nip it in the butt', 'nip it in the bud', 'The phrase is “nip it in the bud”.'],
    ['free reign', 'free rein', 'The phrase is “free rein”, from horse riding.'],
    ['tow the line', 'toe the line', 'The phrase is “toe the line”.'],
    ['baited breath', 'bated breath', 'The phrase is “bated breath”.'],
    ['all of the sudden', 'all of a sudden', 'The phrase is “all of a sudden”.'],
    ['by in large', 'by and large', 'The phrase is “by and large”.'],
    ['make due', 'make do', 'The phrase is “make do”.'],
    ['beckon call', 'beck and call', 'The phrase is “beck and call”.'],
    ['slight of hand', 'sleight of hand', 'The phrase is “sleight of hand”.'],
    ['first come, first serve', 'first come, first served', 'The phrase is “first come, first served”.'],
    ['hunger pains', 'hunger pangs', 'The phrase is “hunger pangs”.'],
  ];
  add({
    id: 'idiom', category: 'correctness', title: 'Fix the phrase',
    re: new RegExp(`\\b(?:${IDIOMS.map(([p]) => T.escapeRe(p).replace(/ /g, '\\s+')).join('|')})\\b`, 'gi'),
    map(m) {
      const key = m[0].toLowerCase().replace(/\s+/g, ' ');
      const hit = IDIOMS.find(([p]) => p === key);
      if (!hit) return null;
      return { start: m.index, end: m.index + m[0].length, replacements: [T.matchCase(m[0], hit[1])], message: hit[2] };
    },
  });

  // ---------------------------------------------------------------------------
  // Correctness: punctuation and spacing
  // ---------------------------------------------------------------------------

  add({
    id: 'space-before-punct', category: 'correctness', title: 'Remove the space before punctuation',
    re: /(?<=[A-Za-z0-9)\]"”’])([ \t\u00a0]+)([,.;:!?])(?=[\s"”’]|$)/g,
    map(m, ctx) {
      if (ctx.text[m.index + m[0].length] === '.') return null; // " ..." is an ellipsis
      if ((m[2] === ':' || m[2] === ';') && /\s/.test(ctx.text[m.index + m[0].length] || '')) return null; // "ATP : NADH" ratios
      return { start: m.index, end: m.index + m[0].length, replacements: [m[2]], message: `There’s no space before “${m[2]}”.` };
    },
  });
  add({
    id: 'space-after-punct', category: 'correctness', title: 'Add a space after punctuation',
    re: /(?<=[a-z]{2})([,;:])(?=[A-Za-z]{2})|(?<=[a-z]{2})(\.)(?=[A-Z][a-z]+\b)/g,
    map(m) {
      return { start: m.index, end: m.index + 1, replacements: [`${m[0]} `], message: `Add a space after “${m[0]}”.` };
    },
  });
  add({
    id: 'extra-space', category: 'correctness', title: 'Remove the extra space',
    run(ctx) {
      const out = [];
      const lines = ctx.text.split('\n');
      let offset = 0;
      for (const line of lines) {
        const runs = [...line.matchAll(/(?<=\S)(?:  |\u00a0 | \u00a0|\u00a0\u00a0)(?=\S)/g)];
        // Wider gaps, or several on one line, are usually alignment (a table or a poem).
        if (runs.length === 1 || (runs.length === 2 && !/\S {3,}\S/.test(line))) {
          for (const m of runs) out.push({ start: offset + m.index, end: offset + m.index + m[0].length, replacements: [' '], message: 'There are two spaces here.' });
        }
        offset += line.length + 1;
      }
      return out;
    },
  });
  add({
    id: 'double-punct', category: 'correctness', title: 'Remove the extra punctuation',
    re: /([,;:])\1+|(?<![.\d])\.\.(?![./\\\d])/g,
    map(m) { return { start: m.index, end: m.index + m[0].length, replacements: [m[1] || '.'], message: 'This punctuation mark is doubled.' }; },
  });
  const INTRO = 'Therefore|Moreover|Furthermore|Additionally|Consequently|Nevertheless|Nonetheless|Meanwhile|Unfortunately|Fortunately|Surprisingly|Interestingly|Similarly|Likewise|Ultimately|Overall|Firstly|Secondly|Thirdly|Lastly|Finally|Instead|Otherwise|Indeed|Afterward|Afterwards|Personally|Honestly|Clearly|Obviously|Typically|Generally|Historically|Traditionally';
  const SUBJECT_START = 'the|a|an|this|that|these|those|there|it|we|they|he|she|I|you|our|my|their|his|her|its|some|most|many|several|all|each|every|no|one|two|in|at|on|by|when|if|after|before|because|since';
  add({
    id: 'intro-comma', category: 'correctness', title: 'Add a comma after the introductory word',
    re: new RegExp(`(?:^|(?<=[.!?]["”’)]?\\s+)|(?<=\\n\\s*))(?:(${INTRO})|(However))(?=\\s+(?:${SUBJECT_START})\\b)`, 'gd'),
    map(m, ctx) {
      const word = m[1] || m[2];
      if (m[2]) {
        const next = /^\s+(\w+)/.exec(ctx.text.slice(m.index + word.length))?.[1] || '';
        if (!/^(?:the|a|an|this|these|those|our|my|their|his|her|its|some|most|many|several|in|at|on|by|when|if|after|before|because|since)$/i.test(next)) return null;
      }
      return { start: m.index, end: m.index + word.length, replacements: [`${word},`], message: `Introductory words like “${word}” are followed by a comma.` };
    },
  });

  // ---------------------------------------------------------------------------
  // Clarity
  // ---------------------------------------------------------------------------

  // phrase → replacement. "" deletes the phrase.
  const WORDY = [
    ['in order to', 'to'], ['in order for', 'for'], ['so as to', 'to'], ['in an effort to', 'to'],
    ['due to the fact that', 'because'], ['owing to the fact that', 'because'], ['in light of the fact that', 'because'], ['on account of the fact that', 'because'],
    ['in spite of the fact that', 'although'], ['despite the fact that', 'although'], ['regardless of the fact that', 'although'],
    ['at this point in time', 'now'], ['at this moment in time', 'now'], ['at the present time', 'currently'], ['at the present moment', 'now'],
    ['in the near future', 'soon'], ['at an early date', 'soon'], ['in the event that', 'if'],
    ['for the purpose of', 'for'], ['with the exception of', 'except'], ['in close proximity to', 'near'], ['in the vicinity of', 'near'],
    ['a large number of', 'many'], ['a great number of', 'many'], ['a significant number of', 'many'],
    ['is able to', 'can'], ['are able to', 'can'], ['has the ability to', 'can'], ['have the ability to', 'can'],
    ['make a decision', 'decide'], ['made a decision', 'decided'], ['making a decision', 'deciding'], ['makes a decision', 'decides'],
    ['come to a conclusion', 'conclude'], ['came to a conclusion', 'concluded'], ['reach a conclusion', 'conclude'], ['reached a conclusion', 'concluded'],
    ['give consideration to', 'consider'], ['take into consideration', 'consider'], ['is in need of', 'needs'], ['are in need of', 'need'],
    ['it is important to note that', ''], ['it should be noted that', ''], ['it is worth noting that', ''], ['it is interesting to note that', ''],
    ['it goes without saying that', ''], ['needless to say,', ''], ['each and every', 'every'], ['first and foremost', 'first'],
    ['with regard to', 'about'], ['in regard to', 'about'], ['with reference to', 'about'], ['in reference to', 'about'],
    ['on a daily basis', 'daily'], ['on a weekly basis', 'weekly'], ['on a monthly basis', 'monthly'], ['on a yearly basis', 'yearly'], ['on a regular basis', 'regularly'],
    ['at all times', 'always'], ['prior to', 'before'], ['subsequent to', 'after'], ['until such time as', 'until'],
    ['in a timely manner', 'promptly'], ['for the most part', 'mostly'], ['is indicative of', 'indicates'], ['are indicative of', 'indicate'],
    ['has a tendency to', 'tends to'], ['have a tendency to', 'tend to'], ['as a matter of fact', 'in fact'], ['the reason why is because', 'because'],
    ['the reason is because', 'the reason is that'], ['whether or not', 'whether'], ['in the course of', 'during'], ['during the course of', 'during'],
    ['make an attempt to', 'try to'], ['made an attempt to', 'tried to'], ['provide assistance to', 'help'], ['conduct an investigation into', 'investigate'],
    ['all of the', 'all the'], ['in the process of', ''], ['a total of', ''],
  ];
  // "whether or not" can lose "or not" only in an indirect question ("decide whether to go").
  // Meaning "regardless of whether", it needs both words.
  const ASKING_BEFORE = /\b(?:know|knows|knew|decide|decides|decided|deciding|ask|asks|asked|wonder|wonders|wondered|wondering|determine|determines|determined|see|check|sure|unclear|choose|chose|question|doubt|consider|considering|discuss|discussed|debate|debated)\s+(?:\w+\s+)?$/i;
  const REDUNDANT = [
    ['past history', 'history'], ['end result', 'result'], ['final outcome', 'outcome'], ['free gift', 'gift'], ['close proximity', 'proximity'],
    ['basic fundamentals', 'fundamentals'], ['advance planning', 'planning'], ['advance warning', 'warning'], ['future plans', 'plans'],
    ['unexpected surprise', 'surprise'], ['revert back', 'revert'], ['return back', 'return'], ['repeat again', 'repeat'], ['added bonus', 'bonus'],
    ['true fact', 'fact'], ['join together', 'join'], ['merge together', 'merge'], ['combine together', 'combine'], ['collaborate together', 'collaborate'],
    ['cooperate together', 'cooperate'], ['completely eliminate', 'eliminate'], ['completely finished', 'finished'], ['completely destroyed', 'destroyed'],
    ['absolutely essential', 'essential'], ['absolutely necessary', 'necessary'], ['very unique', 'unique'], ['most unique', 'unique'],
    ['general consensus', 'consensus'], ['consensus of opinion', 'consensus'], ['new innovation', 'innovation'], ['postpone until later', 'postpone'],
    ['still remains', 'remains'], ['sum total', 'total'], ['brief summary', 'summary'], ['exact same', 'same'], ['might possibly', 'might'],
    ['may possibly', 'may'], ['past experience', 'experience'], ['invited guests', 'guests'], ['foreign imports', 'imports'], ['ATM machine', 'ATM'],
    ['PIN number', 'PIN'], ['reply back', 'reply'], ['first began', 'began'], ['first started', 'started'],
    ['over exaggerate', 'exaggerate'], ['mutual cooperation', 'cooperation'], ['personal opinion', 'opinion'], ['actual fact', 'fact'], ['end goal', 'goal'],
  ];
  function phraseRule(id, category, title, list, message, opts = {}) {
    const lookup = new Map(list.map(([p, r]) => [p.toLowerCase(), r]));
    const sorted = [...lookup.keys()].sort((a, b) => b.length - a.length);
    add({
      id, category, title, goals: opts.goals,
      re: new RegExp(`(?<![\\w'’-])(?:${sorted.map((p) => T.escapeRe(p).replace(/\\ |\s/g, '\\s+')).join('|')})(?![\\w'’-])`, 'gi'),
      map(m, ctx) {
        const key = m[0].toLowerCase().replace(/\s+/g, ' ');
        if (!lookup.has(key)) return null;
        if (opts.skip && opts.skip(m, ctx, key)) return null;
        let rep = lookup.get(key);
        const start = m.index;
        let end = m.index + m[0].length;
        if (rep === '') {
          // Deleting a phrase takes the space after it, and capitalises the next word when the
          // phrase started the sentence.
          const after = /^\s+(\S)/.exec(ctx.text.slice(end));
          if (!after) return null;
          end += after[0].length;
          rep = sentenceStartAt(ctx.text, start) ? after[1].toUpperCase() : after[1];
        } else {
          rep = T.matchCase(m[0], rep);
        }
        return { start, end, replacements: [rep], message: typeof message === 'function' ? message(m[0], lookup.get(key)) : message };
      },
    });
  }
  phraseRule('wordy', 'clarity', 'Make it more concise', WORDY, (p, r) => (r ? `“${r}” says the same in fewer words.` : `“${p.replace(/,$/, '')}” adds words without adding meaning.`), {
    skip: (m, ctx, key) => {
      const after = ctx.text.slice(m.index + m[0].length);
      if (key === 'all of the') return /^\s+(?:above|following)\b/i.test(after);
      if (key === 'whether or not') return !ASKING_BEFORE.test(before(ctx.text, m.index, 40));
      if (key === 'in the process of') return !/^\s+\w+ing\b/.test(after); // "in the process of photosynthesis" stays
      return false;
    },
  });
  phraseRule('redundant', 'clarity', 'Remove the redundancy', REDUNDANT, (p, r) => `“${r}” already includes the meaning of “${p}”.`);

  add({
    id: 'the-majority-of', category: 'clarity', title: 'Make it more concise',
    re: /\b((?:the|a) majority of)(\s+)(?:(the|these|those|my|our|their|his|her|its|them|us|you)\b)?/gi,
    map(m) {
      const rep = m[3] ? 'most of' : 'most';
      return { start: m.index, end: m.index + m[1].length, replacements: [T.matchCase(m[1], rep)], message: `“${rep}” says the same in fewer words.` };
    },
  });

  add({
    id: 'long-sentence', category: 'clarity', title: 'Long sentence',
    run(ctx) {
      const limit = ctx.goal.longSentence;
      if (!limit) return [];
      const out = [];
      for (const s of ctx.sentences()) {
        const n = T.wordCount(s.text);
        if (n > limit) out.push({ start: s.start, end: s.end, replacements: [], whole: true, message: `This sentence has ${n} words, which makes it hard to follow. Try splitting it into two.` });
      }
      return out;
    },
  });

  const PARTS = 'known|seen|done|made|given|taken|written|shown|found|built|told|held|kept|left|lost|paid|sent|sold|spent|understood|won|caught|chosen|driven|eaten|forgotten|hidden|ridden|spoken|stolen|thrown|worn|beaten|begun|bitten|blown|broken|drawn|fallen|flown|frozen|grown|hung|hurt|laid|led|met|put|read|run|said|set|shot|sung|struck|swept|taught|thought|torn|bought|brought|fought|sought|felt|heard|meant|won';
  // Participles that usually describe a state, not an action someone did ("impressed by").
  const STATE_PARTICIPLES = /^(?:impressed|influenced|inspired|fascinated|surprised|shocked|amazed|pleased|disappointed|frustrated|motivated|moved|touched|overwhelmed|intrigued|bored|excited|scared|frightened|worried|concerned|interested|known|accompanied|surrounded|followed|joined|preceded|characterized|marked|dominated)$/i;
  add({
    id: 'passive', category: 'clarity', title: 'Passive voice', goals: ['general', 'academic', 'professional', 'simple'],
    re: new RegExp(`\\b(?:am|is|are|was|were|be|been|being)\\s+(?:\\w+ly\\s+)?(?:\\w+ed|${PARTS})\\s+by\\b(?!\\s+(?:far|then|now|the way|chance|accident|mistake|hand|heart|myself|yourself|himself|herself|itself|ourselves|themselves)\\b)`, 'gi'),
    map(m) {
      const verb = m[0].trim().split(/\s+/).slice(-2, -1)[0] || '';
      if (STATE_PARTICIPLES.test(verb)) return null;
      return { start: m.index, end: m.index + m[0].length - 3, replacements: [], message: 'Passive voice can hide who did what. Try starting with whoever does the action.' };
    },
  });

  // ---------------------------------------------------------------------------
  // Engagement
  // ---------------------------------------------------------------------------

  const STRONGER = {
    good: ['excellent', 'great'], bad: ['terrible', 'awful'], big: ['huge', 'enormous'], small: ['tiny', 'minuscule'], large: ['huge', 'massive'],
    important: ['crucial', 'essential'], happy: ['delighted', 'thrilled'], sad: ['miserable', 'heartbroken'], tired: ['exhausted', 'drained'],
    angry: ['furious', 'livid'], scared: ['terrified'], afraid: ['terrified'], hungry: ['starving', 'ravenous'], cold: ['freezing', 'frigid'],
    hot: ['scorching', 'sweltering'], beautiful: ['stunning', 'gorgeous'], pretty: ['lovely'], ugly: ['hideous'], smart: ['brilliant'],
    difficult: ['challenging', 'arduous'], easy: ['effortless', 'simple'], slow: ['sluggish'], quiet: ['silent', 'hushed'],
    loud: ['deafening', 'thunderous'], interesting: ['fascinating', 'intriguing'], boring: ['tedious', 'dull'], funny: ['hilarious'],
    strong: ['powerful', 'robust'], weak: ['feeble', 'frail'], rich: ['wealthy', 'affluent'], dirty: ['filthy'], clean: ['spotless'],
    busy: ['swamped', 'hectic'], sure: ['certain', 'confident'], often: ['frequently'],
    many: ['numerous'], nice: ['lovely', 'delightful'], worried: ['anxious', 'distraught'], excited: ['thrilled', 'eager'], surprised: ['astonished', 'amazed'],
    serious: ['grave', 'severe'], tasty: ['delicious'], expensive: ['costly', 'pricey'], cheap: ['inexpensive'], simple: ['straightforward'],
    complicated: ['intricate', 'convoluted'], accurate: ['precise', 'exact'], careful: ['meticulous', 'cautious'], necessary: ['essential', 'vital'],
    helpful: ['invaluable'], common: ['widespread', 'prevalent'], rare: ['scarce', 'uncommon'], different: ['distinct', 'dissimilar'],
    obvious: ['glaring', 'evident'], scary: ['terrifying'], bright: ['brilliant', 'dazzling'],
  };
  // Left out on purpose: "very hard", "very fast" (often adverbs: "worked very hard"), "very old"
  // ("my very old grandmother" isn't "ancient"), "very clear" and "very poor" (meaning shifts).
  add({
    id: 'weak-intensifier', category: 'engagement', title: 'Choose a stronger word',
    re: new RegExp(`\\b(very|really|extremely|super)\\s+(${Object.keys(STRONGER).join('|')})\\b(?![-'’])`, 'gi'),
    map(m, ctx) {
      if (NEGATED.test(before(ctx.text, m.index))) return null; // "not very good" means something else
      if (m[1].toLowerCase() === 'super' && ctx.goal.id !== 'academic' && ctx.goal.id !== 'professional') return null;
      const options = STRONGER[m[2].toLowerCase()];
      return { start: m.index, end: m.index + m[0].length, replacements: options.map((o) => T.matchCase(m[0], o)), message: `“${m[1]} ${m[2]}” is weaker than one precise word.`, coach: { phrase: m[0], word: m[2] } };
    },
  });

  const CLICHES = [
    ['at the end of the day', 'ultimately'], ['think outside the box', 'think creatively'], ['think outside of the box', 'think creatively'],
    ["in today's society", 'today'], ['in today’s society', 'today'], ['in this day and age', 'today'], ['since the dawn of time', ''],
    ['last but not least', 'finally'], ['few and far between', 'rare'], ['par for the course', 'typical'], ['low-hanging fruit', 'easy wins'],
    ['a level playing field', 'fair conditions'], ['at the drop of a hat', 'immediately'], ['in the nick of time', 'just in time'],
    ['all walks of life', 'all backgrounds'], ['easier said than done', 'difficult'], ['avoid like the plague', 'avoid'],
    ['hit the ground running', 'start quickly'], ['move the needle', 'make a difference'], ['the tip of the iceberg', ''],
    ['only time will tell', ''], ['it is what it is', ''], ['touch base', 'check in'], ['circle back', 'follow up'],
  ];
  add({
    id: 'cliche', category: 'engagement', title: 'Replace the cliché',
    re: new RegExp(`(?<![\\w'’-])(?:${CLICHES.map(([p]) => T.escapeRe(p).replace(/\\ |\s/g, '\\s+')).join('|')})(?![\\w'’-])`, 'gi'),
    map(m) {
      const key = m[0].toLowerCase().replace(/\s+/g, ' ');
      const hit = CLICHES.find(([p]) => p.toLowerCase() === key);
      if (!hit) return null;
      return { start: m.index, end: m.index + m[0].length, replacements: hit[1] ? [T.matchCase(m[0], hit[1])] : [], message: hit[1] ? `“${m[0]}” is a cliché. Plainer words land better.` : `“${m[0]}” is a cliché. Say exactly what you mean instead.` };
    },
  });

  // ---------------------------------------------------------------------------
  // Tone (academic and professional goals)
  // ---------------------------------------------------------------------------

  const CONTRACTIONS = {
    "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'cannot', "couldn't": 'could not', "won't": 'will not',
    "wouldn't": 'would not', "shouldn't": 'should not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
    "haven't": 'have not', "hasn't": 'has not', "hadn't": 'had not', "mustn't": 'must not', "it's": 'it is', "that's": 'that is',
    "there's": 'there is', "here's": 'here is', "what's": 'what is', "who's": 'who is', "let's": 'let us', "i'm": 'I am',
    "you're": 'you are', "we're": 'we are', "they're": 'they are', "he's": 'he is', "she's": 'she is', "i've": 'I have',
    "you've": 'you have', "we've": 'we have', "they've": 'they have', "i'll": 'I will', "you'll": 'you will', "we'll": 'we will',
    "they'll": 'they will', "he'll": 'he will', "she'll": 'she will', "it'll": 'it will',
  };
  add({
    id: 'contraction', category: 'tone', title: 'Expand the contraction', goals: ['academic'],
    re: new RegExp(`\\b(?:${Object.keys(CONTRACTIONS).map((c) => c.replace("'", "['’]")).join('|')})(?![\\w'’])`, 'gi'),
    map(m, ctx) {
      if (inQuotes(ctx.text, m.index)) return null;
      const key = m[0].toLowerCase().replace('’', "'");
      let rep = CONTRACTIONS[key];
      if (!rep) return null;
      if (/'s$/.test(key) && /^\s+(?:been|got)\b/i.test(ctx.text.slice(m.index + m[0].length))) rep = rep.replace(/ is$/, ' has');
      if (key.startsWith("i'")) rep = rep.replace(/^i\b/, 'I');
      return { start: m.index, end: m.index + m[0].length, replacements: [T.matchCase(m[0], rep)], message: 'Contractions read as informal in academic writing.' };
    },
  });

  const INFORMAL = [
    ['gonna', 'going to'], ['wanna', 'want to'], ['gotta', 'have to'], ['kinda', 'somewhat'], ['sorta', 'somewhat'], ['gimme', 'give me'],
    ['lemme', 'let me'], ['dunno', 'do not know'], ['yeah', 'yes'], ['yep', 'yes'], ['nope', 'no'], ['cuz', 'because'], ['thru', 'through'],
    ['tho', 'though'], ['altho', 'although'], ['pls', 'please'], ['plz', 'please'], ['thx', 'thanks'], ['anyways', 'anyway'],
    ['awesome', 'excellent'], ['totally', 'completely'], ['a lot of', 'many'], ['lots of', 'many'], ['kids', 'children'], ['alright', 'all right'],
  ];
  const ACADEMIC_ONLY = new Set(['a lot of', 'lots of', 'kids', 'totally', 'alright', 'awesome']);
  add({
    id: 'informal', category: 'tone', title: 'Use a more formal word', goals: ['academic', 'professional'],
    re: new RegExp(`(?<![\\w'’-])(?:${INFORMAL.map(([p]) => T.escapeRe(p).replace(/\\ |\s/g, '\\s+')).join('|')})(?![\\w'’-])`, 'gi'),
    map(m, ctx) {
      const key = m[0].toLowerCase().replace(/\s+/g, ' ');
      const hit = INFORMAL.find(([p]) => p === key);
      if (!hit || inQuotes(ctx.text, m.index)) return null;
      if (ACADEMIC_ONLY.has(key) && ctx.goal.id !== 'academic') return null;
      let reps = [hit[1]];
      if (key === 'a lot of' || key === 'lots of') {
        // "many" for things you count ("a lot of students"), "much" for amounts ("a lot of heat").
        const [first = '', second = ''] = (/^\s+([\w-]+)(?:\s+([\w-]+))?/.exec(ctx.text.slice(m.index + m[0].length)) || []).slice(1).map((x) => (x || '').toLowerCase());
        const plural = (x) => /(?:[^s]s|ies|es)$/.test(x) || /^(?:people|children|men|women|feet|teeth|mice|geese|data|police|cattle)$/.test(x);
        const adjective = /(?:al|ive|ous|ful|ent|ant|ic|ed|y|ing)$|^(?:new|old|young|other|different|small|large|big|great)$/.test(first);
        reps = plural(first) || (adjective && plural(second)) ? ['many'] : ['much'];
      }
      return { start: m.index, end: m.index + m[0].length, replacements: reps.map((r) => T.matchCase(m[0], r)), message: `“${m[0]}” reads as informal for ${ctx.goal.id === 'academic' ? 'academic' : 'professional'} writing.` };
    },
  });

  const HEDGES = [
    ['i just wanted to', 'I wanted to', 'You don’t need “just”. It makes the request sound smaller than it is.'],
    ['just wanted to', 'wanted to', 'You don’t need “just”. It makes the request sound smaller than it is.'],
    ['i was just wondering if', 'I was wondering if', 'You don’t need “just”. It makes the request sound smaller than it is.'],
    ['sorry to bother you', '', 'Apologizing for asking can undercut your request.'],
    ['i hate to bother you', '', 'Apologizing for asking can undercut your request.'],
    ["i'm no expert, but", '', 'Lead with your point; the disclaimer weakens it.'],
    ['i’m no expert, but', '', 'Lead with your point; the disclaimer weakens it.'],
  ];
  add({
    id: 'hedging', category: 'tone', title: 'Sound more confident', goals: ['professional'],
    re: new RegExp(`(?<![\\w'’-])(?:${HEDGES.map(([p]) => T.escapeRe(p).replace(/\\ |\s/g, '\\s+')).join('|')})(?![\\w'’-])`, 'gi'),
    map(m, ctx) {
      const key = m[0].toLowerCase().replace(/\s+/g, ' ');
      const hit = HEDGES.find(([p]) => p === key);
      if (!hit) return null;
      let rep = hit[1];
      let end = m.index + m[0].length;
      if (!rep) {
        const after = /^[,.!]?\s+(\S)/.exec(ctx.text.slice(end));
        if (!after) return { start: m.index, end, replacements: [], message: hit[2] };
        end += after[0].length;
        rep = sentenceStartAt(ctx.text, m.index) ? after[1].toUpperCase() : after[1];
      } else rep = T.matchCase(m[0], rep);
      return { start: m.index, end, replacements: [rep], message: hit[2] };
    },
  });

  add({
    id: 'absolute', category: 'tone', title: 'Qualify the absolute claim', goals: ['academic'],
    // Not "never": in history writing it's usually a fact ("the treaty was never ratified").
    re: /\b(always|everyone|everybody|nobody)\b(?![-'’])/gi,
    map(m, ctx) {
      const b = before(ctx.text, m.index, 12).toLowerCase();
      if (/\b(?:as|almost|nearly|not|hardly)\s+$/.test(b) || inQuotes(ctx.text, m.index)) return null;
      if (/^\s+mind\b/i.test(ctx.text.slice(m.index + m[0].length))) return null; // "never mind"
      const reps = { always: ['often', 'usually'], never: ['rarely', 'seldom'], everyone: ['most people'], everybody: ['most people'], nobody: ['few people'] }[m[1].toLowerCase()];
      return { start: m.index, end: m.index + m[0].length, replacements: reps.map((r) => T.matchCase(m[1], r)), message: `Is it ${m[1].toLowerCase() === 'never' || m[1].toLowerCase() === 'nobody' ? 'never true' : 'always true'}? Absolute words are easy to disprove, so qualify the claim unless you can back it fully.` };
    },
  });

  add({
    id: 'exclamation', category: 'tone', title: 'Use one exclamation mark', goals: ['academic', 'professional'],
    re: /!{2,}|\?{2,}/g,
    map(m) { return { start: m.index, end: m.index + m[0].length, replacements: [m[0][0]], message: 'One mark is enough; more reads as shouting.' }; },
  });

  add({
    id: 'exclamation-academic', category: 'tone', title: 'Use a full stop', goals: ['academic'],
    re: /(?<=[\p{L}\d)"”’])!(?!!)/gu,
    map(m, ctx) {
      if (inQuotes(ctx.text, m.index)) return null;
      return { start: m.index, end: m.index + 1, replacements: ['.'], message: 'Exclamation marks read as informal in academic writing.' };
    },
  });

  // ---------------------------------------------------------------------------
  // Running the rules
  // ---------------------------------------------------------------------------

  const PRIORITY = { correctness: 0, facts: 1, clarity: 2, tone: 3, engagement: 4, study: 5 };

  function check(text, opts = {}) {
    const goal = goalOf(opts.goal);
    const disabled = opts.disabled instanceof Set ? opts.disabled : new Set(opts.disabled || []);
    const masks = T.maskRanges(text);
    let sents = null;
    const ctx = { text, goal, sentences: () => (sents ||= T.sentences(text)) };
    const found = [];
    for (const r of RULES) {
      if (disabled.has(r.id)) continue;
      if (!goal.categories.includes(r.category)) continue;
      if (r.goals && !r.goals.includes(goal.id)) continue;
      let hits;
      if (r.run) {
        hits = r.run(ctx);
      } else {
        hits = [];
        r.re.lastIndex = 0;
        for (const m of text.matchAll(r.re)) {
          const issue = r.map(m, ctx);
          if (issue) hits.push(issue);
        }
      }
      for (const issue of hits) {
        if (issue.end <= issue.start) continue;
        if (!issue.whole && T.overlapsAny(masks, issue.start, issue.end)) continue;
        const original = text.slice(issue.start, issue.end);
        const replacements = (issue.replacements || []).filter((x) => x !== original);
        if ((issue.replacements || []).length && !replacements.length) continue;
        found.push({
          id: `${r.id}:${issue.start}:${T.hash(original)}`,
          rule: r.id,
          category: r.category,
          title: r.title,
          message: issue.message,
          start: issue.start,
          end: issue.end,
          original,
          replacements,
          whole: !!issue.whole,
          coach: issue.coach || null,
          source: 'rules',
        });
      }
    }
    // One issue per stretch of text: the most important category wins, then the shorter span.
    found.sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || (a.whole - b.whole) || (a.end - a.start) - (b.end - b.start) || a.start - b.start);
    const kept = [];
    for (const f of found) {
      if (f.whole) {
        kept.push(f); // a long-sentence flag sits under everything else
        continue;
      }
      if (kept.some((k) => !k.whole && f.start < k.end && k.start < f.end)) continue;
      kept.push(f);
    }
    return kept.sort((a, b) => a.start - b.start);
  }

  SE.rules = { check, GOALS, goalOf, goalForSite, CATEGORIES, list: () => RULES.map((r) => ({ id: r.id, category: r.category, title: r.title })), articleFor };
})();
