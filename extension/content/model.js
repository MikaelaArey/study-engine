/*
 * Study Engine (content script): reading and editing the text of a field.
 *
 * InputModel covers <textarea> and text <input>. EditableModel covers rich editors
 * (contenteditable), such as Gmail, Slack, Notion and LinkedIn: it turns the DOM into plain
 * text with "\n" between blocks, and maps offsets in that text back to DOM positions.
 *
 * Edits go through the browser's editing command (insertText), so the page's editor sees
 * them as typing, and Ctrl/Cmd+Z undoes them.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  const C = (SE.content ||= {});
  if (C.InputModel) return;

  const TEXT_INPUT_TYPES = new Set(['text', '']);
  // Fields that hold secrets even when they aren't type="password".
  const SENSITIVE = /password|one-time-code|cc-|card|cvc|cvv|otp|pin\b/i;
  // Single-line boxes that aren't prose: searches, names, addresses, usernames and the like.
  const NOT_PROSE_INPUT = /search|query|^q$|filter|find|^name$|^[fl]name$|user ?name|e-?mail|phone|tel\b|url|address|postal|zip|city|country|first.?name|last.?name|full.?name|given-name|family-name|nickname|organization|company|bday|coupon|promo|captcha/i;
  const NOT_PROSE_MODE = new Set(['numeric', 'decimal', 'tel', 'email', 'url', 'search']);
  // Opt-outs used by sites for writing assistants, plus our own.
  const OPT_OUT = '[data-gramm="false"],[data-gramm_editor="false"],[data-enable-grammarly="false"],[data-study-engine="off"]';
  // Code editors and other places that aren't prose.
  const NOT_PROSE = '.CodeMirror,.cm-editor,.cm-content,.monaco-editor,.ace_editor,[data-language],pre,code,[role="code"],.ql-code-block,[data-slate-code],.notion-code-block';
  // Parts of a rich editor that aren't the writer's text: quoted replies, signatures, chips.
  const SKIP = 'script,style,noscript,template,svg,math,img,video,audio,canvas,iframe,object,embed,.gmail_quote,.gmail_signature,[data-smartmail="gmail_signature"],blockquote[type="cite"],[aria-hidden="true"],[data-se-skip]';

  const isTextControl = (el) => el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

  // The field an event or element belongs to, or null if Study Engine should leave it alone.
  function fieldFor(node) {
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    if (isTextControl(node)) {
      if (node.tagName === 'INPUT') {
        if (!TEXT_INPUT_TYPES.has(node.type)) return null;
        if (node.getAttribute('spellcheck') === 'false') return null;
        if (node.clientWidth < 140) return null; // small boxes: codes, quantities
        if (NOT_PROSE_MODE.has(node.inputMode)) return null;
        const role = node.getAttribute('role');
        if (role === 'combobox' || role === 'searchbox' || /list|both/.test(node.getAttribute('aria-autocomplete') || '')) return null;
        const hints = [node.getAttribute('autocomplete'), node.name, node.id, node.getAttribute('placeholder'), node.getAttribute('aria-label')];
        if (hints.some((x) => x && NOT_PROSE_INPUT.test(x.trim()))) return null;
        if (node.closest('[role="search"], search')) return null;
      }
      if (node.readOnly || node.disabled) return null;
      if (SENSITIVE.test(`${node.getAttribute('autocomplete') || ''} ${node.name || ''} ${node.id || ''}`)) return null;
      if (node.closest(OPT_OUT) || node.closest(NOT_PROSE)) return null;
      return node;
    }
    if (!node.isContentEditable) return null;
    let root = node;
    while (root.parentElement && root.parentElement.isContentEditable) root = root.parentElement;
    if (root.closest(OPT_OUT) || root.matches(NOT_PROSE) || root.closest(NOT_PROSE)) return null;
    if (root.getAttribute('role') === 'combobox' && root.clientHeight < 40 && !root.textContent) return null;
    // Google Docs draws text on a canvas; its hidden input box isn't the document.
    if (location.hostname === 'docs.google.com' && root.closest('.docs-texteventtarget-iframe, .kix-appview-editor')) return null;
    return root;
  }

  // ---------------------------------------------------------------------------
  // <textarea> and <input>
  // ---------------------------------------------------------------------------

  class InputModel {
    constructor(el) {
      this.el = el;
      this.kind = el.tagName === 'INPUT' ? 'input' : 'textarea';
    }

    text() {
      return this.el.value;
    }

    focused() {
      const a = this.el.getRootNode().activeElement;
      return a === this.el;
    }

    caret() {
      try {
        const { selectionStart: s, selectionEnd: e } = this.el;
        return s === e ? s : null;
      } catch {
        return null;
      }
    }

    // Replaces text[start, end) with `text`. Returns whether it worked.
    replace(start, end, text) {
      const el = this.el;
      if (el.value.length < end) return false;
      el.focus({ preventScroll: true });
      el.setSelectionRange(start, end);
      let ok = false;
      try {
        ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
      } catch {}
      if (!ok) {
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }));
      }
      return true;
    }

    select(start, end) {
      this.el.focus({ preventScroll: true });
      this.el.setSelectionRange(start, end);
    }
  }

  // ---------------------------------------------------------------------------
  // contenteditable
  // ---------------------------------------------------------------------------

  const BLOCKS = new Set(['ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'UL']);
  const OBJECT = '\ufffc'; // stands in for a chip or an image, so words either side don't join

  class EditableModel {
    constructor(root) {
      this.el = root;
      this.kind = 'editable';
      this._text = '';
      this.parts = []; // [{ node, start, end }] for each text node, in order
      this.version = -1;
      this.build();
    }

    // Walks the editor's DOM into plain text. Cheap enough to run after every input.
    build() {
      const parts = [];
      let text = '';
      const root = this.el;
      const visit = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const data = node.data;
          if (data) {
            parts.push({ node, start: text.length, end: text.length + data.length });
            text += data;
          }
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const el = node;
        if (el !== root && (el.matches(SKIP) || el.getAttribute('contenteditable') === 'false')) {
          if (!text.endsWith(OBJECT)) text += OBJECT;
          return;
        }
        if (el.tagName === 'BR') {
          text += '\n';
          return;
        }
        const block = el !== root && BLOCKS.has(el.tagName);
        if (block && text && !text.endsWith('\n')) text += '\n';
        for (let c = el.firstChild; c; c = c.nextSibling) visit(c);
        if (block && text && !text.endsWith('\n')) text += '\n';
      };
      visit(root);
      // A trailing break from the last block isn't text.
      this._text = text.replace(/\n$/, '');
      this.parts = parts;
      this.byNode = new Map(parts.map((p) => [p.node, p]));
      return this._text;
    }

    text() {
      return this.build();
    }

    focused() {
      const a = this.el.getRootNode().activeElement;
      return a === this.el || this.el.contains(a);
    }

    /*
     * The DOM point for a text offset. Offsets that fall on a line break or a chip (text with no
     * node of its own) snap to the next text node for a range's start ('start') or to the
     * previous one for its end ('end').
     */
    point(offset, bias = 'start') {
      const parts = this.parts;
      if (!parts.length) return null;
      let lo = 0;
      let hi = parts.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (parts[mid].start <= offset) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (idx === -1) return { node: parts[0].node, offset: 0 };
      const p = parts[idx];
      const len = p.node.data.length;
      if (offset < p.end) return { node: p.node, offset: Math.min(offset - p.start, len) };
      const next = parts[idx + 1];
      if (bias === 'start' && next && (offset > p.end || next.start === offset)) return { node: next.node, offset: 0 };
      return { node: p.node, offset: len };
    }

    range(start, end) {
      const a = this.point(start, 'start');
      const b = this.point(end, 'end');
      if (!a || !b || !a.node.isConnected || !b.node.isConnected) return null;
      const r = document.createRange();
      try {
        r.setStart(a.node, a.offset);
        r.setEnd(b.node, b.offset);
      } catch {
        return null;
      }
      return r;
    }

    // Offset of a DOM point in the text, or null if it isn't in this editor.
    offsetOf(node, offset) {
      if (node.nodeType === Node.TEXT_NODE) {
        const p = this.byNode.get(node);
        return p ? p.start + Math.min(offset, node.data.length) : null;
      }
      if (!this.el.contains(node)) return null;
      // A point between elements: the first text node that starts at or after it.
      const r = document.createRange();
      try {
        r.setStart(node, offset);
      } catch {
        return null;
      }
      for (const p of this.parts) {
        if (r.comparePoint(p.node, 0) >= 0) return p.start;
      }
      return this._text.length;
    }

    caret() {
      const sel = this.el.getRootNode().getSelection?.() || window.getSelection();
      if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
      const r = sel.getRangeAt(0);
      if (!this.el.contains(r.startContainer)) return null;
      return this.offsetOf(r.startContainer, r.startOffset);
    }

    replace(start, end, text) {
      this.build();
      const r = this.range(start, end);
      if (!r) return false;
      this.el.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      let ok = false;
      try {
        ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
      } catch {}
      if (!ok) {
        // Last resort for editors that block the command: edit the text node directly.
        if (r.startContainer === r.endContainer && r.startContainer.nodeType === Node.TEXT_NODE) {
          const n = r.startContainer;
          n.data = n.data.slice(0, r.startOffset) + text + n.data.slice(r.endOffset);
          this.el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertReplacementText', data: text }));
          ok = true;
        }
      }
      return ok;
    }

    select(start, end) {
      this.build();
      const r = this.range(start, end);
      if (!r) return;
      this.el.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }

  const modelFor = (field) => (isTextControl(field) ? new InputModel(field) : new EditableModel(field));

  Object.assign(C, { fieldFor, modelFor, InputModel, EditableModel, isTextControl, OBJECT });
})();
