/*
 * Study Engine (content script): start-up and page events.
 *
 * Runs in every frame at document_start, so its key handlers run before the page's own. A
 * field gets a Session the first time it's focused. Hovering or clicking an underlined word
 * opens its card; the badge in the field's corner opens the assistant panel.
 */
(() => {
  'use strict';
  const SE = globalThis.StudyEngine;
  const C = SE?.content;
  if (!C || C.started) return;
  C.started = true;
  const UI = C.ui;

  // The site in the address bar. Fields in iframes follow the page around them.
  const SITE = (() => {
    try {
      const ancestors = location.ancestorOrigins;
      const top = ancestors?.length ? new URL(ancestors[ancestors.length - 1]) : location;
      return top.protocol === 'file:' ? 'file://' : top.hostname;
    } catch {
      return location.hostname;
    }
  })();

  C.state = { settings: SE.settings.withDefaults(null), aiStatus: null, site: SITE, sessions: new Map() };
  const sessions = C.state.sessions;
  const isOn = () => SE.settings.siteOn(C.state.settings, SITE);
  const orphaned = () => !chrome.runtime?.id;

  let loaded = false;
  let loading = null;
  function load() {
    if (loaded) return Promise.resolve();
    loading ||= chrome.storage.local.get(['settings', 'aiStatus', 'glossary']).then((r) => {
      C.state.settings = SE.settings.withDefaults(r.settings);
      C.state.aiStatus = r.aiStatus || null;
      C.glossary.setGlossary(r.glossary || []);
      loaded = true;
    }).catch(() => {});
    return loading;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !loaded) return;
    let refresh = false;
    if (changes.settings) {
      C.state.settings = SE.settings.withDefaults(changes.settings.newValue);
      refresh = true;
    }
    if (changes.aiStatus) {
      C.state.aiStatus = changes.aiStatus.newValue || null;
      refresh = true;
    }
    if (changes.glossary) C.glossary.setGlossary(changes.glossary.newValue || []);
    if (changes.personalDictionary) {
      for (const s of sessions.values()) s.resetSpelling();
      refresh = true;
    }
    if (!refresh) return;
    if (!isOn()) {
      for (const s of sessions.values()) s.destroy();
      sessions.clear();
      return;
    }
    for (const s of sessions.values()) {
      if (changes.settings || changes.aiStatus) s.aiError = null;
      s.changed('settings');
    }
  });

  function sessionFor(field, create = false) {
    let s = sessions.get(field);
    if (s && !s.alive()) {
      s.destroy();
      sessions.delete(field);
      s = null;
    }
    if (!s && create && loaded && isOn() && !orphaned()) {
      s = new C.Session(field, SITE);
      sessions.set(field, s);
    }
    return s || null;
  }

  const target = (e) => e.composedPath()[0] || e.target;

  // ---------------------------------------------------------------------------
  // Focus and typing
  // ---------------------------------------------------------------------------

  document.addEventListener('focusin', (e) => {
    if (UI.isOurs(e) || orphaned()) return;
    const field = C.fieldFor(target(e));
    if (!field) return;
    load().then(() => {
      const s = sessionFor(field, true);
      s?.reposition(true);
    });
  }, true);

  document.addEventListener('focusout', (e) => {
    if (UI.isOurs(e)) return;
    const field = C.fieldFor(target(e));
    if (field && C.glossary.fieldIs(field)) C.glossary.hide();
    setTimeout(() => {
      for (const s of sessions.values()) s.reposition(true);
    }, 0);
  }, true);

  let inputSinceKeydown = false;
  document.addEventListener('input', (e) => {
    inputSinceKeydown = true;
    if (UI.isOurs(e) || orphaned()) return;
    const field = C.fieldFor(target(e));
    if (!field) return;
    if (!loaded) {
      load().then(() => sessionFor(field, true));
      return;
    }
    if (!e.isComposing && !C.glossary.isSelfInsert()) C.glossary.check(field, !e.inputType || e.inputType.startsWith('insert'));
    const s = sessionFor(field, true);
    if (!s) return;
    if (UI.cardFor()?.S === s && !UI.cardFor().pinned) UI.hideCard();
    s.changed('input');
  }, true);

  document.addEventListener('compositionend', (e) => {
    const field = C.fieldFor(target(e));
    if (field && loaded) {
      C.glossary.check(field, true);
      sessionFor(field)?.changed('input');
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    inputSinceKeydown = false;
    if (UI.isOurs(e)) {
      // Typing in Study Engine's own boxes: handle it, and keep the page's shortcuts out of it.
      UI.handleKey(e);
      e.stopImmediatePropagation();
      return;
    }
    if (orphaned()) return;
    const field = C.fieldFor(target(e));
    if (C.glossary.onKeydown(e, field)) return;
    const open = UI.cardFor();
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      UI.hideCard();
      return;
    }
    if (open && !open.pinned && field === open.S.field && !e.metaKey && !e.ctrlKey) UI.hideCard();
  }, true);

  window.addEventListener('keyup', (e) => {
    if (UI.isOurs(e)) {
      e.stopImmediatePropagation();
      return;
    }
    if (inputSinceKeydown || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || orphaned()) return;
    const field = C.fieldFor(target(e));
    if (!field) return;
    // Some editors cancel the native input event and update the DOM themselves.
    if (e.key.length === 1) C.glossary.check(field, true);
    sessionFor(field)?.changed('input');
  }, true);

  for (const type of ['keypress']) {
    window.addEventListener(type, (e) => {
      if (UI.isOurs(e)) e.stopImmediatePropagation();
    }, true);
  }

  // ---------------------------------------------------------------------------
  // Pointer: hover shows a suggestion, a click into an underline opens it
  // ---------------------------------------------------------------------------

  document.addEventListener('mousedown', (e) => {
    if (UI.isOurs(e)) return;
    if (C.glossary.showing()) C.glossary.hide();
    const open = UI.cardFor();
    if (open) UI.hideCard();
  }, true);

  document.addEventListener('mouseup', (e) => {
    if (UI.isOurs(e) || e.button !== 0) return;
    const field = C.fieldFor(target(e));
    const s = field && sessionFor(field);
    if (!s) return;
    const x = e.clientX;
    const y = e.clientY;
    setTimeout(() => {
      if (!s.alive()) return;
      const hit = s.hit(x, y);
      const issue = hit?.issue || s.issueAtCaret();
      if (!issue) return;
      const anchor = hit?.rect || s.anchorFor(issue);
      if (anchor) UI.showCard(s, issue, anchor, { pinned: true });
    }, 0);
  }, true);

  let hoverTimer = 0;
  let hoverKey = null;
  let moveQueued = false;
  let lastMove = null;
  document.addEventListener('mousemove', (e) => {
    if (!sessions.size) return;
    lastMove = { x: e.clientX, y: e.clientY, ours: UI.isOurs(e) };
    if (moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(onMove);
  }, { capture: true, passive: true });

  function onMove() {
    moveQueued = false;
    const m = lastMove;
    if (!m || m.ours) {
      clearTimeout(hoverTimer);
      return;
    }
    let found = null;
    for (const s of sessions.values()) {
      if (!s.alive()) continue;
      const vis = s.visible();
      const inside = !!vis && C.within(vis, m.x, m.y);
      if (inside !== !!s.hovered) {
        s.hovered = inside;
        s.reposition(true);
      }
      if (!inside) continue;
      const hit = s.hit(m.x, m.y);
      if (hit) found = { s, ...hit };
      break;
    }
    const open = UI.cardFor();
    if (found) {
      const key = `${found.issue.id}`;
      if (open && open.S === found.s && open.issue.id === found.issue.id) {
        clearTimeout(hoverTimer);
        return;
      }
      if (hoverKey === key) return;
      hoverKey = key;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (found.s.alive()) UI.showCard(found.s, found.issue, found.rect);
      }, open ? 120 : 280);
    } else {
      hoverKey = null;
      clearTimeout(hoverTimer);
      if (open && !open.pinned && !UI.cardHovered()) UI.scheduleHide();
    }
  }

  // ---------------------------------------------------------------------------
  // Keeping everything in place
  // ---------------------------------------------------------------------------

  let repositionQueued = false;
  function queueReposition() {
    if (repositionQueued) return;
    repositionQueued = true;
    requestAnimationFrame(() => {
      repositionQueued = false;
      for (const s of sessions.values()) s.reposition();
      C.glossary.reposition();
      const open = UI.cardFor();
      if (open) {
        const anchor = open.S.anchorFor(open.issue);
        if (!anchor) UI.hideCard();
        else UI.moveCard(anchor);
      }
    });
  }
  window.addEventListener('scroll', queueReposition, { capture: true, passive: true });
  window.addEventListener('resize', queueReposition, { passive: true });

  // Pages move fields around without scrolling (a compose window opening, a sidebar). A light
  // check keeps up, and drops sessions whose fields are gone.
  const timer = setInterval(() => {
    if (orphaned()) {
      clearInterval(timer);
      for (const s of sessions.values()) s.destroy();
      sessions.clear();
      UI.hostEl()?.remove();
      return;
    }
    for (const [field, s] of sessions) {
      if (!s.alive()) {
        s.destroy();
        sessions.delete(field);
      } else s.reposition();
    }
  }, 400);

  // ---------------------------------------------------------------------------
  // Messages from the toolbar popup
  // ---------------------------------------------------------------------------

  if (window === window.top) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender.id !== chrome.runtime.id) return;
      if (message?.type === 'se:get-site') {
        const field = [...sessions.keys()].find((f) => f.isConnected);
        sendResponse({ site: SITE, fields: sessions.size, hasField: !!field });
      } else if (message?.type === 'se:open-assistant') {
        const s = [...sessions.values()].find((x) => x.alive() && x.model.focused()) || [...sessions.values()].find((x) => x.alive());
        if (s) UI.openPanel(s);
        sendResponse({ opened: !!s });
      }
    });
  }

  // A field that was focused before this script loaded.
  load().then(() => {
    const a = document.activeElement;
    const field = a && C.fieldFor(a);
    if (field) sessionFor(field, true)?.reposition(true);
  });
})();
