/*
 * Study Engine settings: the glossary, carried over from Live Definitions.
 *
 * Imports, edits and exports the glossary, kept in chrome.storage.local under "glossary" as
 * [{ id, term, definition, notes }]. Import and export use local files only.
 */
(() => {
  'use strict';

  const MAX_TERM_LENGTH = 100; // the content script ignores longer terms
  const MAX_FILE_BYTES = 20 * 1024 * 1024;

  const $ = (id) => document.getElementById(id);
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const byTerm = (a, b) => collator.compare(a.term, b.term);
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  const normalizeTerm = (text) => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
  const cleanLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
  const cleanNotes = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim();
  const toast = (...args) => window.seToast(...args);

  let glossary = [];
  let editing = null;

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  }

  // ---------------------------------------------------------------------------
  // CSV
  // ---------------------------------------------------------------------------

  // RFC 4180: fields with commas, quotes or line breaks are quoted, and quotes inside are
  // doubled. Like spreadsheets, also accepts spaces before an opening quote.
  function parseCsv(text, delimiter) {
    const rows = [];
    let cells = [];
    let field = '';
    let quoted = false;
    let line = 1;
    let rowLine = 1;
    const endField = () => {
      cells.push(field);
      field = '';
    };
    const endRow = () => {
      endField();
      if (cells.some((cell) => cell.trim())) rows.push({ cells, line: rowLine });
      cells = [];
    };
    for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') {
          if (ch === '\n') line++;
          field += ch;
        } else if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else if (ch === '"' && !field.trim()) {
        field = '';
        quoted = true;
      } else if (ch === delimiter) {
        endField();
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        endRow();
        rowLine = ++line;
      } else {
        field += ch;
      }
    }
    if (field || cells.length) endRow();
    return rows;
  }

  function detectDelimiter(text) {
    const firstLine = text.slice(0, text.search(/[\r\n]|$/));
    const count = (ch) => firstLine.split(ch).length - 1;
    const commas = count(',');
    if (count(';') > commas) return ';';
    if (count('\t') > commas) return '\t';
    return ',';
  }

  function entryProblem(term, definition) {
    if (!term) return 'no term';
    if (!definition) return 'no definition';
    if (term.length > MAX_TERM_LENGTH) return `term is longer than ${MAX_TERM_LENGTH} characters`;
    return null;
  }

  function readGlossaryCsv(text) {
    const rows = parseCsv(text, detectDelimiter(text));
    const header = (rows[0]?.cells ?? []).map((cell) => cell.trim().toLowerCase());
    const hasHeader = header.includes('term') && header.includes('definition');
    const col = hasHeader
      ? { term: header.indexOf('term'), definition: header.indexOf('definition'), notes: header.findIndex((h) => h === 'notes' || h === 'note') }
      : { term: 0, definition: 1, notes: 2 };
    const entries = [];
    const skipped = [];
    for (const { cells, line } of hasHeader ? rows.slice(1) : rows) {
      const term = cleanLine(cells[col.term]);
      const definition = cleanLine(cells[col.definition]);
      const notes = col.notes === -1 ? '' : cleanNotes(cells[col.notes]);
      const problem = entryProblem(term, definition);
      if (problem) skipped.push(`line ${line} (${problem})`);
      else entries.push({ term, definition, notes });
    }
    return { entries, skipped, hasHeader };
  }

  const csvField = (value) => (/[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  function toCsv(entries) {
    const lines = [['term', 'definition', 'notes'], ...entries.map((e) => [e.term, e.definition, e.notes])];
    return `\ufeff${lines.map((cells) => cells.map(csvField).join(',')).join('\r\n')}\r\n`;
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  async function load() {
    const { glossary: stored } = await chrome.storage.local.get('glossary');
    glossary = (Array.isArray(stored) ? stored : []).map((e) => ({ id: e.id || crypto.randomUUID(), term: cleanLine(e.term), definition: cleanLine(e.definition), notes: cleanNotes(e.notes) }));
  }

  async function commit(next) {
    const previous = glossary;
    glossary = next;
    render();
    try {
      await chrome.storage.local.set({ glossary });
      return true;
    } catch (err) {
      glossary = previous;
      render();
      toast(`Couldn’t save the glossary: ${err.message}`);
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Table
  // ---------------------------------------------------------------------------

  function render() {
    const query = normalizeTerm($('search').value);
    const sorted = [...glossary].sort(byTerm);
    const shown = query ? sorted.filter((e) => `${e.term}\n${e.definition}\n${e.notes}`.toLowerCase().includes(query)) : sorted;
    const rows = document.createDocumentFragment();
    for (const entry of shown) rows.append(entry.id === editing?.id ? editorRow() : viewRow(entry));
    $('rows').replaceChildren(rows);
    const total = glossary.length;
    $('count').textContent = !total ? '' : query ? `${shown.length.toLocaleString()} of ${plural(total, 'term')}` : plural(total, 'term');
    $('empty').hidden = shown.length > 0;
    $('empty').textContent = total ? `No terms match “${$('search').value.trim()}”.` : 'No terms yet. Import a CSV or add a term above.';
    $('export-btn').disabled = !total;
    $('clear-btn').disabled = !total;
  }

  function viewRow(entry) {
    const notes = el('div', { class: 'clamp' }, entry.notes);
    if (entry.notes.length > 120) notes.title = entry.notes;
    return el('tr', { 'data-id': entry.id },
      el('td', { class: 'term-cell' }, entry.term),
      el('td', {}, entry.definition),
      el('td', { class: 'notes-cell' }, notes),
      el('td', {}, el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-sm', type: 'button', 'data-action': 'edit', 'aria-label': `Edit ${entry.term}` }, 'Edit'),
        el('button', { class: 'btn btn-sm btn-danger', type: 'button', 'data-action': 'delete', 'aria-label': `Delete ${entry.term}` }, 'Delete'))));
  }

  function editorRow() {
    const field = (tag, name, label, attrs = {}) => {
      const input = el(tag, { 'data-field': name, 'aria-label': label, class: 'input', ...attrs });
      input.value = editing[name];
      return input;
    };
    return el('tr', { 'data-id': editing.id, class: 'editing' },
      el('td', {}, field('input', 'term', 'Term', { type: 'text', maxlength: String(MAX_TERM_LENGTH), autocomplete: 'off' })),
      el('td', {}, field('textarea', 'definition', 'Definition', { rows: '3' })),
      el('td', {}, field('textarea', 'notes', 'Notes', { rows: '3' })),
      el('td', {}, el('div', { class: 'row-actions' },
        el('button', { class: 'btn btn-sm btn-primary', type: 'button', 'data-action': 'save' }, 'Save'),
        el('button', { class: 'btn btn-sm', type: 'button', 'data-action': 'cancel' }, 'Cancel')),
      el('div', { class: 'row-error', role: 'alert' })));
  }

  const rowFor = (id) => $('rows').querySelector(`tr[data-id="${CSS.escape(id)}"]`);
  const focusRow = (id, selector) => rowFor(id)?.querySelector(selector)?.focus();

  function formProblem(term, definition, exceptId = null) {
    if (!term) return 'Enter a term.';
    if (term.length > MAX_TERM_LENGTH) return `Terms can be at most ${MAX_TERM_LENGTH} characters.`;
    if (!definition) return 'Enter a definition.';
    const key = normalizeTerm(term);
    const other = glossary.find((e) => e.id !== exceptId && normalizeTerm(e.term) === key);
    if (other) return `“${other.term}” is already in your glossary.`;
    return null;
  }

  function startEdit(id) {
    const entry = glossary.find((e) => e.id === id);
    if (!entry) return;
    editing = { ...entry };
    render();
    focusRow(id, '[data-field="term"]');
  }

  function cancelEdit() {
    const { id } = editing;
    editing = null;
    render();
    focusRow(id, '[data-action="edit"]');
  }

  async function saveEdit() {
    const { id } = editing;
    const term = cleanLine(editing.term);
    const definition = cleanLine(editing.definition);
    const notes = cleanNotes(editing.notes);
    const problem = formProblem(term, definition, id);
    if (problem) {
      const row = rowFor(id);
      row.querySelector('.row-error').textContent = problem;
      row.querySelector(`[data-field="${term && term.length <= MAX_TERM_LENGTH && !definition ? 'definition' : 'term'}"]`).focus();
      return;
    }
    editing = null;
    if (await commit(glossary.map((e) => (e.id === id ? { id, term, definition, notes } : e)))) focusRow(id, '[data-action="edit"]');
  }

  async function deleteEntry(id) {
    const entry = glossary.find((e) => e.id === id);
    if (!entry) return;
    const row = rowFor(id);
    const nextId = (row?.nextElementSibling ?? row?.previousElementSibling)?.dataset.id;
    if (editing?.id === id) editing = null;
    if (!(await commit(glossary.filter((e) => e.id !== id)))) return;
    if (nextId) focusRow(nextId, '[data-action="delete"]');
    else $('search').focus();
    toast(`Deleted “${entry.term}”.`, () => {
      const key = normalizeTerm(entry.term);
      if (!glossary.some((e) => normalizeTerm(e.term) === key)) commit([...glossary, entry]);
    });
  }

  $('rows').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const { id } = button.closest('tr').dataset;
    ({ edit: startEdit, delete: deleteEntry, save: saveEdit, cancel: cancelEdit })[button.dataset.action](id);
  });
  $('rows').addEventListener('input', (e) => {
    const name = e.target.dataset.field;
    if (name && editing) editing[name] = e.target.value;
  });
  $('rows').addEventListener('keydown', (e) => {
    if (!editing || !e.target.dataset.field) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      saveEdit();
    }
  });
  $('search').addEventListener('input', render);

  $('add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const { term: termInput, definition: definitionInput, notes: notesInput } = form.elements;
    const term = cleanLine(termInput.value);
    const definition = cleanLine(definitionInput.value);
    const problem = formProblem(term, definition);
    if (problem) {
      setStatus($('add-status'), 'error', problem);
      (term && term.length <= MAX_TERM_LENGTH && !definition ? definitionInput : termInput).focus();
      return;
    }
    const entry = { id: crypto.randomUUID(), term, definition, notes: cleanNotes(notesInput.value) };
    if (await commit([...glossary, entry])) {
      form.reset();
      setStatus($('add-status'), 'ok', `Added “${term}”.`);
      termInput.focus();
    }
  });
  $('add-form').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.requestSubmit();
    }
  });

  function setStatus(node, kind, message, details = []) {
    node.className = `status ${kind}`;
    node.replaceChildren(message);
    if (details.length) node.append(el('ul', {}, ...details.map((d) => el('li', {}, d))));
  }

  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    e.target.value = '';
    if (file) await importFile(file);
  });

  async function importFile(file) {
    const status = $('io-status');
    if (file.size > MAX_FILE_BYTES) {
      setStatus(status, 'error', `${file.name} is too large to import. The limit is 20 MB.`);
      return;
    }
    const { entries, skipped, hasHeader } = readGlossaryCsv(await file.text());
    const more = skipped.length > 5 ? `, and ${plural(skipped.length - 5, 'more row')}` : '';
    const skipNote = skipped.length ? [`Skipped ${plural(skipped.length, 'row')}: ${skipped.slice(0, 5).join(', ')}${more}.`] : [];
    if (!entries.length) {
      setStatus(status, 'error', `No terms found in ${file.name}. Each row needs a term and a definition.`, skipNote);
      return;
    }
    const next = glossary.slice();
    const indexByKey = new Map(next.map((e, i) => [normalizeTerm(e.term), i]));
    const seen = new Set();
    let added = 0;
    let updated = 0;
    let repeated = 0;
    for (const entry of entries) {
      const key = normalizeTerm(entry.term);
      const i = indexByKey.get(key);
      if (seen.has(key)) {
        repeated++;
        next[i] = { ...next[i], ...entry };
      } else if (i === undefined) {
        indexByKey.set(key, next.push({ id: crypto.randomUUID(), ...entry }) - 1);
        added++;
      } else if (next[i].definition !== entry.definition || next[i].notes !== entry.notes || next[i].term !== entry.term) {
        next[i] = { ...next[i], ...entry };
        updated++;
      }
      seen.add(key);
    }
    if (!(await commit(next))) return;
    const unchanged = entries.length - added - updated - repeated;
    const parts = [`${added.toLocaleString()} new`, `${updated.toLocaleString()} updated`];
    if (unchanged) parts.push(`${unchanged.toLocaleString()} already up to date`);
    const details = [];
    if (!hasHeader) details.push('No header row, so the columns were read as term, definition, notes.');
    if (repeated) details.push(`${plural(repeated, 'row')} repeated a term from earlier in the file; the later row was used.`);
    details.push(...skipNote);
    setStatus(status, 'ok', `Imported ${file.name}: ${parts.join(', ')}.`, details);
  }

  $('export-btn').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([toCsv([...glossary].sort(byTerm))], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', { href: url, download: `study-engine-glossary-${new Date().toLocaleDateString('en-CA')}.csv` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setStatus($('io-status'), 'ok', `Exported ${plural(glossary.length, 'term')}.`);
  });

  $('clear-btn').addEventListener('click', async () => {
    const previous = glossary;
    if (!previous.length) return;
    if (!confirm(`Delete all ${plural(previous.length, 'term')}? Export a CSV first if you want a copy.`)) return;
    editing = null;
    if (await commit([])) toast(`Deleted ${plural(previous.length, 'term')}.`, () => commit(previous));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.glossary && !editing) {
      load().then(render);
    }
  });

  window.seGlossary = { load: () => load().then(render), readGlossaryCsv, toCsv };
  load().then(render);
})();
