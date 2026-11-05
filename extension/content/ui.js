/*
 * Study Engine (content script): the interface drawn on web pages.
 *
 * One closed shadow root per frame holds everything: the mirrors over text fields, the badge
 * in each field's corner, the suggestion card and the assistant panel. Page CSS can't reach
 * in, and pages can't read it. Built with createElement only (no innerHTML), so it works on
 * pages that enforce Trusted Types, and page text is only ever set as text.
 */
(() => {
  'use strict';
  const SE = (globalThis.StudyEngine ||= {});
  const C = (SE.content ||= {});
  if (C.ui) return;

  const CAT = {
    correctness: { label: 'Correctness', color: '#e3434a' },
    clarity: { label: 'Clarity', color: '#2a6ef0' },
    engagement: { label: 'Engagement', color: '#0f9e63' },
    tone: { label: 'Tone', color: '#7a4ff2' },
    facts: { label: 'Facts', color: '#e8590c' },
    study: { label: 'Study', color: '#2a6ef0' },
  };
  const KIND = { remember: 'Remember', reason: 'Reason', words: 'Words' };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    .root {
      --bg: #ffffff; --surface-2: #f6f8f7; --surface-3: #edf2ef; --line: #e2e8e4; --line-2: #cdd6d1;
      --ink: #14211b; --ink-2: #485a52; --ink-3: #6f7f78;
      --brand: #15b585; --brand-strong: #0a7c5b; --brand-hover: #086a4e; --brand-soft: #e4f6ee; --brand-ink: #07704f;
      --k-correctness: #e3434a; --k-clarity: #2a6ef0; --k-engagement: #0f9e63; --k-tone: #7a4ff2; --k-facts: #e8590c; --k-study: #2a6ef0;
      --good: #0f9e63; --good-soft: #e3f6ec; --warn: #b97800; --warn-soft: #fdf2d8; --bad: #d23a3f; --bad-soft: #fde9e9;
      --shadow: 0 2px 6px rgba(20, 44, 34, 0.08), 0 14px 36px rgba(20, 44, 34, 0.16);
      font: 400 13.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: var(--ink); -webkit-font-smoothing: antialiased; text-align: left; letter-spacing: normal;
    }
    button, input, textarea, select { font: inherit; color: inherit; letter-spacing: normal; }
    button { cursor: pointer; }
    .k-correctness { --k: var(--k-correctness); } .k-clarity { --k: var(--k-clarity); } .k-engagement { --k: var(--k-engagement); }
    .k-tone { --k: var(--k-tone); } .k-facts { --k: var(--k-facts); } .k-study { --k: var(--k-study); }

    /* Mirrors over textareas and inputs */
    .mirror-box { position: fixed; overflow: hidden; pointer-events: none; z-index: 1; }
    .mirror { position: absolute; top: 0; left: 0; margin: 0; border: 0; box-sizing: border-box; color: transparent; background: transparent;
      overflow: visible; pointer-events: none; user-select: none; }
    .u { text-decoration-line: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; text-decoration-skip-ink: none;
      text-decoration-color: var(--k); border-radius: 2px; }
    .u-correctness { --k: var(--k-correctness); } .u-clarity { --k: var(--k-clarity); } .u-engagement { --k: var(--k-engagement); }
    .u-tone { --k: var(--k-tone); } .u-facts { --k: var(--k-facts); text-decoration-style: dashed; }
    .u-study { --k: var(--k-study); text-decoration-style: dotted; text-decoration-thickness: 3px; }
    .u.focus { background-color: color-mix(in srgb, var(--k) 16%, transparent); }
    .w { text-decoration: underline dotted 1px rgba(42, 110, 240, 0.55); text-underline-offset: 4px; }
    .w.focus { background-color: rgba(42, 110, 240, 0.08); }

    /* Buttons */
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 5px 11px; border: 1px solid var(--line-2);
      border-radius: 8px; background: var(--bg); color: var(--ink); font-weight: 600; font-size: 13px; line-height: 1.2; white-space: nowrap; }
    .btn:hover { background: var(--surface-2); }
    .btn:disabled { opacity: 0.55; cursor: default; }
    .btn-primary { border-color: var(--brand-strong); background: var(--brand-strong); color: #fff; }
    .btn-primary:hover { background: var(--brand-hover); border-color: var(--brand-hover); }
    .btn-soft { border-color: transparent; background: var(--brand-soft); color: var(--brand-ink); }
    .btn-soft:hover { background: #d3efe3; }
    .btn-ghost { border-color: transparent; background: none; color: var(--ink-2); }
    .btn-ghost:hover { background: var(--surface-3); color: var(--ink); }
    .btn svg { width: 15px; height: 15px; flex: none; }
    .icon-btn { display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; background: none; color: var(--ink-3); }
    .icon-btn:hover { background: var(--surface-3); color: var(--ink); }
    .icon-btn svg { width: 16px; height: 16px; }
    :focus-visible { outline: 2px solid var(--brand-strong); outline-offset: 2px; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .grow { flex: 1 1 auto; }
    .pill { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
    .pill-good { background: var(--good-soft); color: var(--good); } .pill-warn { background: var(--warn-soft); color: var(--warn); }
    .pill-bad { background: var(--bad-soft); color: var(--bad); } .pill-quiet { background: var(--surface-3); color: var(--ink-2); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--k, var(--line-2)); flex: none; }
    .mark { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--brand); flex: none; }
    .mark svg { width: 13px; height: 13px; }

    /* Suggestion card */
    .card { position: fixed; z-index: 4; width: 340px; max-width: calc(100vw - 16px); max-height: min(70vh, 520px); overflow: auto;
      border: 1px solid var(--line); border-radius: 12px; background: var(--bg); box-shadow: var(--shadow); opacity: 0; transform: translateY(-3px);
      transition: opacity 120ms ease, transform 120ms ease; pointer-events: auto; }
    .card.visible { opacity: 1; transform: none; }
    .card-top { display: flex; align-items: center; gap: 8px; padding: 10px 10px 0 14px; }
    .card-kind { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
    .card-body { display: grid; gap: 9px; padding: 6px 14px 12px; }
    .card-title { font-weight: 650; font-size: 14px; }
    .change { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 14px; }
    .change del { color: var(--ink-3); text-decoration-thickness: 1.5px; overflow-wrap: anywhere; }
    .k-correctness .change del { color: var(--bad); }
    .sugg { border: 0; border-radius: 7px; padding: 4px 10px; background: var(--brand-strong); color: #fff; font-weight: 700; font-size: 14px; max-width: 100%; overflow-wrap: anywhere; text-align: left; }
    .sugg:hover { background: var(--brand-hover); }
    .sugg.alt { background: var(--brand-soft); color: var(--brand-ink); }
    .sugg.alt:hover { background: #d3efe3; }
    .msg { color: var(--ink-2); font-size: 13px; }
    .quote { font-size: 13.5px; padding: 6px 10px; border-left: 3px solid var(--k, var(--line-2)); background: var(--surface-2); border-radius: 0 6px 6px 0; overflow-wrap: anywhere; }
    .card-foot { display: flex; align-items: center; gap: 2px; padding: 7px 8px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 12px 12px; }
    .card-foot .btn { padding: 4px 9px; }
    .card-foot .grow { flex: 1 1 auto; }
    .card-foot .mark { width: 18px; height: 18px; border-radius: 5px; margin: 0 4px 0 2px; }
    .card-foot .mark svg { width: 12px; height: 12px; }
    .sources { display: grid; gap: 7px; margin: 0; padding: 0; list-style: none; }
    .sources li { display: grid; gap: 1px; }
    .sources a { color: var(--brand-ink); font-size: 13px; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; overflow-wrap: anywhere; }
    .sources small { color: var(--ink-3); font-size: 11.5px; }
    .note { font-size: 12px; color: var(--ink-3); }
    .answer { width: 100%; min-height: 64px; padding: 8px 10px; border: 1.5px solid var(--line-2); border-radius: 8px; background: var(--bg); resize: vertical; font-size: 14px; line-height: 1.45; }
    .answer:focus, .input:focus { outline: none; border-color: var(--brand-strong); box-shadow: 0 0 0 3px var(--brand-soft); }
    .input { width: 100%; min-height: 32px; padding: 5px 10px; border: 1.5px solid var(--line-2); border-radius: 8px; background: var(--bg); font-size: 14px; }
    .feedback { display: grid; gap: 4px; padding: 8px 10px; border-radius: 8px; background: var(--surface-2); font-size: 13px; }
    .feedback.correct { background: var(--good-soft); }
    .feedback .pill { justify-self: start; }
    .reveal { padding: 8px 10px; border-left: 3px solid var(--brand); background: var(--surface-2); border-radius: 0 8px 8px 0; font-size: 13px; }
    .hint-box { font-size: 12.5px; color: var(--ink-2); background: var(--surface-3); border-radius: 8px; padding: 8px 10px; }
    .word-head { display: flex; align-items: baseline; gap: 8px; }
    .word-head b { font-size: 17px; }
    .def { font-size: 13px; color: var(--ink-2); }
    .def b { color: var(--ink); }

    /* Badge */
    .badge { position: fixed; z-index: 2; display: grid; place-items: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%;
      background: var(--brand); box-shadow: 0 1px 3px rgba(20, 44, 34, 0.25); pointer-events: auto; transition: transform 120ms ease; }
    .badge:hover { transform: scale(1.08); }
    .badge svg { width: 15px; height: 15px; }
    .badge .count { position: absolute; top: -6px; right: -7px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--k-correctness);
      color: #fff; font: 700 10.5px/17px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px #fff; }
    .badge .count.calm { background: var(--brand-strong); }
    .badge.busy::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--brand-strong); animation: spin 0.9s linear infinite; }
    .badge.off { background: #9aa7a1; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Assistant panel */
    .panel { position: fixed; z-index: 5; top: 14px; right: 14px; bottom: 14px; width: 368px; max-width: calc(100vw - 28px); display: flex; flex-direction: column;
      border: 1px solid var(--line); border-radius: 14px; background: var(--bg); box-shadow: var(--shadow); pointer-events: auto; overflow: hidden; }
    .p-head { display: flex; align-items: center; gap: 9px; padding: 12px 12px 10px 14px; border-bottom: 1px solid var(--line); }
    .p-head .mark { width: 26px; height: 26px; border-radius: 8px; }
    .p-head .mark svg { width: 16px; height: 16px; }
    .p-title { font-weight: 700; font-size: 15px; }
    .p-sub { font-size: 12px; color: var(--ink-3); }
    .p-scroll { flex: 1 1 auto; overflow-y: auto; padding: 12px 12px 16px; display: grid; gap: 12px; align-content: start; background: var(--surface-2); }
    .score { display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); }
    .ring { position: relative; width: 52px; height: 52px; flex: none; }
    .ring svg { width: 52px; height: 52px; transform: rotate(-90deg); }
    .ring b { position: absolute; inset: 0; display: grid; place-items: center; font-size: 15px; font-weight: 750; font-variant-numeric: tabular-nums; }
    .score h3 { margin: 0; font-size: 14px; }
    .score p { margin: 2px 0 0; font-size: 12.5px; color: var(--ink-2); }
    .controls { display: grid; gap: 8px; }
    .seg { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--surface-3); gap: 2px; }
    .seg button { border: 0; background: none; padding: 4px 11px; border-radius: 7px; font-weight: 650; font-size: 12.5px; color: var(--ink-2); }
    .seg button[aria-pressed="true"] { background: var(--bg); color: var(--ink); box-shadow: 0 1px 2px rgba(20, 44, 34, 0.08); }
    .field-row { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); font-weight: 600; }
    select.select { min-height: 30px; padding: 4px 8px; border: 1px solid var(--line-2); border-radius: 8px; background: var(--bg); font-size: 13px; font-weight: 600; }
    .filters { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 3px; }
    .filter { border: 0; background: none; padding: 5px 1px 6px; border-radius: 8px; display: grid; gap: 3px; justify-items: center; font-size: 10.5px; font-weight: 650; color: var(--ink-3); }
    .filter b { font-size: 14px; color: var(--ink); font-variant-numeric: tabular-nums; }
    .filter::after { content: ""; width: 70%; height: 3px; border-radius: 2px; background: var(--k, var(--line-2)); }
    .filter[aria-pressed="true"] { background: var(--bg); box-shadow: 0 1px 2px rgba(20, 44, 34, 0.08); color: var(--ink); }
    .filter:disabled { opacity: 0.4; cursor: default; }
    .item { border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
    .item.open { border-color: color-mix(in srgb, var(--k) 45%, var(--line)); box-shadow: 0 2px 10px rgba(20, 44, 34, 0.08); }
    .item-head { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 11px; border: 0; background: none; text-align: left; }
    .item-head .t { flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 13px; }
    .item-head .o { color: var(--ink-3); font-size: 12.5px; max-width: 42%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item .card-body { padding: 0 11px 11px; }
    .empty { display: grid; justify-items: center; gap: 6px; padding: 22px 12px; text-align: center; color: var(--ink-2); font-size: 13px; }
    .empty b { color: var(--ink); font-size: 14px; }
    .empty svg { width: 28px; height: 28px; color: var(--brand); }
    .sec { display: grid; gap: 8px; }
    .sec-h { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-3); }
    .status { font-size: 12.5px; color: var(--ink-2); }
    .status.error { color: var(--bad); }
    .stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .stat { padding: 8px; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); }
    .stat b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; }
    .stat span { font-size: 11.5px; color: var(--ink-3); }
    .tones { display: flex; flex-wrap: wrap; gap: 5px; }
    .tones span { padding: 2px 9px; border-radius: 999px; background: var(--brand-soft); color: var(--brand-ink); font-size: 12px; font-weight: 650; }
    .p-foot { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--line); background: var(--bg); }
    .spinner { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line-2); border-top-color: var(--brand-strong); animation: spin 0.8s linear infinite; flex: none; }

    /* Glossary card */
    .gcard { position: fixed; z-index: 4; width: max-content; min-width: 240px; max-width: min(360px, calc(100vw - 16px)); padding: 11px 13px;
      border: 1px solid var(--line); border-radius: 11px; background: var(--bg); box-shadow: var(--shadow); opacity: 0; transform: translateY(-3px);
      transition: opacity 140ms ease, transform 140ms ease; pointer-events: none; }
    .gcard.visible { opacity: 1; transform: none; pointer-events: auto; }
    .gcard.fading { transition-duration: 400ms; }
    .gterm { margin: 0 0 3px; padding-right: 22px; font-weight: 700; font-size: 13.5px; }
    .gdef { margin: 0; max-height: 40vh; overflow: auto; }
    .gnotes { margin: 8px 0 0; padding: 8px 0 0; border-top: 1px solid var(--line); color: var(--ink-2); font-size: 12.5px; max-height: 30vh; overflow: auto; white-space: pre-line; }
    .gactions { display: flex; align-items: center; gap: 10px; margin-top: 9px; }
    .gclose { position: absolute; top: 6px; right: 6px; }
    kbd { font: inherit; font-size: 11px; padding: 1px 6px; border-radius: 4px; border: 1px solid var(--line); background: var(--surface-2); }
    .link { border: 0; background: none; padding: 0; color: var(--brand-ink); font-weight: 650; font-size: 12.5px; }
    .link:hover { text-decoration: underline; }

    .toast { position: fixed; z-index: 6; left: 50%; bottom: 22px; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 9px 14px; border-radius: 10px;
      background: var(--ink); color: #fff; font-size: 13px; font-weight: 600; box-shadow: var(--shadow); pointer-events: auto; display: flex; gap: 12px; align-items: center; }
    .toast button { border: 0; background: none; color: #9be7c9; font-weight: 700; padding: 0; }
    @media (prefers-reduced-motion: reduce) { .card, .gcard, .badge { transition: none; } .badge.busy::after, .spinner { animation-duration: 2.4s; } }
  `;

  // ---------------------------------------------------------------------------
  // Building elements
  // ---------------------------------------------------------------------------

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'disabled' || k === 'hidden') el[k] = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false || c === true) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  const SVGNS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    close: ['M6 6l12 12M18 6L6 18'],
    check: ['M5 12.5l4.2 4.2L19 7'],
    spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z'],
    open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
    search: ['M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z', 'M20 20l-4.8-4.8'],
    gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    book: ['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z', 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3'],
  };
  function icon(name) {
    const s = document.createElementNS(SVGNS, 'svg');
    for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.9', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) s.setAttribute(k, v);
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', d);
      s.append(p);
    }
    return s;
  }
  // The Study Engine mark: three white bars.
  function logo() {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    for (const [y, w] of [[5.5, 16], [10.6, 12], [15.7, 7.5]]) {
      const r = document.createElementNS(SVGNS, 'rect');
      for (const [k, v] of Object.entries({ x: 4, y, width: w, height: 2.8, rx: 1.4, fill: '#ffffff' })) r.setAttribute(k, String(v));
      s.append(r);
    }
    return s;
  }
  const mark = () => h('span', { class: 'mark' }, logo());

  // ---------------------------------------------------------------------------
  // The layer
  // ---------------------------------------------------------------------------

  let host = null;
  let shadow = null;
  let root = null;
  const layers = {};

  function ensure() {
    if (root) {
      if (!host.isConnected) document.documentElement.append(host);
      return layers;
    }
    host = document.createElement('study-engine-ui');
    host.style.cssText = 'all: initial !important; display: block !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; pointer-events: none !important;';
    shadow = host.attachShadow({ mode: 'closed' });
    // A constructed stylesheet isn't blocked by a page's Content-Security-Policy, as a <style>
    // element can be. Fall back to one where constructed sheets aren't available.
    let style = null;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      style = document.createElement('style');
      style.textContent = CSS;
    }
    root = h('div', { class: 'root' });
    layers.mirrors = h('div', { class: 'layer' });
    layers.badges = h('div', { class: 'layer' });
    layers.cards = h('div', { class: 'layer' });
    root.append(layers.mirrors, layers.badges, layers.cards);
    if (style) shadow.append(style);
    shadow.append(root);
    document.documentElement.append(host);
    // Clicks in Study Engine's interface keep the caret in the page's field, except in inputs.
    root.addEventListener('mousedown', (e) => {
      const t = e.composedPath()[0];
      if (!(t instanceof HTMLElement) || !t.closest('textarea, input, select, a')) e.preventDefault();
      e.stopPropagation();
    });
    for (const type of ['mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'input', 'beforeinput', 'focusin', 'focusout']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }
    return layers;
  }
  const isOurs = (e) => !!host && e.composedPath().includes(host);
  const hostEl = () => host;
  const activeInUI = () => shadow?.activeElement || null;

  // Keys typed in Study Engine's own boxes. main.js calls this from a window listener that runs
  // before the page's, and then stops the event, so site shortcuts (like Gmail's) don't fire
  // while someone types an answer. Typing still works: it's the browser's default action.
  function handleKey(e) {
    const t = activeInUI();
    if (e.type !== 'keydown') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (cardState) hideCard();
      else closePanel();
      return;
    }
    if (e.key === 'Enter' && t?._seEnter && (t.tagName === 'INPUT' || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      t._seEnter();
    }
  }
  const onEnter = (el, fn) => {
    el._seEnter = fn;
    return el;
  };

  // ---------------------------------------------------------------------------
  // Positioning
  // ---------------------------------------------------------------------------

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Below the anchor, or above it when there's no room below. Stays on screen.
  function place(el, anchor, gap = 8) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const { width, height } = el.getBoundingClientRect();
    let top = anchor.bottom + gap;
    if (top + height > vh - 8 && anchor.top - gap - height >= 8) top = anchor.top - gap - height;
    el.style.left = `${clamp(anchor.left - 12, 8, vw - width - 8)}px`;
    el.style.top = `${clamp(top, 8, Math.max(8, vh - height - 8))}px`;
  }

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  let toastEl = null;
  let toastTimer = 0;
  function toast(text, action) {
    ensure();
    toastEl?.remove();
    toastEl = h('div', { class: 'toast', role: 'status' }, h('span', {}, text), action ? h('button', { type: 'button', onclick: () => { toastEl?.remove(); action.run(); } }, action.label) : null);
    root.append(toastEl);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.remove(), action ? 7000 : 3500);
  }

  // ---------------------------------------------------------------------------
  // Suggestion content, shared by the card and the panel
  // ---------------------------------------------------------------------------

  const VERDICT = {
    correct: ['Right', 'pill-good'], partial: ['Partly right', 'pill-warn'], incorrect: ['Not yet', 'pill-bad'],
    no_attempt: ['Have a go', 'pill-quiet'], error: ['Couldn’t check', 'pill-quiet'],
  };
  const FACT_TITLE = { incorrect: 'Recheck this fact', misleading: 'Recheck this claim', unverified: 'Couldn’t verify this' };

  function kindLabel(i) {
    if (i.category === 'study') return KIND[i.kind] || 'Question';
    if (i.category === 'facts') return 'Fact check';
    return CAT[i.category]?.label || 'Suggestion';
  }

  function feedbackEl(r) {
    const [label, cls] = VERDICT[r.verdict] || VERDICT.error;
    return h('div', { class: `feedback${r.verdict === 'correct' ? ' correct' : ''}`, 'aria-live': 'polite' },
      h('span', { class: `pill ${cls}` }, label), r.feedback ? h('div', {}, r.feedback) : null, r.hint ? h('div', { class: 'msg' }, `Hint: ${r.hint}`) : null);
  }

  // The body of a suggestion: what's wrong and what to do. `S` is the session.
  function body(S, i) {
    if (i.category === 'facts') return factBody(S, i);
    if (i.category === 'study') return i.kind === 'words' && i.word ? wordBody(S, i) : questionBody(S, i);
    if (i.coach && S.studyMode) return coachBody(S, i);
    const parts = [];
    if (i.replacements.length) {
      parts.push(h('div', { class: 'change' },
        i.original.trim() && !i.whole ? h('del', {}, i.original) : null,
        i.original.trim() && !i.whole ? h('span', { class: 'note', 'aria-hidden': 'true' }, '→') : null,
        ...i.replacements.slice(0, 4).map((r, n) => h('button', { class: `sugg${n ? ' alt' : ''}`, type: 'button', title: 'Accept', onclick: () => S.accept(i, r) }, r.trim() ? r : r === '' ? 'Remove' : '␣'))));
    }
    if (i.message) parts.push(h('div', { class: 'msg' }, i.message));
    if (S.studyMode && !i.replacements.length && i.category !== 'correctness') parts.push(h('div', { class: 'hint-box' }, 'Study mode: fix this one yourself. The underline clears when it’s fixed.'));
    return parts;
  }

  function footActions(S, i) {
    const acts = [];
    if (i.rule === 'spelling' && i.word) acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => S.addWord(i) }, 'Add to dictionary'));
    if (i.category === 'facts') acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => S.dismiss(i) }, 'I’ve checked it'));
    else if (i.category === 'study') acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => S.dismiss(i) }, 'Not now'));
    else acts.push(h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => S.dismiss(i) }, 'Dismiss'));
    return acts;
  }

  function factBody(S, i) {
    const parts = [h('div', { class: 'quote k-facts' }, `“${i.original}”`)];
    if (i.message) parts.push(h('div', {}, i.message));
    if (i.correction) parts.push(h('div', { class: 'msg' }, h('b', {}, 'What sources say: '), i.correction));
    if (i.sources?.length) {
      parts.push(h('ul', { class: 'sources' }, ...i.sources.map((s) => {
        let site = '';
        try { site = new URL(s.url).hostname.replace(/^www\./, ''); } catch {}
        return h('li', {}, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title || site), site && s.title !== site ? h('small', {}, site) : null);
      })));
    } else {
      parts.push(h('div', { class: 'note' }, i.searched ? 'No single source settled it. Look it up before you rely on it.' : 'Checked against Claude’s knowledge, without a web search. Look it up before you rely on it.'));
    }
    parts.push(h('div', { class: 'note' }, 'Study Engine never changes your facts for you. Check a source, then edit it yourself.'));
    return parts;
  }

  function questionBody(S, i) {
    const st = (i.study ||= { answer: '', attempts: 0, hintsUsed: 0 });
    const done = st.done;
    const parts = [h('div', { class: 'card-title' }, i.question)];
    if (!done) {
      parts.push(onEnter(h('textarea', {
        class: 'answer', rows: '3', placeholder: 'Your answer stays here, not in your text', value: st.answer, 'aria-label': 'Your answer',
        oninput: (e) => { st.answer = e.target.value; },
      }), () => S.answer(i)));
    }
    if (st.result) parts.push(feedbackEl(st.result));
    if (st.hintsUsed && !done && i.hint) parts.push(h('div', { class: 'hint-box' }, `Hint: ${i.hint}`));
    if (st.revealed && i.reveal) parts.push(h('div', { class: 'reveal' }, i.reveal));
    const row = h('div', { class: 'row' });
    if (!done) {
      row.append(
        h('button', { class: 'btn btn-primary', type: 'button', disabled: st.busy, onclick: () => S.answer(i) }, st.busy ? 'Checking…' : st.attempts ? 'Try again' : 'Answer'),
        i.hint && !st.hintsUsed ? h('button', { class: 'btn', type: 'button', onclick: () => { st.hintsUsed = 1; S.refreshCard(i); } }, 'Hint') : null,
        h('button', { class: 'btn', type: 'button', disabled: !st.attempts, title: st.attempts ? null : 'Try once first', onclick: () => S.reveal(i) }, 'Show me'));
    } else {
      row.append(h('button', { class: 'btn btn-soft', type: 'button', onclick: () => S.resolve(i) }, 'Done'));
    }
    parts.push(row);
    return parts;
  }

  // A word question: ask for the precise word first, then teach it.
  function wordBody(S, i) {
    const st = (i.study ||= { answer: '', attempts: 0, stage: 'nudge' });
    const parts = [];
    if (st.stage === 'nudge') {
      parts.push(h('div', { class: 'card-title' }, i.question));
      parts.push(onEnter(h('input', {
        class: 'input', placeholder: 'Type the word', value: st.answer, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your word',
        oninput: (e) => { st.answer = e.target.value; },
      }), () => S.checkWord(i)));
      if (st.result) parts.push(feedbackEl(st.result));
      parts.push(h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => S.checkWord(i) }, 'Check'),
        h('button', { class: 'btn', type: 'button', onclick: () => S.showWord(i) }, 'Show me')));
      return parts;
    }
    if (st.result?.verdict === 'correct') parts.push(feedbackEl({ verdict: 'correct', feedback: 'That’s it. Here’s why it fits.' }));
    parts.push(h('div', { class: 'word-head' }, h('b', {}, i.word)));
    if (i.definition) parts.push(h('div', { class: 'def' }, h('b', {}, 'Definition: '), i.definition));
    if (i.why) parts.push(h('div', { class: 'def' }, h('b', {}, 'Why it fits: '), i.why));
    parts.push(h('div', { class: 'hint-box' }, 'Rewrite the sentence yourself. There’s no Accept button: the underline clears when the word is in your sentence.'));
    return parts;
  }

  // Study mode's version of a weak-word suggestion: ask before telling.
  function coachBody(S, i) {
    const st = (i.study ||= { answer: '', attempts: 0, stage: 'nudge' });
    const parts = [];
    if (st.stage === 'nudge') {
      parts.push(h('div', { class: 'card-title' }, `Is there one word that says “${i.coach.phrase}”?`));
      parts.push(onEnter(h('input', {
        class: 'input', placeholder: 'Type a word', value: st.answer, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your word',
        oninput: (e) => { st.answer = e.target.value; },
      }), () => S.checkCoach(i)));
      if (st.result) parts.push(feedbackEl(st.result));
      parts.push(h('div', { class: 'row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => S.checkCoach(i) }, 'Check'),
        h('button', { class: 'btn', type: 'button', onclick: () => { st.stage = 'teach'; S.refreshCard(i); } }, 'Show me')));
      return parts;
    }
    parts.push(h('div', { class: 'card-title' }, `Stronger options for “${i.coach.phrase}”`));
    parts.push(h('div', { class: 'tones' }, ...i.replacements.map((r) => h('span', {}, r))));
    parts.push(h('div', { class: 'hint-box' }, 'Rewrite the phrase yourself in your own words. The underline clears when it changes.'));
    return parts;
  }

  // ---------------------------------------------------------------------------
  // The floating card
  // ---------------------------------------------------------------------------

  let card = null;
  let cardState = null; // { S, issue, anchor, pinned }
  let cardHover = false;
  let cardHideTimer = 0;

  function renderCard() {
    if (!cardState) return;
    const { S, issue: i } = cardState;
    const cat = i.category === 'study' ? 'study' : i.category;
    const title = i.category === 'facts' ? FACT_TITLE[i.verdict] || 'Recheck this fact' : i.category === 'study' ? i.title : i.title;
    card.className = `card k-${cat}${card.classList.contains('visible') ? ' visible' : ''}`;
    card.replaceChildren(
      h('div', { class: 'card-top' }, h('span', { class: `dot k-${cat}` }), h('span', { class: 'card-kind' }, kindLabel(i)), h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => hideCard() }, icon('close'))),
      h('div', { class: 'card-body' }, i.category === 'study' ? null : h('div', { class: 'card-title' }, title), ...body(S, i)),
      h('div', { class: 'card-foot' }, ...footActions(S, i), h('span', { class: 'grow' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Open the assistant', title: 'Open the Study Engine assistant', onclick: () => { hideCard(); openPanel(S, i.id); } }, icon('open')),
        h('span', { class: 'mark', title: 'Study Engine' }, logo())),
    );
  }

  function showCard(S, issue, anchor, { pinned = false } = {}) {
    const L = ensure();
    if (!card) {
      card = h('div', { class: 'card', role: 'dialog', 'aria-label': 'Study Engine suggestion' });
      card.addEventListener('mouseenter', () => { cardHover = true; clearTimeout(cardHideTimer); });
      card.addEventListener('mouseleave', () => { cardHover = false; if (!cardState?.pinned) scheduleHide(); });
      L.cards.append(card);
    }
    const same = cardState?.issue.id === issue.id && cardState.S === S;
    cardState = { S, issue, anchor, pinned: pinned || (same && cardState.pinned) };
    clearTimeout(cardHideTimer);
    card.hidden = false;
    renderCard();
    place(card, anchor);
    requestAnimationFrame(() => card?.classList.add('visible'));
    S.setFocus(issue.id);
  }

  function refreshCard(issue) {
    if (cardState && (!issue || cardState.issue.id === issue.id)) {
      const focused = shadow.activeElement;
      const sel = focused?.matches?.('textarea, input') ? [focused.tagName, focused.selectionStart, focused.selectionEnd] : null;
      renderCard();
      place(card, cardState.anchor);
      if (sel) {
        const el = card.querySelector(sel[0].toLowerCase());
        if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(sel[1], sel[2]); } catch {} }
      }
    }
  }

  function hideCard() {
    if (!card || !cardState) return;
    const S = cardState.S;
    cardState = null;
    cardHover = false;
    card.classList.remove('visible');
    setTimeout(() => { if (!cardState && card) card.hidden = true; }, 130);
    S.setFocus(null);
  }

  function scheduleHide(ms = 350) {
    clearTimeout(cardHideTimer);
    cardHideTimer = setTimeout(() => { if (!cardHover && !cardState?.pinned) hideCard(); }, ms);
  }

  const cardFor = () => cardState;
  const cardHovered = () => cardHover;
  function moveCard(anchor) {
    if (!cardState || !card) return;
    cardState.anchor = anchor;
    place(card, anchor);
  }

  // ---------------------------------------------------------------------------
  // Badges
  // ---------------------------------------------------------------------------

  function badge(S) {
    const L = ensure();
    if (!S.badgeEl) {
      S.badgeEl = h('button', { class: 'badge', type: 'button', 'aria-label': 'Study Engine', onclick: () => togglePanel(S) }, logo(), h('span', { class: 'count', hidden: true }));
      L.badges.append(S.badgeEl);
    }
    return S.badgeEl;
  }

  function placeBadge(S, vis, count, { busy, off, worst }) {
    const b = badge(S);
    if (!vis || vis.width < 70 || vis.height < 18) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    const size = 26;
    const singleLine = S.model.kind === 'input' || vis.height < 44;
    const left = vis.right - size - (singleLine ? 6 : 8);
    const top = singleLine ? vis.top + (vis.height - size) / 2 : vis.bottom - size - 8;
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.classList.toggle('busy', !!busy);
    b.classList.toggle('off', !!off);
    const c = b.querySelector('.count');
    c.hidden = !count;
    c.textContent = count > 99 ? '99+' : String(count);
    c.classList.toggle('calm', worst !== 'correctness' && worst !== 'facts');
    b.title = off ? 'Study Engine is off on this site' : count ? `${count} suggestion${count === 1 ? '' : 's'}. Open the assistant.` : 'Study Engine: looking good. Open the assistant.';
  }

  // ---------------------------------------------------------------------------
  // The assistant panel
  // ---------------------------------------------------------------------------

  let panel = null;
  let panelState = null; // { S, filter, open }

  function togglePanel(S) {
    if (panelState?.S === S) closePanel();
    else openPanel(S);
  }

  function openPanel(S, openId = null) {
    const L = ensure();
    hideCard();
    if (!panel) {
      panel = h('aside', { class: 'panel', 'aria-label': 'Study Engine assistant' });
      L.cards.append(panel);
    }
    panelState = { S, filter: panelState?.S === S ? panelState.filter : 'all', open: openId };
    panel.hidden = false;
    renderPanel();
  }

  function closePanel() {
    if (!panel) return;
    panelState = null;
    panel.hidden = true;
  }

  const panelFor = () => panelState?.S || null;

  function ringEl(score) {
    const r = 21;
    const c = 2 * Math.PI * r;
    const color = score >= 85 ? '#15b585' : score >= 65 ? '#e09a12' : '#e3434a';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 52 52');
    for (const [stroke, dash] of [['#edf2ef', 0], [color, c * (1 - score / 100)]]) {
      const ci = document.createElementNS(SVGNS, 'circle');
      for (const [k, v] of Object.entries({ cx: 26, cy: 26, r, fill: 'none', stroke, 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': c.toFixed(2), 'stroke-dashoffset': dash.toFixed(2) })) ci.setAttribute(k, String(v));
      svg.append(ci);
    }
    return h('div', { class: 'ring', 'aria-hidden': 'true' }, svg, h('b', {}, String(score)));
  }

  function renderPanel() {
    if (!panelState || !panel) return;
    const { S } = panelState;
    if (!S.alive()) {
      closePanel();
      return;
    }
    const info = S.summary();
    const all = info.issues;
    const counts = {};
    for (const i of all) counts[i.category] = (counts[i.category] || 0) + 1;
    const f = panelState.filter;
    const list = f === 'all' ? all : all.filter((i) => i.category === f);
    const cats = ['correctness', 'clarity', 'engagement', 'tone', 'facts'];
    if (S.studyMode) cats.push('study');
    const filterBtn = (id, label, n, k) => h('button', {
      class: `filter${k ? ` k-${k}` : ''}`, type: 'button', 'aria-pressed': String(f === id), disabled: id !== 'all' && !n,
      onclick: () => { panelState.filter = id; renderPanel(); },
    }, h('b', {}, String(n)), label);

    const goals = SE.rules.GOALS;
    const fixable = all.filter((i) => i.category === 'correctness' && i.replacements.length === 1);
    const scrollTop = panel.querySelector('.p-scroll')?.scrollTop || 0;

    const items = list.map((i) => {
      const open = panelState.open === i.id;
      const cat = i.category;
      return h('article', { class: `item k-${cat}${open ? ' open' : ''}`, 'data-id': i.id },
        h('button', {
          class: 'item-head', type: 'button', 'aria-expanded': String(open),
          onclick: () => { panelState.open = open ? null : i.id; S.setFocus(panelState.open, { reveal: !open }); renderPanel(); },
          onmouseenter: () => S.setFocus(i.id), onmouseleave: () => S.setFocus(panelState?.open || null),
        }, h('span', { class: `dot k-${cat}` }), h('span', { class: 't' }, cat === 'facts' ? FACT_TITLE[i.verdict] || 'Recheck this fact' : i.title), i.whole ? null : h('span', { class: 'o' }, i.original)),
        open ? h('div', { class: 'card-body' }, ...body(S, i), h('div', { class: 'row' }, ...footActions(S, i))) : null);
    });

    const status = [];
    if (info.ai.state === 'off') status.push(h('div', { class: 'status' }, info.ai.reason, ' ', h('button', { class: 'link', type: 'button', onclick: () => S.openSettings() }, 'Settings')));
    else if (info.ai.error) status.push(h('div', { class: 'row' }, h('span', { class: 'status error grow' }, info.ai.error), h('button', { class: 'btn', type: 'button', onclick: () => { S.aiError = null; S.runAi(true); } }, 'Try again')));
    else if (info.ai.busy) status.push(h('div', { class: 'row status' }, h('span', { class: 'spinner' }), 'Checking with Claude…'));
    else if (S.settings.ai.autoCheck === false) status.push(h('button', { class: 'btn btn-soft', type: 'button', onclick: () => S.runAi(true) }, icon('spark'), 'Check with Claude'));

    const factsSec = h('div', { class: 'sec' },
      h('div', { class: 'sec-h' }, 'Fact check'),
      h('div', { class: 'status' }, info.facts.text),
      info.ai.state === 'on' ? h('div', { class: 'row' },
        h('button', { class: 'btn btn-soft', type: 'button', disabled: info.facts.busy, onclick: () => S.checkFacts() }, info.facts.busy ? h('span', { class: 'spinner' }) : icon('search'), info.facts.busy ? 'Checking facts…' : 'Check facts now')) : null);

    const st = info.stats;
    panel.replaceChildren(
      h('div', { class: 'p-head' }, mark(), h('div', { class: 'grow' }, h('div', { class: 'p-title' }, 'Study Engine'), h('div', { class: 'p-sub' }, info.where)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => S.openSettings() }, icon('gear')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close', onclick: closePanel }, icon('close'))),
      h('div', { class: 'p-scroll' },
        h('div', { class: 'score' }, ringEl(info.score),
          h('div', {}, h('h3', {}, all.length ? `${all.length} suggestion${all.length === 1 ? '' : 's'}` : 'Looking good'),
            h('p', {}, info.tone.length ? `Sounds ${info.tone.join(', ')}.` : info.ai.state === 'on' ? 'Tone appears after the AI check.' : 'Writing score from the local checks.'))),
        h('div', { class: 'controls' },
          h('div', { class: 'row' },
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' },
              h('button', { type: 'button', 'aria-pressed': String(!S.studyMode), title: 'Fix suggestions, like an editor', onclick: () => S.setStudy(false) }, 'Write'),
              h('button', { type: 'button', 'aria-pressed': String(S.studyMode), title: 'Questions instead of fixes: you do the thinking', onclick: () => S.setStudy(true) }, 'Study')),
            h('span', { class: 'grow' }),
            h('label', { class: 'field-row' }, 'Goal', h('select', { class: 'select', onchange: (e) => S.setGoal(e.target.value) },
              ...goals.map((g) => h('option', { value: g.id, selected: g.id === S.goal ? true : null }, g.name))))),
          h('div', { class: 'filters', role: 'group', 'aria-label': 'Show suggestions by kind' },
            filterBtn('all', 'All', all.length), ...cats.map((k) => filterBtn(k, (CAT[k].label === 'Correctness' ? 'Correct' : CAT[k].label === 'Engagement' ? 'Engage' : CAT[k].label), counts[k] || 0, k)))),
        ...status,
        info.safety ? h('div', { class: 'hint-box', role: 'note' }, h('b', {}, 'If you’re going through something hard, you don’t have to handle it alone. '),
          'In the US, call or text 988 to reach the Suicide & Crisis Lifeline, any time. Elsewhere, find a line at ',
          h('a', { href: 'https://findahelpline.com', target: '_blank', rel: 'noopener noreferrer' }, 'findahelpline.com'), '. Study questions are paused for this text.') : null,
        fixable.length > 1 ? h('button', { class: 'btn btn-primary', type: 'button', onclick: () => S.acceptAll(fixable) }, icon('check'), `Accept all ${fixable.length} correctness fixes`) : null,
        items.length ? h('div', { class: 'sec' }, ...items)
          : h('div', { class: 'empty' }, icon('check'), h('b', {}, f === 'all' ? 'Nothing to fix' : 'None of these'), h('span', {}, f === 'all' ? (info.text ? 'No suggestions right now.' : 'Start writing and suggestions appear here.') : 'Nothing in this category.')),
        factsSec,
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, 'This text'),
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, String(st.words)), h('span', {}, 'words')),
            h('div', { class: 'stat' }, h('b', {}, st.words ? `${Math.max(1, Math.round(st.readingMinutes))} min` : '0'), h('span', {}, 'reading time')),
            h('div', { class: 'stat', title: 'Flesch–Kincaid grade level' }, h('b', {}, st.words > 30 ? String(Math.round(st.grade)) : '–'), h('span', {}, 'grade level')))),
      ),
      h('div', { class: 'p-foot' },
        h('button', { class: 'btn btn-soft', type: 'button', onclick: () => S.openInEditor() }, icon('book'), 'Open in Study Engine'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => S.disableSite() }, 'Turn off on this site')),
    );
    const sc = panel.querySelector('.p-scroll');
    if (sc) sc.scrollTop = scrollTop;
  }

  C.ui = { ensure, isOurs, hostEl, activeInUI, handleKey, h, icon, logo, toast, showCard, hideCard, refreshCard, scheduleHide, cardFor, cardHovered, moveCard, badge, placeBadge, openPanel, closePanel, togglePanel, renderPanel, panelFor, place, CAT, FACT_TITLE };
})();
