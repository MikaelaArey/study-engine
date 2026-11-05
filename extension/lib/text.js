/*
 * Study Engine: shared text utilities.
 *
 * Loaded as a classic script by the service worker, the content scripts and the editor page.
 * Everything hangs off globalThis.StudyEngine so the files can share code without modules.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  if (SE.text) return;

  const LETTER = /[\p{L}\p{N}]/u;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Abbreviations a full stop doesn't end a sentence after. TITLES never end one; the
  // others do when the next word starts with a capital letter ("...and so on, etc. Then").
  const TITLES = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'mt', 'ft', 'fig', 'figs', 'no', 'nos', 'vol', 'vols', 'pp', 'p', 'ch', 'sec', 'gen', 'col', 'lt', 'capt', 'sgt', 'rev', 'hon', 'pres', 'gov', 'sen', 'rep', 'e.g', 'i.e', 'cf', 'viz', 'approx', 'ca', 'c']);
  const MAYBE_END = new Set(['etc', 'inc', 'ltd', 'co', 'corp', 'al', 'a.m', 'p.m', 'u.s', 'u.k', 'u.s.a', 'b.c', 'a.d', 'b.c.e', 'c.e', 'ph.d', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec', 'dept', 'est', 'misc']);
  const CLOSERS = /["'”’)\]»]/;

  // Sentences with their positions: [{start, end, text}]. A line break always ends one.
  function sentences(text) {
    const out = [];
    const n = text.length;
    let start = 0;
    const push = (from, to) => {
      const raw = text.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const body = raw.trim();
      if (body) out.push({ start: from + lead, end: from + lead + body.length, text: body });
    };
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (ch === '\n') {
        push(start, i);
        start = i + 1;
        continue;
      }
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') continue;
      // The whole run of punctuation and closing quotes or brackets.
      let j = i;
      while (j + 1 < n && /[.!?…]/.test(text[j + 1])) j++;
      while (j + 1 < n && CLOSERS.test(text[j + 1])) j++;
      const next = text[j + 1];
      if (j + 1 < n && !/\s/.test(next)) {
        i = j;
        continue; // "3.5", "example.com", "U.S.A"
      }
      // Find the next word's first letter, to tell "etc. Then" from "etc. and".
      let k = j + 1;
      while (k < n && /[ \t\u00a0"“'‘(]/.test(text[k])) k++;
      const nextChar = text[k] || '';
      const nextUpper = /\p{Lu}|\d/u.test(nextChar) || k >= n || text[k] === '\n';
      const run = text.slice(i, j + 1).replace(/["'”’)\]»]/g, '');
      if (run === '.') {
        const before = /([\p{L}.]+)$/u.exec(text.slice(Math.max(0, i - 12), i));
        const word = before ? before[1].toLowerCase() : '';
        if (word && /^\p{Lu}$/u.test(before[1])) { i = j; continue; } // an initial: "J. K. Rowling"
        if (TITLES.has(word)) { i = j; continue; }
        // "etc.", and dotted abbreviations such as "D.C." or "W.H.", end a sentence only
        // before a capital letter.
        if ((MAYBE_END.has(word) || /^(?:\p{L}\.)+\p{L}$/u.test(word)) && !nextUpper) { i = j; continue; }
      } else if (/^(?:\.{2,}|…)$/.test(run) && !nextUpper) {
        i = j;
        continue; // an ellipsis mid-sentence: "wait... what"
      }
      push(start, j + 1);
      start = j + 1;
      i = j;
    }
    push(start, n);
    return out;
  }

  // Words for spelling: letters with inner apostrophes ("don't", "Maya's"). Hyphens and
  // digits split words, so "well-known" is checked as "well" and "known".
  const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
  function words(text) {
    const out = [];
    for (const m of text.matchAll(WORD)) out.push({ w: m[0], start: m.index, end: m.index + m[0].length });
    return out;
  }
  const wordCount = (t) => (String(t).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

  // Ranges that are never checked: links, emails, @handles, #tags, code and file names.
  const MASKS = [
    /\bhttps?:\/\/[^\s<>"']+/gi,
    /\bwww\.[^\s<>"']+/gi,
    /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g,
    /(?:^|(?<=[\s(]))[@#][\p{L}\p{N}_][\p{L}\p{N}_.-]*/gu,
    /`[^`\n]+`/g,
    /\b[\w-]+\.(?:js|ts|jsx|tsx|py|rb|go|rs|java|c|cpp|h|cs|php|html?|css|scss|json|ya?ml|xml|md|txt|csv|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|svg|zip|sh)\b/gi,
    /\b(?:[A-Za-z]:)?(?:[\\/][\w.-]+){2,}/g,
  ];
  function maskRanges(text) {
    const out = [];
    for (const re of MASKS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length]);
    }
    return out.sort((a, b) => a[0] - b[0]);
  }
  const overlapsAny = (ranges, start, end) => ranges.some(([a, b]) => start < b && a < end);

  // FNV-1a, for cache keys. Not cryptographic.
  function hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
  }

  // Finds `needle` in `text`, nearest to `hint`, as a whole word at its edges. Falls back to a
  // case-insensitive match that tolerates changed spacing and quote marks.
  function findSpan(text, needle, hint = 0) {
    if (!needle) return null;
    let best = null;
    const edgeOk = (start, end) => {
      if (LETTER.test(needle[0]) && start > 0 && LETTER.test(text[start - 1])) return false;
      if (LETTER.test(needle.at(-1)) && end < text.length && LETTER.test(text[end])) return false;
      return true;
    };
    const consider = (start, end) => {
      if (!edgeOk(start, end)) return;
      const d = Math.abs(start - hint);
      if (!best || d < best.d) best = { start, end, d };
    };
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) consider(i, i + needle.length);
    if (!best) {
      const pattern = needle.trim().split(/\s+/).map((w) => escapeRe(w).replace(/['’]/g, "['’]").replace(/["“”]/g, '["“”]')).join('\\s+');
      if (pattern) {
        const r = new RegExp(pattern, 'giu');
        for (let m = r.exec(text); m; m = r.exec(text)) {
          consider(m.index, m.index + m[0].length);
          if (!m[0].length) r.lastIndex++;
        }
      }
    }
    return best;
  }

  // Keeps a replacement's first letter in the same case as the text it replaces.
  function matchCase(original, replacement) {
    if (!replacement || !original || original === 'I') return replacement;
    const first = original.match(/\p{L}/u)?.[0];
    if (!first) return replacement;
    if (first === first.toUpperCase() && first !== first.toLowerCase()) {
      if (original.length > 1 && original === original.toUpperCase() && /\p{L}{2}/u.test(original)) return replacement.toUpperCase();
      return replacement.replace(/\p{L}/u, (c) => c.toUpperCase());
    }
    return replacement;
  }

  // Readability numbers for the assistant panel.
  function syllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  function stats(text) {
    const ws = String(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    const sents = sentences(text).filter((s) => /[\p{L}\p{N}]/u.test(s.text));
    const syl = ws.reduce((n, w) => n + syllables(w), 0);
    const nw = ws.length;
    const ns = Math.max(1, sents.length);
    const ease = nw ? 206.835 - 1.015 * (nw / ns) - 84.6 * (syl / nw) : 0;
    const grade = nw ? 0.39 * (nw / ns) + 11.8 * (syl / nw) - 15.59 : 0;
    const unique = new Set(ws.map((w) => w.toLowerCase())).size;
    return {
      words: nw,
      characters: String(text).length,
      sentences: sents.length,
      readingMinutes: nw / 238,
      avgSentence: nw / ns,
      readingEase: Math.max(0, Math.min(100, Math.round(ease))),
      grade: Math.max(0, Math.round(grade * 10) / 10),
      uniqueWords: unique,
    };
  }

  // Whether a passage has claims worth fact-checking: numbers and dates, names mid-sentence,
  // superlatives and attributions. A quick local filter before any AI call.
  function hasClaims(text) {
    if (wordCount(text) < 6) return false;
    if (/\b\d{3,4}s?\b|\b\d+(?:[.,]\d+)?\s*(?:%|percent|million|billion|thousand|km|miles|kg|pounds|degrees|°)/i.test(text)) return true;
    if (/\b(?:first|largest|biggest|smallest|oldest|tallest|longest|highest|most|least|only|invented|discovered|founded|born|died|won|wrote|said|according to|percent|population|capital of|located in|built in|signed|elected)\b/i.test(text)) return true;
    return /(?<=[a-z,;]\s)\p{Lu}\p{Ll}+(?:\s\p{Lu}\p{Ll}+)*/u.test(text);
  }

  // A sentence in another language, such as a German book title in a citation: two or more
  // common function words of French, German, Spanish or Italian that aren't English words.
  const FOREIGN = new Set(['der', 'das', 'und', 'für', 'über', 'zur', 'zum', 'des', 'dem', 'ein', 'eine', 'einer', 'eines', 'mit', 'aus', 'auf', 'bei', 'nach', 'ist', 'nicht', 'sich', 'wie', 'oder', 'unserer', 'neue', 'neuen', 'les', 'du', 'et', 'dans', 'pour', 'avec', 'une', 'est', 'je', 'aux', 'ces', 'qui', 'que', 'sont', 'mais', 'très', 'été', 'los', 'las', 'del', 'y', 'con', 'por', 'para', 'una', 'es', 'el', 'il', 'della', 'delle', 'degli', 'nel', 'sono', 'che', 'gli', 'di', 'la', 'le']);
  function isForeign(sentence) {
    let n = 0;
    for (const m of String(sentence).toLowerCase().matchAll(/[\p{L}]+/gu)) if (FOREIGN.has(m[0]) && ++n >= 2) return true;
    return false;
  }

  SE.text = { sentences, words, wordCount, maskRanges, overlapsAny, hash, findSpan, matchCase, escapeRe, stats, syllables, hasClaims, isForeign };
})();
