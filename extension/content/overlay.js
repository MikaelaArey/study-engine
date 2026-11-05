/*
 * Study Engine (content script): drawing underlines.
 *
 * MirrorOverlay (textarea, input): an invisible copy of the field's text, laid exactly over it
 * in Study Engine's own layer, with the underlined words marked. It never touches the page's
 * DOM and lets every click through.
 *
 * HighlightOverlay (contenteditable): the CSS Custom Highlight API, which styles ranges of the
 * page's own text without changing its DOM, so editors like Gmail and Notion don't notice.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  const C = (SE.content ||= {});
  if (C.MirrorOverlay) return;

  const MIRROR_STYLES = [
    'direction', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-feature-settings',
    'font-variation-settings', 'font-kerning', 'font-optical-sizing', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform',
    'text-indent', 'text-align', 'tab-size', 'word-break', 'overflow-wrap', 'hyphens', 'text-rendering', 'white-space',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  ];

  // The part of an element that's actually on screen: inside the window and every scrolling
  // ancestor. Returns null when none of it is.
  function visibleRect(el, inner) {
    const r = inner || el.getBoundingClientRect();
    let top = Math.max(r.top, 0);
    let left = Math.max(r.left, 0);
    let bottom = Math.min(r.bottom, window.innerHeight);
    let right = Math.min(r.right, window.innerWidth);
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      top = Math.max(top, ar.top + a.clientTop);
      left = Math.max(left, ar.left + a.clientLeft);
      bottom = Math.min(bottom, ar.top + a.clientTop + a.clientHeight);
      right = Math.min(right, ar.left + a.clientLeft + a.clientWidth);
      if (cs.position === 'fixed') break;
    }
    if (bottom - top < 2 || right - left < 2) return null;
    return { top, left, bottom, right, width: right - left, height: bottom - top };
  }

  const within = (r, x, y, pad = 0) => x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;

  // ---------------------------------------------------------------------------
  // Mirror, for <textarea> and <input>
  // ---------------------------------------------------------------------------

  class MirrorOverlay {
    constructor(field, layer) {
      this.field = field;
      this.isInput = field.tagName === 'INPUT';
      this.box = document.createElement('div');
      this.box.className = 'mirror-box';
      this.mirror = document.createElement('div');
      this.mirror.className = 'mirror';
      this.box.append(this.mirror);
      layer.append(this.box);
      this.marks = new Map(); // issue id -> [span]
      this.rectCache = null;
      this.styleKey = '';
      this.onScroll = () => this.sync();
      field.addEventListener('scroll', this.onScroll, { passive: true });
    }

    copyStyles() {
      const cs = getComputedStyle(this.field);
      const key = MIRROR_STYLES.map((p) => cs.getPropertyValue(p)).join('|') + this.field.clientWidth + 'x' + this.field.clientHeight;
      if (key === this.styleKey) return;
      this.styleKey = key;
      const m = this.mirror.style;
      for (const p of MIRROR_STYLES) m.setProperty(p, cs.getPropertyValue(p), 'important');
      m.setProperty('width', `${this.isInput ? Math.max(this.field.scrollWidth, this.field.clientWidth) : this.field.clientWidth}px`, 'important');
      if (this.isInput) {
        const inner = this.field.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        m.setProperty('white-space', 'pre', 'important');
        m.setProperty('line-height', `${Math.max(inner, 1)}px`, 'important');
        m.setProperty('height', `${this.field.clientHeight}px`, 'important');
      } else {
        if (!/pre/.test(cs.whiteSpace)) m.setProperty('white-space', 'pre-wrap', 'important');
        if (cs.overflowWrap === 'normal' && cs.wordBreak === 'normal') m.setProperty('overflow-wrap', 'break-word', 'important');
      }
    }

    /*
     * Draws `issues` ([{id, start, end, category, whole}]) over `text`. Issues must not overlap,
     * except "whole" issues (a whole sentence), which can contain others.
     */
    render(text, issues, focusId) {
      this.copyStyles();
      const frag = document.createDocumentFragment();
      const marks = new Map();
      const wholes = issues.filter((i) => i.whole).sort((a, b) => a.start - b.start);
      const parts = issues.filter((i) => !i.whole).sort((a, b) => a.start - b.start);
      const mark = (parent, i, from, to) => {
        const span = document.createElement('span');
        span.className = `u u-${i.category}${i.id === focusId ? ' focus' : ''}`;
        span.textContent = text.slice(from, to);
        parent.append(span);
        if (!marks.has(i.id)) marks.set(i.id, []);
        marks.get(i.id).push(span);
      };
      const runs = (parent, from, to) => {
        let at = from;
        for (const i of parts) {
          if (i.end <= at || i.start >= to) continue;
          const s = Math.max(i.start, at);
          const e = Math.min(i.end, to);
          if (s > at) parent.append(text.slice(at, s));
          mark(parent, i, s, e);
          at = e;
        }
        if (at < to) parent.append(text.slice(at, to));
      };
      let at = 0;
      for (const w of wholes) {
        if (w.start < at) continue;
        runs(frag, at, w.start);
        const span = document.createElement('span');
        span.className = `w${w.id === focusId ? ' focus' : ''}`;
        runs(span, w.start, w.end);
        frag.append(span);
        marks.set(w.id, [span]);
        at = w.end;
      }
      runs(frag, at, text.length);
      if (!text || text.endsWith('\n')) frag.append('\u200b');
      this.mirror.replaceChildren(frag);
      this.marks = marks;
      this.sync();
    }

    // Puts the mirror over the field and matches its scroll position.
    sync() {
      this.rectCache = null;
      const f = this.field;
      if (!f.isConnected) {
        this.box.hidden = true;
        return false;
      }
      const r = f.getBoundingClientRect();
      const inner = { left: r.left + f.clientLeft, top: r.top + f.clientTop, width: f.clientWidth, height: f.clientHeight };
      const vis = visibleRect(f, { ...inner, right: inner.left + inner.width, bottom: inner.top + inner.height });
      if (!vis || getComputedStyle(f).visibility === 'hidden') {
        this.box.hidden = true;
        return false;
      }
      this.box.hidden = false;
      const b = this.box.style;
      b.left = `${inner.left}px`;
      b.top = `${inner.top}px`;
      b.width = `${inner.width}px`;
      b.height = `${inner.height}px`;
      b.clipPath = `inset(${vis.top - inner.top}px ${inner.left + inner.width - vis.right}px ${inner.top + inner.height - vis.bottom}px ${vis.left - inner.left}px)`;
      this.mirror.style.transform = `translate(${-f.scrollLeft}px, ${-f.scrollTop}px)`;
      return true;
    }

    rects(id) {
      return (this.marks.get(id) || []).flatMap((s) => [...s.getClientRects()]);
    }

    // The issue under a point, as [id, rect], or null.
    hit(x, y, ids) {
      if (this.box.hidden) return null;
      const box = this.box.getBoundingClientRect();
      if (!within(box, x, y)) return null;
      for (const id of ids) {
        for (const r of this.rects(id)) if (within(r, x, y, 1)) return [id, r];
      }
      return null;
    }

    destroy() {
      this.field.removeEventListener('scroll', this.onScroll);
      this.box.remove();
    }
  }

  // ---------------------------------------------------------------------------
  // Highlights, for contenteditable
  // ---------------------------------------------------------------------------

  const CATEGORIES = ['correctness', 'clarity', 'engagement', 'tone', 'facts', 'study', 'whole', 'focus'];
  const HIGHLIGHT_CSS = `
    ::highlight(se-correctness) { text-decoration: underline 2px #e3434a; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-clarity) { text-decoration: underline 2px #2a6ef0; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-engagement) { text-decoration: underline 2px #0f9e63; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-tone) { text-decoration: underline 2px #7a4ff2; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-facts) { text-decoration: underline dashed 2px #e8590c; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-study) { text-decoration: underline dotted 3px #2a6ef0; text-underline-offset: 3px; text-decoration-skip-ink: none; }
    ::highlight(se-whole) { text-decoration: underline dotted 1px rgba(42, 110, 240, 0.55); text-underline-offset: 4px; }
    ::highlight(se-focus) { background-color: rgba(21, 181, 133, 0.18); }
  `;

  const registry = new Set(); // HighlightOverlays with ranges
  let styleEl = null;
  let syncQueued = false;

  // The highlight styles go on the page as a constructed stylesheet, which a page's
  // Content-Security-Policy doesn't block. If the page replaces its stylesheet list, they're
  // added back on the next draw.
  let sheet = null;
  function ensureStyle() {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(HIGHLIGHT_CSS);
      }
      if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch {}
    if (styleEl?.isConnected) return;
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-study-engine', '');
    styleEl.textContent = HIGHLIGHT_CSS;
    (document.head || document.documentElement).append(styleEl);
  }

  // Rebuilds the page's highlights from every editor's ranges.
  function syncHighlights() {
    syncQueued = false;
    if (!globalThis.CSS?.highlights) return;
    const byCat = new Map(CATEGORIES.map((c) => [c, []]));
    for (const o of registry) {
      for (const { range, cat } of o.ranges.values()) byCat.get(cat)?.push(range);
      if (o.focusRange) byCat.get('focus').push(o.focusRange);
    }
    let any = false;
    for (const [cat, ranges] of byCat) {
      const name = `se-${cat}`;
      if (ranges.length) {
        any = true;
        CSS.highlights.set(name, new Highlight(...ranges));
      } else CSS.highlights.delete(name);
    }
    if (any) ensureStyle();
  }
  const queueSync = () => {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(syncHighlights);
  };

  class HighlightOverlay {
    constructor(model) {
      this.model = model;
      this.field = model.el;
      this.ranges = new Map(); // id -> { range, cat }
      this.focusRange = null;
      this.rectCache = new Map();
      registry.add(this);
    }

    render(text, issues, focusId) {
      this.ranges = new Map();
      this.focusRange = null;
      this.rectCache = new Map();
      for (const i of issues) {
        const range = this.model.range(i.start, i.end);
        if (!range) continue;
        this.ranges.set(i.id, { range, cat: i.whole ? 'whole' : i.category });
        if (i.id === focusId) this.focusRange = range;
      }
      queueSync();
    }

    sync() {
      this.rectCache = new Map();
      return this.field.isConnected;
    }

    rects(id) {
      if (!this.rectCache.has(id)) {
        const r = this.ranges.get(id)?.range;
        this.rectCache.set(id, r ? [...r.getClientRects()].filter((x) => x.width > 0 || x.height > 0) : []);
      }
      return this.rectCache.get(id);
    }

    hit(x, y, ids) {
      for (const id of ids) {
        for (const r of this.rects(id)) if (within(r, x, y, 1)) return [id, r];
      }
      return null;
    }

    destroy() {
      registry.delete(this);
      this.ranges = new Map();
      queueSync();
    }
  }

  Object.assign(C, { MirrorOverlay, HighlightOverlay, visibleRect, within, syncHighlights });
})();
