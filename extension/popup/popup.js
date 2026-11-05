/*
 * Study Engine: toolbar popup.
 *
 * Switches for everywhere and for this site, study mode and the goal for this site, AI status,
 * and buttons to the editor and settings. The extension can't read tab addresses, so it asks
 * the page's content script which site it's on; on pages it can't run on, nothing answers.
 */
(() => {
  'use strict';
  const SE = globalThis.StudyEngine;
  const $ = (id) => document.getElementById(id);
  let site = null;
  let tabId = null;
  let hasField = false;
  let s = SE.settings.withDefaults(null);

  async function currentSite() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab?.id ?? null;
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'se:get-site' }, { frameId: 0 });
      hasField = !!reply?.hasField;
      return reply?.site || null;
    } catch {
      return null;
    }
  }

  function render(aiStatus, usage) {
    const on = s.enabled !== false;
    $('enabled').checked = on;
    $('enabled-desc').textContent = on ? 'On all sites' : 'Off on all sites';
    const here = !!site;
    const siteOn = here && on && !(s.disabledSites || []).includes(site);
    $('site-enabled').checked = here && !(s.disabledSites || []).includes(site);
    $('site-enabled').disabled = !here || !on;
    $('site-row').classList.toggle('unavailable', !here);
    $('site-name').textContent = here ? (site === 'file://' ? 'Local files' : site) : 'Not available on this page. If you just installed or reloaded Study Engine, reload the page.';
    $('study-row').hidden = !siteOn;
    $('goal-row').hidden = !siteOn;
    if (siteOn) {
      $('study').checked = SE.settings.studyOn(s, site);
      const goal = SE.settings.goalFor(s, site);
      $('goal').replaceChildren(...SE.rules.GOALS.map((g) => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = g.name;
        o.selected = g.id === goal;
        return o;
      }));
    }
    $('open-assistant').hidden = !(siteOn && hasField);
    const ready = !!aiStatus?.ready;
    $('ai-pill').className = `pill ${ready ? 'pill-good' : 'pill-quiet'}`;
    $('ai-text').textContent = ready ? 'AI on' : 'AI off';
    $('ai-box').hidden = !!aiStatus?.keyAdded;
    const month = new Date().toISOString().slice(0, 7);
    $('usage').textContent = usage?.month === month && usage.requests ? `${usage.requests.toLocaleString()} AI checks this month` : '';
  }

  async function refresh() {
    const { settings, aiStatus, usage } = await chrome.storage.local.get(['settings', 'aiStatus', 'usage']);
    s = SE.settings.withDefaults(settings);
    render(aiStatus, usage);
  }

  $('enabled').addEventListener('change', async (e) => {
    await SE.settings.update({ enabled: e.target.checked });
    refresh();
  });
  $('site-enabled').addEventListener('change', async (e) => {
    const others = (s.disabledSites || []).filter((x) => x !== site);
    await SE.settings.update({ disabledSites: e.target.checked ? others : [...others, site] });
    refresh();
  });
  $('study').addEventListener('change', async (e) => {
    const list = new Set(s.studySites || []);
    if (e.target.checked) list.add(site);
    else list.delete(site);
    await SE.settings.update({ studySites: [...list] });
    refresh();
  });
  $('goal').addEventListener('change', async (e) => {
    await SE.settings.update({ siteGoals: { ...(s.siteGoals || {}), [site]: e.target.value } });
    refresh();
  });
  $('open-editor').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'se:open-editor' }, () => window.close());
  });
  $('open-assistant').addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'se:open-assistant' }, { frameId: 0 });
    } catch {}
    window.close();
  });
  const openSettings = () => chrome.runtime.openOptionsPage().finally(() => window.close());
  $('settings').addEventListener('click', openSettings);
  $('add-key').addEventListener('click', openSettings);

  (async () => {
    site = await currentSite();
    await refresh();
  })();
})();
