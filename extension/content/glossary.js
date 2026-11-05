/*
 * Study Engine (content script): definitions from your own glossary, as you type.
 *
 * Carried over from Live Definitions: when you finish typing a glossary term (followed by a
 * space, a comma, a full stop, or "is "), a card shows its definition at the caret, and Tab
 * or Insert puts the definition in your text. The glossary is managed on the options page.
 *
 * It reads only the few dozen characters before the caret, in memory, and makes no requests.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  const C = (SE.content ||= {});
  if (C.glossary) return;
  const UI = C.ui;

  const AUTO_HIDE_MS = 6000;
  const MAX_TERM_LENGTH = 100;

  let termIndex = new Map();
  let maxTermLength = 0;
  const normalizeTerm = (text) => String(text).replace(/\s+/g, ' ').trim().toLowerCase();

  function setGlossary(rows) {
    const index = new Map();
    let longest = 0;
    for (const row of rows || []) {
      const key = normalizeTerm(row.term || '');
      const definition = String(row.definition || '').trim();
      if (!key || !definition || key.length > MAX_TERM_LENGTH) continue;
      index.set(key, { key, term: String(row.term).trim(), definition, notes: String(row.notes || '').trim() });
      longest = Math.max(longest, key.length);
    }
    termIndex = index;
    maxTermLength = longest;
  }

  const enabled = () => {
    const s = C.state.settings;
    return !!s && s.glossary !== false && SE.settings.siteOn(s, C.state.site) && termIndex.size > 0;
  };

  // ---------------------------------------------------------------------------
  // Matching
  // ---------------------------------------------------------------------------

  const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;
  const WHITESPACE = /\s/;
  const IS_TRIGGER = /\s+is\s$/i;
  const CHAR_TRIGGER = /[\s,.]$/;
  const KEEP_OPEN_TAIL = /(?:\s+is\s?|\s+i|[,.]\s*|\s+)$/i;
  const isWordChar = (ch) => ch !== undefined && WORD_CHAR.test(ch);
  const contextLength = () => maxTermLength * 2 + 16;

  function findTermEndingAt(text, end, truncated) {
    for (let i = Math.max(truncated ? 1 : 0, end - maxTermLength * 2); i < end; i++) {
      const ch = text[i];
      if (WHITESPACE.test(ch)) continue;
      if (i > 0 && isWordChar(ch) && isWordChar(text[i - 1])) continue;
      const entry = termIndex.get(normalizeTerm(text.slice(i, end)));
      if (entry) return { entry, start: i };
    }
    return null;
  }

  function detect(text, truncated) {
    const is = IS_TRIGGER.exec(text);
    if (is) {
      const hit = findTermEndingAt(text, is.index, truncated);
      if (hit) return hit;
    }
    return CHAR_TRIGGER.test(text) ? findTermEndingAt(text, text.length - 1, truncated) : null;
  }

  function stillMatches(text, truncated, key) {
    const tail = KEEP_OPEN_TAIL.exec(text);
    const hit = tail && findTermEndingAt(text, tail.index, truncated);
    return !!hit && hit.entry.key === key;
  }

  // ---------------------------------------------------------------------------
  // The text before the caret
  // ---------------------------------------------------------------------------

  const isTextField = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
  const BLOCK_TAGS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TD', 'TH', 'TR', 'UL']);

  function readContext(field) {
    const limit = contextLength();
    if (isTextField(field)) {
      let pos;
      let selEnd;
      try {
        pos = field.selectionStart;
        selEnd = field.selectionEnd;
      } catch {
        return null;
      }
      if (pos == null || pos !== selEnd) return null;
      const from = Math.max(0, pos - limit);
      const chunk = field.value.slice(from, pos);
      const lineStart = chunk.lastIndexOf('\n') + 1;
      return { text: chunk.slice(lineStart), truncated: lineStart === 0 && from > 0, offset: from + lineStart };
    }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    const { startContainer, startOffset } = sel.getRangeAt(0);
    if (!field.contains(startContainer)) return null;
    return { ...textBeforeCaret(field, startContainer, startOffset, limit), offset: null };
  }

  function closestBlock(node, root) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    for (; el && el !== root; el = el.parentElement) if (BLOCK_TAGS.has(el.tagName)) return el;
    return root;
  }

  function* textNodesBeforeCaret(root, container, offset) {
    const line = closestBlock(container, root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    if (container.nodeType === Node.TEXT_NODE) {
      yield [container, offset];
      walker.currentNode = container;
      node = walker.previousNode();
    } else if (offset < container.childNodes.length) {
      walker.currentNode = container.childNodes[offset];
      node = walker.previousNode();
    } else {
      node = container;
      while (node.lastChild) node = node.lastChild;
      walker.currentNode = node;
    }
    for (; node; node = walker.previousNode()) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (closestBlock(node, root) !== line) return;
        yield [node, node.data.length];
      } else if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName)) {
        return;
      }
    }
  }

  function textBeforeCaret(root, container, offset, limit) {
    let text = '';
    let truncated = false;
    for (const [node, end] of textNodesBeforeCaret(root, container, offset)) {
      if (text.length >= limit) {
        truncated = true;
        break;
      }
      text = node.data.slice(0, end) + text;
    }
    if (text.length > limit) {
      text = text.slice(-limit);
      truncated = true;
    }
    return { text, truncated };
  }

  function rangeBeforeCaret(root, count) {
    const caret = window.getSelection().getRangeAt(0);
    const range = document.createRange();
    range.setEnd(caret.startContainer, caret.startOffset);
    let remaining = count;
    for (const [node, end] of textNodesBeforeCaret(root, caret.startContainer, caret.startOffset)) {
      if (end >= remaining) {
        range.setStart(node, end - remaining);
        return range;
      }
      remaining -= end;
    }
    return null;
  }

  function charAfterCaret(field) {
    if (isTextField(field)) return field.value.charAt(field.selectionEnd);
    const { startContainer: node, startOffset: offset } = window.getSelection().getRangeAt(0);
    if (node.nodeType === Node.TEXT_NODE) return node.data.charAt(offset);
    const next = node.childNodes[offset];
    return next?.nodeType === Node.TEXT_NODE ? next.data.charAt(0) : '';
  }

  function occurrenceKey(field, ctx, hit) {
    let start;
    if (ctx.offset != null) start = ctx.offset + hit.start;
    else {
      const caret = window.getSelection().getRangeAt(0);
      const before = document.createRange();
      before.selectNodeContents(field);
      before.setEnd(caret.startContainer, caret.startOffset);
      start = before.toString().length - (ctx.text.length - hit.start);
    }
    return `${hit.entry.key}@${start}`;
  }

  // ---------------------------------------------------------------------------
  // Caret position on screen
  // ---------------------------------------------------------------------------

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const caretRect = (field) => (isTextField(field) ? caretRectInTextField(field) : caretRectInEditable());
  const MIRROR_STYLES = ['direction', 'font-family', 'font-size', 'font-style', 'font-variant', 'font-weight', 'font-stretch', 'font-feature-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform', 'text-indent', 'text-align', 'tab-size', 'word-break', 'hyphens', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'];

  function caretRectInTextField(field) {
    const isInput = field.tagName === 'INPUT';
    const pos = field.selectionEnd ?? field.value.length;
    const cs = getComputedStyle(field);
    const mirror = document.createElement('div');
    const set = (prop, value) => mirror.style.setProperty(prop, value, 'important');
    for (const prop of MIRROR_STYLES) set(prop, cs.getPropertyValue(prop));
    set('display', 'block');
    set('position', 'absolute');
    set('top', '0');
    set('left', '-10000px');
    set('visibility', 'hidden');
    set('overflow', 'hidden');
    set('box-sizing', 'content-box');
    set('border', '0');
    set('margin', '0');
    set('min-width', '0');
    set('max-width', 'none');
    set('height', 'auto');
    set('width', `${Math.max(0, field.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight))}px`);
    set('white-space', isInput ? 'pre' : 'pre-wrap');
    set('overflow-wrap', isInput ? 'normal' : 'break-word');
    mirror.textContent = field.value.slice(0, pos);
    const marker = document.createElement('span');
    marker.style.setProperty('all', 'unset', 'important');
    marker.textContent = '\u200b';
    mirror.append(marker, field.value.slice(pos).match(/^\S*/)[0]);
    (document.body || document.documentElement).appendChild(mirror);
    const m = marker.getBoundingClientRect();
    const origin = mirror.getBoundingClientRect();
    mirror.remove();
    const box = field.getBoundingClientRect();
    const left = clamp(box.left + field.clientLeft + (m.left - origin.left) - field.scrollLeft, box.left, box.right);
    if (isInput) return { left, top: box.top, bottom: box.bottom };
    const top = box.top + field.clientTop + (m.top - origin.top) - field.scrollTop;
    return { left, top, bottom: top + m.height };
  }

  function caretRectInEditable() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    const r = rects[rects.length - 1];
    if (r && (r.top || r.bottom || r.left)) return { left: r.left, top: r.top, bottom: r.bottom };
    const { startContainer: node, startOffset: offset } = range;
    if (node.nodeType === Node.TEXT_NODE && offset > 0) {
      const prev = document.createRange();
      prev.setStart(node, offset - 1);
      prev.setEnd(node, offset);
      const pr = [...prev.getClientRects()].pop();
      if (pr) return { left: pr.right, top: pr.top, bottom: pr.bottom };
    }
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    return { left: box.left, top: box.top, bottom: box.top + lineHeight };
  }

  // ---------------------------------------------------------------------------
  // The card
  // ---------------------------------------------------------------------------

  let ui = null;
  function ensureCard() {
    if (ui) return ui;
    const L = UI.ensure();
    const { h } = UI;
    const term = h('div', { class: 'gterm' });
    const def = h('div', { class: 'gdef' });
    const notes = h('div', { class: 'gnotes', hidden: true });
    const insert = h('button', { class: 'btn btn-primary', type: 'button', tabindex: '-1' }, 'Insert definition');
    const more = h('button', { class: 'link', type: 'button', tabindex: '-1', 'aria-expanded': 'false', style: 'margin-left:auto' }, 'More');
    const close = h('button', { class: 'icon-btn gclose', type: 'button', tabindex: '-1', 'aria-label': 'Dismiss', title: 'Dismiss (Esc)' }, UI.icon('close'));
    const card = h('div', { class: 'gcard', hidden: true, 'aria-live': 'polite' }, close, term, def, notes,
      h('div', { class: 'gactions' }, insert, h('span', { class: 'note' }, h('kbd', {}, 'Tab')), more));
    card.addEventListener('mouseenter', () => {
      hovering = true;
      clearTimeout(hideTimer);
    });
    card.addEventListener('mouseleave', () => {
      hovering = false;
      if (active) startHideTimer();
    });
    close.addEventListener('click', () => hideCard({ dismiss: true }));
    insert.addEventListener('click', () => insertDefinition());
    more.addEventListener('click', () => {
      const expand = notes.hidden;
      notes.hidden = !expand;
      more.textContent = expand ? 'Less' : 'More';
      more.setAttribute('aria-expanded', String(expand));
      if (active && !positionCard()) hideCard();
    });
    L.cards.append(card);
    ui = { card, term, def, notes, more };
    return ui;
  }

  let active = null;
  let hovering = false;
  let hideTimer = 0;
  let removeTimer = 0;
  const dismissed = new WeakMap();

  function showCard(field, entry, occKey) {
    const { card, term, def, notes, more } = ensureCard();
    term.textContent = entry.term;
    def.textContent = entry.definition;
    notes.textContent = entry.notes;
    notes.hidden = true;
    more.hidden = !entry.notes;
    more.textContent = 'More';
    more.setAttribute('aria-expanded', 'false');
    active = { field, entry, occKey };
    hovering = false;
    clearTimeout(removeTimer);
    card.classList.remove('fading');
    card.hidden = false;
    if (!positionCard()) {
      hideCard();
      return;
    }
    card.classList.add('visible');
    startHideTimer();
  }

  function hideCard({ dismiss = false, fade = false } = {}) {
    if (!active) return;
    if (dismiss) {
      let keys = dismissed.get(active.field);
      if (!keys) dismissed.set(active.field, (keys = new Set()));
      keys.add(active.occKey);
    }
    active = null;
    clearTimeout(hideTimer);
    const { card } = ui;
    card.classList.toggle('fading', fade);
    card.classList.remove('visible');
    clearTimeout(removeTimer);
    removeTimer = setTimeout(() => {
      if (!active) card.hidden = true;
    }, fade ? 450 : 160);
  }

  function startHideTimer() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!hovering) hideCard({ fade: true });
    }, AUTO_HIDE_MS);
  }

  function positionCard() {
    const caret = caretRect(active.field);
    const vw = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
    const vh = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);
    if (!caret || caret.bottom < 0 || caret.top > vh || caret.left < 0 || caret.left > vw) return false;
    const GAP = 6;
    const MARGIN = 8;
    const { card } = ui;
    const { width, height } = card.getBoundingClientRect();
    let top = caret.bottom + GAP;
    if (top + height > vh - MARGIN && caret.top - GAP - height >= MARGIN) top = caret.top - GAP - height;
    card.style.left = `${clamp(caret.left - 14, MARGIN, vw - width - MARGIN)}px`;
    card.style.top = `${clamp(top, MARGIN, vh - height - MARGIN)}px`;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Inserting
  // ---------------------------------------------------------------------------

  let selfInsert = false;
  const hasFocus = (field) => {
    const focused = field.getRootNode().activeElement;
    return focused === field || field.contains(focused);
  };

  function insertDefinition() {
    if (!active) return;
    const { field, entry } = active;
    const ctx = hasFocus(field) ? readContext(field) : null;
    if (!ctx || !stillMatches(ctx.text, ctx.truncated, entry.key)) {
      hideCard();
      return;
    }
    const typed = ctx.text.slice(KEEP_OPEN_TAIL.exec(ctx.text).index);
    const partialIs = /^\s+(is?)$/i.exec(typed);
    let replace;
    let text = ' ';
    if (partialIs) {
      replace = typed.length;
      text = ` ${partialIs[1].length === 1 ? `${partialIs[1]}s` : partialIs[1]} `;
    } else {
      replace = typed.length - typed.trimEnd().length;
    }
    const before = ctx.text.slice(0, ctx.text.length - replace);
    let { definition } = entry;
    if (/[.!?]["'”’)\]]*$/.test(before)) definition = definition.charAt(0).toUpperCase() + definition.slice(1);
    text += definition;
    if (isWordChar(charAfterCaret(field))) text += ' ';
    selfInsert = true;
    let inserted;
    try {
      inserted = isTextField(field) ? insertIntoTextField(field, text, replace) : insertIntoEditable(field, text, replace);
    } finally {
      selfInsert = false;
    }
    if (inserted) hideCard({ dismiss: true });
  }

  function insertIntoTextField(field, text, replace) {
    const end = field.selectionEnd;
    field.setSelectionRange(end - replace, end);
    if (document.execCommand('insertText', false, text)) return true;
    field.setRangeText(text, end - replace, end, 'end');
    field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    return true;
  }

  function insertIntoEditable(field, text, replace) {
    if (replace === 1 && text.startsWith(' ')) {
      text = text.slice(1);
      replace = 0;
    }
    if (replace) {
      const range = rangeBeforeCaret(field, replace);
      if (!range) return false;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    return document.execCommand('insertText', false, text);
  }

  const isDismissed = (field, key) => dismissed.get(field)?.has(key) ?? false;
  function forgetDismissalsIfEmpty(field) {
    const keys = dismissed.get(field);
    if (!keys || !keys.size) return;
    const empty = isTextField(field) ? field.value === '' : !field.textContent.trim();
    if (empty) keys.clear();
  }

  // ---------------------------------------------------------------------------
  // Hooks called by main.js
  // ---------------------------------------------------------------------------

  function check(field, inserting) {
    if (selfInsert || !field.isConnected || !enabled()) {
      if (active && !enabled()) hideCard();
      return;
    }
    forgetDismissalsIfEmpty(field);
    const ctx = readContext(field);
    const showingHere = active?.field === field;
    if (!ctx) {
      if (showingHere) hideCard();
      return;
    }
    const hit = inserting && detect(ctx.text, ctx.truncated);
    if (hit) {
      const occKey = occurrenceKey(field, ctx, hit);
      if (isDismissed(field, occKey)) {
        if (showingHere) hideCard();
      } else if (showingHere && active.occKey === occKey) {
        if (positionCard()) startHideTimer();
        else hideCard();
      } else {
        showCard(field, hit.entry, occKey);
      }
      return;
    }
    if (showingHere && (!stillMatches(ctx.text, ctx.truncated, active.entry.key) || !positionCard())) hideCard();
  }

  const CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

  // Returns true if it handled the key (Tab to insert, Esc to dismiss).
  function onKeydown(e, field) {
    if (field) forgetDismissalsIfEmpty(field);
    if (!active || e.isComposing) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      hideCard({ dismiss: true });
      return true;
    }
    if (e.key === 'Tab' && field === active.field && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      insertDefinition();
      return true;
    }
    if (CARET_KEYS.has(e.key)) hideCard();
    return false;
  }

  C.glossary = {
    setGlossary,
    check,
    onKeydown,
    isSelfInsert: () => selfInsert,
    showing: () => !!active,
    hide: () => hideCard(),
    reposition: () => {
      if (active && !positionCard()) hideCard();
    },
    fieldIs: (f) => active?.field === f,
  };
})();
