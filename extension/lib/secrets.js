/*
 * Study Engine: secrets (the Anthropic API key).
 *
 * Kept in IndexedDB on the extension's own origin. Only extension pages and the service worker
 * can open it; content scripts run on the page's origin and never see it.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  if (SE.secrets) return;

  const DB = 'study-engine';
  const STORE = 'secrets';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }

  const get = (name) => run('readonly', (s) => s.get(name));
  const set = (name, value) => run('readwrite', (s) => s.put(value, name));
  const remove = (name) => run('readwrite', (s) => s.delete(name));

  SE.secrets = { get, set, remove };
})();
