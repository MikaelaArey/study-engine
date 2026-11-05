/*
 * Study Engine: settings, kept in chrome.storage.local under "settings".
 *
 * Shared by the service worker, the popup, the options page, the content scripts and the
 * editor. Missing keys fall back to DEFAULTS, so older saved settings keep working.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  if (SE.settings) return;

  const MODELS = [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Fastest and lowest cost' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', note: 'Older' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Balanced' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Most capable' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'Newest' },
  ];

  const DEFAULTS = {
    enabled: true,
    disabledSites: [],
    siteGoals: {}, // hostname -> goal id; otherwise the goal is chosen from the site
    dialect: 'en-US',
    categories: { correctness: true, clarity: true, engagement: true, tone: true },
    disabledRules: [],
    studySites: [], // hostnames where study mode (questions instead of fixes) is on
    showBadge: true,
    glossary: true, // definitions from your glossary as you type
    ai: {
      enabled: true, // used only once an API key is added
      autoCheck: true, // check paragraphs as you pause, rather than only on request
      facts: 'auto', // 'auto' | 'manual' | 'off'
      webSearch: true,
      writingModel: 'claude-haiku-5-5',
      studyModel: 'claude-sonnet-5-5',
      factModel: 'claude-sonnet-5-5',
    },
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  function merge(base, over) {
    if (!isObj(over)) return structuredClone(base);
    const out = structuredClone(base);
    for (const [k, v] of Object.entries(over)) {
      if (isObj(out[k]) && isObj(v)) out[k] = merge(out[k], v);
      else if (v !== undefined) out[k] = v;
    }
    return out;
  }

  const withDefaults = (stored) => merge(DEFAULTS, stored);

  async function load() {
    const { settings } = await chrome.storage.local.get('settings');
    return withDefaults(settings);
  }

  // Applies a partial change, such as { ai: { facts: 'manual' } }.
  async function update(patch) {
    const { settings } = await chrome.storage.local.get('settings');
    const next = merge(withDefaults(settings), patch);
    await chrome.storage.local.set({ settings: next });
    return next;
  }

  const goalFor = (s, host) => s.siteGoals?.[host] || SE.rules?.goalForSite(host) || 'general';
  const studyOn = (s, host) => (s.studySites || []).includes(host);
  const siteOn = (s, host) => s.enabled !== false && !(s.disabledSites || []).includes(host);

  SE.settings = { DEFAULTS, MODELS, load, update, withDefaults, merge, goalFor, studyOn, siteOn };
})();
