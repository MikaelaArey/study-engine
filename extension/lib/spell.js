/*
 * Study Engine: spell checker.
 *
 * Words are looked up in a dictionary built from SCOWL (data/dict-*.txt). Suggestions come
 * from a list of common misspellings first, then from words one or two edits away, ranked by
 * how common the word is, keyboard distance and typical typos (swapped or doubled letters).
 * Runs in the service worker, so the dictionary is loaded once rather than in every tab.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  if (SE.Speller) return;

  // Frequent misspellings and their corrections. Checked before the edit-distance search, and
  // the only way to suggest two words ("alot" → "a lot").
  const COMMON = {
    abscence: 'absence', accomodate: 'accommodate', accomodation: 'accommodation', acheive: 'achieve',
    acheived: 'achieved', acheivement: 'achievement', accross: 'across', adress: 'address',
    agressive: 'aggressive', alot: 'a lot', alittle: 'a little', amature: 'amateur',
    apparantly: 'apparently', appearence: 'appearance', arguement: 'argument', aswell: 'as well',
    atleast: 'at least', assasination: 'assassination', basicly: 'basically', becuase: 'because',
    becasue: 'because', becuse: 'because', beacuse: 'because', beggining: 'beginning',
    begining: 'beginning', beleive: 'believe', belive: 'believe', buisness: 'business',
    calender: 'calendar', cemetary: 'cemetery', changable: 'changeable', collegue: 'colleague',
    comming: 'coming', commited: 'committed', commitee: 'committee', completly: 'completely',
    concious: 'conscious', curiousity: 'curiosity', definately: 'definitely', definatly: 'definitely',
    definitly: 'definitely', dilemna: 'dilemma', dissapoint: 'disappoint', disapoint: 'disappoint',
    eachother: 'each other', embarass: 'embarrass', embarassing: 'embarrassing', enviroment: 'environment',
    equiptment: 'equipment', everytime: 'every time', excercise: 'exercise', existance: 'existence',
    experiance: 'experience', familar: 'familiar', fasinating: 'fascinating', finaly: 'finally',
    foriegn: 'foreign', fourty: 'forty', freind: 'friend', freinds: 'friends', gaurd: 'guard',
    goverment: 'government', grammer: 'grammar', greatful: 'grateful', guage: 'gauge',
    happend: 'happened', harrass: 'harass', heighth: 'height', heirarchy: 'hierarchy',
    hygeine: 'hygiene', hypocracy: 'hypocrisy', ignorence: 'ignorance', immediatly: 'immediately',
    incase: 'in case', independant: 'independent', indispensible: 'indispensable', infact: 'in fact',
    inspite: 'in spite', intelligance: 'intelligence', interupt: 'interrupt', irrelevent: 'irrelevant',
    knowlege: 'knowledge', liason: 'liaison', libary: 'library', maintainance: 'maintenance',
    millenium: 'millennium', miniscule: 'minuscule', mischievious: 'mischievous', mispell: 'misspell',
    neccessary: 'necessary', necesary: 'necessary', neice: 'niece', noone: 'no one',
    noticable: 'noticeable', occassion: 'occasion', occassionally: 'occasionally', occured: 'occurred',
    occurence: 'occurrence', occuring: 'occurring', ofcourse: 'of course', ommision: 'omission',
    oppurtunity: 'opportunity', opprotunity: 'opportunity', paralel: 'parallel', peice: 'piece',
    perseverence: 'perseverance', persistant: 'persistent', playwrite: 'playwright', posession: 'possession',
    potatos: 'potatoes', preceed: 'precede', prefered: 'preferred', presance: 'presence',
    privelege: 'privilege', priviledge: 'privilege', probly: 'probably', pronounciation: 'pronunciation',
    publically: 'publicly', quarentine: 'quarantine', questionaire: 'questionnaire', realy: 'really',
    recieve: 'receive', recieved: 'received', reciept: 'receipt', reccomend: 'recommend', recomend: 'recommend',
    refered: 'referred', referance: 'reference', relevent: 'relevant', religous: 'religious',
    remeber: 'remember', repitition: 'repetition', resistence: 'resistance', responsability: 'responsibility',
    rythm: 'rhythm', seperate: 'separate', seperately: 'separately', sieze: 'seize', similiar: 'similar',
    sincerly: 'sincerely', speach: 'speech', strenght: 'strength', succesful: 'successful',
    sucessful: 'successful', supercede: 'supersede', suprise: 'surprise', surprize: 'surprise',
    tatoo: 'tattoo', tendancy: 'tendency', thankyou: 'thank you', thier: 'their', threshhold: 'threshold',
    tommorow: 'tomorrow', tommorrow: 'tomorrow', tomorow: 'tomorrow', tounge: 'tongue', truely: 'truly',
    twelth: 'twelfth', tyrany: 'tyranny', untill: 'until', upto: 'up to', vaccum: 'vacuum',
    vegtable: 'vegetable', visable: 'visible', wierd: 'weird', wich: 'which', withold: 'withhold',
    writting: 'writing', writen: 'written', teh: 'the', hte: 'the', taht: 'that', adn: 'and',
    waht: 'what', wiht: 'with', jsut: 'just', knwo: 'know', konw: 'know', woudl: 'would',
    coudl: 'could', shoudl: 'should', thnak: 'thank', thnaks: 'thanks', recieving: 'receiving',
    beleived: 'believed', arguements: 'arguments', goverments: 'governments', enviromental: 'environmental',
    unfortunatly: 'unfortunately', unfortunatley: 'unfortunately', probaly: 'probably', ususally: 'usually',
    usualy: 'usually', exersice: 'exercise', explaination: 'explanation', interpretting: 'interpreting',
  };

  // US spellings for the common list; the British dictionary has its own.
  const COMMON_GB = { adress: 'address', jewelery: 'jewellery', nieghbour: 'neighbour' };
  const COMMON_US = { jewelery: 'jewelry', nieghbor: 'neighbor', lisence: 'license', humourous: 'humorous' };

  // Prefixes that make new words from known ones, for words the dictionary doesn't list.
  const PREFIXES = ['non', 're', 'un', 'mis', 'pre', 'post', 'anti', 'bi', 'tri', 'multi', 'semi', 'pseudo', 'neuro', 'micro', 'macro', 'inter', 'intra', 'trans', 'sub', 'super', 'hyper', 'hypo', 'over', 'under', 'counter', 'co', 'de', 'dis', 'extra', 'meta', 'mono', 'poly', 'proto', 'quasi', 'ultra', 'auto', 'bio', 'geo', 'electro', 'photo', 'thermo', 'hydro', 'socio', 'psycho', 'cyber', 'eco', 'mega', 'tele', 'self'];

  const ALPHA = 'abcdefghijklmnopqrstuvwxyz';
  const VOWELS = new Set('aeiouy');
  const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const NEAR = new Map();
  for (let r = 0; r < ROWS.length; r++) {
    for (let c = 0; c < ROWS[r].length; c++) {
      const set = new Set();
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const ch = ROWS[r + dr]?.[c + dc];
          if (ch && (dr || dc)) set.add(ch);
        }
      }
      NEAR.set(ROWS[r][c], set);
    }
  }
  const adjacent = (a, b) => NEAR.get(a)?.has(b) ?? false;

  const isLower = (w) => w === w.toLowerCase();
  const isCapitalized = (w) => /^\p{Lu}[\p{Ll}\p{M}'’]*$/u.test(w);
  const isAllCaps = (w) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
  const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const straight = (w) => w.replace(/’/g, "'");

  class Speller {
    constructor() {
      this.exact = new Map(); // word as listed -> tier
      this.lower = new Map(); // lowercase-listed words -> tier
      this.proper = new Map(); // lowercase of a capitalised word -> { form, tier }
      this.personal = new Set(); // lowercase
      this.common = { ...COMMON, ...COMMON_US };
      this.cache = new Map();
      this.size = 0;
    }

    // Loads a dictionary file. `append` adds to what's loaded (for data/extra-words.txt).
    load(text, dialect = 'en-US', { append = false } = {}) {
      if (!append) {
        this.exact.clear();
        this.lower.clear();
        this.proper.clear();
        this.dialect = dialect;
        this.common = { ...COMMON, ...(dialect === 'en-GB' ? COMMON_GB : COMMON_US) };
      }
      this.cache.clear();
      let tier = 60;
      for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line[0] === '#') continue;
        if (line[0] === '~') {
          tier = Number(line.slice(1)) || 60;
          continue;
        }
        if (!this.exact.has(line)) this.exact.set(line, tier);
        if (isLower(line)) {
          if (!this.lower.has(line)) this.lower.set(line, tier);
        } else {
          const key = line.toLowerCase();
          const prev = this.proper.get(key);
          if (!prev || prev.tier > tier) this.proper.set(key, { form: line, tier });
        }
      }
      this.size = this.exact.size;
      return this.size;
    }

    // Words only the other dialect accepts ("labour" for an American speller), so the card can
    // say it's a British or American spelling rather than a typo.
    loadVariants(text) {
      this.variants = new Set(text.split('\n').filter(Boolean).map((w) => w.toLowerCase()));
      this.cache.clear();
    }

    // The same word in this dialect's spelling: "fibre" → "fiber", "colour" → "color" for
    // American English; the reverse for British.
    dialectFix(lc) {
      const toUS = [[/our(?=s?$|ed$|ing$|able$|ite$|ful$|less$|ers?$)/, 'or'], [/red$/, 'ered'], [/re(?=s?$)/, 'er'], [/is(?=e[sd]?$|ing$|ation$|ations$|er$|ers$)/, 'iz'], [/ys(?=e[sd]?$|ing$)/, 'yz'],
        [/(?<=[aeiou][lp])l(?=ed$|ing$|er$|ers$)/, ''], [/ogue$/, 'og'], [/ence$/, 'ense'], [/ences$/, 'enses'], [/mme(?=s?$)/, 'm'], [/ae/, 'e'], [/oe/, 'e'], [/^aluminium$/, 'aluminum'], [/^storey/, 'story'], [/^sceptic/, 'skeptic'], [/^grey/, 'gray'], [/^cheque/, 'check'], [/^tyre/, 'tire'], [/^plough/, 'plow'], [/^instil$/, 'instill'], [/^manoeuvr/, 'maneuver']];
      const toGB = [[/or(?=s?$|ed$|ing$|able$|ite$|ful$|less$|ers?$)/, 'our'], [/er(?=s?$|ed$)/, 're'], [/iz(?=e[sd]?$|ing$|ation$|ations$|er$|ers$)/, 'is'], [/yz(?=e[sd]?$|ing$)/, 'ys'],
        [/(?<=[aeiou])l(?=ed$|ing$|er$|ers$)/, 'll'], [/og$/, 'ogue'], [/ense$/, 'ence'], [/enses$/, 'ences'], [/^aluminum$/, 'aluminium'], [/^gray/, 'grey'], [/^skeptic/, 'sceptic'], [/^tire/, 'tyre'], [/^check$/, 'cheque'], [/^plow/, 'plough'], [/^maneuver/, 'manoeuvr']];
      const out = [];
      for (const [re, to] of this.dialect === 'en-GB' ? toGB : toUS) {
        const cand = lc.replace(re, to);
        if (cand !== lc && this.lower.has(cand) && !out.includes(cand)) out.push(cand);
      }
      return out;
    }

    // "attaches", "feedbacks": a known word with the plural or third-person ending SCOWL omits.
    inflected(lc) {
      if (/(?:s|x|z|ch|sh)es$/.test(lc) && this.lower.has(lc.slice(0, -2))) return true;
      if (/[^s]s$/.test(lc)) {
        const base = lc.slice(0, -1);
        if (!/(?:s|x|z|ch|sh)$/.test(base) && this.lower.has(base)) return true;
      }
      return false;
    }

    setPersonal(words) {
      this.personal = new Set((words || []).map((w) => straight(String(w)).toLowerCase()));
      this.cache.clear();
    }

    // Whether this exact form is spelled right, ignoring capitalisation at a sentence start.
    known(word) {
      const w = straight(word);
      if (this.exact.has(w)) return true;
      const lc = w.toLowerCase();
      if (this.personal.has(lc)) return true;
      if (isCapitalized(w) && this.lower.has(lc)) return true;
      if (isAllCaps(w)) return this.exact.has(w) || this.lower.has(lc) || this.proper.has(lc);
      if (/^\p{Lu}/u.test(w) && this.proper.has(lc)) return true;
      // "naïve", "coöperate": accents on a word the dictionary has without them.
      const plain = w.normalize('NFD').replace(/\p{M}/gu, '');
      if (plain !== w) return this.known(plain);
      return false;
    }

    // "nonlocal", "reimagining", "misattributed": a common prefix on a known word.
    prefixed(lc) {
      for (const p of PREFIXES) {
        if (lc.length - p.length < 4 || !lc.startsWith(p)) continue;
        const rest = lc.slice(p.length);
        const t = this.lower.get(rest);
        if (t !== undefined && t <= 60) return true;
      }
      return false;
    }

    // Whether `b` is `a` with two neighbouring letters swapped ("Teh" → "The").
    static swapped(a, b) {
      if (a.length !== b.length) return false;
      const diff = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
      return diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]];
    }

    /*
     * Checks one word. Returns null when it's fine, or { type, suggestions } where type is
     * "spelling" or "capitalization". `ctx.sentenceStart` says the word starts a sentence;
     * `ctx.repeats` is how many times this exact form appears in the text.
     */
    check(word, ctx = {}) {
      let w = straight(word);
      if (w.length < 2 || /\d/.test(w)) return null;
      // "Maya's", "students'" (the tokenizer drops a trailing apostrophe).
      const possessive = /^(.+)'[sS]$/.exec(w);
      if (possessive && this.known(possessive[1])) return null;
      if (this.known(w)) return null;
      if (possessive) w = possessive[1];
      const lc = w.toLowerCase();
      if (this.personal.has(lc)) return null;
      if (isAllCaps(w)) return null; // acronyms and shouting
      if (/\p{Ll}\p{Lu}/u.test(w)) return null; // iPhone, McKinsey, JavaScript-style names

      const fixed = this.common[lc];
      if (this.variants?.has(lc) && (isLower(w) || ctx.sentenceStart)) {
        const cap = (s) => (/^\p{Lu}/u.test(w) ? capitalize(s) : s);
        const list = [...this.dialectFix(lc).map(cap), ...this.suggest(w, 3)];
        return { type: 'dialect', suggestions: [...new Set(list)].slice(0, 3) };
      }
      if (!fixed && this.inflected(lc)) return null;
      if (isLower(w)) {
        // Lowercase names: "february" → "February". Only common ones, and not abbreviations
        // ("nm" isn't "NM").
        const p = this.proper.get(lc);
        if (p && !fixed && !this.lower.has(lc)) {
          if (p.tier <= 35 && w.length >= 3 && !isAllCaps(p.form)) return { type: 'capitalization', suggestions: [p.form] };
          return null; // "utopian", "portland cement": a less common name, used as an ordinary word
        }
        if (!fixed && this.prefixed(lc)) return null;
        const suggestions = this.suggest(w);
        // A long word with nothing close to it is more likely a technical term than a typo.
        if (!suggestions.length && w.length >= 10) return null;
        return { type: 'spelling', suggestions };
      }

      // A capitalised word we don't know is usually a name. Flag it only when it looks like a
      // typo: a known misspelling, two letters swapped at the start of a sentence ("Teh"), or one
      // letter off a common name in mid-sentence ("Febuary"). Never if it repeats in the text.
      if ((ctx.repeats || 1) > 1) return null;
      if (fixed) return { type: 'spelling', suggestions: this.suggest(w) };
      const suggestions = this.suggest(w, 4, { strict: true });
      if (!suggestions.length) return null;
      const best = suggestions[0];
      const bl = best.toLowerCase();
      if (bl[0] !== lc[0]) return null; // "Gmail" isn't a typo of "Mail": brands add a letter in front
      if (ctx.sentenceStart) {
        if (!Speller.swapped(lc, bl) || (this.lower.get(bl) ?? 99) > 50) return null;
      } else {
        const p = this.proper.get(bl);
        if (!p || this.lower.has(bl) || p.tier > 35 || editDistance(lc, bl) > 1) return null;
      }
      return { type: 'spelling', suggestions };
    }

    tierOf(lc) {
      const t = this.lower.get(lc);
      if (t !== undefined) return t;
      const p = this.proper.get(lc);
      return p ? p.tier + 5 : undefined;
    }

    formOf(lc, original) {
      const p = !this.lower.has(lc) ? this.proper.get(lc) : null;
      if (p) return p.form;
      return /^\p{Lu}/u.test(original) ? capitalize(lc) : lc;
    }

    suggest(word, limit = 4, { strict = false } = {}) {
      const original = straight(word);
      const w = original.toLowerCase();
      const key = `${w}|${limit}|${strict ? 1 : 0}`;
      if (this.cache.has(key)) return this.cache.get(key).map((s) => (/^\p{Lu}/u.test(original) ? capitalize(s) : s));
      const found = new Map();
      let near = false; // a word one edit away was found
      const add = (cand, cost) => {
        if (cand === w) return;
        const tier = this.tierOf(cand);
        if (tier === undefined) return;
        if (cost < 2) near = true;
        let score = cost + tier / 12;
        if (cand[0] !== w[0]) score += 0.9; // people rarely mistype the first letter
        const prev = found.get(cand);
        if (prev === undefined || score < prev) found.set(cand, score);
      };

      const fixed = this.common[w];
      if (fixed) found.set(fixed, -10);

      const n = w.length;
      const firstEdits = [];
      for (let i = 0; i <= n; i++) {
        const L = w.slice(0, i);
        const R = w.slice(i);
        if (R) {
          const del = L + R.slice(1);
          firstEdits.push(del);
          add(del, R[0] === L.at(-1) || R[0] === R[1] ? 0.4 : 1); // "untill" → "until"
        }
        if (R.length > 1 && R[0] !== R[1]) {
          const tr = L + R[1] + R[0] + R.slice(2);
          firstEdits.push(tr);
          add(tr, 0.5); // "recieve" → "receive"
        }
        for (const c of ALPHA) {
          if (R && c !== R[0]) {
            const rep = L + c + R.slice(1);
            firstEdits.push(rep);
            let cost = 1;
            if (adjacent(R[0], c)) cost -= 0.35;
            if (VOWELS.has(R[0]) && VOWELS.has(c)) cost -= 0.3; // "definately" → "definitely"
            add(rep, cost);
          }
          const ins = L + c + R;
          firstEdits.push(ins);
          add(ins, c === L.at(-1) || c === R[0] ? 0.45 : 1); // "ocurred" → "occurred"
        }
      }

      // Two edits away, only if one edit found little. Bounded: about 500 first edits, each
      // with its own edits, so long words skip this step.
      if (!strict && found.size < 3 && n >= 4 && n <= 13) {
        for (const e of firstEdits) {
          const m = e.length;
          for (let i = 0; i <= m; i++) {
            const L = e.slice(0, i);
            const R = e.slice(i);
            if (R) add(L + R.slice(1), 2.2);
            if (R.length > 1) add(L + R[1] + R[0] + R.slice(2), 2);
            for (const c of ALPHA) {
              if (R && c !== R[0]) add(L + c + R.slice(1), 2.4);
              add(L + c + R, 2.3);
            }
          }
        }
      }

      // Two words run together: "inorder" → "in order". Only when no word is one edit away, so
      // "centred" gets "centered", not "cent red".
      if (!strict && n >= 5 && !near) {
        for (let i = 1; i < n - 1; i++) {
          const a = w.slice(0, i);
          const b = w.slice(i);
          const ta = this.lower.get(a);
          const tb = this.lower.get(b);
          if (ta !== undefined && tb !== undefined && ta <= 35 && tb <= 35 && (a.length > 1 || a === 'a' || a === 'i')) {
            const cand = `${a} ${b}`;
            const score = 1.2 + (ta + tb) / 40;
            if (!found.has(cand) || found.get(cand) > score) found.set(cand, score);
          }
        }
      }

      const ranked = [...found.entries()].sort((x, y) => x[1] - y[1]).slice(0, limit).map(([cand]) => {
        if (cand.includes(' ')) return cand;
        return this.formOf(cand, 'a');
      });
      this.cache.set(key, ranked);
      if (this.cache.size > 4000) this.cache.delete(this.cache.keys().next().value);
      return ranked.map((s) => (/^\p{Lu}/u.test(original) && /^\p{Ll}/u.test(s) ? capitalize(s) : s));
    }
  }

  // Levenshtein distance with transpositions (optimal string alignment), for short words.
  function editDistance(a, b) {
    const m = a.length;
    const n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[m][n];
  }

  SE.Speller = Speller;
  SE.editDistance = editDistance;
})();
