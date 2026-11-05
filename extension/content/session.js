/*
 * Study Engine (content script): one text field's checks and suggestions.
 *
 * A Session is created when you first focus a field. On every change it runs the local rules
 * and asks the service worker about unfamiliar words (instant, no network). When you pause,
 * it sends changed paragraphs for an AI writing check; once a paragraph has settled and has
 * checkable claims, it asks for a fact check; in study mode it asks for questions too.
 * Results are drawn as underlines and listed in the assistant panel.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  const C = (SE.content ||= {});
  if (C.Session) return;
  const T = SE.text;
  const UI = C.ui;

  // Messages to the service worker. Never throws: failures come back as { ok: false, error }.
  function send(type, data = {}) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...data }, (r) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: { code: 'disconnected', message: chrome.runtime.lastError.message } });
          else resolve(r || { ok: false, error: { code: 'no_response', message: 'No response from Study Engine.' } });
        });
      } catch (e) {
        resolve({ ok: false, error: { code: 'orphaned', message: String(e?.message || e) } });
      }
    });
  }

  const PRIORITY = { correctness: 0, facts: 1, study: 2, clarity: 3, tone: 4, engagement: 5 };
  const SOURCE_RANK = { spelling: 0, rules: 1, ai: 2, facts: 0, study: 3 };
  const WEIGHT = { correctness: 3, facts: 3, clarity: 1.5, tone: 1, engagement: 1, study: 0 };
  // Errors that won't fix themselves: stop asking until settings change.
  const PERMANENT = new Set(['not_configured', 'auth_failed', 'no_credit', 'forbidden', 'model_not_found', 'ai_off', 'orphaned']);
  // Hyphenated prefixes that aren't words on their own: "co-worker", "re-enter".
  const PREFIXES = new Set(['co', 're', 'pre', 'non', 'anti', 'ex', 'self', 'semi', 'multi', 'post', 'mid', 'sub', 'pro', 'inter', 'ultra', 'mini', 'micro', 'macro', 'neo', 'pseudo', 'quasi', 'cross', 'counter', 'bi', 'tri', 'de', 'un', 'e', 'x', 'mis', 'dis', 'vice', 'meta', 'hyper', 'mega', 'cyber']);

  const SETTLE_MS = { local: 90, ai: 1400, study: 3500, facts: 5500 };
  // Latin-script words only, and not IPA ("ɛfɛl"), which Unicode also counts as Latin.
  const LATIN = /^(?:(?![\u0250-\u02af\u1d00-\u1dbf])[\p{Script=Latin}\p{M}'’])+$/u;

  // The issue for a word the spell checker flagged: a typo, a name in lowercase, or a spelling
  // from the other dialect ("labour" in American English).
  function spellingIssue(r, word, dialect) {
    const cap = r.type === 'capitalization';
    const dia = r.type === 'dialect';
    const gb = dialect === 'en-GB';
    return {
      rule: 'spelling', category: 'correctness', source: 'spelling', original: word, replacements: r.suggestions.slice(0, 3),
      title: cap ? 'Capitalize the name' : dia ? (gb ? 'Use British spelling' : 'Use American spelling') : 'Correct your spelling',
      message: cap ? 'This is a name, so it starts with a capital letter.' : dia ? `“${word}” is the ${gb ? 'American' : 'British'} spelling. You can switch to ${gb ? 'American' : 'British'} English in settings.` : r.suggestions.length ? '' : 'This word isn’t in Study Engine’s dictionary.',
      word: cap || dia ? null : word,
    };
  }
  const MIN_WORDS_FOR_FACTS = 30;

  // Paragraphs: runs of lines between blank lines, split further if they're very long.
  function blocksOf(text) {
    const blocks = [];
    const push = (s, e) => {
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e <= s) return;
      if (e - s <= 1600) {
        blocks.push({ start: s, end: e });
        return;
      }
      let bs = s;
      let last = s;
      for (const sn of T.sentences(text.slice(s, e))) {
        const se = s + sn.end;
        if (se - bs > 1200 && last > bs) {
          blocks.push({ start: bs, end: last });
          bs = last;
        }
        last = se;
      }
      blocks.push({ start: bs, end: e });
    };
    const sep = /\n[ \t\u00a0]*\n/g;
    let start = 0;
    for (const m of text.matchAll(sep)) {
      push(start, m.index);
      start = m.index + m[0].length;
    }
    push(start, text.length);
    return blocks.map((b, index) => {
      const t = text.slice(b.start, b.end);
      return { ...b, index, text: t, hash: T.hash(t), words: T.wordCount(t) };
    });
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  class Session {
    constructor(field, site) {
      this.field = field;
      this.site = site;
      this.model = C.modelFor(field);
      this.overlay = this.model.kind === 'editable' ? new C.HighlightOverlay(this.model) : new C.MirrorOverlay(field, UI.ensure().mirrors);
      this.text = null;
      this.blocks = [];
      this.ruleCache = new Map(); // `${hash}|${config}` -> relative rule issues
      this.spell = new Map(); // `${word}|${start?}|${repeat?}` -> result | null | 'pending'
      this.ai = new Map(); // `${hash}|${goal}|${mode}` -> { status, issues, tone, error }
      this.aiByIndex = new Map(); // block index -> last finished AI result, kept while a block is rechecked
      this.facts = new Map(); // chunk hash -> { status, claims: [abs hint], searched, error }
      this.study = new Map(); // block hash -> { status, questions }
      this.studyState = new Map(); // issue key -> card state (answers, attempts)
      this.dismissed = new Set();
      this.issues = [];
      this.focusId = null;
      this.timers = {};
      this.aiError = null; // { code, message }
      this.factsError = null;
      this.safety = false;
      this.inflight = 0;
      this.factsBusy = 0;
      this.manualFacts = false;
      this.lastInput = 0;
      this.dead = false;
      this.lastRect = '';
      this.ro = new ResizeObserver(() => this.reposition());
      this.ro.observe(field);
      if (this.model.kind === 'editable') {
        // Editors change their DOM themselves too (undo, sending a message, pasting).
        this.mo = new MutationObserver(() => this.changed('mutation'));
        this.mo.observe(field, { subtree: true, childList: true, characterData: true });
      }
      this.changed('init');
    }

    // ---------------------------------------------------------------------------
    // Settings for this field's site
    // ---------------------------------------------------------------------------

    get settings() {
      return C.state.settings;
    }

    get goal() {
      return SE.settings.goalFor(this.settings, this.site);
    }

    get studyMode() {
      return SE.settings.studyOn(this.settings, this.site);
    }

    aiInfo() {
      const st = C.state.aiStatus || {};
      if (!st.keyAdded) return { state: 'off', reason: 'AI checks are off: add an Anthropic API key in settings for grammar in context, tone and fact checks.' };
      if (this.settings.ai.enabled === false || !st.ready) return { state: 'off', reason: 'AI checks are turned off in settings.' };
      if (this.aiError && PERMANENT.has(this.aiError.code)) return { state: 'off', reason: this.aiError.message };
      return { state: 'on', busy: this.inflight > 0, error: this.aiError?.message || '' };
    }

    aiUsable() {
      return this.aiInfo().state === 'on';
    }

    alive() {
      return !this.dead && this.field.isConnected;
    }

    // ---------------------------------------------------------------------------
    // Scheduling
    // ---------------------------------------------------------------------------

    later(name, ms, fn) {
      clearTimeout(this.timers[name]);
      this.timers[name] = setTimeout(() => {
        if (this.alive()) fn();
      }, ms);
    }

    // Call after the field's text may have changed.
    changed(reason) {
      if (!this.alive()) return;
      if (this.applying) return;
      const text = this.model.text();
      if (text === this.text && reason !== 'settings') {
        this.reposition();
        return;
      }
      if (reason === 'input' || reason === 'mutation') this.lastInput = Date.now();
      this.text = text;
      this.blocks = blocksOf(text);
      if (reason === 'settings') this.ruleCache.clear();
      if (text.length < 20000 || reason === 'init' || reason === 'settings') this.runLocal();
      else this.later('local', SETTLE_MS.local, () => this.runLocal());
      if (this.aiUsable() && this.settings.ai.autoCheck !== false) {
        this.later('ai', SETTLE_MS.ai, () => this.runAi());
        if (this.studyMode) this.later('study', SETTLE_MS.study, () => this.runStudy());
        if (this.settings.ai.facts === 'auto') this.later('facts', SETTLE_MS.facts, () => this.runFacts(false));
      }
    }

    // ---------------------------------------------------------------------------
    // Local checks: rules and spelling
    // ---------------------------------------------------------------------------

    rulesConfig() {
      const s = this.settings;
      return { goal: this.goal, disabled: s.disabledRules || [] };
    }

    runLocal() {
      const cfg = this.rulesConfig();
      const key = `${cfg.goal}|${cfg.disabled.join(',')}`;
      const want = [];
      const counts = new Map();
      for (const w of T.words(this.text)) counts.set(w.w, (counts.get(w.w) || 0) + 1);
      for (const b of this.blocks) {
        const ck = `${b.hash}|${key}`;
        if (!this.ruleCache.has(ck)) this.ruleCache.set(ck, SE.rules.check(b.text, cfg));
        for (const tok of this.spellTokens(b, counts)) {
          if (!this.spell.has(tok.key)) {
            this.spell.set(tok.key, 'pending');
            want.push(tok);
          }
        }
      }
      if (this.ruleCache.size > 400) this.ruleCache = new Map([...this.ruleCache].slice(-200));
      this.render();
      if (want.length) this.askSpelling(want);
    }

    // Words to spell-check in a block, with whether each starts a sentence.
    spellTokens(b, counts) {
      if (b.spell) return b.spell;
      const masks = T.maskRanges(b.text);
      const sents = T.sentences(b.text);
      const starts = new Set(sents.map((s) => s.start + (/^[("“'‘]/.test(s.text) ? 1 : 0)));
      // Sentences in another language (a German title in a citation) aren't spell-checked.
      for (const s of sents) if (T.isForeign(s.text)) masks.push([s.start, s.end]);
      const out = [];
      for (const w of T.words(b.text)) {
        if (w.w.length < 2 || T.overlapsAny(masks, w.start, w.end)) continue;
        if (!LATIN.test(w.w)) continue; // IPA, Greek, Cyrillic: not English words
        const before = b.text[w.start - 1] || '';
        const after = b.text[w.end] || '';
        if (/\d/.test(before) || /\d/.test(after) || before === '_' || after === '_') continue; // "3rd", "snake_case"
        if (after === '-' && PREFIXES.has(w.w.toLowerCase())) continue;
        if (before === '\\' || before === '/' || after === '/') continue;
        const s = starts.has(w.start);
        const r = (counts.get(w.w) || 1) > 1;
        out.push({ ...w, s, r, key: `${w.w}|${s ? 1 : 0}|${r ? 1 : 0}` });
      }
      b.spell = out;
      return out;
    }

    async askSpelling(tokens) {
      const unique = [];
      const seen = new Set();
      for (const t of tokens) if (!seen.has(t.key)) { seen.add(t.key); unique.push(t); }
      for (let i = 0; i < unique.length; i += 1500) {
        const batch = unique.slice(i, i + 1500);
        const r = await send('se:spell', { words: batch.map((t) => ({ w: t.w, s: t.s, r: t.r ? 2 : 1 })) });
        if (!r.ok) {
          for (const t of batch) this.spell.delete(t.key);
          return;
        }
        batch.forEach((t, n) => this.spell.set(t.key, r.results[n] || null));
      }
      if (this.alive()) this.render();
    }

    forgetWord(word) {
      const lc = String(word).toLowerCase();
      for (const k of [...this.spell.keys()]) if (k.split('|')[0].toLowerCase() === lc) this.spell.delete(k);
    }

    resetSpelling() {
      this.spell.clear();
      for (const b of this.blocks) b.spell = null;
    }

    // ---------------------------------------------------------------------------
    // AI checks
    // ---------------------------------------------------------------------------

    noteError(e) {
      this.aiError = { code: e?.code || 'error', message: e?.message || 'Something went wrong reaching Claude.' };
      if (!PERMANENT.has(this.aiError.code)) {
        // Temporary trouble (rate limits, network): try again a little later.
        this.later('retry', 30000, () => {
          this.aiError = null;
          this.runAi();
        });
      }
    }

    async runAi(force = false) {
      if (!this.aiUsable() || !this.alive()) return;
      const goal = this.goal;
      const mode = this.studyMode ? 'study' : 'write';
      const local = this.localIssues();
      for (const b of this.blocks) {
        if (this.inflight >= 2) break;
        if (b.words < 3 || b.text.length > 6000) continue;
        const key = `${b.hash}|${goal}|${mode}`;
        const prev = this.ai.get(key);
        if (prev && (prev.status !== 'error' || !force)) continue;
        const flagged = local.filter((i) => i.start >= b.start && i.end <= b.end).map((i) => ({ title: i.title, original: i.original }));
        this.ai.set(key, { status: 'pending' });
        this.inflight++;
        this.renderSoon();
        send('se:write-check', { text: b.text, goal, mode, site: this.site, flagged }).then((r) => {
          this.inflight--;
          if (r.ok) {
            const res = { status: 'done', issues: r.issues || [], tone: r.tone || [] };
            this.ai.set(key, res);
            this.aiByIndex.set(b.index, { text: b.text, ...res });
            if (this.aiError && !PERMANENT.has(this.aiError.code)) this.aiError = null;
          } else {
            this.ai.set(key, { status: 'error' });
            this.noteError(r.error);
          }
          if (this.ai.size > 300) this.ai = new Map([...this.ai].slice(-150));
          if (!this.alive()) return;
          this.render();
          if (this.blocks.some((x) => !this.ai.has(`${x.hash}|${goal}|${mode}`) && x.words >= 3)) this.later('ai', 200, () => this.runAi());
        });
      }
    }

    async runStudy() {
      if (!this.aiUsable() || !this.studyMode || !this.alive()) return;
      const caret = this.model.caret();
      const recent = [...this.study.values()].flatMap((s) => (s.questions || []).map((q) => q.question)).slice(-12);
      for (const b of this.blocks) {
        if (b.words < 12 || this.study.has(b.hash)) continue;
        // Wait until the student has moved on from a paragraph, or paused, before questioning it.
        if (caret != null && caret >= b.start && caret <= b.end && Date.now() - this.lastInput < 8000) {
          this.later('study', 8200 - (Date.now() - this.lastInput), () => this.runStudy());
          continue;
        }
        this.study.set(b.hash, { status: 'pending' });
        this.inflight++;
        this.renderSoon();
        const r = await send('se:study', { text: b.text, goal: this.goal, site: this.site, max: 2, recent });
        this.inflight--;
        if (r.ok) {
          if (r.safety === 'support') this.safety = true;
          this.study.set(b.hash, { status: 'done', questions: (r.questions || []).map((q) => ({ ...q, hint: q.hint, at: b.start + q.start })) });
        } else {
          this.study.delete(b.hash);
          this.noteError(r.error);
          break;
        }
        if (!this.alive()) return;
        this.render();
      }
    }

    // Fact checks run on "chunks": a settled paragraph on its own when they run automatically,
    // or the whole text in pieces of up to about 3,500 characters when you ask.
    chunks(manual) {
      const out = [];
      let cur = null;
      for (const b of this.blocks) {
        if (b.words < 6) continue;
        if (!manual) {
          if (!T.hasClaims(b.text)) continue;
          out.push({ start: b.start, end: b.end });
          continue;
        }
        if (cur && b.end - cur.start <= 3500) cur.end = b.end;
        else {
          cur = { start: b.start, end: b.end };
          out.push(cur);
        }
      }
      return out.map((c) => ({ ...c, text: this.text.slice(c.start, c.end), hash: T.hash(this.text.slice(c.start, c.end)) }));
    }

    async runFacts(manual) {
      if (!this.aiUsable() || !this.alive()) return;
      const mode = this.settings.ai.facts;
      if (mode === 'off' || (mode === 'manual' && !manual)) return;
      if (!manual && T.wordCount(this.text) < MIN_WORDS_FOR_FACTS) return;
      if (manual) this.manualFacts = true;
      const caret = this.model.caret();
      let waiting = false;
      const todo = this.chunks(manual).filter((c) => {
        const prev = this.facts.get(c.hash);
        if (prev && prev.status !== 'error') return false;
        // A paragraph you're still writing waits until you move on, or stop for 15 seconds.
        if (!manual && caret != null && caret >= c.start && caret <= c.end && Date.now() - this.lastInput < 15000) {
          waiting = true;
          return false;
        }
        return true;
      });
      if (waiting) this.later('facts', 15200 - (Date.now() - this.lastInput), () => this.runFacts(false));
      if (!todo.length) {
        this.renderSoon();
        return;
      }
      const context = this.text.slice(0, 400);
      await Promise.all(todo.map(async (c) => {
        this.facts.set(c.hash, { status: 'pending' });
        this.factsBusy++;
        this.renderSoon();
        const r = await send('se:fact-check', { text: c.text, context: c.start > 0 ? context : '', site: this.site });
        this.factsBusy--;
        if (r.ok) {
          this.factsError = null;
          this.facts.set(c.hash, { status: 'done', searched: !!r.searched, claims: (r.claims || []).map((x) => ({ ...x, at: c.start + x.start })) });
        } else {
          this.facts.set(c.hash, { status: 'error' });
          this.factsError = r.error?.message || 'The fact check didn’t finish.';
          if (PERMANENT.has(r.error?.code)) this.noteError(r.error);
        }
        if (this.alive()) this.render();
      }));
    }

    checkFacts() {
      if (!this.aiUsable()) {
        UI.toast('Fact checks need AI checks on. Add an API key in settings.');
        return;
      }
      for (const [k, v] of this.facts) if (v.status === 'error') this.facts.delete(k);
      this.runFacts(true);
    }

    // ---------------------------------------------------------------------------
    // Merging everything into one list of issues
    // ---------------------------------------------------------------------------

    keyOf(i) {
      // Stable across edits elsewhere: the rule, the words and the sentence they sit in.
      const t = this.text;
      const s0 = Math.max(t.lastIndexOf('\n', i.start - 1), Math.max(t.lastIndexOf('. ', i.start - 1), t.lastIndexOf('? ', i.start - 1)));
      let s1 = t.slice(i.end).search(/[.!?](?:\s|$)|\n/);
      s1 = s1 < 0 ? t.length : i.end + s1;
      return `${i.rule || i.category}|${i.original.toLowerCase()}|${T.hash(t.slice(s0 + 1, s1))}`;
    }

    localIssues() {
      const out = [];
      const cfg = this.rulesConfig();
      const key = `${cfg.goal}|${cfg.disabled.join(',')}`;
      for (const b of this.blocks) {
        for (const i of this.ruleCache.get(`${b.hash}|${key}`) || []) {
          out.push({ ...i, id: `r:${b.start + i.start}:${i.rule}`, start: b.start + i.start, end: b.start + i.end });
        }
        for (const tok of b.spell || []) {
          const r = this.spell.get(tok.key);
          if (!r || r === 'pending') continue;
          out.push({ ...spellingIssue(r, tok.w, this.settings.dialect), id: `s:${b.start + tok.start}`, start: b.start + tok.start, end: b.start + tok.end });
        }
      }
      return out;
    }

    aiIssues() {
      const out = [];
      const goal = this.goal;
      const mode = this.studyMode ? 'study' : 'write';
      for (const b of this.blocks) {
        let res = this.ai.get(`${b.hash}|${goal}|${mode}`);
        let shifted = false;
        if (!res || res.status !== 'done') {
          // While a changed paragraph is rechecked, keep its earlier suggestions whose words
          // are still there, so underlines don't blink.
          const prev = this.aiByIndex.get(b.index);
          if (!prev) continue;
          res = prev;
          shifted = prev.text !== b.text;
        }
        for (const i of res.issues || []) {
          let start = i.start;
          let end = i.end;
          if (shifted || b.text.slice(start, end) !== i.original) {
            const span = T.findSpan(b.text, i.original, i.start);
            if (!span) continue;
            ({ start, end } = span);
          }
          out.push({ ...i, rule: `ai-${i.category}`, source: 'ai', id: `a:${b.start + start}:${T.hash(i.original + i.title)}`, start: b.start + start, end: b.start + end });
        }
      }
      return out;
    }

    tone() {
      const counts = new Map();
      for (const b of this.blocks) {
        const res = this.aiByIndex.get(b.index);
        for (const t of res?.tone || []) counts.set(t, (counts.get(t) || 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
    }

    factIssues() {
      const out = [];
      for (const f of this.facts.values()) {
        if (f.status !== 'done') continue;
        for (const c of f.claims) {
          const span = T.findSpan(this.text, c.original, c.at);
          if (!span) continue;
          out.push({ ...c, id: `f:${span.start}:${T.hash(c.original)}`, rule: 'facts', category: 'facts', source: 'facts', title: UI.FACT_TITLE[c.verdict] || 'Recheck this fact', start: span.start, end: span.end, replacements: [], searched: f.searched });
        }
      }
      return out;
    }

    studyIssues() {
      if (!this.studyMode) return [];
      const out = [];
      for (const s of this.study.values()) {
        for (const q of s.questions || []) {
          const span = T.findSpan(this.text, q.original, q.at);
          if (!span) continue;
          out.push({ ...q, id: `q:${span.start}:${T.hash(q.question)}`, rule: `study-${q.kind}`, category: 'study', source: 'study', start: span.start, end: span.end, replacements: [], message: '' });
        }
      }
      return out;
    }

    merge() {
      const cats = this.settings.categories || {};
      const all = [...this.localIssues(), ...this.aiIssues(), ...this.factIssues(), ...this.studyIssues()].filter((i) => {
        if (i.category in cats && cats[i.category] === false) return false;
        i.key = this.keyOf(i);
        if (this.dismissed.has(i.key)) return false;
        if (i.category === 'study') {
          i.study = this.studyState.get(i.key) || { answer: '', attempts: 0, hintsUsed: 0, stage: 'nudge' };
          this.studyState.set(i.key, i.study);
          // A word question clears once the student uses the word in that sentence.
          if (i.kind === 'words' && i.word && this.usesWord(i)) {
            this.dismissed.add(i.key);
            UI.toast(`“${i.word}” is in your sentence now.`);
            return false;
          }
        }
        if (i.coach) {
          i.study = this.studyState.get(i.key) || { answer: '', attempts: 0, stage: 'nudge' };
          this.studyState.set(i.key, i.study);
        }
        // Study mode fixes only spelling and grammar directly; the rest the student rewrites.
        if (this.studyMode && i.category !== 'correctness' && i.category !== 'study' && !i.coach && i.replacements.length) i.replacements = [];
        return true;
      });
      const wholes = all.filter((i) => i.whole);
      const parts = all.filter((i) => !i.whole).sort((a, b) => PRIORITY[a.category] - PRIORITY[b.category] || (SOURCE_RANK[a.source] ?? 5) - (SOURCE_RANK[b.source] ?? 5) || (a.end - a.start) - (b.end - b.start));
      const kept = [];
      for (const i of parts) if (!kept.some((k) => i.start < k.end && k.start < i.end)) kept.push(i);
      return [...kept, ...wholes].sort((a, b) => a.start - b.start || (a.whole ? 1 : -1));
    }

    usesWord(i) {
      const t = this.text;
      const s0 = Math.max(0, t.lastIndexOf('\n', i.start) + 1);
      let s1 = t.indexOf('\n', i.end);
      if (s1 < 0) s1 = t.length;
      const stem = i.word.toLowerCase().slice(0, Math.max(4, i.word.length - 2));
      return t.slice(s0, s1).toLowerCase().includes(stem);
    }

    // ---------------------------------------------------------------------------
    // Drawing
    // ---------------------------------------------------------------------------

    renderSoon() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        if (this.alive()) this.render();
      });
    }

    render() {
      if (!this.alive()) return;
      this.issues = this.merge();
      this.overlay.render(this.text, this.issues, this.focusId);
      this.reposition(true);
      const open = UI.cardFor();
      if (open?.S === this) {
        const still = this.issues.find((i) => i.key === open.issue.key);
        if (!still) UI.hideCard();
      }
      if (UI.panelFor() === this) UI.renderPanel();
    }

    setFocus(id, { reveal = false } = {}) {
      if (this.focusId === id && !reveal) return;
      this.focusId = id;
      if (!this.alive()) return;
      this.overlay.render(this.text, this.issues, id);
      if (reveal && id) {
        const i = this.issues.find((x) => x.id === id);
        if (i) this.reveal_(i);
      }
    }

    reveal_(i) {
      if (this.model.kind === 'editable') {
        const r = this.model.range(i.start, i.end);
        const el = r?.startContainer?.parentElement;
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else {
        // Put the caret there without stealing focus from the panel for long.
        const f = this.field;
        const before = f.value.slice(0, i.start);
        const lines = before.split('\n').length - 1;
        const lh = parseFloat(getComputedStyle(f).lineHeight) || 20;
        if (f.scrollHeight > f.clientHeight) f.scrollTop = Math.max(0, lines * lh - f.clientHeight / 2);
        f.scrollIntoView({ block: 'nearest' });
      }
      requestAnimationFrame(() => this.reposition(true));
    }

    visible() {
      const f = this.field;
      const r = f.getBoundingClientRect();
      return C.visibleRect(f, { left: r.left + f.clientLeft, top: r.top + f.clientTop, right: r.left + f.clientLeft + f.clientWidth, bottom: r.top + f.clientTop + f.clientHeight });
    }

    // Moves the mirror, badge and card to follow the field. Cheap when nothing moved.
    reposition(force = false) {
      if (!this.alive()) return;
      const r = this.field.getBoundingClientRect();
      const sig = `${r.left}|${r.top}|${r.width}|${r.height}|${this.field.scrollTop}|${this.field.scrollLeft}|${window.scrollX}|${window.scrollY}`;
      if (!force && sig === this.lastRect) return;
      this.lastRect = sig;
      this.overlay.sync();
      const vis = this.visible();
      const s = this.settings;
      const showBadge = s.showBadge !== false && (this.model.focused() || UI.panelFor() === this || this.hovered);
      const counted = this.issues.filter((i) => !i.whole && i.category !== 'study');
      const worst = counted.reduce((w, i) => (w == null || PRIORITY[i.category] < PRIORITY[w] ? i.category : w), null);
      if (showBadge) UI.placeBadge(this, vis, counted.length + this.issues.filter((i) => i.category === 'study').length, { busy: this.inflight > 0 || this.factsBusy > 0, worst });
      else if (this.badgeEl) this.badgeEl.hidden = true;
      const open = UI.cardFor();
      if (open?.S === this) {
        const rects = this.overlay.rects(open.issue.id);
        if (!rects.length) UI.hideCard();
      }
    }

    // ---------------------------------------------------------------------------
    // What the card and the panel show
    // ---------------------------------------------------------------------------

    summary() {
      const issues = this.issues;
      const stats = T.stats(this.text || '');
      let penalty = 0;
      for (const i of issues) penalty += i.whole ? 1 : WEIGHT[i.category] || 1;
      // Weighted issues per 100 words; short texts count as 80 words so one slip isn't a disaster.
      const per100 = (penalty * 100) / Math.max(stats.words, 80);
      const score = stats.words ? clamp(Math.round(100 - per100 * 3), 10, 100) : 100;
      const ai = this.aiInfo();
      const chunks = ai.state === 'on' ? this.chunks(this.manualFacts || this.settings.ai.facts !== 'auto') : [];
      const checked = chunks.filter((c) => this.facts.get(c.hash)?.status === 'done').length;
      const flagged = issues.filter((i) => i.category === 'facts').length;
      let factsText;
      if (ai.state !== 'on') factsText = 'Fact checks use Claude with a web search. They need AI checks on.';
      else if (this.factsBusy) factsText = 'Checking facts against the web…';
      else if (this.factsError) factsText = this.factsError;
      else if (this.settings.ai.facts === 'off') factsText = 'Automatic fact checks are off. You can still check now.';
      else if (checked) factsText = flagged ? `${flagged} ${flagged === 1 ? 'claim' : 'claims'} to recheck, marked with dashed orange underlines.` : `No problems found in ${checked} ${checked === 1 ? 'passage' : 'passages'} with checkable facts.`;
      else if (this.settings.ai.facts === 'auto') factsText = stats.words < MIN_WORDS_FOR_FACTS ? 'Facts are checked automatically in longer writing, such as papers.' : 'Paragraphs with dates, numbers and names are checked once you move on from them.';
      else factsText = 'Check names, dates, numbers and claims against the web.';
      if (this.safety) factsText = factsText; // unchanged; the safety note shows separately
      return {
        issues, stats, score, tone: this.tone(), ai: { ...ai, error: ai.state === 'on' ? ai.error : '' },
        facts: { busy: this.factsBusy > 0, text: factsText },
        where: `${this.site === 'file://' ? 'Local file' : this.site || 'This page'} · ${SE.rules.goalOf(this.goal).name}${this.studyMode ? ' · Study mode' : ''}`,
        text: this.text,
        safety: this.safety,
      };
    }

    // ---------------------------------------------------------------------------
    // Actions
    // ---------------------------------------------------------------------------

    locate(i) {
      const t = this.model.text();
      if (t.slice(i.start, i.end) === i.original) return { start: i.start, end: i.end };
      return T.findSpan(t, i.original, i.start);
    }

    accept(i, replacement) {
      const at = this.locate(i);
      if (!at) {
        UI.toast('That text has changed, so the suggestion no longer fits.');
        this.changed('input');
        return;
      }
      UI.hideCard();
      const ok = this.model.replace(at.start, at.end, replacement);
      if (!ok) UI.toast('This page didn’t accept the change. Try typing it instead.');
      this.changed('input');
      if (UI.panelFor() === this) UI.renderPanel();
    }

    acceptAll(list) {
      const spots = list.map((i) => ({ i, at: this.locate(i) })).filter((x) => x.at).sort((a, b) => b.at.start - a.at.start);
      this.applying = true;
      let n = 0;
      try {
        for (const { i, at } of spots) if (this.model.replace(at.start, at.end, i.replacements[0])) n++;
      } finally {
        this.applying = false;
      }
      this.changed('input');
      UI.toast(`Fixed ${n} ${n === 1 ? 'mistake' : 'mistakes'}. Ctrl+Z or ⌘Z undoes each one.`);
    }

    dismiss(i) {
      this.dismissed.add(i.key);
      UI.hideCard();
      this.render();
    }

    resolve(i) {
      this.dismiss(i);
    }

    async addWord(i) {
      const r = await send('se:dict-add', { word: i.word });
      if (!r.ok) {
        UI.toast(r.error?.message || 'Couldn’t add that word.');
        return;
      }
      UI.hideCard();
      UI.toast(`Added “${r.word}” to your dictionary.`);
    }

    setGoal(goal) {
      const siteGoals = { ...(this.settings.siteGoals || {}), [this.site]: goal };
      SE.settings.update({ siteGoals });
    }

    setStudy(on) {
      const list = new Set(this.settings.studySites || []);
      if (on) list.add(this.site);
      else list.delete(this.site);
      SE.settings.update({ studySites: [...list] });
      UI.toast(on ? 'Study mode: questions instead of fixes. Spelling and grammar still get direct fixes.' : 'Write mode: suggestions with one-click fixes.');
    }

    disableSite() {
      const list = new Set(this.settings.disabledSites || []);
      list.add(this.site);
      SE.settings.update({ disabledSites: [...list] });
      UI.closePanel();
      UI.toast(`Study Engine is off on ${this.site}. Turn it back on from the toolbar button.`);
    }

    openSettings() {
      send('se:open-options');
    }

    openInEditor() {
      send('se:open-editor', { text: this.model.text(), title: document.title, goal: this.goal, source: this.site });
    }

    refreshCard(i) {
      UI.refreshCard(i);
      if (UI.panelFor() === this) UI.renderPanel();
    }

    async answer(i) {
      const st = i.study;
      if (st.busy) return;
      if (!st.answer.trim()) {
        st.result = { verdict: 'no_attempt', feedback: 'Have a go, even a guess. A wrong try still helps the right answer stick.' };
        this.refreshCard(i);
        return;
      }
      st.busy = true;
      st.attempts += 1;
      this.refreshCard(i);
      const r = await send('se:grade', { question: i.question, keyPoints: i.keyPoints || [], reveal: i.reveal || '', answer: st.answer, attempt: st.attempts });
      st.busy = false;
      st.result = r.ok ? { verdict: r.verdict, feedback: r.feedback, hint: r.hint } : { verdict: 'error', feedback: r.error?.message || 'Couldn’t check that answer.' };
      if (r.ok && r.verdict === 'correct') st.done = true;
      this.refreshCard(i);
    }

    reveal(i) {
      i.study.revealed = true;
      i.study.done = true;
      this.refreshCard(i);
    }

    checkWord(i) {
      const st = i.study;
      const a = st.answer.trim().toLowerCase();
      st.attempts += 1;
      const stem = i.word.toLowerCase().slice(0, Math.max(4, i.word.length - 2));
      if (!a) st.result = { verdict: 'no_attempt', feedback: 'Have a guess first. Show me is there if you need it.' };
      else if (a.startsWith(stem) || stem.startsWith(a.slice(0, Math.max(4, a.length - 2)))) {
        st.stage = 'teach';
        st.result = { verdict: 'correct', feedback: '' };
      } else st.result = { verdict: 'incorrect', feedback: st.attempts > 1 ? 'Not that one. Show me is there if you need it.' : 'Not quite. Try another word.' };
      this.refreshCard(i);
    }

    showWord(i) {
      i.study.stage = 'teach';
      i.study.result = null;
      this.refreshCard(i);
    }

    checkCoach(i) {
      const st = i.study;
      const a = st.answer.trim().toLowerCase();
      if (!a) {
        st.result = { verdict: 'no_attempt', feedback: 'Have a guess first.' };
      } else if (i.replacements.some((r) => r.toLowerCase() === a)) {
        st.result = { verdict: 'correct', feedback: `Yes: “${a}” says it in one word.` };
        st.stage = 'teach';
      } else {
        st.result = { verdict: 'partial', feedback: `“${a}” could work. Here are words writers often use.` };
        st.stage = 'teach';
      }
      this.refreshCard(i);
    }

    // ---------------------------------------------------------------------------
    // Pointer and caret
    // ---------------------------------------------------------------------------

    hit(x, y) {
      const ids = this.issues.filter((i) => !i.whole).map((i) => i.id);
      const h = this.overlay.hit(x, y, ids) || this.overlay.hit(x, y, this.issues.filter((i) => i.whole).map((i) => i.id));
      if (!h) return null;
      return { issue: this.issues.find((i) => i.id === h[0]), rect: h[1] };
    }

    issueAtCaret() {
      const c = this.model.caret();
      if (c == null) return null;
      return this.issues.find((i) => !i.whole && c >= i.start && c <= i.end) || null;
    }

    anchorFor(i) {
      const rects = this.overlay.rects(i.id);
      return rects[0] || null;
    }

    destroy() {
      if (this.dead) return;
      this.dead = true;
      for (const t of Object.values(this.timers)) clearTimeout(t);
      this.ro.disconnect();
      this.mo?.disconnect();
      this.overlay.destroy();
      this.badgeEl?.remove();
      if (UI.cardFor()?.S === this) UI.hideCard();
      if (UI.panelFor() === this) UI.closePanel();
    }
  }

  Object.assign(C, { Session, send, blocksOf, spellingIssue });
})();
