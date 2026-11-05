/*
 * Study Engine settings page.
 *
 * Settings live in chrome.storage.local ("settings", see lib/settings.js); every open tab
 * picks up changes straight away. The API key is saved with lib/secrets.js, which keeps it
 * where content scripts can't read it.
 */
(() => {
  'use strict';
  const SE = globalThis.StudyEngine;
  const $ = (id) => document.getElementById(id);
  let s = SE.settings.withDefaults(null);

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'value') node.value = v;
      else if (k === 'checked' || k === 'selected') node[k] = true;
      else node.setAttribute(k, v === true ? '' : v);
    }
    node.append(...children.flat().filter((c) => c != null && c !== false));
    return node;
  }

  // ---------------------------------------------------------------------------
  // Toast, shared with the glossary
  // ---------------------------------------------------------------------------

  let toastTimer = 0;
  let undoAction = null;
  function toast(message, undo = null) {
    $('toast-text').textContent = message;
    $('toast-undo').hidden = !undo;
    undoAction = undo;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, undo ? 8000 : 4000);
  }
  function hideToast() {
    $('toast').hidden = true;
    undoAction = null;
  }
  $('toast-undo').addEventListener('click', () => {
    const undo = undoAction;
    hideToast();
    undo?.();
  });
  window.seToast = toast;

  const send = (type, data = {}) => new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, ...data }, (r) => resolve(chrome.runtime.lastError ? { ok: false, error: { message: chrome.runtime.lastError.message } } : r));
  });
  const save = async (patch) => {
    s = await SE.settings.update(patch);
    renderAll();
  };

  // ---------------------------------------------------------------------------
  // AI
  // ---------------------------------------------------------------------------

  const mask = (k) => (k.length > 14 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••');

  async function renderKey() {
    const key = (await SE.secrets.get('anthropicKey').catch(() => '')) || '';
    $('key-saved').hidden = !key;
    $('key-masked').textContent = key ? mask(key) : '';
    $('key').placeholder = key ? 'Paste a new key to replace it' : 'sk-ant-…';
    const pill = $('ai-pill');
    const on = !!key && s.ai.enabled !== false;
    pill.className = `pill ${on ? 'pill-good' : key ? 'pill-quiet' : 'pill-warn'}`;
    $('ai-pill-text').textContent = on ? 'AI checks on' : key ? 'AI checks off' : 'No key yet';
    $('welcome').hidden = !!key && !new URLSearchParams(location.search).has('welcome');
    for (const id of ['ai-auto', 'ai-search', 'm-writing', 'm-study', 'm-facts']) $(id).disabled = !on;
    for (const r of document.querySelectorAll('input[name="facts"]')) r.disabled = !on;
  }

  function setStatus(id, kind, text) {
    const n = $(id);
    n.className = `status ${kind}`;
    n.textContent = text;
  }

  $('key-show').addEventListener('click', (e) => {
    const show = $('key').type === 'password';
    $('key').type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
    e.currentTarget.setAttribute('aria-pressed', String(show));
  });

  async function testKey() {
    setStatus('key-status', '', 'Testing the connection…');
    const r = await send('se:test-key');
    if (r?.ok) setStatus('key-status', 'ok', `Connected. Claude answered using ${r.model}.`);
    else setStatus('key-status', 'error', r?.error?.message || 'The test didn’t finish.');
  }

  $('key-save').addEventListener('click', async () => {
    const key = $('key').value.trim();
    if (!key) {
      setStatus('key-status', 'error', 'Paste your API key first.');
      $('key').focus();
      return;
    }
    if (!/^sk-ant-[\w-]{20,}$/.test(key)) {
      setStatus('key-status', 'error', 'That doesn’t look like an Anthropic API key. Keys start with “sk-ant-”.');
      return;
    }
    await SE.secrets.set('anthropicKey', key);
    $('key').value = '';
    $('key').type = 'password';
    $('key-show').textContent = 'Show';
    await send('se:key-changed');
    await renderKey();
    await testKey();
  });
  $('key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('key-save').click();
  });
  $('key-test').addEventListener('click', testKey);
  $('key-remove').addEventListener('click', async () => {
    if (!confirm('Remove your API key? AI checks and fact checks stop until you add one again.')) return;
    await SE.secrets.remove('anthropicKey');
    await send('se:key-changed');
    setStatus('key-status', 'ok', 'Key removed. Built-in checks keep working.');
    renderKey();
  });

  $('ai-enabled').addEventListener('change', (e) => save({ ai: { enabled: e.target.checked } }).then(() => send('se:key-changed')).then(renderKey));
  $('ai-auto').addEventListener('change', (e) => save({ ai: { autoCheck: e.target.checked } }));
  $('ai-search').addEventListener('change', (e) => save({ ai: { webSearch: e.target.checked } }));
  for (const r of document.querySelectorAll('input[name="facts"]')) r.addEventListener('change', (e) => save({ ai: { facts: e.target.value } }));

  for (const [id, field] of [['m-writing', 'writingModel'], ['m-study', 'studyModel'], ['m-facts', 'factModel']]) {
    const select = $(id);
    for (const m of SE.settings.MODELS) select.append(el('option', { value: m.id }, `${m.name} · ${m.note}`));
    select.addEventListener('change', (e) => save({ ai: { [field]: e.target.value } }));
  }

  async function renderUsage() {
    const { usage } = await chrome.storage.local.get('usage');
    const month = new Date().toISOString().slice(0, 7);
    if (!usage || usage.month !== month || !usage.requests) {
      $('usage').textContent = '';
      return;
    }
    const tokens = usage.inputTokens + usage.outputTokens;
    $('usage').replaceChildren(
      `This month: ${usage.requests.toLocaleString()} AI ${usage.requests === 1 ? 'check' : 'checks'}`,
      usage.searches ? `, ${usage.searches.toLocaleString()} web ${usage.searches === 1 ? 'search' : 'searches'}` : '',
      `, about ${tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)} million` : tokens.toLocaleString()} tokens. Your exact bill is in the `,
      el('a', { href: 'https://console.anthropic.com/settings/usage', target: '_blank', rel: 'noopener noreferrer' }, 'Anthropic Console'), '.');
  }

  // ---------------------------------------------------------------------------
  // Writing, study mode, sites
  // ---------------------------------------------------------------------------

  const siteName = (h) => (h === 'file://' ? 'Local files' : h);

  function renderLists() {
    const goals = SE.rules.GOALS;
    const goalItems = Object.entries(s.siteGoals || {}).sort(([a], [b]) => a.localeCompare(b)).map(([host, goal]) => el('div', { class: 'item' },
      el('b', {}, siteName(host)),
      el('select', { class: 'select', 'aria-label': `Goal on ${siteName(host)}`, onchange: (e) => save({ siteGoals: { ...s.siteGoals, [host]: e.target.value } }) },
        ...goals.map((g) => el('option', { value: g.id, selected: g.id === goal }, g.name))),
      el('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => {
        const next = { ...s.siteGoals };
        delete next[host];
        chrome.storage.local.set({ settings: { ...s, siteGoals: next } }).then(load);
      } }, 'Reset')));
    $('goal-list').replaceChildren(...(goalItems.length ? goalItems : [el('p', { class: 'none' }, 'No sites changed yet.')]));

    const list = (items, empty, label, onRemove) => (items.length ? items.map((host) => el('div', { class: 'item' }, el('b', {}, siteName(host)),
      el('button', { class: 'btn btn-sm', type: 'button', onclick: () => onRemove(host) }, label))) : [el('p', { class: 'none' }, empty)]);
    $('study-list').replaceChildren(...list([...(s.studySites || [])].sort(), 'Study mode isn’t on for any site yet.', 'Turn off', (host) => save({ studySites: s.studySites.filter((x) => x !== host) })));
    $('site-list').replaceChildren(...list([...(s.disabledSites || [])].sort(), 'Study Engine is on for every site.', 'Turn back on', (host) => save({ disabledSites: s.disabledSites.filter((x) => x !== host) })));
  }

  function renderRules() {
    const disabled = new Set(s.disabledRules || []);
    const groups = {};
    for (const r of SE.rules.list()) (groups[r.category] ||= []).push(r);
    const order = ['correctness', 'clarity', 'engagement', 'tone'];
    $('rules').replaceChildren(...order.filter((c) => groups[c]).map((c) => el('div', { class: `rule-group k-${c}` },
      el('h4', {}, el('i', { class: 'dot' }), SE.rules.CATEGORIES[c].label),
      el('div', { class: 'grid' }, ...groups[c].map((r) => el('label', {},
        el('input', { type: 'checkbox', checked: !disabled.has(r.id), onchange: (e) => {
          const next = new Set(s.disabledRules || []);
          if (e.target.checked) next.delete(r.id);
          else next.add(r.id);
          save({ disabledRules: [...next] });
        } }), r.title))))));
  }

  function renderSwitches() {
    $('ai-enabled').checked = s.ai.enabled !== false;
    $('ai-auto').checked = s.ai.autoCheck !== false;
    $('ai-search').checked = s.ai.webSearch !== false;
    for (const r of document.querySelectorAll('input[name="facts"]')) r.checked = r.value === s.ai.facts;
    $('m-writing').value = s.ai.writingModel;
    $('m-study').value = s.ai.studyModel;
    $('m-facts').value = s.ai.factModel;
    for (const r of document.querySelectorAll('input[name="dialect"]')) r.checked = r.value === s.dialect;
    $('show-badge').checked = s.showBadge !== false;
    for (const c of ['clarity', 'engagement', 'tone']) $(`cat-${c}`).checked = s.categories?.[c] !== false;
    $('gl-enabled').checked = s.glossary !== false;
    $('enabled').checked = s.enabled !== false;
  }

  for (const r of document.querySelectorAll('input[name="dialect"]')) r.addEventListener('change', (e) => save({ dialect: e.target.value }));
  $('show-badge').addEventListener('change', (e) => save({ showBadge: e.target.checked }));
  for (const c of ['clarity', 'engagement', 'tone']) $(`cat-${c}`).addEventListener('change', (e) => save({ categories: { [c]: e.target.checked } }));
  $('gl-enabled').addEventListener('change', (e) => save({ glossary: e.target.checked }));
  $('enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }));

  // ---------------------------------------------------------------------------
  // Personal dictionary
  // ---------------------------------------------------------------------------

  async function renderDictionary() {
    const { personalDictionary = [] } = await chrome.storage.local.get('personalDictionary');
    $('dict-count').textContent = personalDictionary.length ? `${personalDictionary.length.toLocaleString()} ${personalDictionary.length === 1 ? 'word' : 'words'}` : '';
    $('dict-list').replaceChildren(...(personalDictionary.length ? personalDictionary.map((w) => el('span', { class: 'chip' }, w,
      el('button', { type: 'button', 'aria-label': `Remove ${w}`, title: 'Remove', onclick: async () => {
        const { personalDictionary: cur = [] } = await chrome.storage.local.get('personalDictionary');
        await chrome.storage.local.set({ personalDictionary: cur.filter((x) => x !== w) });
        toast(`Removed “${w}”.`, async () => {
          const { personalDictionary: now = [] } = await chrome.storage.local.get('personalDictionary');
          if (!now.includes(w)) await chrome.storage.local.set({ personalDictionary: [...now, w].sort((a, b) => a.localeCompare(b)) });
        });
      } }, '×'))) : [el('p', { class: 'none' }, 'No words yet.')]));
  }

  $('dict-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const word = $('dict-word').value.trim();
    if (!word) return;
    const r = await send('se:dict-add', { word });
    if (r?.ok) {
      $('dict-word').value = '';
      toast(`Added “${r.word}”.`);
    } else toast(r?.error?.message || 'Couldn’t add that word.');
  });

  // ---------------------------------------------------------------------------

  $('open-editor').addEventListener('click', () => send('se:open-editor'));

  function renderAll() {
    renderSwitches();
    renderLists();
    renderRules();
    renderKey();
  }

  async function load() {
    s = await SE.settings.load();
    renderAll();
    renderUsage();
    renderDictionary();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) {
      s = SE.settings.withDefaults(changes.settings.newValue);
      renderAll();
    }
    if (changes.personalDictionary) renderDictionary();
    if (changes.usage) renderUsage();
    if (changes.aiStatus) renderKey();
  });

  load();
})();
