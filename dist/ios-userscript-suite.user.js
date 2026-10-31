// ==UserScript==
// @name         iOS Userscript Suite
// @namespace    https://github.com/schedulesyncrepeatingtask/uYouEnhanced
// @version      1.4.1
// @description  All-in-one Safari suite tuned for iPhone 13 mini: YouTube ad skipping, SponsorBlock, dislikes, Picture-in-Picture, video downloader, Google anti-tracking and cookie-banner rejection, Reddit login-wall removal and shortlink bypassing. Every module updates itself.
// @author       iOS Userscript Suite contributors (see README for the original authors)
// @license      AGPL-3.0-or-later
// @homepageURL  https://github.com/schedulesyncrepeatingtask/uYouEnhanced
// @supportURL   https://github.com/schedulesyncrepeatingtask/uYouEnhanced/issues
// @match        *://*/*
// @run-at       document-start
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @grant        GM.setClipboard
// @grant        GM.registerMenuCommand
// @grant        GM.info
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @connect      raw.githubusercontent.com
// @connect      returnyoutubedislikeapi.com
// @connect      sponsor.ajay.app
// @connect      *
// @updateURL    https://raw.githubusercontent.com/schedulesyncrepeatingtask/uYouEnhanced/main/dist/ios-userscript-suite.meta.js
// @downloadURL  https://raw.githubusercontent.com/schedulesyncrepeatingtask/uYouEnhanced/main/dist/ios-userscript-suite.user.js
// ==/UserScript==

(function () {
  'use strict';

  /* ======================================================================
   * iOS Userscript Suite — core runtime
   *
   * The core is deliberately small: it decides which modules match the
   * current page, loads their settings with ONE storage read, runs them,
   * and offers a shared toolbox (toasts, floating buttons, a settings sheet,
   * network requests, page-world injection, throttled observers).
   *
   * Every module carries its own version. The updater compares those with
   * dist/modules/manifest.json in the GitHub repo and hot-swaps individual
   * modules without waiting for a full userscript update.
   * ==================================================================== */

  const SUITE = {"name":"iOS Userscript Suite","version":"1.4.1","api":1,"repo":"schedulesyncrepeatingtask/uYouEnhanced","branch":"main","file":"ios-userscript-suite"};
  const RAW = `https://raw.githubusercontent.com/${SUITE.repo}/${SUITE.branch}/dist/`;
  const STATE_KEY = 'ioss:state';
  const CODE_KEY = (id) => `ioss:code:${id}`;
  const PANEL_HASHES = ['#suite', '#ioss', '#settings-suite'];

  const isTop = (() => { try { return window.top === window.self; } catch (_) { return false; } })();
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const BUNDLED = [];
  const register = (def) => BUNDLED.push(def);

  /* ---------------------------------------------------------------- utils */

  function cmpVer(a, b) {
    const pa = String(a || '0').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
    const pb = String(b || '0').split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function isGoogleHost(hostname) {
    const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return /(^|\.)google\.(com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2}|org\.[a-z]{2}|net\.[a-z]{2}|ne\.jp|it\.ao|nom\.es|off\.ai)$/.test(h);
  }

  function el(tag, props, children) {
    const node = tag === 'svg' || tag === 'path'
      ? document.createElementNS('http://www.w3.org/2000/svg', tag)
      : document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string' && tag !== 'svg' && tag !== 'path') node[k] = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children || [])) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }

  function icon(d, size = 22) {
    return el('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', fill: 'currentColor' },
      [el('path', { d })]);
  }

  function safe(label, fn, ...args) {
    try { return fn(...args); } catch (e) { console.warn(`[iOS Suite] ${label}:`, e); return undefined; }
  }

  function whenRoot(cb) {
    if (document.documentElement) return cb();
    const mo = new MutationObserver(() => {
      if (document.documentElement) { mo.disconnect(); cb(); }
    });
    mo.observe(document, { childList: true });
  }

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => fn(), { once: true });
    else fn();
  }

  function onLoad(fn) {
    if (document.readyState === 'complete') fn();
    else window.addEventListener('load', () => fn(), { once: true });
  }

  function addStyle(css, id) {
    const s = document.createElement('style');
    if (id) s.id = id;
    s.textContent = css;
    whenRoot(() => (document.head || document.documentElement).appendChild(s));
    return s;
  }

  // Runs fn on a timer, but skips ticks while the tab is in the background
  // so idle tabs do not drain the battery.
  function every(ms, fn) {
    const id = setInterval(() => { if (!document.hidden) safe('interval', fn); }, ms);
    return () => clearInterval(id);
  }

  // MutationObserver whose callback runs at most once per frame (or after a
  // debounce) instead of once per mutation batch. YouTube/Google mutate the
  // DOM hundreds of times per second; this keeps the phone cool.
  function observe(target, options, callback, { debounce = 0, throttle = 0 } = {}) {
    let scheduled = false;
    let timer = 0;
    const run = () => { scheduled = false; safe('observer', callback); };
    const mo = new MutationObserver(() => {
      if (debounce) {
        clearTimeout(timer);
        timer = setTimeout(run, debounce);
        return;
      }
      if (scheduled) return;
      scheduled = true;
      if (throttle) timer = setTimeout(run, throttle);
      else if (document.hidden) setTimeout(run, 250);
      else requestAnimationFrame(run);
    });
    const start = () => {
      const t = typeof target === 'function' ? target() : target;
      if (t) mo.observe(t, options);
    };
    if (typeof target === 'function' || target) {
      if (!document.documentElement) whenRoot(start); else start();
    }
    return () => { mo.disconnect(); clearTimeout(timer); };
  }

  function waitFor(selector, { timeout = 15000, root = document } = {}) {
    return new Promise((resolve) => {
      const found = root.querySelector(selector);
      if (found) return resolve(found);
      let stop = null;
      const t = setTimeout(() => { stop && stop(); resolve(null); }, timeout);
      stop = observe(() => root === document ? document.documentElement : root, { childList: true, subtree: true }, () => {
        const hit = root.querySelector(selector);
        if (hit) { clearTimeout(t); stop(); resolve(hit); }
      });
    });
  }

  /* ----------------------------------------------------- URL change bus */

  const urlListeners = new Set();
  let lastHref = location.href;
  let urlPoll = null;
  function checkUrl() {
    if (location.href === lastHref) return;
    const prev = lastHref;
    lastHref = location.href;
    for (const fn of urlListeners) safe('url listener', fn, location.href, prev);
  }
  function onUrlChange(fn) {
    urlListeners.add(fn);
    if (!urlPoll) {
      // Content scripts cannot see the page's history.pushState calls, so we
      // combine cheap polling (only while visible) with the SPA events that
      // YouTube & co. dispatch on the shared DOM.
      urlPoll = every(400, checkUrl);
      window.addEventListener('popstate', checkUrl, true);
      window.addEventListener('hashchange', checkUrl, true);
      for (const ev of ['yt-navigate-finish', 'state-navigateend', 'yt-page-data-updated', 'spfdone']) {
        document.addEventListener(ev, () => setTimeout(checkUrl, 0), true);
      }
      try { window.navigation && window.navigation.addEventListener('navigatesuccess', checkUrl); } catch (_) { /* optional */ }
    }
    return () => urlListeners.delete(fn);
  }

  /* -------------------------------------------------------- GM wrapper */

  const G = typeof GM === 'object' && GM ? GM : {};
  const hasGM = (n) => typeof G[n] === 'function';
  const GM_get = (() => { try { return typeof GM_getValue === 'function' ? GM_getValue : null; } catch (_) { return null; } })();
  const GM_set = (() => { try { return typeof GM_setValue === 'function' ? GM_setValue : null; } catch (_) { return null; } })();
  const GM_del = (() => { try { return typeof GM_deleteValue === 'function' ? GM_deleteValue : null; } catch (_) { return null; } })();
  const GM_xhr = (() => { try { return typeof GM_xmlhttpRequest === 'function' ? GM_xmlhttpRequest : null; } catch (_) { return null; } })();
  const GM_tab = (() => { try { return typeof GM_openInTab === 'function' ? GM_openInTab : null; } catch (_) { return null; } })();
  const GM_clip = (() => { try { return typeof GM_setClipboard === 'function' ? GM_setClipboard : null; } catch (_) { return null; } })();
  const GM_menu = (() => { try { return typeof GM_registerMenuCommand === 'function' ? GM_registerMenuCommand : null; } catch (_) { return null; } })();

  const storage = {
    async get(key, def) {
      try {
        if (hasGM('getValue')) { const v = await G.getValue(key, def); return v === undefined ? def : v; }
        if (GM_get) { const v = GM_get(key, def); return v === undefined ? def : v; }
      } catch (_) { /* fall through */ }
      try { const raw = localStorage.getItem(key); return raw == null ? def : JSON.parse(raw); } catch (_) { return def; }
    },
    async set(key, value) {
      try {
        if (hasGM('setValue')) return await G.setValue(key, value);
        if (GM_set) return GM_set(key, value);
      } catch (_) { /* fall through */ }
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
    },
    async del(key) {
      try {
        if (hasGM('deleteValue')) return await G.deleteValue(key);
        if (GM_del) return GM_del(key);
      } catch (_) { /* fall through */ }
      try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
    }
  };

  // Promise wrapper around GM.xmlHttpRequest (cross-origin, works inside
  // Safari's extension sandbox) with a plain fetch() fallback.
  function request({ url, method = 'GET', headers = {}, body, responseType, timeout = 20000, onprogress } = {}) {
    return new Promise((resolve, reject) => {
      const xhr = hasGM('xmlHttpRequest') ? G.xmlHttpRequest.bind(G) : GM_xhr;
      if (!xhr) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = setTimeout(() => ctl && ctl.abort(), timeout);
        fetch(url, { method, headers, body, signal: ctl && ctl.signal, credentials: 'omit' })
          .then(async (r) => resolve({
            status: r.status, finalUrl: r.url,
            text: responseType === 'blob' ? '' : await r.text(),
            response: responseType === 'blob' ? await r.blob() : undefined
          }))
          .catch(reject)
          .finally(() => clearTimeout(t));
        return;
      }
      let handle;
      try {
        handle = xhr({
          method, url, headers, data: body, timeout,
          responseType: responseType || undefined,
          onprogress,
          onload: (r) => resolve({
            status: r.status, finalUrl: r.finalUrl || url,
            text: typeof r.responseText === 'string' ? r.responseText : '',
            response: r.response, headers: r.responseHeaders
          }),
          onerror: () => reject(new Error('Network error: ' + url)),
          ontimeout: () => reject(new Error('Timeout: ' + url)),
          onabort: () => reject(new Error('Aborted: ' + url))
        });
      } catch (e) { reject(e); }
      return handle;
    });
  }

  function openTab(url, active = true) {
    try {
      if (hasGM('openInTab')) return G.openInTab(url, !active);
      if (GM_tab) return GM_tab(url, { active, insert: true });
    } catch (_) { /* fall back */ }
    const w = window.open(url, '_blank', 'noopener');
    if (!w) location.href = url;
  }

  async function copy(text) {
    try {
      if (hasGM('setClipboard')) { await G.setClipboard(text); return true; }
      if (GM_clip) { GM_clip(text); return true; }
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) { return false; }
  }

  function menu(title, cb) {
    try {
      if (hasGM('registerMenuCommand')) { G.registerMenuCommand(title, cb); return true; }
      if (GM_menu) { GM_menu(title, cb); return true; }
    } catch (_) { /* not supported (e.g. Userscripts for iOS) */ }
    return false;
  }

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ------------------------------------------------- page-world bridge */

  // Safari userscript managers run us in an isolated "content" world:
  // patches to window.fetch, history, document.hidden, ... are invisible to
  // the page there. pageRun() injects code into the real page world. It
  // borrows the page's CSP nonce and a Trusted Types policy when the site
  // requires them, and reports whether the code actually executed.
  let ttPolicy = null;
  function pageRun(code, ...args) {
    const src = typeof code === 'function'
      ? `(${code})(...${JSON.stringify(args)});`
      : String(code);
    const token = 'ioss' + Math.random().toString(36).slice(2);
    const wrapped = `try{${src}}finally{document.documentElement.setAttribute('data-${token}','1');}`;
    const root = document.documentElement;
    if (!root) return false;
    try {
      const s = document.createElement('script');
      const nonceEl = document.querySelector('script[nonce]');
      const nonce = nonceEl && (nonceEl.nonce || nonceEl.getAttribute('nonce'));
      if (nonce) s.setAttribute('nonce', nonce);
      let text = wrapped;
      if (window.trustedTypes && window.trustedTypes.createPolicy) {
        try {
          ttPolicy = ttPolicy || window.trustedTypes.createPolicy('ioss-' + Math.random().toString(36).slice(2, 7), { createScript: (x) => x });
          text = ttPolicy.createScript(wrapped);
        } catch (_) { /* policy creation refused; try plain text */ }
      }
      s.textContent = text;
      (document.head || root).appendChild(s);
      s.remove();
    } catch (_) { /* blocked */ }
    const ok = root.hasAttribute('data-' + token);
    root.removeAttribute('data-' + token);
    return ok;
  }

  /* --------------------------------------------------------------- UI */

  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    .wrap { --bg:#fff; --fg:#111; --mut:#666; --line:rgba(0,0,0,.1); --acc:#0a84ff; --card:#f2f2f7;
      font: 15px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; color: var(--fg); }
    @media (prefers-color-scheme: dark) { .wrap { --bg:#1c1c1e; --fg:#f2f2f7; --mut:#9a9aa0; --line:rgba(255,255,255,.12); --card:#2c2c2e; } }
    .toasts { position: fixed; left: 50%; transform: translateX(-50%); top: calc(env(safe-area-inset-top, 0px) + 10px);
      z-index: 2147483647; display: flex; flex-direction: column; gap: 8px; width: min(92vw, 420px); pointer-events: none; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 8px 8px 14px;
      border-radius: 14px; background: rgba(28,28,30,.92); color: #fff; box-shadow: 0 6px 24px rgba(0,0,0,.3);
      -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); opacity: 0; transform: translateY(-8px);
      transition: opacity .2s, transform .2s; }
    .toast.show { opacity: 1; transform: none; }
    .toast .msg { flex: 1; white-space: pre-line; font-size: 14px; }
    .toast button { min-height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: rgba(255,255,255,.18);
      color: #fff; font: 600 14px -apple-system, system-ui, sans-serif; }
    .fabs { position: fixed; z-index: 2147483600; display: flex; flex-direction: column-reverse; gap: 10px; }
    .fab { width: 44px; height: 44px; border-radius: 22px; border: 0; display: none; align-items: center; justify-content: center;
      color: #fff; background: rgba(20,20,20,.62); box-shadow: 0 3px 12px rgba(0,0,0,.35);
      -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); touch-action: manipulation; }
    .fab.show { display: flex; }
    .dot { position: fixed; top: 0; left: 0; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
      z-index: 2147483601; touch-action: none; -webkit-user-select: none; user-select: none; transition: opacity .3s; will-change: transform; }
    .dot.idle { opacity: .28; }
    .dot i { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #1c1c1e;
      background: radial-gradient(circle at 30% 25%, rgba(255,255,255,.95), rgba(170,178,196,.75));
      border: 1px solid rgba(0,0,0,.18); box-shadow: 0 2px 8px rgba(0,0,0,.3); }
    .dot svg { width: 16px; height: 16px; pointer-events: none; }
    .fab:active { transform: scale(.92); background: rgba(10,132,255,.85); }
    .fabs, .dot, .backdrop, .sheet { pointer-events: auto; }
    .backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.38); z-index: 2147483646; }
    .sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; max-height: 86vh; max-height: 86dvh;
      overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; background: var(--bg);
      border-radius: 16px 16px 0 0; padding: 6px 16px calc(18px + env(safe-area-inset-bottom, 0px)); box-shadow: 0 -8px 30px rgba(0,0,0,.25); }
    @media (min-width: 620px) { .sheet { left: 50%; right: auto; width: 560px; transform: translateX(-50%); } }
    .grab { width: 38px; height: 5px; border-radius: 3px; background: var(--line); margin: 4px auto 8px; }
    .head { display: flex; align-items: center; gap: 8px; position: sticky; top: -6px; background: var(--bg); padding: 6px 0 8px; z-index: 1; }
    .head h2 { flex: 1; margin: 0; font-size: 19px; }
    .btn { min-height: 44px; padding: 0 14px; border-radius: 11px; border: 0; background: var(--card); color: var(--fg);
      font: 600 15px -apple-system, system-ui, sans-serif; }
    .btn.primary { background: var(--acc); color: #fff; }
    .card { background: var(--card); border-radius: 12px; margin: 10px 0; overflow: hidden; }
    .mod { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 6px 12px; }
    .mod .t { flex: 1; min-width: 0; }
    .mod .n { font-weight: 600; }
    .mod .v { font-size: 12px; color: var(--mut); }
    .mod .err { font-size: 12px; color: #ff453a; }
    .more { border: 0; background: none; color: var(--acc); font-size: 14px; min-height: 44px; padding: 0 4px; }
    .opts { border-top: 1px solid var(--line); padding: 4px 12px 8px; display: none; }
    .opts.open { display: block; }
    .desc { color: var(--mut); font-size: 13px; margin: 6px 0; }
    .row { display: flex; align-items: center; gap: 10px; min-height: 44px; border-bottom: 1px solid var(--line); }
    .row:last-child { border-bottom: 0; }
    .row label { flex: 1; }
    .row small { display: block; color: var(--mut); font-size: 12px; }
    input[type=number], input[type=text], select { font-size: 16px; min-height: 36px; border-radius: 8px; border: 1px solid var(--line);
      background: var(--bg); color: var(--fg); padding: 4px 8px; max-width: 46%; }
    input[type=number] { width: 90px; }
    input.sw { -webkit-appearance: none; appearance: none; width: 51px; height: 31px; border-radius: 16px; background: var(--line);
      position: relative; flex: none; transition: background .2s; margin: 0; }
    input.sw::after { content: ""; position: absolute; top: 2px; left: 2px; width: 27px; height: 27px; border-radius: 50%;
      background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.25); transition: transform .2s; }
    input.sw:checked { background: #34c759; }
    input.sw:checked::after { transform: translateX(20px); }
    .foot { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .note { color: var(--mut); font-size: 12px; margin-top: 10px; }
    .banner { background: rgba(10,132,255,.14); border-radius: 10px; padding: 10px 12px; margin: 8px 0; font-size: 14px; }
  `;

  let uiRoot = null;
  function ui() {
    if (uiRoot && uiRoot.host.isConnected) return uiRoot;
    const host = document.createElement('ioss-ui');
    // A full-viewport layer that lets taps through. Not 'all: initial' and not
    // 0x0: page filters (e.g. Dark Mode's invert) must be able to target the
    // host, and a filtered host becomes the containing block of its fixed
    // children, so it has to cover the viewport for them to stay in place.
    host.style.cssText = 'position: fixed !important; inset: 0 !important; width: auto !important; height: auto !important; margin: 0 !important; padding: 0 !important; border: 0 !important; background: none !important; display: block !important; pointer-events: none !important; z-index: 2147483647 !important; transform: none !important; opacity: 1 !important; visibility: visible !important;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(el('style', { text: UI_CSS }));
    const wrap = el('div', { class: 'wrap' }, [el('div', { class: 'toasts' }), el('div', { class: 'fabs' })]);
    shadow.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
    uiRoot = { host, shadow, wrap, toasts: wrap.querySelector('.toasts'), fabs: wrap.querySelector('.fabs') };
    positionFabs();
    return uiRoot;
  }

  function toast(message, { timeout = 3500, action, onAction } = {}) {
    if (!isTop || !document.documentElement) return null;
    const { toasts } = ui();
    while (toasts.children.length >= 3) toasts.firstChild.remove();
    const node = el('div', { class: 'toast', role: 'status' }, [el('div', { class: 'msg', text: message })]);
    const close = () => { node.classList.remove('show'); setTimeout(() => node.remove(), 220); };
    if (action) {
      node.appendChild(el('button', { type: 'button', text: action, onclick: (e) => { e.stopPropagation(); close(); safe('toast action', onAction); } }));
    }
    toasts.appendChild(node);
    requestAnimationFrame(() => node.classList.add('show'));
    if (timeout) setTimeout(close, timeout);
    return { close };
  }

  function positionFabs() {
    if (!uiRoot) return;
    const c = state ? state.core : DEFAULT_CORE;
    const side = c.fabSide === 'left' ? 'left' : 'right';
    const s = uiRoot.fabs.style;
    s.left = s.right = '';
    s[side] = `calc(10px + env(safe-area-inset-${side}, 0px))`;
    s.bottom = `calc(${Math.max(0, Number(c.fabBottom) || 0)}px + env(safe-area-inset-bottom, 0px))`;
  }

  // Floating 44pt buttons stacked in one corner (Apple's minimum tap size).
  function fab({ title, path, onTap, onLongPress }) {
    let node = null;
    const build = () => {
      if (node && node.isConnected) return node;
      node = el('button', { class: 'fab', type: 'button', title, 'aria-label': title }, [icon(path)]);
      let timer = 0;
      let long = false;
      node.addEventListener('touchstart', () => {
        long = false;
        if (onLongPress) timer = setTimeout(() => { long = true; safe('fab long', onLongPress); }, 600);
      }, { passive: true });
      node.addEventListener('touchend', () => clearTimeout(timer), { passive: true });
      node.addEventListener('touchmove', () => clearTimeout(timer), { passive: true });
      node.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (long) { long = false; return; }
        safe('fab tap', onTap);
      });
      ui().fabs.appendChild(node);
      return node;
    };
    return {
      show() { if (!isTop) return; whenBody(() => build().classList.add('show')); },
      hide() { node && node.classList.remove('show'); },
      remove() { node && node.remove(); node = null; },
      get element() { return node; }
    };
  }

  // Draggable settings dot (idea from Google Lite): a 28pt dot inside a 44pt
  // touch target. It fades after a few seconds, remembers where you left it
  // and opens the settings sheet when tapped.
  const GEAR_PATH = 'M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z';
  function mountDot() {
    const { wrap } = ui();
    if (wrap.querySelector('.dot')) return;
    const SIZE = 44;
    const node = el('div', { class: 'dot', role: 'button', 'aria-label': `${SUITE.name} settings`, title: `${SUITE.name} settings` }, [el('i', {}, [icon(GEAR_PATH, 16)])]);
    wrap.appendChild(node);
    const clamp = (x, y) => ({
      x: Math.round(Math.min(innerWidth - SIZE - 4, Math.max(4, x))),
      y: Math.round(Math.min(innerHeight - SIZE - 4, Math.max(4, y)))
    });
    // Stored as fractions of the viewport so rotation keeps it on screen.
    const saved = state.core.dotPos;
    let pos = saved ? clamp(saved.fx * innerWidth, saved.fy * innerHeight) : clamp(innerWidth - SIZE - 4, innerHeight * 0.32);
    const apply = () => { node.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`; };
    apply();
    addEventListener('resize', () => { pos = clamp(pos.x, pos.y); apply(); }, { passive: true });
    let idleTimer = 0;
    const wake = () => { node.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => node.classList.add('idle'), 3500); };
    wake();
    let start = null;
    let moved = false;
    node.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      moved = false;
      try { node.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      wake();
    });
    node.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (moved) { pos = clamp(start.px + dx, start.py + dy); apply(); }
    });
    const end = (e, cancelled) => {
      if (!start) return;
      try { node.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      start = null;
      if (moved) {
        state.core.dotPos = { fx: pos.x / innerWidth, fy: pos.y / innerHeight };
        saveState();
      } else if (!cancelled) {
        openPanel();
      }
      moved = false;
      wake();
    };
    node.addEventListener('pointerup', (e) => end(e, false));
    node.addEventListener('pointercancel', (e) => end(e, true));
  }

  function whenBody(cb) {
    if (document.body) return cb();
    onReady(cb);
  }

  /* --------------------------------------------------- settings & state */

  const DEFAULT_CORE = {
    autoUpdate: true,
    intervalHours: 12,
    notifyUpdates: true,
    dot: true,
    dotPos: null,
    fabSide: 'right',
    fabBottom: 76,
    debug: false,
    lastCheck: 0,
    lastSuiteNotice: '',
    welcomed: false
  };

  let state = null;
  const active = new Map(); // id -> { def, source: 'bundled'|'updated', error }
  let canEval = null;
  let saveTimer = 0;

  async function loadState() {
    const raw = await storage.get(STATE_KEY, null);
    const s = raw && typeof raw === 'object' ? raw : {};
    s.core = Object.assign({}, DEFAULT_CORE, s.core || {});
    s.modules = s.modules || {};
    s.cache = s.cache || {};
    return s;
  }

  function saveState() {
    clearTimeout(saveTimer);
    return new Promise((resolve) => {
      saveTimer = setTimeout(() => { storage.set(STATE_KEY, state).then(resolve, resolve); }, 120);
    });
  }

  function moduleState(def) {
    const m = state.modules[def.id] || (state.modules[def.id] = {});
    if (typeof m.enabled !== 'boolean') m.enabled = def.enabledByDefault !== false;
    if (typeof m.autoUpdate !== 'boolean') m.autoUpdate = true;
    m.settings = Object.assign({}, def.defaults || {}, m.settings || {});
    return m;
  }

  function testEval() {
    if (canEval !== null) return canEval;
    try { canEval = Function('return 1')() === 1; } catch (_) { canEval = false; }
    return canEval;
  }

  function evalModule(code) {
    // eslint-disable-next-line no-new-func
    const def = Function(`"use strict";\nreturn (\n${code}\n);`)();
    if (!def || typeof def !== 'object' || !def.id || !def.version || typeof def.run !== 'function') {
      throw new Error('Invalid module definition');
    }
    return def;
  }

  // Picks the newest available copy of a module: the bundled one, or a
  // hot-updated copy downloaded earlier by the updater.
  async function resolveModule(bundled) {
    const cachedVer = state.cache[bundled.id];
    if (!cachedVer) return { def: bundled, source: 'bundled' };
    if (cmpVer(cachedVer, bundled.version) <= 0) {
      delete state.cache[bundled.id];
      storage.del(CODE_KEY(bundled.id));
      saveState();
      return { def: bundled, source: 'bundled' };
    }
    if (!testEval()) return { def: bundled, source: 'bundled' };
    try {
      const code = await storage.get(CODE_KEY(bundled.id), '');
      const def = evalModule(code);
      if (def.id !== bundled.id || (def.api || 1) > SUITE.api) throw new Error('incompatible');
      return { def, source: 'updated' };
    } catch (e) {
      console.warn('[iOS Suite] cached update for', bundled.id, 'is unusable, using bundled copy:', e);
      return { def: bundled, source: 'bundled' };
    }
  }

  function makeApi(def, mstate) {
    const tag = `[iOS Suite:${def.id}]`;
    return {
      id: def.id,
      version: def.version,
      suiteVersion: SUITE.version,
      isTop, isIOS,
      get cfg() { return mstate.settings; },
      save: saveState,
      log: (...a) => { if (state.core.debug) console.log(tag, ...a); },
      warn: (...a) => console.warn(tag, ...a),
      el, icon, addStyle, onReady, onLoad, onUrlChange, every, observe, waitFor,
      request, toast, fab, pageRun, openTab, copy, menu, isGoogleHost, sha256,
      storage: {
        get: (k, d) => storage.get(`ioss:${def.id}:${k}`, d),
        set: (k, v) => storage.set(`ioss:${def.id}:${k}`, v),
        del: (k) => storage.del(`ioss:${def.id}:${k}`)
      },
      openSettings: () => openPanel(def.id)
    };
  }

  function runModule(entry, url) {
    const { def } = entry;
    const mstate = moduleState(def);
    if (!mstate.enabled) return;
    if (!isTop && !def.frames) return;
    let matches = false;
    try { matches = !!def.match(url); } catch (_) { matches = false; }
    if (!matches) return;
    entry.matched = true;
    const go = () => {
      try {
        const r = def.run(makeApi(def, mstate), mstate.settings);
        if (r && typeof r.catch === 'function') r.catch((e) => { entry.error = String(e && e.message || e); console.warn(`[iOS Suite:${def.id}]`, e); });
      } catch (e) {
        entry.error = String(e && e.message || e);
        console.warn(`[iOS Suite:${def.id}] crashed:`, e);
      }
    };
    if (def.runAt === 'ready') onReady(go);
    else if (def.runAt === 'load') onLoad(go);
    else go();
  }

  /* -------------------------------------------------------- the updater */

  let checking = false;
  async function checkUpdates(force = false) {
    if (checking || !isTop || location.protocol !== 'https:' || !crypto.subtle) return null;
    const c = state.core;
    if (!force && (!c.autoUpdate || Date.now() - c.lastCheck < c.intervalHours * 3600e3)) return null;
    checking = true;
    const updated = [];
    try {
      c.lastCheck = Date.now();
      await saveState();
      const res = await request({ url: `${RAW}modules/manifest.json?t=${Date.now()}`, timeout: 15000 });
      if (res.status !== 200) throw new Error(`manifest HTTP ${res.status}`);
      const man = JSON.parse(res.text);

      if (man.suite && cmpVer(man.suite, SUITE.version) > 0 && (force || c.lastSuiteNotice !== man.suite)) {
        c.lastSuiteNotice = man.suite;
        if (c.notifyUpdates || force) {
          toast(`iOS Suite ${man.suite} is available (you have ${SUITE.version}).`, {
            timeout: 9000, action: 'Install', onAction: () => openTab(`${RAW}${SUITE.file}.user.js`)
          });
        }
      }

      for (const b of BUNDLED) {
        const info = man.modules && man.modules[b.id];
        const ms = state.modules[b.id];
        if (!info || (ms && ms.autoUpdate === false)) continue;
        if ((info.api || 1) > SUITE.api) continue;
        const current = state.cache[b.id] && cmpVer(state.cache[b.id], b.version) > 0 ? state.cache[b.id] : b.version;
        if (cmpVer(info.version, current) <= 0) continue;
        if (!testEval()) continue;
        const r = await request({ url: `${RAW}modules/${info.file}?v=${encodeURIComponent(info.version)}`, timeout: 20000 });
        if (r.status !== 200) continue;
        if (info.sha256 && (await sha256(r.text)) !== info.sha256) { console.warn('[iOS Suite] checksum mismatch for', b.id); continue; }
        const def = evalModule(r.text);
        if (def.id !== b.id || cmpVer(def.version, info.version) !== 0) continue;
        await storage.set(CODE_KEY(b.id), r.text);
        state.cache[b.id] = def.version;
        updated.push(`${def.name || def.id} ${def.version}`);
      }
      await saveState();
      if (updated.length && (c.notifyUpdates || force)) {
        toast(`Updated: ${updated.join(', ')}.\nReload to apply.`, { timeout: 8000, action: 'Reload', onAction: () => location.reload() });
      } else if (force) {
        toast(canEval === false
          ? 'Module hot-updates are blocked here; the full script update is used instead.'
          : 'Everything is up to date.');
      }
      return updated;
    } catch (e) {
      if (force) toast('Update check failed: ' + (e && e.message || e));
      if (c.debug) console.warn('[iOS Suite] update check failed', e);
      return null;
    } finally {
      checking = false;
    }
  }

  /* ---------------------------------------------------- settings sheet */

  let panel = null;
  function closePanel() {
    if (!panel) return;
    panel.forEach((n) => n.remove());
    panel = null;
    document.documentElement.style.removeProperty('overflow');
  }

  function optionRow(def, mstate, opt) {
    const id = `o-${def.id}-${opt.key}`;
    const val = mstate.settings[opt.key];
    let input;
    const commit = (v) => { mstate.settings[opt.key] = v; saveState(); markDirty(); };
    if (opt.type === 'bool') {
      input = el('input', { id, type: 'checkbox', class: 'sw', checked: !!val, onchange: (e) => commit(e.target.checked) });
    } else if (opt.type === 'number') {
      input = el('input', { id, type: 'number', inputmode: 'decimal', value: String(val), min: opt.min, max: opt.max, step: opt.step || 1,
        onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) commit(n); } });
    } else if (opt.type === 'select') {
      input = el('select', { id, onchange: (e) => commit(e.target.value) },
        opt.choices.map(([v, label]) => el('option', { value: v, text: label, selected: String(val) === String(v) })));
    } else {
      input = el('input', { id, type: 'text', value: String(val == null ? '' : val), autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
        onchange: (e) => commit(e.target.value.trim()) });
    }
    return el('div', { class: 'row' }, [
      el('label', { for: id }, [opt.label, opt.help ? el('small', { text: opt.help }) : null]),
      input
    ]);
  }

  let dirtyBanner = null;
  function markDirty() {
    if (dirtyBanner) dirtyBanner.style.display = 'block';
  }

  function openPanel(focusId) {
    if (!isTop) return;
    whenBody(() => {
      closePanel();
      const { wrap } = ui();
      const backdrop = el('div', { class: 'backdrop', onclick: closePanel });
      const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': `${SUITE.name} settings` });
      sheet.appendChild(el('div', { class: 'grab' }));
      sheet.appendChild(el('div', { class: 'head' }, [
        el('h2', { text: SUITE.name }),
        el('button', { class: 'btn', type: 'button', text: 'Done', onclick: closePanel })
      ]));
      dirtyBanner = el('div', { class: 'banner', style: { display: 'none' } }, [
        'Changes apply after a reload. ',
        el('button', { class: 'btn primary', type: 'button', text: 'Reload page', onclick: () => location.reload() })
      ]);
      sheet.appendChild(dirtyBanner);
      sheet.appendChild(el('div', { class: 'desc', text: `v${SUITE.version} · modules marked "on this page" are active right now.` }));

      for (const b of BUNDLED) {
        const entry = active.get(b.id) || { def: b, source: 'bundled' };
        const def = entry.def;
        const ms = moduleState(def);
        const opts = el('div', { class: `opts${focusId === def.id ? ' open' : ''}` }, [
          el('div', { class: 'desc', text: def.description || '' }),
          def.source ? el('div', { class: 'desc', text: `Based on: ${def.source}` }) : null,
          ...(def.options || []).map((o) => optionRow(def, ms, o)),
          el('div', { class: 'row' }, [
            el('label', { for: `au-${def.id}` }, ['Auto-update this module', el('small', { text: state.cache[def.id] ? `Hot update ${state.cache[def.id]} installed` : 'Uses the bundled copy' })]),
            el('input', { id: `au-${def.id}`, type: 'checkbox', class: 'sw', checked: ms.autoUpdate, onchange: (e) => { ms.autoUpdate = e.target.checked; saveState(); } })
          ])
        ]);
        const more = el('button', { class: 'more', type: 'button', text: focusId === def.id ? 'Less' : 'Options',
          onclick: () => { const o = opts.classList.toggle('open'); more.textContent = o ? 'Less' : 'Options'; } });
        sheet.appendChild(el('div', { class: 'card' }, [
          el('div', { class: 'mod' }, [
            el('div', { class: 't' }, [
              el('div', { class: 'n', text: def.name || def.id }),
              el('div', { class: 'v', text: `v${def.version}${entry.source === 'updated' ? ' (hot-updated)' : ''}${entry.matched ? ' · on this page' : ''}` }),
              entry.error ? el('div', { class: 'err', text: `Error: ${entry.error}` }) : null
            ]),
            more,
            el('input', { type: 'checkbox', class: 'sw', 'aria-label': `Enable ${def.name}`, checked: ms.enabled,
              onchange: (e) => { ms.enabled = e.target.checked; saveState(); markDirty(); } })
          ]),
          opts
        ]));
      }

      const coreDef = {
        id: 'core',
        options: [
          { key: 'autoUpdate', type: 'bool', label: 'Check for module updates automatically' },
          { key: 'intervalHours', type: 'number', label: 'Check every (hours)', min: 1, max: 168 },
          { key: 'notifyUpdates', type: 'bool', label: 'Show update messages' },
          { key: 'dot', type: 'bool', label: 'Settings dot on every page', help: 'Drag it anywhere; it fades when idle. Without it, add #suite to an address.' },
          { key: 'fabSide', type: 'select', label: 'Floating buttons side', choices: [['right', 'Right'], ['left', 'Left']] },
          { key: 'fabBottom', type: 'number', label: 'Floating buttons height (px from bottom)', min: 0, max: 600 },
          { key: 'debug', type: 'bool', label: 'Debug logging (Web Inspector)' }
        ]
      };
      const coreState = { settings: state.core };
      sheet.appendChild(el('div', { class: 'card' }, [
        el('div', { class: 'mod' }, [el('div', { class: 't' }, [el('div', { class: 'n', text: 'Suite & updates' }),
          el('div', { class: 'v', text: state.core.lastCheck ? `Last check: ${new Date(state.core.lastCheck).toLocaleString()}` : 'Never checked' })])]),
        el('div', { class: 'opts open' }, coreDef.options.map((o) => optionRow(coreDef, coreState, o)))
      ]));
      sheet.appendChild(el('div', { class: 'foot' }, [
        el('button', { class: 'btn primary', type: 'button', text: 'Check for updates now', onclick: () => checkUpdates(true) }),
        el('button', { class: 'btn', type: 'button', text: 'Reset settings', onclick: async () => {
          if (!confirm('Reset every module to its default settings?')) return;
          state.modules = {};
          state.core = Object.assign({}, DEFAULT_CORE, { welcomed: true });
          await storage.set(STATE_KEY, state);
          location.reload();
        } })
      ]));
      sheet.appendChild(el('div', { class: 'note', text: `Tip: open this sheet on any site by adding ${PANEL_HASHES[0]} to the address. Updates come from github.com/${SUITE.repo}.` }));

      wrap.appendChild(backdrop);
      wrap.appendChild(sheet);
      panel = [backdrop, sheet];
      positionFabs();
    });
  }

  // Single-page sites such as YouTube rewrite the address while loading and
  // drop "#suite" before DOMContentLoaded, so the hash is read once at
  // document-start and hashchange is watched from that moment on (using the
  // event's own newURL, since the site may already have rewritten it).
  const wantsPanel = (hash) => PANEL_HASHES.includes(String(hash || '').toLowerCase());
  let panelRequested = isTop && wantsPanel(location.hash);
  let booted = false;

  function requestPanel() {
    if (!booted) { panelRequested = true; return; }
    if (wantsPanel(location.hash)) {
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* ignore */ }
    }
    openPanel();
  }

  if (isTop) {
    window.addEventListener('hashchange', (e) => {
      let hash = location.hash;
      try { hash = new URL(e.newURL).hash; } catch (_) { /* keep location.hash */ }
      if (wantsPanel(hash)) requestPanel();
    }, true);
  }

  /* ------------------------------------------------------------- boot */

  async function boot() {
    const url = new URL(location.href);

    // Frames: bail out before touching storage unless a frame-capable module
    // (e.g. SponsorBlock inside a YouTube embed) wants this URL. This keeps
    // ad iframes on random sites cost-free.
    if (!isTop) {
      const wanted = BUNDLED.some((d) => d.frames && safe('match', () => d.match(url)));
      if (!wanted) return;
    }

    state = await loadState();
    const entries = await Promise.all(BUNDLED.map(resolveModule));
    for (const e of entries) active.set(e.def.id, e);
    for (const e of entries) runModule(e, url);
    if (!isTop) return;

    menu('⚙️ iOS Suite settings', () => openPanel());
    menu('🔄 Check for updates', () => checkUpdates(true));
    booted = true;
    if (panelRequested) onReady(requestPanel);

    onReady(() => {
      if (state.core.dot) safe('settings dot', mountDot);
      if (!state.core.welcomed && location.protocol === 'https:') {
        state.core.welcomed = true;
        saveState();
        setTimeout(() => toast(`${SUITE.name} is active.\nTap the ⚙︎ dot (or add ${PANEL_HASHES[0]} to an address) for settings.`, {
          timeout: 9000, action: 'Settings', onAction: () => openPanel()
        }), 1500);
      }
    });

    onLoad(() => setTimeout(() => checkUpdates(false), 4000));
  }

  /* ---- module: google-consent v2.1.0 ---- */
  register(({
  id: 'google-consent',
  name: 'Reject cookie banners (Google & YouTube)',
  version: '2.1.0',
  api: 1,
  source: 'Google: Block Cookie Banner 2.0',
  description: 'Pre-sets the "reject all" consent cookie (SOCS=CAI) so Google and YouTube never show their consent dialog, hides the dialog while it would render, and taps "Reject all" as a fallback.',
  runAt: 'start',
  frames: false,
  match: (u) => /(^|\.)google\.[a-z.]+$/.test(u.hostname) || /(^|\.)youtube\.com$/.test(u.hostname),
  defaults: { setCookie: true, hideDialog: true, autoReject: true },
  options: [
    { key: 'setCookie', type: 'bool', label: 'Pre-set "rejected" consent cookie' },
    { key: 'hideDialog', type: 'bool', label: 'Hide the consent dialog' },
    { key: 'autoReject', type: 'bool', label: 'Tap "Reject all" automatically' }
  ],
  run(api, cfg) {
    const host = location.hostname;
    const isYouTube = /(^|\.)youtube\.com$/.test(host);
    if (!isYouTube && !api.isGoogleHost(host)) return;
    const onConsentPage = host === 'consent.google.com' || host === 'consent.youtube.com';

    // 1. SOCS=CAI is the minimal "rejected / essential only" consent value.
    function setConsentCookie() {
      if (/(?:^|;\s*)SOCS=/.test(document.cookie)) return false;
      const m = isYouTube ? ['youtube.com', 'youtube.com'] : host.match(/(google\.[a-z.]+)$/);
      if (!m) return false;
      const expires = new Date(Date.now() + 400 * 864e5).toUTCString();
      document.cookie = `SOCS=CAI; domain=.${m[1]}; path=/; expires=${expires}; Secure; SameSite=Lax`;
      return true;
    }
    const cookieWasMissing = cfg.setCookie ? setConsentCookie() : true;

    // 2. Hide the dialog. Fix: the original forced `overflow: auto` on every
    // Google page permanently, which broke scrolling-locked apps like Maps.
    // Now the scroll unlock only applies while a consent dialog exists.
    if (cfg.hideDialog && !onConsentPage) {
      api.addStyle(`
        [role="dialog"]:has(#W0wltc), [aria-modal="true"]:has(#W0wltc), div:has(> [role="dialog"] #W0wltc),
        ytd-consent-bump-v2-lightbox, ytm-consent-bump-v2-renderer, tp-yt-iron-overlay-backdrop:has(+ ytd-consent-bump-v2-lightbox)
          { display: none !important; }
        html:has(#W0wltc), html:has(#W0wltc) body, html:has(ytm-consent-bump-v2-renderer) body, html:has(ytd-consent-bump-v2-lightbox) body
          { overflow: auto !important; position: static !important; }
      `, 'ioss-consent-css');
    }

    if (!cfg.autoReject || !(cookieWasMissing || onConsentPage)) return;

    // 3. Fallback: tap "Reject all".
    const REJECT_TEXTS = [
      'reject all', 'reject the use of cookies and other data for the purposes described', 'alle ablehnen', 'tout refuser',
      'rifiuta tutto', 'rechazar todo', 'alles afwijzen', 'odrzuć wszystko', 'ปฏิเสธทั้งหมด', 'rejeitar tudo', 'recusar tudo',
      'avvisa alla', 'afvis alle', 'avvis alle', 'hylkää kaikki', 'odmítnout vše', 'odmietnuť všetko', 'tümünü reddet',
      'отклонить все', 'відхилити все', 'απόρριψη όλων', 'összes elutasítása', 'respinge tot', 'отхвърляне на всички',
      'zavrni vse', 'odbij sve', 'atmesti viską', 'noraidīt visu', 'keeldu kõigist', 'すべて拒否', '모두 거부', '全部拒绝', '全部拒絕'
    ];
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let done = false;

    function findRejectButton() {
      const byId = document.getElementById('W0wltc');
      if (byId) return byId;
      const eom = document.querySelector('form input[name="set_eom"][value="true"]');
      if (eom && eom.form) {
        const submit = eom.form.querySelector('button, input[type="submit"]');
        if (submit) return submit;
      }
      const scope = document.querySelector('ytd-consent-bump-v2-lightbox, ytm-consent-bump-v2-renderer, [role="dialog"]') || document;
      for (const b of scope.querySelectorAll('button, [role="button"], input[type="submit"]')) {
        if (REJECT_TEXTS.includes(norm(b.innerText || b.value)) || REJECT_TEXTS.includes(norm(b.getAttribute('aria-label')))) return b;
      }
      return null;
    }

    api.onReady(() => {
      const tryReject = () => {
        if (done) return true;
        const btn = findRejectButton();
        if (!btn) return false;
        done = true;
        btn.click();
        api.log('Rejected cookies');
        return true;
      };
      if (tryReject()) return;
      const stop = api.observe(document.documentElement, { childList: true, subtree: true }, () => { if (tryReject()) stop(); });
      setTimeout(stop, 15000);
    });
  }
}));

  /* ---- module: google-privacy v2.3.0 ---- */
  register(({
  id: 'google-privacy',
  name: "Don't Track Me Google",
  version: '2.3.0',
  api: 1,
  source: "Don't Track Me Google 2.2.2-quiet (rob--w / KTZ)",
  description: 'Removes Google result redirect wrappers, click tracking, ping beacons, referrers, AMP wrappers and third-party tracking parameters, blocks telemetry beacons and can force SafeSearch off.',
  runAt: 'start',
  frames: false,
  match: (u) => /(^|\.)google\.[a-z.]+$/.test(u.hostname),
  defaults: {
    unwrapRedirects: true,
    removePing: true,
    removeInlineTracking: true,
    removeTrackingAttributes: true,
    noReferrer: true,
    stripGoogleTrackingParams: false,
    stripDestinationTrackingParams: true,
    unwrapAmpLinks: true,
    blockTrackingBeacons: true,
    removeTrackingPixels: true,
    cleanShadowDom: true,
    aggressiveHrefGuard: true,
    forceSafeSearchOff: true
  },
  options: [
    { key: 'unwrapRedirects', type: 'bool', label: 'Unwrap /url?q= redirect links' },
    { key: 'unwrapAmpLinks', type: 'bool', label: 'Unwrap AMP links' },
    { key: 'noReferrer', type: 'bool', label: 'No referrer on result links' },
    { key: 'removePing', type: 'bool', label: 'Remove ping tracking' },
    { key: 'removeInlineTracking', type: 'bool', label: 'Remove click handlers on outgoing links' },
    { key: 'removeTrackingAttributes', type: 'bool', label: 'Remove data-ved & co.' },
    { key: 'stripGoogleTrackingParams', type: 'bool', label: 'Strip Google params (ved, ei, …)' },
    { key: 'stripDestinationTrackingParams', type: 'bool', label: 'Strip utm_*, fbclid, … from results' },
    { key: 'blockTrackingBeacons', type: 'bool', label: 'Block telemetry beacons', help: 'Runs inside the page (needs page access)' },
    { key: 'removeTrackingPixels', type: 'bool', label: 'Remove tracking pixels' },
    { key: 'cleanShadowDom', type: 'bool', label: 'Clean links inside shadow DOM' },
    { key: 'aggressiveHrefGuard', type: 'bool', label: 'Guard against late href rewrites' },
    { key: 'forceSafeSearchOff', type: 'bool', label: 'Force SafeSearch off' }
  ],

  // Self-contained so it can also be serialised into the page world.
  makeCleaner: function (cfg) {
    const REDIRECT_PATHS = new Set(['/url', '/imgres', '/aclk', '/link', '/webhp', '/interstitial', '/translate', '/ml']);
    const TARGET_KEYS = ['q', 'url', 'u', 'imgurl', 'imgrefurl', 'adurl', 'continue', 'destination'];
    const GOOGLE_PARAMS = new Set(['gclid', 'dclid', 'gbraid', 'wbraid', 'gclsrc', 'ved', 'ei', 'sxsrf', 'iflsig', 'uule', 'gs_lcrp',
      'sourceid', 'client', 'oq', 'aqs', 'hl', 'gl', 'ictx', 'sca_esv', 'sca_upv']);
    const DEST_PARAMS = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_reader',
      'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'fbclid', 'igshid', 'ig_rid', 'msclkid', 'mc_eid', 'mc_cid', 'yclid', 'vero_id',
      'oly_anon_id', 'oly_enc_id', '_hsenc', '_hsmi', 'mkt_tok', 'ref_src', 'trk', 'trkCampaign', 'si', 'srsltid']);
    const BEACON_HOSTS = ['doubleclick.net', 'google-analytics.com', 'googletagmanager.com', 'googlesyndication.com', 'googleadservices.com'];
    const BEACON_PATHS = new Set(['/gen_204', '/client_204', '/csi', '/log204', '/generate_204']);
    const isHttp = (v) => /^https?:\/\//i.test(v);
    const base = () => location.href;

    function isGoogleHost(hostname) {
      const h = String(hostname || '').toLowerCase().replace(/\.$/, '');
      return /(^|\.)google\.(com|[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2}|org\.[a-z]{2}|net\.[a-z]{2})$/.test(h);
    }
    function decodeRepeatedly(v) {
      let r = v;
      for (let i = 0; i < 3; i++) {
        let d;
        try { d = decodeURIComponent(r); } catch (_) { break; }
        if (d === r) break;
        r = d;
      }
      return r;
    }
    function isTrackingBeaconUrl(raw) {
      if (!raw) return false;
      let u;
      try { u = new URL(raw, base()); } catch (_) { return false; }
      const h = u.hostname.toLowerCase().replace(/\.$/, '');
      if (isGoogleHost(h) && BEACON_PATHS.has(u.pathname)) return true;
      return BEACON_HOSTS.some((t) => h === t || h.endsWith('.' + t));
    }
    function extractRedirectTarget(url) {
      if (!cfg.unwrapRedirects || !url) return null;
      let p;
      try { p = new URL(url, base()); } catch (_) { return null; }
      if (!isHttp(p.href) || !isGoogleHost(p.hostname) || !REDIRECT_PATHS.has(p.pathname)) return null;
      for (const key of TARGET_KEYS) {
        const raw = p.searchParams.get(key);
        if (!raw) continue;
        const cand = decodeRepeatedly(raw).trim();
        if (!isHttp(cand)) continue;
        try { return new URL(cand).href; } catch (_) { /* malformed */ }
      }
      return null;
    }
    function unwrapAmp(url) {
      if (!cfg.unwrapAmpLinks || !url) return url;
      let p;
      try { p = new URL(url, base()); } catch (_) { return url; }
      if (!isGoogleHost(p.hostname)) return url;
      const s = p.pathname.match(/^\/amp\/s\/(.+)$/i);
      const plain = !s && p.pathname.match(/^\/amp\/(?!s\/)(.+)$/i);
      try {
        if (s) return new URL('https://' + s[1] + p.search + p.hash).href;
        if (plain) return new URL('http://' + plain[1] + p.search + p.hash).href;
      } catch (_) { /* keep */ }
      return url;
    }
    function strip(url, set, googleOnly) {
      let p;
      try { p = new URL(url); } catch (_) { return url; }
      if (googleOnly !== isGoogleHost(p.hostname)) return url;
      let changed = false;
      for (const k of Array.from(p.searchParams.keys())) {
        if (set.has(googleOnly ? k.toLowerCase() : k)) { p.searchParams.delete(k); changed = true; }
      }
      return changed ? p.href : url;
    }
    function safeOffUrl(input) {
      if (!cfg.forceSafeSearchOff || !input) return input;
      let u;
      try { u = new URL(input, base()); } catch (_) { return input; }
      if (!isGoogleHost(u.hostname)) return input;
      let changed = false;
      for (const k of ['safe', 'safesearch']) {
        if (u.searchParams.has(k) && u.searchParams.get(k) !== 'off') { u.searchParams.set(k, 'off'); changed = true; }
      }
      if (u.searchParams.get('safe') === null && (u.pathname === '/search' || u.pathname === '/webhp')) {
        u.searchParams.set('safe', 'off');
        changed = true;
      }
      return changed ? u.href : input;
    }
    function cleanUrl(url) {
      let r = extractRedirectTarget(url) || url;
      r = unwrapAmp(r);
      if (cfg.stripGoogleTrackingParams) r = strip(r, GOOGLE_PARAMS, true);
      if (cfg.stripDestinationTrackingParams) r = strip(r, DEST_PARAMS, false);
      return safeOffUrl(r);
    }
    return { cleanUrl, isTrackingBeaconUrl, isGoogleHost, safeOffUrl, isHttp };
  },

  // Runs in the page world: telemetry + late-href guards. These have no
  // effect from Safari's isolated content world, which is why the original
  // script's guards silently did nothing on iOS.
  pageGuards: function (makeCleaner, cfg) {
    if (window.__iossDtmg) return;
    window.__iossDtmg = true;
    const c = makeCleaner(cfg);
    if (cfg.blockTrackingBeacons) {
      try {
        if (navigator.sendBeacon) {
          const orig = navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon = function (url, data) {
            try { if (c.isTrackingBeaconUrl(String(url))) return true; } catch (_) { /* pass */ }
            return orig(url, data);
          };
        }
      } catch (_) { /* ignore */ }
      try {
        const of = window.fetch;
        if (typeof of === 'function') {
          window.fetch = function (input, init) {
            try {
              const url = typeof input === 'string' ? input : input && input.url;
              if (url && c.isTrackingBeaconUrl(url)) return Promise.resolve(new Response(null, { status: 204 }));
            } catch (_) { /* pass */ }
            return of.apply(this, arguments);
          };
        }
      } catch (_) { /* ignore */ }
      try {
        const X = window.XMLHttpRequest.prototype;
        const open = X.open;
        const send = X.send;
        X.open = function (m, url) {
          try { this.__iossBlocked = c.isTrackingBeaconUrl(String(url)); } catch (_) { this.__iossBlocked = false; }
          return open.apply(this, arguments);
        };
        X.send = function () { if (this.__iossBlocked) return undefined; return send.apply(this, arguments); };
      } catch (_) { /* ignore */ }
      try {
        const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (d && d.set) {
          Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true, enumerable: d.enumerable, get: d.get,
            set(v) { try { if (c.isTrackingBeaconUrl(String(v))) return; } catch (_) { /* pass */ } d.set.call(this, v); }
          });
        }
      } catch (_) { /* ignore */ }
    }
    if (cfg.aggressiveHrefGuard) {
      try {
        const d = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, 'href');
        if (d && d.set && d.get) {
          Object.defineProperty(HTMLAnchorElement.prototype, 'href', {
            configurable: true, enumerable: d.enumerable, get: d.get,
            set(v) {
              let out = v;
              try {
                if (typeof v === 'string') {
                  const cleaned = c.cleanUrl(new URL(v, location.href).href);
                  if (cleaned && c.isHttp(cleaned)) out = cleaned;
                }
              } catch (_) { out = v; }
              return d.set.call(this, out);
            }
          });
        }
      } catch (_) { /* ignore */ }
    }
  },

  run(api, cfg) {
    const self = this;
    const C = self.makeCleaner(cfg);
    const CLEAN_MARK = 'data-dtmg-cleaned';
    const stats = { links: 0, pixels: 0 };

    // ---- SafeSearch: the original only rewrote the address bar with
    // replaceState, so the results already on screen were still filtered.
    // Reload once with safe=off (loop-guarded per URL for locked accounts).
    if (cfg.forceSafeSearchOff && (location.pathname === '/search' || location.pathname === '/webhp')) {
      const target = C.safeOffUrl(location.href);
      if (target !== location.href) {
        let tried = false;
        try {
          const k = 'ioss-ss:' + target;
          tried = sessionStorage.getItem(k) === '1';
          sessionStorage.setItem(k, '1');
        } catch (_) { tried = true; }
        if (!tried && new URLSearchParams(location.search).get('q')) {
          location.replace(target);
          return;
        }
        try { history.replaceState(history.state, '', target); } catch (_) { /* ignore */ }
      }
    }

    // ---- page-world guards (telemetry, late href rewrites)
    if (cfg.blockTrackingBeacons || cfg.aggressiveHrefGuard) {
      const snapshot = JSON.parse(JSON.stringify(cfg));
      const code = `(${self.pageGuards})((${self.makeCleaner}), ${JSON.stringify(snapshot)});`;
      if (!api.pageRun(code)) api.onReady(() => api.pageRun(code) || api.log('page guards blocked by CSP'));
    }

    // ---- link cleaning (works from the isolated world: attributes are shared)
    function isExternal(href) {
      try { const u = new URL(href, location.href); return /^https?:$/.test(u.protocol) && !C.isGoogleHost(u.hostname); } catch (_) { return false; }
    }

    function stripHandlers(a) {
      for (const attr of ['onmousedown', 'onmouseup', 'onclick', 'ontouchstart', 'onpointerdown']) {
        if (a.hasAttribute(attr)) a.removeAttribute(attr);
      }
      const js = a.getAttribute('jsaction');
      if (js) {
        const kept = js.split(';').map((p) => p.trim()).filter((p) => !/^(mousedown|click|touchstart|pointerdown|clickmod|clickonly):/i.test(p)).join(';');
        if (kept !== js) { if (kept) a.setAttribute('jsaction', kept); else a.removeAttribute('jsaction'); }
      }
    }

    function cleanLink(a) {
      if (!a || a.tagName !== 'A') return false;
      const raw = a.getAttribute('href');
      if (!raw || raw.startsWith('#') || /^javascript:/i.test(raw)) return false;
      let changed = false;
      let abs;
      try { abs = new URL(raw, location.href).href; } catch (_) { abs = raw; }
      const cleaned = C.cleanUrl(abs);
      if (cleaned && cleaned !== abs && C.isHttp(cleaned)) { a.setAttribute('href', cleaned); changed = true; }
      if (cfg.removePing && a.hasAttribute('ping')) { a.removeAttribute('ping'); changed = true; }
      const external = isExternal(a.getAttribute('href'));
      // Fix: only touch handlers/referrer of links that leave Google. The
      // original stripped click handlers from every link, which broke
      // in-page Google controls ("People also ask", image viewer, tabs).
      if (external) {
        if (cfg.noReferrer) {
          a.referrerPolicy = 'no-referrer';
          const rel = new Set((a.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
          if (!rel.has('noreferrer')) { rel.add('noreferrer'); a.setAttribute('rel', Array.from(rel).join(' ')); }
        }
        if (cfg.removeInlineTracking) stripHandlers(a);
      }
      if (cfg.removeTrackingAttributes) {
        for (const attr of ['data-ved', 'data-jsarwt', 'data-usg', 'data-cthref']) if (a.hasAttribute(attr)) a.removeAttribute(attr);
      }
      if (changed) { stats.links++; a.setAttribute(CLEAN_MARK, '1'); }
      return changed;
    }

    function scrubPixels(root) {
      if (!cfg.removeTrackingPixels || !root.querySelectorAll) return;
      for (const n of root.querySelectorAll('img[src], link[rel~="preload"][href], link[rel~="prefetch"][href]')) {
        const src = n.tagName === 'IMG' ? n.getAttribute('src') : n.getAttribute('href');
        if (!src || !C.isTrackingBeaconUrl(src)) continue;
        if (n.tagName === 'IMG') { n.removeAttribute('src'); n.setAttribute('data-dtmg-blocked-pixel', '1'); } else n.remove();
        stats.pixels++;
      }
    }

    function cleanTree(root) {
      if (!root) return;
      if (root.tagName === 'A') cleanLink(root);
      if (root.querySelectorAll) {
        for (const a of root.querySelectorAll('a[href]')) cleanLink(a);
        scrubPixels(root);
      }
    }

    function shadowRoots(root, out = []) {
      for (const n of root.querySelectorAll('*')) if (n.shadowRoot) { out.push(n.shadowRoot); shadowRoots(n.shadowRoot, out); }
      return out;
    }

    const watchedShadows = new WeakSet();
    function fullScan() {
      cleanTree(document);
      if (cfg.cleanShadowDom && document.body) {
        for (const sr of shadowRoots(document.body)) {
          cleanTree(sr);
          if (!watchedShadows.has(sr)) { watchedShadows.add(sr); watch(sr); }
        }
      }
      if (cfg.forceSafeSearchOff) ensureSafeForms();
      api.log(`scan: ${stats.links} links cleaned, ${stats.pixels} pixels removed`);
    }

    // Fix: the original rescanned the whole document (plus a querySelectorAll('*')
    // shadow walk) for every mutation batch. Now added nodes are queued and
    // cleaned once per frame; full scans only run on a dirty, slow timer.
    const pending = new Set();
    let dirty = true;
    function watch(target) {
      const mo = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes') { if (m.target.tagName === 'A') pending.add(m.target); continue; }
          for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
        }
        if (pending.size) schedule();
      });
      mo.observe(target, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['href', 'ping', 'onmousedown', 'onclick', 'ontouchstart', 'onpointerdown', 'jsaction'] });
    }
    let queued = false;
    function schedule() {
      if (queued) return;
      queued = true;
      const flush = () => {
        queued = false;
        dirty = true;
        const nodes = Array.from(pending);
        pending.clear();
        for (const n of nodes) if (n.isConnected) cleanTree(n);
      };
      if (document.hidden) setTimeout(flush, 100); else requestAnimationFrame(flush);
    }

    function ensureSafeForms() {
      for (const f of document.querySelectorAll('input[name="safe"], input[name="safesearch"]')) if (f.value && f.value !== 'off') f.value = 'off';
      for (const form of document.querySelectorAll('form[action*="/search"], form[role="search"]')) {
        if (!form.querySelector('input[name="safe"]')) form.appendChild(Object.assign(document.createElement('input'), { type: 'hidden', name: 'safe', value: 'off' }));
      }
    }

    // Clean right before Google's own handlers see a tap.
    const onEvent = (e) => {
      const t = e.target && (e.target.nodeType === 3 ? e.target.parentElement : e.target);
      const a = t && t.closest && t.closest('a[href]');
      if (a) cleanLink(a);
    };
    for (const ev of ['touchstart', 'pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu']) {
      window.addEventListener(ev, onEvent, { capture: true, passive: true });
    }

    const startWatching = () => watch(document.documentElement);
    if (document.documentElement) startWatching(); else api.onReady(startWatching);
    api.onReady(fullScan);
    api.onLoad(fullScan);
    api.onUrlChange(() => { dirty = true; fullScan(); });
    api.every(4000, () => { if (dirty) { dirty = false; fullScan(); } });
  }
}));

  /* ---- module: google-lite v1.2.0 ---- */
  register(({
  id: 'google-lite',
  name: 'Google Lite (lighter Google & YouTube)',
  version: '1.2.0',
  api: 1,
  source: 'Google Lite 谷歌系轻量化 1.1.1',
  description: 'Throttles YouTube performance telemetry, lazy-loads images and frames below the fold on Google Search, Gmail and Drive, and pre-connects to Google\'s static servers. Does not touch ads, sign-in or the video stream.',
  runAt: 'start',
  frames: false,
  match: (u) => {
    const h = u.hostname;
    if (/^(accounts|myaccount|pay)\.google\.com$/.test(h) || u.pathname.startsWith('/sorry/')) return false;
    return /(^|\.)google\.[a-z.]+$/.test(h) || /(^|\.)youtube\.com$/.test(h) || /(^|\.)gmail\.com$/.test(h);
  },
  defaults: { telemetryThrottle: true, keepHistory: true, lazyBelowFold: true, preconnect: true, offSites: '' },
  options: [
    { key: 'telemetryThrottle', type: 'bool', label: 'Throttle YouTube telemetry', help: 'At most 5 performance pings per 30 s, 1 event log per 4 s' },
    { key: 'keepHistory', type: 'bool', label: 'Never throttle watch history & resume position', help: 'Keeps /api/stats/playback and /watchtime untouched' },
    { key: 'lazyBelowFold', type: 'bool', label: 'Lazy-load below-the-fold images (Search, Gmail, Drive)' },
    { key: 'preconnect', type: 'bool', label: 'Pre-connect to Google static servers' },
    { key: 'offSites', type: 'text', label: 'Turn off on these sites', help: 'Comma-separated, e.g. mail.google.com, drive.google.com' }
  ],

  // Runs in the page world: YouTube's fetch()/sendBeacon() can only be
  // wrapped there (from Safari's sandbox the wrapper would be invisible).
  pageThrottle: function (keepHistory) {
    if (window.__iossGoogleLite) return;
    window.__iossGoogleLite = true;
    const METRIC_RE = /(\/youtubei\/v1\/stats\/|\/csi_204|\/ytcsi|\/ytStats|\/ptracking|\/api\/stats\/|\/generate_204)/i;
    const BUSINESS_RE = /(\/youtubei\/v1\/log_event|\/watchtime|\/playback|\/qoe|\/ytdl)/i;
    const HISTORY_RE = /\/api\/stats\/(playback|watchtime)|\/youtubei\/v1\/player\/heartbeat/i;
    const LIMIT = 5;
    const WINDOW = 30000;
    const GAP = 4000;
    // Fix: the original started with a budget of 0 and only started the
    // refill timer after a request got through, so the budget never
    // refilled and every matching request was blocked forever, including
    // watch history and resume position.
    let budget = LIMIT;
    let resetTimer = 0;
    let lastBusiness = 0;
    const block = (url) => {
      if (!url) return false;
      if (keepHistory && HISTORY_RE.test(url)) return false;
      if (METRIC_RE.test(url)) {
        if (!resetTimer) resetTimer = setTimeout(() => { budget = LIMIT; resetTimer = 0; }, WINDOW);
        if (budget <= 0) return true;
        budget--;
        return false;
      }
      if (BUSINESS_RE.test(url)) {
        const now = Date.now();
        if (now - lastBusiness < GAP) return true;
        lastBusiness = now;
      }
      return false;
    };
    if (navigator.sendBeacon) {
      const beacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) { return block(String(url || '')) ? true : beacon(url, data); };
    }
    if (window.fetch) {
      const f = window.fetch;
      window.fetch = function (input, init) {
        let url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (_) { /* ignore */ }
        if (block(url)) return Promise.resolve(new Response(null, { status: 204 }));
        return f.apply(this, arguments);
      };
    }
  },

  run(api, cfg) {
    const host = location.hostname.toLowerCase();
    const off = String(cfg.offSites || '').split(',').map((s) => s.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
    if (off.includes(host.replace(/^www\./, ''))) return;

    const isYouTube = /(^|\.)youtube\.com$/.test(host);
    const isSearch = api.isGoogleHost(host) && location.pathname.startsWith('/search');
    const isGmail = host === 'mail.google.com' || /(^|\.)gmail\.com$/.test(host);
    const isDrive = host === 'drive.google.com' || host === 'docs.google.com';

    // 1. YouTube telemetry throttling (page world; retried once the page
    //    has a CSP nonce we can borrow).
    if (cfg.telemetryThrottle && isYouTube) {
      if (!api.pageRun(this.pageThrottle, !!cfg.keepHistory)) api.onReady(() => api.pageRun(this.pageThrottle, !!cfg.keepHistory) || api.log('telemetry throttle blocked by CSP'));
    }

    // 2. Pre-connect hints, placed in <head> instead of a hidden <div>.
    if (cfg.preconnect) {
      api.onReady(() => {
        if (document.getElementById('ioss-google-lite-hints')) return;
        const frag = document.createDocumentFragment();
        const add = (rel, href, cors) => { const l = document.createElement('link'); l.rel = rel; l.href = href; if (cors) l.crossOrigin = 'anonymous'; frag.appendChild(l); };
        for (const h of ['https://www.gstatic.com', 'https://fonts.gstatic.com']) if (!location.href.startsWith(h)) add('preconnect', h, true);
        const extra = isYouTube ? ['https://i.ytimg.com', 'https://yt3.ggpht.com'] : ['https://ssl.gstatic.com', 'https://lh3.googleusercontent.com', 'https://encrypted-tbn0.gstatic.com'];
        for (const h of extra) add('dns-prefetch', h);
        const marker = document.createElement('meta');
        marker.id = 'ioss-google-lite-hints';
        frag.appendChild(marker);
        (document.head || document.documentElement).appendChild(frag);
      });
    }

    // 3. Lazy-load below the fold. Only new images/frames are visited, in
    //    one batch per frame, instead of rescanning the whole page.
    if (cfg.lazyBelowFold && (isSearch || isGmail || isDrive)) {
      const MARGIN = 200;
      const mark = (n) => {
        if (n.hasAttribute('loading')) return;
        const top = n.getBoundingClientRect().top;
        if (top > innerHeight + MARGIN) { n.setAttribute('loading', 'lazy'); n.setAttribute('decoding', 'async'); }
      };
      const scan = (root) => {
        if (root.nodeType !== 1) return;
        if (root.tagName === 'IMG' || root.tagName === 'IFRAME') mark(root);
        root.querySelectorAll && root.querySelectorAll('img:not([loading]), iframe:not([loading])').forEach(mark);
      };
      const pending = new Set();
      let queued = false;
      const mo = new MutationObserver((muts) => {
        for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
        if (!pending.size || queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          const nodes = Array.from(pending);
          pending.clear();
          for (const n of nodes) if (n.isConnected) scan(n);
        });
      });
      const start = () => mo.observe(document.documentElement, { childList: true, subtree: true });
      if (document.documentElement) start(); else api.onReady(start);
      api.onReady(() => scan(document.body));
    }
  }
}));

  /* ---- module: reddit v1.1.0 ---- */
  register(({
  id: 'reddit',
  name: 'Reddit: remove login wall',
  version: '1.1.0',
  api: 1,
  source: 'Remove Reddit Login Requirement 1.0.12 (SoCuul)',
  description: 'Removes the modals that force you to log in or open the app for NSFW/"mature" posts, un-blurs content, re-enables scrolling and restores deferred embeds.',
  runAt: 'start',
  frames: false,
  match: (u) => /(^|\.)reddit\.com$/.test(u.hostname),
  defaults: { over18Cookie: true, hideAppPrompts: true, unblur: true },
  options: [
    { key: 'over18Cookie', type: 'bool', label: 'Set the "over 18" cookie', help: 'Prevents "are you sure?" interstitials' },
    { key: 'hideAppPrompts', type: 'bool', label: 'Hide "open in app" prompts' },
    { key: 'unblur', type: 'bool', label: 'Un-blur NSFW/spoiler media' }
  ],

  // Runs in the page world when possible: properties such as
  // shreddit-blurred-container.handleClick() and shreddit-embed.html are
  // defined by Reddit's JS and are invisible from Safari's content world.
  pageMain: function (cfg) {
    if (window.__iossReddit) return;
    window.__iossReddit = true;
    const handled = new WeakSet();
    const stripStyle = (node, re) => {
      const s = node && node.getAttribute('style');
      if (s && re.test(s)) node.setAttribute('style', s.replace(re, ''));
    };
    const sweep = () => {
      stripStyle(document.body, /pointer-events:\s*none;?\s*overflow:\s*hidden;?/g);
      stripStyle(document.querySelector('.sidebar-grid'), /filter:\s*blur\(4px\);?/g);
      const overlays = [
        document.querySelector('xpromo-nsfw-blocking-modal-desktop'),
        document.querySelector('xpromo-nsfw-bypassable-modal-desktop'),
        document.querySelector('xpromo-nsfw-blocking-container') && document.querySelector('xpromo-nsfw-blocking-container').shadowRoot &&
          document.querySelector('xpromo-nsfw-blocking-container').shadowRoot.querySelector('.prompt'),
        document.querySelector('.configured-xpromo-modal'),
        document.querySelector('#blocking-modal-contents:has(.text-category-nsfw)'),
        document.querySelector('#nsfw-qr-dialog'),
        document.querySelector('div[style*="position: fixed"][style*="inset: 0px"][style*="backdrop-filter: blur(4px)"]'),
        document.querySelector('faceplate-modal:has(> div.text-category-nsfw)'),
        cfg.hideAppPrompts ? document.querySelector('xpromo-app-selector') : null
      ];
      overlays.forEach((o) => o && o.remove());
      if (cfg.unblur) {
        document.querySelectorAll('shreddit-blurred-container').forEach((c) => {
          if (handled.has(c)) return;
          if (c.isNsfwAllowed === false || c.isNsfwAllowed === undefined) { try { c.isNsfwAllowed = true; } catch (_) { /* ignore */ } }
          if (typeof c.handleClick === 'function') { handled.add(c); try { c.handleClick(); } catch (_) { /* ignore */ } }
        });
      }
      document.querySelectorAll('xpromo-nsfw-blocking-container').forEach((c) => {
        const p = c.shadowRoot && c.shadowRoot.querySelector('div.prompt');
        if (p) p.style.setProperty('display', 'none', 'important');
      });
      document.querySelectorAll('shreddit-embed[data-embed-obscured-deferred]').forEach((c) => {
        if (!c.html) return;
        try { c.replaceWith(document.createRange().createContextualFragment(c.html)); } catch (_) { /* CSP/TT */ }
      });
      document.querySelectorAll('devvit2-custom-post').forEach((c) => {
        const s = c.querySelector('devvit2-surface');
        const gate = s && s.shadowRoot && s.shadowRoot.querySelector('devvit2-dialog devvit2-modal-card devvit2-blur-gate');
        if (gate) gate.remove();
      });
    };
    // Fix: the original ran this whole sweep synchronously for every single
    // DOM mutation; now it runs at most once per animation frame.
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; sweep(); });
    });
    const start = () => { mo.observe(document.documentElement, { subtree: true, childList: true }); sweep(); };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  },

  run(api, cfg) {
    // Fix: GM_cookie does not exist in iOS userscript managers. In the
    // original, that threw a ReferenceError and the whole script died
    // before any modal was removed. A plain document cookie does the job.
    if (cfg.over18Cookie && !/(?:^|;\s*)over18=/.test(document.cookie)) {
      document.cookie = `over18=true; domain=.reddit.com; path=/; max-age=${400 * 86400}; Secure; SameSite=Lax`;
    }

    // Hide known overlays with CSS first so they never flash on screen.
    api.addStyle(`
      xpromo-nsfw-blocking-modal-desktop, xpromo-nsfw-bypassable-modal-desktop, .configured-xpromo-modal, #nsfw-qr-dialog
        ${cfg.hideAppPrompts ? ', xpromo-app-selector' : ''} { display: none !important; }
      body[style*="pointer-events: none"] { pointer-events: auto !important; overflow: auto !important; }
      .sidebar-grid[style*="blur"] { filter: none !important; }
    `, 'ioss-reddit-css');

    const snapshot = JSON.parse(JSON.stringify(cfg));
    const inject = () => api.pageRun(this.pageMain, snapshot);
    if (!inject()) {
      api.onReady(() => {
        // Last resort: run in the content world. Overlay removal and
        // scroll unlock still work; un-blurring may not.
        if (!inject()) this.pageMain(snapshot);
      });
    }
  }
}));

  /* ---- module: instagram v1.1.0 ---- */
  register(({
  id: 'instagram',
  name: 'Instagram: browse without logging in',
  version: '1.1.0',
  api: 1,
  source: 'Browse Instagram Without Logging In 1.0 (dankdave69)',
  description: 'Removes the login/sign-up pop-up that blocks profiles and posts after scrolling, re-enables scrolling, and opens posts and reels as full pages so they can be viewed without an account.',
  runAt: 'ready',
  frames: false,
  match: (u) => u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com',
  defaults: { autoClose: true, openPostsDirectly: true, hideLoginBanner: true },
  options: [
    { key: 'autoClose', type: 'bool', label: 'Close the login pop-up automatically', help: 'Off: show a close (✕) button on it instead, like the original' },
    { key: 'openPostsDirectly', type: 'bool', label: 'Open posts & reels as full pages', help: 'The in-feed viewer asks you to log in' },
    { key: 'hideLoginBanner', type: 'bool', label: 'Hide the "Log in to see more" banner at the bottom' }
  ],
  run(api, cfg) {
    const LOGIN_SIGNS = 'input[name="username"], input[name="password"], a[href*="/accounts/login"], a[href*="/accounts/emailsignup"], a[href*="/accounts/signup"], form[id*="login" i]';
    const POST_SIGNS = 'article, video, [role="dialog"] img[srcset][sizes]';
    const handled = new WeakSet();

    // Walk up to the outermost fixed-position layer (the dimmed backdrop).
    function overlayOf(dialog) {
      let layer = dialog;
      for (let n = dialog; n && n !== document.body; n = n.parentElement) {
        if (getComputedStyle(n).position === 'fixed') layer = n;
      }
      return layer;
    }

    function unlockScroll() {
      for (const n of [document.documentElement, document.body]) {
        if (n && /hidden/.test(n.style.overflow)) n.style.overflow = '';
      }
    }

    // Fix: the original relied on 2020-era class names ("RnEpo _Yhr4") that
    // Instagram no longer uses, so it never found the pop-up any more. The
    // wall is now recognised by what it contains: a login form or sign-up
    // link, and no post content.
    function findWalls() {
      const walls = [];
      for (const d of document.querySelectorAll('[role="dialog"], [role="presentation"], [aria-modal="true"]')) {
        if (handled.has(d) || !d.querySelector(LOGIN_SIGNS) || d.querySelector(POST_SIGNS)) continue;
        walls.push(d);
      }
      return walls;
    }

    function addCloseButton(layer) {
      if (layer.querySelector('.ioss-ig-close')) return;
      // Fix: the original placed a 30px button at coordinates computed for a
      // 400px desktop dialog and re-added it (plus a new resize listener)
      // every 500 ms. This one is a fixed 44pt button under the notch.
      layer.appendChild(api.el('button', {
        type: 'button', class: 'ioss-ig-close', 'aria-label': 'Close', text: '✕',
        style: { position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 10px)', right: '10px', zIndex: '2147483000',
          width: '44px', height: '44px', borderRadius: '22px', border: '0', background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: '20px' },
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); hide(layer); }
      }));
    }

    // Fix: hide instead of remove(). Deleting nodes React still manages
    // (as the original did) can crash Instagram's page when it re-renders.
    function hide(layer) {
      layer.style.setProperty('display', 'none', 'important');
      unlockScroll();
      api.log('login wall hidden');
    }

    function sweep() {
      for (const d of findWalls()) {
        handled.add(d);
        const layer = overlayOf(d);
        if (cfg.autoClose) hide(layer); else addCloseButton(layer);
      }
      if (cfg.hideLoginBanner) {
        for (const a of document.querySelectorAll('a[href*="/accounts/login"], a[href*="/accounts/emailsignup"]')) {
          let n = a;
          while (n && n !== document.body && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
          if (!n || n === document.body || handled.has(n)) continue;
          const r = n.getBoundingClientRect();
          // Only bottom banners; the top bar holds navigation.
          if (r.top > innerHeight / 2 && r.height < innerHeight * 0.4 && !n.querySelector(POST_SIGNS)) {
            handled.add(n);
            n.style.setProperty('display', 'none', 'important');
          }
        }
      }
    }

    // Fix: the original re-assigned onclick on every link in a
    // setInterval(..., 0) loop (hundreds of times a second, a constant
    // battery drain). One capture-phase listener does the same job and also
    // covers reels.
    if (cfg.openPostsDirectly) {
      window.addEventListener('click', (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (!a || a.target === '_blank') return;
        let url;
        try { url = new URL(a.href); } catch (_) { return; }
        if (url.origin !== location.origin || !/^\/(?:[^/]+\/)?(p|reel|reels|tv)\/[^/]+/.test(url.pathname)) return;
        if (url.pathname === location.pathname) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        location.href = url.href;
      }, true);
    }

    sweep();
    api.observe(document.body, { childList: true, subtree: true }, sweep, { throttle: 300 });
    api.onUrlChange(() => setTimeout(sweep, 300));
  }
}));

  /* ---- module: yt-adblock v6.22.0 ---- */
  register(({
  id: 'yt-adblock',
  name: 'YouTube: remove ads',
  version: '6.22.0',
  api: 1,
  source: 'youtube-adb 6.21 (iamfugui)',
  description: 'Hides banner/feed/search ads on YouTube (mobile and desktop), skips or fast-forwards video ads and removes the "ad blockers are not allowed" pop-up. Does not interfere with the network.',
  runAt: 'start',
  frames: false,
  match: (u) => /(^|\.)youtube\.com$/.test(u.hostname) && !/^(accounts|studio|music)\./.test(u.hostname) &&
    !/^\/(live_chat_replay|persist_identity)/.test(u.pathname),
  defaults: { hideAds: true, skipVideoAds: true, removePopup: true, muteAds: true },
  options: [
    { key: 'hideAds', type: 'bool', label: 'Hide banner, feed and search ads' },
    { key: 'skipVideoAds', type: 'bool', label: 'Skip video ads' },
    { key: 'muteAds', type: 'bool', label: 'Mute ads while they are being skipped' },
    { key: 'removePopup', type: 'bool', label: 'Remove the ad-blocker warning pop-up' }
  ],
  run(api, cfg) {
    const AD_SELECTORS = [
      // desktop (original list)
      '#masthead-ad',
      'ytd-rich-item-renderer.style-scope.ytd-rich-grid-row #content:has(.ytd-display-ad-renderer)',
      'ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)',
      '.video-ads.ytp-ad-module',
      'tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)',
      'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',
      '#related #player-ads',
      '#related ytd-ad-slot-renderer',
      'ytd-ad-slot-renderer',
      'yt-mealbar-promo-renderer',
      'ytd-popup-container:has(a[href="/premium"])',
      // m.youtube.com (iPhone)
      'ad-slot-renderer',
      'ytm-companion-ad-renderer',
      'ytm-companion-slot',
      'ytm-promoted-sparkles-web-renderer',
      'ytm-promoted-sparkles-text-search-renderer',
      'ytm-promoted-video-renderer',
      'ytm-ad-slot-renderer',
      'ytm-item-section-renderer:has(> lazy-list > ad-slot-renderer:only-child)',
      'ytm-rich-item-renderer:has(ad-slot-renderer)',
      'ytm-mealbar-promo-renderer',
      'ytm-paid-content-overlay-renderer'
    ];
    if (cfg.hideAds) api.addStyle(AD_SELECTORS.map((s) => `${s}{display:none!important}`).join('\n'), 'ioss-ytadb-css');

    const SKIP_SEL = '.ytp-ad-skip-button, .ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-container button, button[id^="skip-button"], .ytm-ad-skip-button, .ytp-ad-skip-button-slot button';
    let skipping = false;
    let mutedByUs = false;
    let rateBefore = 1;

    const player = () => document.querySelector('#movie_player, .html5-video-player');
    const videoOf = (p) => (p && p.querySelector('video')) || document.querySelector('video');

    function tap(btn) {
      btn.click();
      // Fix: the original built a synthetic Touch() here. Safari has no Touch
      // constructor, so that threw on every ad and spammed errors.
      for (const type of ['pointerdown', 'pointerup']) {
        try { btn.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch' })); } catch (_) { /* old Safari */ }
      }
    }

    function handleAd() {
      const p = player();
      const v = videoOf(p);
      if (!v) return;
      const adShowing = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))) ||
        !!document.querySelector('.video-ads.ytp-ad-module .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout');
      if (adShowing) {
        if (!skipping) {
          skipping = true;
          rateBefore = v.playbackRate || 1;
          mutedByUs = false;
        }
        if (cfg.muteAds && !v.muted) { v.muted = true; mutedByUs = true; }
        const btn = document.querySelector(SKIP_SEL);
        if (btn) tap(btn);
        if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.1) {
          try { v.currentTime = Math.max(0, v.duration - 0.05); } catch (_) { /* not seekable yet */ }
        }
        try { if (v.playbackRate < 16) v.playbackRate = 16; } catch (_) { /* rate not allowed */ }
        if (v.paused) v.play().catch(() => {});
      } else if (skipping) {
        // Fix: restore what we changed. The original left videos muted and
        // force-played any paused video near 0s on every DOM change, which
        // made it impossible to pause right at the start of a video.
        skipping = false;
        try { v.playbackRate = rateBefore; } catch (_) { /* ignore */ }
        if (mutedByUs) { v.muted = false; mutedByUs = false; }
        if (v.paused && v.currentTime < 1) v.play().catch(() => {});
      }
    }

    function resumeVideo() {
      const v = document.querySelector('video.html5-main-video') || document.querySelector('video');
      if (v && v.paused) v.play().catch(() => {});
    }

    function removePopup() {
      let removed = false;
      document.querySelectorAll('ytd-enforcement-message-view-model, ytm-enforcement-message-view-model').forEach((m) => {
        (m.closest('tp-yt-paper-dialog, ytd-popup-container > *, .ytd-popup-container') || m).remove();
        removed = true;
      });
      document.querySelectorAll('ytd-popup-container').forEach((c) => {
        if (c.querySelector('a[href="/premium"]') && c.querySelector('ytd-enforcement-message-view-model, tp-yt-paper-dialog')) { c.remove(); removed = true; }
      });
      document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => {
        if (removed || b.style.zIndex === '2201') { b.className = ''; b.removeAttribute('opened'); if (removed) b.remove(); }
      });
      if (removed) { api.log('removed ad-blocker pop-up'); resumeVideo(); }
    }

    const tick = () => {
      if (cfg.skipVideoAds) handleAd();
      if (cfg.removePopup) removePopup();
    };

    api.onReady(() => {
      tick();
      // Fix: the original ran four handlers synchronously for every DOM
      // mutation with two separate observers. One throttled observer now
      // also watches the player's class (ad start/end is a class change).
      api.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, tick, { throttle: 120 });
      // Safety net while a video page is open.
      api.every(1000, () => { if (/^\/(watch|shorts|embed)/.test(location.pathname)) tick(); });
    });
  }
}));

  /* ---- module: yt-sponsorblock v2026.4.0 ---- */
  register(({
  id: 'yt-sponsorblock',
  name: 'SponsorBlock: skip sponsors',
  version: '2026.4.0',
  api: 1,
  source: 'Simple Sponsor Skipper 2026.03 (mthsk)',
  description: 'Skips sponsors, intros, outros, self-promotion and other segments on YouTube, its embeds, Invidious instances and Odysee using the SponsorBlock database.',
  runAt: 'start',
  frames: true,
  INVIDIOUS: ['yt.artemislena.eu', 'tube.cadence.moe', 'y.com.sb', 'invidious.esmailelbob.xyz', 'invidious.flokinet.to', 'inv.frail.com.br',
    'invidious.garudalinux.org', 'invidious.kavin.rocks', 'inv.nadeko.net', 'invidious.namazso.eu', 'iv.nboeck.de', 'invidious.nerdvpn.de',
    'youtube.owacon.moe', 'inv.pistasjis.net', 'invidious.projectsegfau.lt', 'inv.bp.projectsegfau.lt', 'inv.in.projectsegfau.lt',
    'inv.us.projectsegfau.lt', 'vid.puffyan.us', 'invidious.sethforprivacy.com', 'invidious.slipfox.xyz', 'invidious.snopyta.org',
    'inv.vern.cc', 'invidious.weblibre.org', 'youchu.be', 'yewtu.be'],
  match: function (u) {
    const h = u.hostname;
    if (/^(m|www)\.youtube\.com$/.test(h)) return true;
    if (h === 'www.youtube-nocookie.com') return u.pathname.startsWith('/embed/');
    return h === 'odysee.com' || this.INVIDIOUS.includes(h);
  },
  defaults: {
    cat_sponsor: true, cat_intro: true, cat_outro: true, cat_interaction: true, cat_selfpromo: true, cat_preview: true,
    cat_music_offtopic: true, cat_filler: false, highlight: true, toasts: true, upvotes: -2, hashing: true, instance: 'sponsor.ajay.app'
  },
  options: [
    { key: 'cat_sponsor', type: 'bool', label: 'Skip sponsors' },
    { key: 'cat_intro', type: 'bool', label: 'Skip intros' },
    { key: 'cat_outro', type: 'bool', label: 'Skip outros / end cards' },
    { key: 'cat_interaction', type: 'bool', label: 'Skip "like & subscribe" reminders' },
    { key: 'cat_selfpromo', type: 'bool', label: 'Skip self-promotion' },
    { key: 'cat_preview', type: 'bool', label: 'Skip previews / recaps' },
    { key: 'cat_music_offtopic', type: 'bool', label: 'Skip non-music parts of music videos' },
    { key: 'cat_filler', type: 'bool', label: 'Skip filler (very aggressive)' },
    { key: 'highlight', type: 'bool', label: 'Offer to jump to the highlight' },
    { key: 'toasts', type: 'bool', label: 'Show a message (with Undo) when skipping' },
    { key: 'upvotes', type: 'number', label: 'Minimum segment votes', min: -2, max: 100 },
    { key: 'hashing', type: 'bool', label: 'Private lookups (hash prefix)', help: 'Never sends the full video ID' },
    { key: 'instance', type: 'text', label: 'Database server' }
  ],

  run(api, cfg) {
    const CATS = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'preview', 'music_offtopic', 'filler'];
    const LABEL = { sponsor: 'sponsor', intro: 'intro', outro: 'outro', interaction: 'interaction reminder', selfpromo: 'self-promotion',
      preview: 'preview', music_offtopic: 'non-music', filler: 'filler', combined: 'combined' };
    const PLAYER_SEL = '#movie_player video, video.html5-main-video, video#player_html5_api, video#player, video#video, video#vjs_video_3_html5_api, .vjs-tech';
    const isOdysee = location.hostname === 'odysee.com';
    const notify = (msg, extra) => { if (cfg.toasts && api.isTop) api.toast(msg, extra); };

    const fmt = (s) => {
      s = Math.max(0, Math.floor(s));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = String(s % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
    };

    function videoIdFromUrl() {
      const p = new URLSearchParams(location.search);
      if (p.get('v')) return p.get('v');
      const m = location.pathname.match(/^\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }

    // Fix: the original crashed with a TypeError whenever a segment was
    // dropped before the first kept one (newSegments[-1]), and then skipped
    // nothing at all. It also compared highlight votes to a non-existent
    // "upvotes" field. Segments are now sorted and merged safely.
    function processSegments(segments) {
      if (!Array.isArray(segments)) return { list: [], poi: null };
      const sorted = segments.slice().sort((a, b) => a.segment[0] - b.segment[0]);
      const list = [];
      let poi = null;
      for (const s of sorted) {
        if (s.votes < cfg.upvotes) continue;
        if (s.category === 'poi_highlight') { if (!poi || s.votes > poi.votes) poi = s; continue; }
        if (s.actionType && s.actionType !== 'skip') continue;
        const last = list[list.length - 1];
        if (last && last.segment[1] >= s.segment[0]) {
          if (s.segment[1] > last.segment[1]) { last.segment = [last.segment[0], s.segment[1]]; last.category = last.category === s.category ? s.category : 'combined'; }
          continue;
        }
        list.push({ category: s.category, segment: [s.segment[0], s.segment[1]], videoDuration: s.videoDuration });
      }
      return { list, poi: poi ? poi.segment[0] : null };
    }

    async function fetchSegments(videoId) {
      const categories = CATS.filter((c) => cfg['cat_' + c]);
      if (!categories.length) categories.push('sponsor');
      if (cfg.highlight) categories.push('poi_highlight');
      const inst = String(cfg.instance || 'sponsor.ajay.app').replace(/^https?:\/\//, '').replace(/\s*\(.*$/, '').replace(/\/+$/, '');
      const cat = encodeURIComponent(JSON.stringify(categories));
      let url;
      if (cfg.hashing) {
        const hash = await api.sha256(videoId);
        url = `https://${inst}/api/skipSegments/${hash.slice(0, 4)}?categories=${cat}`;
      } else {
        url = `https://${inst}/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${cat}`;
      }
      const r = await api.request({ url, headers: { Accept: 'application/json' }, timeout: 15000 });
      if (r.status === 404) return [];
      if (r.status !== 200) throw new Error('SponsorBlock HTTP ' + r.status);
      const data = JSON.parse(r.text);
      if (!cfg.hashing) return data;
      const hit = data.find((v) => v.videoID === videoId);
      return hit ? hit.segments : [];
    }

    let session = null;

    function start(videoId) {
      if (session && session.videoId === videoId) return;
      if (session) session.stop();
      session = makeSession(videoId);
    }

    function makeSession(videoId) {
      const s = { videoId, stopped: false, player: null, segs: [], poi: null, ignore: new Set(), timers: [] };
      const later = (fn, ms) => { const t = setTimeout(fn, ms); s.timers.push(t); return t; };
      let precise = 0;

      const onTime = () => {
        const v = s.player;
        if (s.stopped || !v || v.paused || v.seeking) return;
        const t = v.currentTime;
        for (let i = 0; i < s.segs.length; i++) {
          const seg = s.segs[i];
          if (s.ignore.has(i)) continue;
          const [a, b] = seg.segment;
          if (t >= a && t < b - 0.2) {
            v.currentTime = b;
            api.log(`skipped ${seg.category} ${a}-${b}`);
            notify(`Skipped ${LABEL[seg.category] || seg.category} (${i + 1}/${s.segs.length})`, {
              action: 'Undo', onAction: () => { s.ignore.add(i); v.currentTime = a; }
            });
            return;
          }
          // timeupdate only fires every ~250 ms on iOS: schedule an exact
          // jump when a segment is about to start so less of it is heard.
          if (a > t && a - t < 1 && !precise) {
            precise = later(() => { precise = 0; onTime(); }, ((a - t) / (v.playbackRate || 1)) * 1000 + 15);
          }
        }
      };

      const bind = (v) => {
        if (s.player === v) return;
        if (s.player) { s.player.removeEventListener('timeupdate', onTime); s.player.removeEventListener('seeked', onTime); s.player.removeEventListener('play', onTime); }
        s.player = v;
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('seeked', onTime);
        v.addEventListener('play', onTime);
      };

      // Fix: the original polled for the player every 10 ms forever (also
      // after leaving the page) and stacked listeners on every navigation.
      const findPlayer = () => {
        if (s.stopped) return;
        const v = document.querySelector(PLAYER_SEL);
        if (v) bind(v);
      };
      s.watch = setInterval(findPlayer, 1000);

      fetchSegments(videoId).then((segments) => {
        if (s.stopped) return;
        const { list, poi } = processSegments(segments);
        s.segs = list;
        s.poi = poi;
        api.log(`${list.length} segment(s) for ${videoId}`);
        findPlayer();
        if (list.length) {
          let dur = list[0].videoDuration || 0;
          for (const seg of list) dur -= seg.segment[1] - seg.segment[0];
          notify(`${list.length} skippable segment${list.length > 1 ? 's' : ''} found` + (dur > 0 ? ` · ${fmt(dur)} without them` : ''), { timeout: 2500 });
        }
        if (poi != null && cfg.highlight) {
          later(() => {
            if (!s.stopped && (!s.player || s.player.currentTime < poi)) {
              api.toast(`Highlight at ${fmt(poi)}`, { timeout: 7000, action: 'Jump', onAction: () => { if (s.player) s.player.currentTime = poi; } });
            }
          }, 1500);
        }
        onTime();
      }).catch((e) => api.log('lookup failed', e.message));

      s.stop = () => {
        s.stopped = true;
        clearInterval(s.watch);
        s.timers.forEach(clearTimeout);
        if (s.player) { s.player.removeEventListener('timeupdate', onTime); s.player.removeEventListener('seeked', onTime); s.player.removeEventListener('play', onTime); }
      };
      return s;
    }

    function check() {
      const id = videoIdFromUrl();
      if (id) start(id);
      else if (session && !isOdysee) { session.stop(); session = null; }
    }

    if (isOdysee) {
      // Odysee mirrors many YouTube uploads; the YouTube ID is in the cover art.
      api.onReady(() => api.observe(document.body, { childList: true, subtree: true }, () => {
        const cover = document.querySelector('div.content__cover');
        if (!cover || !document.querySelector('#vjs_video_3')) return;
        const bg = cover.style.backgroundImage || '';
        const thumb = bg.substring(bg.indexOf('"') + 1).split('"')[0];
        let id = null;
        if (/ytimg\.com|img\.youtube\.com/.test(thumb)) id = thumb.split('/vi/').pop().split('/')[0];
        else if (thumb && !/\.(webp|jpe?g|gif|png)$/i.test(thumb)) id = thumb.split('/').pop();
        if (id) start(id);
      }, { throttle: 500 }));
      return;
    }

    check();
    api.onUrlChange(check);
  }
}));

  /* ---- module: yt-dislike v3.2.3 ---- */
  register(({
  id: 'yt-dislike',
  name: 'Return YouTube Dislike',
  version: '3.2.3',
  api: 1,
  source: 'Return YouTube Dislike 3.2.0-ios (Anarios & JRWR)',
  description: 'Shows dislike counts again (watch pages and Shorts, mobile and desktop) using the returnyoutubedislike.com API, and anonymously contributes your own likes/dislikes.',
  runAt: 'ready',
  frames: false,
  match: (u) => /^(m|www)\.youtube\.com$/.test(u.hostname),
  defaults: {
    disableVoteSubmission: false,
    numberDisplayFormat: 'compactShort',
    numberDisplayRoundDown: true,
    numberDisplayReformatLikes: false,
    coloredThumbs: false,
    coloredBar: false,
    colorTheme: 'classic',
    rateBarEnabled: true,
    tooltipPercentageMode: 'none',
    disableLogging: true
  },
  options: [
    { key: 'disableVoteSubmission', type: 'bool', label: "Don't send my likes/dislikes" },
    { key: 'numberDisplayFormat', type: 'select', label: 'Number format', choices: [['compactShort', '1.2K'], ['compactLong', '1.2 thousand'], ['standard', '1,234']] },
    { key: 'numberDisplayRoundDown', type: 'bool', label: 'Round numbers down' },
    { key: 'numberDisplayReformatLikes', type: 'bool', label: 'Re-format like count the same way' },
    { key: 'coloredThumbs', type: 'bool', label: 'Colour the thumbs' },
    { key: 'coloredBar', type: 'bool', label: 'Colour the ratio bar (desktop)' },
    { key: 'colorTheme', type: 'select', label: 'Colours', choices: [['classic', 'Green / red'], ['accessible', 'Blue / yellow'], ['neon', 'Cyan / pink']] },
    { key: 'rateBarEnabled', type: 'bool', label: 'Like/dislike ratio bar (desktop)' },
    { key: 'tooltipPercentageMode', type: 'select', label: 'Ratio bar tooltip', choices: [['none', 'Counts'], ['dash_like', 'Counts - like %'], ['dash_dislike', 'Counts - dislike %'], ['both', 'Both %'], ['only_like', 'Like %'], ['only_dislike', 'Dislike %']] },
    { key: 'disableLogging', type: 'bool', label: 'Quiet console' }
  ],
  run(api, cfg) {
// ---------------------------------------------------------------------------
// Below is the original Return YouTube Dislike userscript (webpack bundle),
// kept close to upstream so future upstream fixes are easy to merge. Changes
// for the suite / iPhone are marked "Suite:".
// ---------------------------------------------------------------------------
;// CONCATENATED MODULE: ./Extensions/common/vote-client.js
const DEFAULT_API_BASE_URL = "https://returnyoutubedislikeapi.com";
const USER_ID_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const VALID_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const VALID_VOTE_VALUES = new Set([-1, 0, 1]);

class VoteClientError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "VoteClientError";
    this.status = options.status;
    this.cause = options.cause;
  }
}

function countLeadingZeroes(bytes, limit = Infinity) {
  let zeroes = 0;

  for (const originalValue of bytes) {
    let value = originalValue;
    if (value === 0) {
      zeroes += 8;
    } else {
      let count = 1;
      if (value >>> 4 === 0) {
        count += 4;
        value <<= 4;
      }
      if (value >>> 6 === 0) {
        count += 2;
        value <<= 2;
      }
      zeroes += count - (value >>> 7);
      break;
    }

    if (zeroes >= limit) break;
  }

  return zeroes;
}

function generateUserId(cryptoImpl = globalThis.crypto, length = 36) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError("User ID length must be a positive integer");
  }
  if (!cryptoImpl?.getRandomValues) {
    throw new VoteClientError("Web Crypto random generation is unavailable");
  }

  const values = new Uint32Array(length);
  cryptoImpl.getRandomValues(values);
  let result = "";
  for (const value of values) {
    result += USER_ID_CHARSET[value % USER_ID_CHARSET.length];
  }
  return result;
}

function decodeBase64(value) {
  if (typeof atob !== "function") {
    throw new VoteClientError("Base64 decoding is unavailable");
  }
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes) {
  if (typeof btoa !== "function") {
    throw new VoteClientError("Base64 encoding is unavailable");
  }
  return btoa(String.fromCharCode(...bytes));
}

async function solvePuzzle(puzzle, cryptoImpl = globalThis.crypto, maxAttempts) {
  if (!puzzle || typeof puzzle.challenge !== "string" || !Number.isInteger(puzzle.difficulty)) {
    throw new VoteClientError("The API returned an invalid puzzle");
  }
  if (!cryptoImpl?.subtle?.digest) {
    throw new VoteClientError("Web Crypto hashing is unavailable");
  }

  const challenge = decodeBase64(puzzle.challenge);
  if (challenge.length !== 16) {
    throw new VoteClientError("The API returned an invalid puzzle challenge");
  }

  const attempts = maxAttempts ?? Math.pow(2, puzzle.difficulty) * 3;
  if (!Number.isSafeInteger(attempts) || attempts <= 0) {
    throw new VoteClientError("The puzzle attempt limit is invalid");
  }

  const buffer = new ArrayBuffer(20);
  const byteView = new Uint8Array(buffer);
  const integerView = new Uint32Array(buffer);
  byteView.set(challenge, 4);

  for (let counter = 0; counter < attempts; counter++) {
    integerView[0] = counter;
    const hash = await cryptoImpl.subtle.digest("SHA-512", buffer);
    if (countLeadingZeroes(new Uint8Array(hash), puzzle.difficulty) >= puzzle.difficulty) {
      return { solution: encodeBase64(byteView.slice(0, 4)) };
    }
  }

  return null;
}

function isConfirmedCredential(value) {
  return Boolean(value?.userId && value.registrationConfirmed === true);
}

function createVoteClient({
  apiBaseUrl = DEFAULT_API_BASE_URL,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  credentialStore,
  cryptoImpl = globalThis.crypto,
  puzzleAttempts = 2,
  votePuzzleAttempts = 3,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!credentialStore?.load || !credentialStore?.save || !credentialStore?.clear) {
    throw new TypeError("credentialStore must provide load, save, and clear");
  }
  if (!Number.isInteger(puzzleAttempts) || puzzleAttempts <= 0) {
    throw new TypeError("puzzleAttempts must be a positive integer");
  }
  if (!Number.isInteger(votePuzzleAttempts) || votePuzzleAttempts <= 0) {
    throw new TypeError("votePuzzleAttempts must be a positive integer");
  }

  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const voteQueues = new Map();
  let registrationPromise = null;
  let registrationIsForced = false;

  async function readJson(response, operation) {
    try {
      return await response.json();
    } catch (error) {
      throw new VoteClientError(`${operation} returned invalid JSON`, { status: response.status, cause: error });
    }
  }

  function isSuccessful(response) {
    if (typeof response.ok === "boolean") return response.ok;
    return response.status >= 200 && response.status < 300;
  }

  async function request(path, options, operation) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, options);
    } catch (error) {
      throw new VoteClientError(`${operation} request failed`, { cause: error });
    }

    if (!response || !Number.isInteger(response.status)) {
      throw new VoteClientError(`${operation} returned an invalid response`);
    }
    return response;
  }

  async function postJson(path, body, operation) {
    const response = await request(
      path,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      operation,
    );
    return response;
  }

  async function registerNewCredential() {
    const userId = generateUserId(cryptoImpl);

    for (let attempt = 0; attempt < puzzleAttempts; attempt++) {
      const path = `/puzzle/registration?userId=${encodeURIComponent(userId)}`;
      const puzzleResponse = await request(
        path,
        { method: "GET", headers: { Accept: "application/json" } },
        "Registration puzzle",
      );
      if (!isSuccessful(puzzleResponse)) {
        throw new VoteClientError("Registration puzzle request was rejected", { status: puzzleResponse.status });
      }

      const puzzle = await readJson(puzzleResponse, "Registration puzzle");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(path, solvedPuzzle, "Registration confirmation");
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Registration confirmation was rejected", { status: confirmResponse.status });
      }
      const confirmed = await readJson(confirmResponse, "Registration confirmation");
      if (confirmed !== true) {
        throw new VoteClientError("Registration confirmation failed");
      }

      const credential = { userId, registrationConfirmed: true };
      await credentialStore.save(credential);
      return { userId };
    }

    throw new VoteClientError("Unable to solve the registration puzzle");
  }

  async function ensureRegisteredInternal(force) {
    if (force) {
      await credentialStore.clear();
    } else {
      const credential = await credentialStore.load();
      if (isConfirmedCredential(credential)) return { userId: credential.userId };
    }
    return registerNewCredential();
  }

  function trackRegistration(work, force) {
    let trackedPromise;
    trackedPromise = work.finally(() => {
      if (registrationPromise === trackedPromise) {
        registrationPromise = null;
        registrationIsForced = false;
      }
    });
    registrationPromise = trackedPromise;
    registrationIsForced = force;
    return trackedPromise;
  }

  function ensureRegistered(options = {}) {
    const force = options.force === true;
    if (!registrationPromise) {
      return trackRegistration(ensureRegisteredInternal(force), force);
    }
    if (!force || registrationIsForced) return registrationPromise;

    const pendingRegistration = registrationPromise;
    return trackRegistration(
      pendingRegistration.catch(() => undefined).then(() => ensureRegisteredInternal(true)),
      true,
    );
  }

  async function performVote(videoId, value, authenticationRetriesRemaining) {
    let { userId } = await ensureRegistered();

    for (let attempt = 0; attempt < votePuzzleAttempts; attempt++) {
      const voteResponse = await postJson("/interact/vote", { userId, videoId, value }, "Vote submission");

      if (voteResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote submission was unauthorized after re-registration", { status: 401 });
        }
        ({ userId } = await ensureRegistered({ force: true }));
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(voteResponse)) {
        throw new VoteClientError("Vote submission was rejected", { status: voteResponse.status });
      }

      const puzzle = await readJson(voteResponse, "Vote submission");
      const solvedPuzzle = await solvePuzzle(puzzle, cryptoImpl);
      if (!solvedPuzzle) continue;

      const confirmResponse = await postJson(
        "/interact/confirmVote",
        { ...solvedPuzzle, userId, videoId },
        "Vote confirmation",
      );
      if (confirmResponse.status === 401) {
        if (authenticationRetriesRemaining <= 0) {
          throw new VoteClientError("Vote confirmation was unauthorized after re-registration", { status: 401 });
        }
        await ensureRegistered({ force: true });
        return performVote(videoId, value, authenticationRetriesRemaining - 1);
      }
      if (!isSuccessful(confirmResponse)) {
        throw new VoteClientError("Vote confirmation was rejected", { status: confirmResponse.status });
      }

      const confirmed = await readJson(confirmResponse, "Vote confirmation");
      if (confirmed !== true) throw new VoteClientError("Vote confirmation failed");
      return true;
    }

    throw new VoteClientError("Unable to solve the vote puzzle");
  }

  function submitVote(videoId, value) {
    if (typeof videoId !== "string" || !VALID_VIDEO_ID.test(videoId)) {
      return Promise.reject(new TypeError("videoId must be an 11-character YouTube video ID"));
    }
    if (!VALID_VOTE_VALUES.has(value)) {
      return Promise.reject(new TypeError("value must be -1, 0, or 1"));
    }

    const previous = voteQueues.get(videoId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => performVote(videoId, value, 1));
    voteQueues.set(videoId, current);
    current.then(
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
      () => {
        if (voteQueues.get(videoId) === current) voteQueues.delete(videoId);
      },
    );
    return current;
  }

  return { ensureRegistered, submitVote };
}



;// CONCATENATED MODULE: ./Extensions/common/vote-transition.js
const LIKED_STATE = "LIKED_STATE";
const DISLIKED_STATE = "DISLIKED_STATE";
const NEUTRAL_STATE = "NEUTRAL_STATE";

const LIKE_ACTION = "like";
const DISLIKE_ACTION = "dislike";

const TRANSITIONS = {
  [NEUTRAL_STATE]: {
    [LIKE_ACTION]: { nextState: LIKED_STATE, value: 1, likesDelta: 1, dislikesDelta: 0 },
    [DISLIKE_ACTION]: { nextState: DISLIKED_STATE, value: -1, likesDelta: 0, dislikesDelta: 1 },
  },
  [LIKED_STATE]: {
    [LIKE_ACTION]: { nextState: NEUTRAL_STATE, value: 0, likesDelta: -1, dislikesDelta: 0 },
    [DISLIKE_ACTION]: { nextState: DISLIKED_STATE, value: -1, likesDelta: -1, dislikesDelta: 1 },
  },
  [DISLIKED_STATE]: {
    [LIKE_ACTION]: { nextState: LIKED_STATE, value: 1, likesDelta: 1, dislikesDelta: -1 },
    [DISLIKE_ACTION]: { nextState: NEUTRAL_STATE, value: 0, likesDelta: 0, dislikesDelta: -1 },
  },
};

function resolveVoteTransition(previousState, action) {
  const transition = TRANSITIONS[previousState]?.[action];
  if (!transition) {
    throw new TypeError(`Unsupported vote transition: ${previousState} -> ${action}`);
  }
  return { ...transition };
}

function applyVoteTransitionCounts(likes, dislikes, transition) {
  if (!transition || !Number.isFinite(transition.likesDelta) || !Number.isFinite(transition.dislikesDelta)) {
    throw new TypeError("A valid vote transition is required");
  }

  const normalizedLikes = Number.isFinite(likes) ? likes : 0;
  const normalizedDislikes = Number.isFinite(dislikes) ? dislikes : 0;
  return {
    likes: Math.max(0, normalizedLikes + transition.likesDelta),
    dislikes: Math.max(0, normalizedDislikes + transition.dislikesDelta),
  };
}

function shouldSubmitVote({ disableVoteSubmission = false, signedOut = false } = {}) {
  return disableVoteSubmission !== true && signedOut !== true;
}



;// CONCATENATED MODULE: ./Extensions/UserScript/src/gm-credential-store.js
const CREDENTIALS_KEY = "rydVoteCredentials";

// Suite: storage goes through the suite API so this module also works when
// it is hot-updated (GM globals are not visible to hot-updated code).
async function getStoredValue() {
  return api.storage.get(CREDENTIALS_KEY, null);
}

async function setStoredValue(value) {
  await api.storage.set(CREDENTIALS_KEY, value);
}

async function deleteStoredValue() {
  await api.storage.del(CREDENTIALS_KEY);
}

function createGmCredentialStore() {
  return {
    async load() {
      const value = await getStoredValue();
      if (!value || typeof value !== "object") {
        return null;
      }

      return {
        userId: value.userId,
        registrationConfirmed: value.registrationConfirmed === true,
      };
    },

    async save(credentials) {
      await setStoredValue({
        userId: credentials.userId,
        registrationConfirmed: credentials.registrationConfirmed === true,
      });
    },

    async clear() {
      await deleteStoredValue();
    },
  };
}



;// CONCATENATED MODULE: ./Extensions/UserScript/src/gm-synthetic-dislike-store.js
const SYNTHETIC_DISLIKE_KEY_PREFIX = "rydSyntheticDislikedShort:";

// Each currently disliked Short owns one independent key. Deliberately do not
// evict selected videos: forgetting one would make the next click submit -1
// again instead of the required neutral (0) transition.

async function gm_synthetic_dislike_store_getStoredValue(key, fallbackValue) {
  return api.storage.get(key, fallbackValue);
}

async function gm_synthetic_dislike_store_setStoredValue(key, value) {
  await api.storage.set(key, value);
}

async function gm_synthetic_dislike_store_deleteStoredValue(key) {
  await api.storage.del(key);
}

function validateVideoId(videoId) {
  if (typeof videoId !== "string" || videoId.length === 0) {
    throw new TypeError("videoId must be a non-empty string");
  }
}

function syntheticDislikeKey(videoId) {
  return `${SYNTHETIC_DISLIKE_KEY_PREFIX}${videoId}`;
}

function createGmSyntheticDislikeStore() {
  let mutationQueue = Promise.resolve();

  function enqueueMutation(mutation) {
    const result = mutationQueue.catch(() => undefined).then(mutation);
    mutationQueue = result;
    return result;
  }

  return {
    async isDisliked(videoId) {
      validateVideoId(videoId);
      await mutationQueue.catch(() => undefined);
      return (await gm_synthetic_dislike_store_getStoredValue(syntheticDislikeKey(videoId), false)) === true;
    },

    async setDisliked(videoId, disliked) {
      validateVideoId(videoId);
      if (typeof disliked !== "boolean") {
        throw new TypeError("disliked must be a boolean");
      }

      return enqueueMutation(() =>
        disliked ? gm_synthetic_dislike_store_setStoredValue(syntheticDislikeKey(videoId), true) : gm_synthetic_dislike_store_deleteStoredValue(syntheticDislikeKey(videoId)),
      );
    },
  };
}



;// CONCATENATED MODULE: ./Extensions/UserScript/userscript-version.json
const userscript_version_namespaceObject = "3.2.0";
;// CONCATENATED MODULE: ./Extensions/UserScript/src/userscript-entry.js







const API_BASE_URL = "https://returnyoutubedislikeapi.com";
// iOS fix: requests go through GM.xmlHttpRequest (via the suite API), which
// is not subject to YouTube's CSP / CORS inside Safari's extension sandbox.
function gmFetch(url, options = {}) {
  return api
    .request({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body, timeout: 15000 })
    .then((response) => {
      const status = Number(response.status) || 0;
      const text = response.text || "";
      return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
          return JSON.parse(text);
        },
        async text() {
          return text;
        },
      };
    });
}

const fetchImpl = gmFetch;
const voteClient = createVoteClient({
  apiBaseUrl: API_BASE_URL,
  fetchImpl,
  credentialStore: createGmCredentialStore(),
  cryptoImpl: globalThis.crypto,
});
const syntheticDislikeStore = createGmSyntheticDislikeStore();

// Suite: options are edited in the suite settings sheet.
const extConfig = cfg;

let previousState = NEUTRAL_STATE;
let likesvalue = 0;
let dislikesvalue = 0;

let isMobile = location.hostname == "m.youtube.com";

function getShortVideoIdFromPathname(pathname) {
  return pathname.match(/^\/shorts\/([^/]+)\/?$/)?.[1] ?? null;
}

let isShorts = () => getShortVideoIdFromPathname(location.pathname) !== null;
let mobileDislikes = 0;
let suppressNextLikeActivation = false;
const boundLikeButtons = new WeakSet();
const boundDislikeButtons = new WeakSet();
const boundActivationVideoIds = new WeakMap();
const suppressedStaleRefreshTargets = new WeakSet();
const removingSyntheticShortsDislikes = new WeakSet();
const pendingWatchControlResets = new Map();
let pendingWatchNavigationBoundary = null;
const hydratingShortsActivationTargets = new WeakMap();
const shortsHydrationTails = new Map();
let shortsLifecycleObserver = null;
let shortsLifecycleObserverTarget = null;
let initializationGeneration = 0;
let initializationTimer = null;
let activeCountRequest = null;
let countStateVideoId = null;
let countStateLoaded = false;
let countStateEpoch = 0;
let shortsSubmittedStateVideoId = null;
let shortsSubmittedState = NEUTRAL_STATE;
let watchRateBarObserver = null;
let watchRateBarObserverTarget = null;
let watchRateBarObserverVideoId = null;
let watchRateBarRepairTimer = null;
const SYNTHETIC_SHORTS_DISLIKE_SELECTOR = "[data-ryd-synthetic-shorts-dislike]";
const SHORTS_DISLIKE_ICON_PATH =
  "m8.482 1.5.294.005a9.01 9.01 0 013.918 1.04l.257.143.203.116c.17.097.357.16.55.185l.194.012h1.477l.115.006c.53.054.95.475 1.004 1.005l.006.114v4.499c0 .621-.504 1.125-1.125 1.125h-1.343a.75.75 0 00-.66.395l-.048.107-2.24 6.402a.75.75 0 01-.832.491l-.78-.13a3 3 0 01-2.439-3.587L7.5 11.25H4.454a2.749 2.749 0 01-2.683-2.151 2.762 2.762 0 01.479-2.237l-.016-.065A2.862 2.862 0 013 4.125v-.032c0-.227.037-.453.108-.668l.08-.211A2.816 2.816 0 015.78 1.5h2.703ZM5.78 3c-.566 0-1.069.362-1.248.9a.613.613 0 00-.031.193v.654l-.44.44c-.333.332-.47.813-.364 1.271l.015.065.157.675-.413.557a1.248 1.248 0 00.999 1.995H7.5a1.501 1.501 0 011.467 1.815L8.5 13.742a1.5 1.5 0 001.22 1.794l.157.027 2.031-5.806a2.25 2.25 0 012.124-1.507H15V4.501h-1.102a3.001 3.001 0 01-1.489-.396l-.202-.116A7.504 7.504 0 008.482 3H5.78Z";
function cLog(text, subtext = "") {
  if (!extConfig.disableLogging) {
    subtext = subtext.trim() === "" ? "" : `(${subtext})`;
    console.log(`[Return YouTube Dislikes] ${text} ${subtext}`);
  }
}

function isInViewport(element) {
  const rect = element.getBoundingClientRect();
  const height = innerHeight || document.documentElement.clientHeight;
  const width = innerWidth || document.documentElement.clientWidth;
  return (
    // When short (channel) is ignored, the element (like/dislike AND short itself) is
    // hidden with a 0 DOMRect. In this case, consider it outside of Viewport
    !(rect.top == 0 && rect.left == 0 && rect.bottom == 0 && rect.right == 0) &&
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= height &&
    rect.right <= width
  );
}

function intersectsViewport(element) {
  const rect = element.getBoundingClientRect();
  const height = innerHeight || document.documentElement.clientHeight;
  const width = innerWidth || document.documentElement.clientWidth;
  return (
    rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width
  );
}

function hasRenderedBox(element) {
  if (!element?.isConnected || element.closest("[hidden], [aria-hidden='true'], [inert]")) {
    return false;
  }
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getRendererShortVideoIds(renderer) {
  const identities = new Set();
  const attributeVideoId = renderer.getAttribute("video-id");
  if (attributeVideoId) {
    identities.add(attributeVideoId);
    return identities;
  }
  for (const link of renderer.querySelectorAll('a[href*="/shorts/"]')) {
    try {
      const linkVideoId = getShortVideoIdFromPathname(new URL(link.getAttribute("href"), location.origin).pathname);
      if (linkVideoId) {
        identities.add(linkVideoId);
      }
    } catch {
      // Ignore malformed or incomplete links while YouTube hydrates the reel.
    }
  }
  return identities;
}

function rendererMatchesShort(renderer, videoId) {
  return Boolean(videoId) && getRendererShortVideoIds(renderer).has(videoId);
}

function getControlOwnershipVideoIds(container) {
  const identities = new Set();
  if (!container) {
    return identities;
  }
  const ownedElements = [container, ...container.querySelectorAll("[data-ryd-video-id]")];
  for (const element of ownedElements) {
    const ownedVideoId = element.getAttribute?.("data-ryd-video-id");
    if (ownedVideoId) {
      identities.add(ownedVideoId);
    }
  }
  for (const target of container.querySelectorAll("button, tp-yt-paper-button#button")) {
    const boundVideoId = boundActivationVideoIds.get(target);
    if (boundVideoId) {
      identities.add(boundVideoId);
    }
  }
  return identities;
}

function hasConflictingControlOwnership(container, videoId) {
  return Array.from(getControlOwnershipVideoIds(container)).some((ownedVideoId) => ownedVideoId !== videoId);
}

function clearPendingWatchControlObservers() {
  for (const resetState of pendingWatchControlResets.values()) {
    resetState.observer.disconnect();
  }
  pendingWatchControlResets.clear();
}

function clearPendingWatchNavigationBoundary() {
  pendingWatchNavigationBoundary?.observer?.disconnect();
  pendingWatchNavigationBoundary = null;
}

function activationTargetHasVideoIdentity(target, videoId, buttons) {
  let current = target;
  while (current) {
    if (current.getAttribute?.("video-id") === videoId || current.getAttribute?.("data-video-id") === videoId) {
      return true;
    }
    if (current === buttons) {
      break;
    }
    current = current.parentElement;
  }
  return false;
}

function watchTargetIsReady(targetState, buttons, videoId) {
  return (
    !buttons.contains(targetState.activationTarget) ||
    activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons) ||
    targetState.refreshed
  );
}

function originalWatchTargetsAreReady(resetState, buttons, videoId) {
  return [resetState.like, resetState.dislike].every((targetState) =>
    watchTargetIsReady(targetState, buttons, videoId),
  );
}

function currentWatchTargetIsReady(target, targetState, buttons, videoId) {
  const boundVideoId = boundActivationVideoIds.get(target);
  return (
    !boundVideoId ||
    boundVideoId === videoId ||
    activationTargetHasVideoIdentity(target, videoId, buttons) ||
    (target === targetState.activationTarget && targetState.refreshed)
  );
}

function elementIsOwnedDisplayMutation(element, targetState) {
  if (!element || !targetState.host.contains(element)) {
    return false;
  }
  return Boolean(
    element.closest(
      "#text, [role='text'], yt-formatted-string, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, .ryd-tooltip, [data-ryd-synthetic-shorts-dislike]",
    ),
  );
}

function mutationIsMeaningfulWatchRefresh(mutation, targetState, videoId, buttons) {
  if (suppressedStaleRefreshTargets.has(targetState.activationTarget)) {
    return false;
  }
  const mutationElement =
    mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
  if (!mutationElement || !targetState.host.contains(mutationElement)) {
    return false;
  }

  if (mutation.type === "attributes") {
    if (["data-video-id", "video-id"].includes(mutation.attributeName)) {
      return activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons);
    }
    return (
      ["aria-disabled", "aria-label", "disabled", "title"].includes(mutation.attributeName) &&
      (mutationElement === targetState.activationTarget || mutationElement === targetState.host)
    );
  }

  if (mutation.type !== "childList" || elementIsOwnedDisplayMutation(mutationElement, targetState)) {
    return false;
  }
  const changedElements = [...mutation.addedNodes, ...mutation.removedNodes]
    .map((node) => (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement))
    .filter(Boolean);
  return changedElements.some((element) => !elementIsOwnedDisplayMutation(element, targetState));
}

function captureMeaningfulWatchRefreshes(resetState, mutations, videoId, buttons) {
  for (const targetState of [resetState.like, resetState.dislike]) {
    if (
      !targetState.refreshed &&
      mutations.some((mutation) => mutationIsMeaningfulWatchRefresh(mutation, targetState, videoId, buttons))
    ) {
      targetState.refreshed = true;
    }
  }
}

function captureWatchNavigationBoundaryRefreshes(boundary, mutations) {
  for (const targetState of [boundary.like, boundary.dislike]) {
    if (
      !targetState.refreshed &&
      mutations.some((mutation) => mutationIsMeaningfulWatchRefresh(mutation, targetState, "", boundary.buttons))
    ) {
      targetState.refreshed = true;
    }
  }
}

function seedWatchTargetFromNavigationBoundary(targetState, boundaryTargetState, buttons, videoId) {
  if (targetState.activationTarget === boundaryTargetState.activationTarget) {
    targetState.refreshed ||= boundaryTargetState.refreshed;
    return;
  }

  const boundVideoId = boundActivationVideoIds.get(targetState.activationTarget);
  targetState.refreshed ||=
    !boundVideoId ||
    boundVideoId === videoId ||
    activationTargetHasVideoIdentity(targetState.activationTarget, videoId, buttons);
}

function seedWatchResetFromNavigationBoundary(resetState, buttons, videoId) {
  const boundary = pendingWatchNavigationBoundary;
  if (!boundary || boundary.sourceVideoId === videoId) {
    return;
  }

  captureWatchNavigationBoundaryRefreshes(boundary, boundary.observer.takeRecords());
  clearPendingWatchNavigationBoundary();
  if (boundary.buttons !== buttons) {
    return;
  }

  seedWatchTargetFromNavigationBoundary(resetState.like, boundary.like, buttons, videoId);
  seedWatchTargetFromNavigationBoundary(resetState.dislike, boundary.dislike, buttons, videoId);
}

function suppressStaleTargetRefresh(target) {
  suppressedStaleRefreshTargets.add(target);
  setTimeout(() => suppressedStaleRefreshTargets.delete(target), 0);
}

function watchControlsAreReadyForVideo(buttons, likeButton, dislikeButton, videoId) {
  if (!hasConflictingControlOwnership(buttons, videoId)) {
    clearPendingWatchControlObservers();
    if (pendingWatchNavigationBoundary?.sourceVideoId !== videoId) {
      clearPendingWatchNavigationBoundary();
    }
    return true;
  }

  // YouTube occasionally completes a watch-to-watch navigation while reusing
  // the exact same reaction-control nodes and without mutating anything inside
  // them. In that state the old per-node ownership is the only conflicting
  // signal, so waiting for a control mutation can never finish. A completed
  // navigation plus a matching current watch root is the route-level ownership
  // proof for this otherwise indistinguishable case.
  const watchRoot = buttons.closest("ytd-watch-flexy, ytd-watch-grid");
  if (
    pendingWatchNavigationBoundary?.completedVideoId === videoId &&
    pendingWatchNavigationBoundary.sourceVideoId !== videoId &&
    pendingWatchNavigationBoundary.buttons === buttons &&
    watchRoot?.getAttribute("video-id") === videoId &&
    getButtons() === buttons &&
    hasRenderedBox(buttons)
  ) {
    clearPendingWatchControlObservers();
    clearPendingWatchNavigationBoundary();
    return true;
  }

  const existingReset = pendingWatchControlResets.get(buttons);
  if (existingReset?.videoId === videoId) {
    seedWatchResetFromNavigationBoundary(existingReset, buttons, videoId);
    if (!originalWatchTargetsAreReady(existingReset, buttons, videoId)) {
      return false;
    }

    const currentLikeButton = getLikeButton();
    const currentDislikeButton = getDislikeButton();
    if (!currentLikeButton || !currentDislikeButton || getButtons() !== buttons) {
      return false;
    }
    const currentLikeTarget = getActivationTarget(currentLikeButton);
    const currentDislikeTarget = getActivationTarget(currentDislikeButton);
    if (
      !currentWatchTargetIsReady(currentLikeTarget, existingReset.like, buttons, videoId) ||
      !currentWatchTargetIsReady(currentDislikeTarget, existingReset.dislike, buttons, videoId)
    ) {
      return false;
    }

    existingReset.observer.disconnect();
    pendingWatchControlResets.delete(buttons);
    return true;
  }

  existingReset?.observer.disconnect();
  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const resetState = {
    dislike: {
      activationTarget: dislikeActivationTarget,
      host: dislikeButton,
      refreshed: false,
    },
    like: {
      activationTarget: likeActivationTarget,
      host: likeButton,
      refreshed: false,
    },
    observer: null,
    videoId,
  };
  seedWatchResetFromNavigationBoundary(resetState, buttons, videoId);
  if (
    originalWatchTargetsAreReady(resetState, buttons, videoId) &&
    currentWatchTargetIsReady(likeActivationTarget, resetState.like, buttons, videoId) &&
    currentWatchTargetIsReady(dislikeActivationTarget, resetState.dislike, buttons, videoId)
  ) {
    pendingWatchControlResets.delete(buttons);
    return true;
  }
  const observer = new MutationObserver((mutations) => {
    captureMeaningfulWatchRefreshes(resetState, mutations, videoId, buttons);
    if (originalWatchTargetsAreReady(resetState, buttons, videoId)) {
      observer.disconnect();
      setEventListeners();
    }
  });
  resetState.observer = observer;
  pendingWatchControlResets.set(buttons, resetState);
  observer.observe(buttons, {
    attributeFilter: ["aria-disabled", "aria-label", "data-video-id", "disabled", "title", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  return false;
}

function getActiveDesktopShortsActionBar() {
  const videoId = getVideoId();
  const candidates = Array.from(document.querySelectorAll("ytd-reel-video-renderer"))
    .filter((renderer) => intersectsViewport(renderer))
    .map((renderer) => ({
      actionBar: renderer.querySelector("reel-action-bar-view-model"),
      renderer,
    }))
    .filter(({ actionBar }) => actionBar);

  const matchingCandidate = candidates.find(({ renderer }) => rendererMatchesShort(renderer, videoId));
  if (matchingCandidate) {
    return matchingCandidate.actionBar;
  }

  // During channel/watch -> Shorts SPA transitions, YouTube can render the active
  // reel before its video-id/link metadata is hydrated. A single visible reel is
  // still unambiguous; waiting for metadata in this state leaves the controls
  // permanently uninitialized on some page variants.
  if (
    candidates.length === 1 &&
    getRendererShortVideoIds(candidates[0].renderer).size === 0 &&
    !hasConflictingControlOwnership(candidates[0].actionBar, videoId)
  ) {
    return candidates[0].actionBar;
  }

  const fullyVisibleCandidates = candidates.filter(
    ({ actionBar, renderer }) =>
      isInViewport(renderer) &&
      getRendererShortVideoIds(renderer).size === 0 &&
      !hasConflictingControlOwnership(actionBar, videoId),
  );
  return fullyVisibleCandidates.length === 1 ? fullyVisibleCandidates[0].actionBar : null;
}

function getActiveMobileShortsButtons() {
  const videoId = getVideoId();
  const candidates = Array.from(document.querySelectorAll("ytm-like-button-renderer"))
    .filter((buttons) => isInViewport(buttons))
    .map((buttons) => ({ buttons, ...getMobileShortOwnership(buttons) }));

  const matchingCandidates = candidates.filter(({ identities }) => identities.has(videoId));
  if (matchingCandidates.length === 1) {
    return matchingCandidates[0].buttons;
  }

  if (
    candidates.length === 1 &&
    candidates[0].identities.size === 0 &&
    !hasConflictingControlOwnership(candidates[0].buttons, videoId)
  ) {
    return candidates[0].buttons;
  }
  return null;
}

function getExactShortLinkVideoIds(element) {
  const identities = new Set();
  for (const link of element.querySelectorAll('a[href*="/shorts/"]')) {
    try {
      const linkVideoId = getShortVideoIdFromPathname(new URL(link.getAttribute("href"), location.origin).pathname);
      if (linkVideoId) {
        identities.add(linkVideoId);
      }
    } catch {
      // Ignore malformed or incomplete links while YouTube hydrates the reel.
    }
  }
  return identities;
}

function getMobileShortOwnership(buttons) {
  const ancestors = [];
  let current = buttons;
  while (current && current !== document.body) {
    if (current.matches("ytm-shorts, ytm-shorts-container, #shorts-container, #shorts-inner-container")) {
      break;
    }
    ancestors.push(current);
    current = current.parentElement;
  }

  for (const ancestor of ancestors) {
    const attributeVideoId = ancestor.getAttribute("video-id") || ancestor.getAttribute("data-video-id");
    if (attributeVideoId) {
      return { identities: new Set([attributeVideoId]), owner: ancestor };
    }
  }

  for (const ancestor of ancestors) {
    const identities = getExactShortLinkVideoIds(ancestor);
    if (identities.size > 0) {
      return { identities, owner: ancestor };
    }
  }

  const owner =
    ancestors.find((ancestor) => ancestor.matches("ytm-reel-video-renderer, ytm-shorts-video-renderer")) ??
    ancestors.find((ancestor) => ancestor.matches("ytm-reel-player-overlay-renderer")) ??
    buttons;
  return { identities: new Set(), owner };
}

function getDesktopWatchButtonCandidates() {
  return Array.from(
    new Set(
      document.querySelectorAll(
        "#menu-container #top-level-buttons-computed, ytd-menu-renderer.ytd-watch-metadata > div, ytd-menu-renderer.ytd-video-primary-info-renderer > div",
      ),
    ),
  ).filter((candidate) =>
    candidate.querySelector(
      "segmented-like-dislike-button-view-model, ytd-segmented-like-dislike-button-renderer, like-button-view-model, #segmented-like-button",
    ),
  );
}

function selectCurrentWatchButtons(candidates) {
  const videoId = getVideoId();
  return (
    candidates
      .map((candidate, index) => {
        const watchRoot = candidate.closest("ytd-watch-flexy, ytd-watch-grid");
        const rootVideoId = watchRoot?.getAttribute("video-id");
        const rootMatches = Boolean(videoId && rootVideoId === videoId);
        const rendered = hasRenderedBox(candidate);
        const inViewport = rendered && intersectsViewport(candidate);
        const conflicts = Boolean(videoId && hasConflictingControlOwnership(candidate, videoId));
        // YouTube can retain several button groups under the same current
        // ytd-watch-flexy while an SPA navigation settles. A matching root is
        // therefore useful ownership evidence, but it must never make a
        // hidden stale group outrank the rendered controls the user can see.
        const tier =
          rootMatches && inViewport && !conflicts
            ? 10
            : rootMatches && inViewport
              ? 9
              : inViewport && !conflicts
                ? 8
                : inViewport
                  ? 7
                  : rootMatches && rendered && !conflicts
                    ? 6
                    : rootMatches && rendered
                      ? 5
                      : rendered && !conflicts
                        ? 4
                        : rendered
                          ? 3
                          : rootMatches && !conflicts
                            ? 2
                            : !conflicts
                              ? 1
                              : 0;
        return { candidate, index, tier };
      })
      .sort((left, right) => right.tier - left.tier || left.index - right.index)[0]?.candidate ?? null
  );
}

// iOS fix: if m.youtube.com renames its action-bar classes, find the
// like/dislike pair through the button elements themselves.
function getMobileWatchButtonsFallback() {
  const scope =
    document.querySelector("ytm-slim-video-action-bar-renderer") ??
    document.querySelector("ytm-slim-video-metadata-section-renderer") ??
    document.querySelector("ytm-watch");
  if (!scope) {
    return null;
  }
  const segmented = scope.querySelector(
    "segmented-like-dislike-button-view-model, ytm-segmented-like-dislike-button-renderer",
  );
  if (segmented) {
    return segmented.parentElement;
  }
  const like = scope.querySelector("like-button-view-model");
  return like?.parentElement ?? null;
}

function getButtons() {
  if (isShorts()) {
    if (!isMobile) {
      const actionBar = getActiveDesktopShortsActionBar();
      if (actionBar) {
        return actionBar;
      }
    } else {
      const buttons = getActiveMobileShortsButtons();
      if (buttons) {
        return buttons;
      }
    }

    // Never bind watch/channel controls that are still connected while a Shorts
    // SPA route is mounting. The initialization retry loop will pick up the real
    // reel controls as soon as they are available.
    return null;
  }
  if (isMobile) {
    return (
      document.querySelector(".slim-video-action-bar-actions .segmented-buttons") ??
      document.querySelector(".slim-video-action-bar-actions") ??
      getMobileWatchButtonsFallback()
    );
  }
  return selectCurrentWatchButtons(getDesktopWatchButtonCandidates());
}

function removeSyntheticShortsDislike(syntheticDislike) {
  if (!syntheticDislike || removingSyntheticShortsDislikes.has(syntheticDislike)) {
    return;
  }
  removingSyntheticShortsDislikes.add(syntheticDislike);
  try {
    syntheticDislike.remove();
  } finally {
    removingSyntheticShortsDislikes.delete(syntheticDislike);
  }
}

function ensureSyntheticShortsDislikeButton(buttons) {
  if (!isShorts() || isMobile || !buttons) {
    return;
  }

  const syntheticDislike = buttons.querySelector(SYNTHETIC_SHORTS_DISLIKE_SELECTOR);
  const nativeDislike = buttons.querySelector("dislike-button-view-model, #dislike-button");
  if (nativeDislike) {
    removeSyntheticShortsDislike(syntheticDislike);
    return;
  }
  if (syntheticDislike) {
    const videoId = getVideoId();
    if (videoId && syntheticDislike.getAttribute("data-ryd-video-id") !== videoId) {
      syntheticDislike.setAttribute("data-ryd-video-id", videoId);
      setSyntheticShortsPressed(false, syntheticDislike);
      const button = syntheticDislike.querySelector("button");
      if (button) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
      }
      const count = syntheticDislike.querySelector("#text, [role='text']");
      if (count) {
        count.textContent = "";
      }
    }
    return;
  }

  const likeButton = buttons.querySelector("like-button-view-model");
  const nativeLikeButton = likeButton?.querySelector("button");
  if (!likeButton || !nativeLikeButton) {
    return;
  }

  const ownedDislike = document.createElement("div");
  ownedDislike.className = likeButton.getAttribute("class") || "";
  ownedDislike.setAttribute("data-ryd-synthetic-shorts-dislike", "true");
  ownedDislike.setAttribute("data-ryd-role", "dislike");
  ownedDislike.setAttribute("data-ryd-video-id", getVideoId());
  ownedDislike.classList.add("ryd-synthetic-shorts-dislike");

  const button = document.createElement("button");
  button.type = "button";
  button.className = nativeLikeButton.className;
  button.setAttribute("aria-label", "Dislike this video");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-disabled", "true");
  button.disabled = true;

  const icon = document.createElement("div");
  icon.className =
    nativeLikeButton.querySelector(".ytSpecButtonShapeNextIcon")?.getAttribute("class") || "ytSpecButtonShapeNextIcon";
  icon.setAttribute("aria-hidden", "true");
  const svgNamespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("height", "24");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("width", "24");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", SHORTS_DISLIKE_ICON_PATH);
  svg.appendChild(path);
  icon.appendChild(svg);

  const countContainer = document.createElement("div");
  countContainer.className =
    likeButton.querySelector(".ytSpecButtonShapeWithLabelLabel")?.className || "ytSpecButtonShapeWithLabelLabel";
  const count = document.createElement("span");
  count.id = "text";
  count.className =
    likeButton.querySelector('span[role="text"]')?.className ||
    "ytAttributedStringHost ytAttributedStringTextAlignmentCenter";
  count.setAttribute("role", "text");
  countContainer.appendChild(count);
  button.appendChild(icon);
  const buttonAndCount = document.createElement("label");
  buttonAndCount.className = nativeLikeButton.closest("label")?.className || "ytSpecButtonShapeWithLabelHost";
  buttonAndCount.classList.add("ryd-synthetic-shorts-dislike-label");
  buttonAndCount.append(button, countContainer);
  ownedDislike.appendChild(buttonAndCount);
  setSyntheticShortsPressed(false, ownedDislike);
  likeButton.insertAdjacentElement("afterend", ownedDislike);
}

function getDislikeButton() {
  const buttons = getButtons();
  ensureSyntheticShortsDislikeButton(buttons);
  if (buttons?.tagName === "REEL-ACTION-BAR-VIEW-MODEL") {
    return (
      buttons.querySelector("dislike-button-view-model, #dislike-button") ??
      buttons.querySelector(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)
    );
  }
  const firstButton = ownChildren(buttons)[0];
  if (!firstButton) {
    return null;
  }

  if (firstButton.tagName === "YTD-SEGMENTED-LIKE-DISLIKE-BUTTON-RENDERER") {
    if (firstButton.children[1] === undefined) {
      return buttons.querySelector("#segmented-dislike-button");
    } else {
      return firstButton.children[1];
    }
  } else {
    if (buttons.querySelector("segmented-like-dislike-button-view-model")) {
      const dislikeViewModel = buttons.querySelector("dislike-button-view-model");
      if (!dislikeViewModel) cLog("Dislike button wasn't added to DOM yet...");
      return dislikeViewModel;
    } else {
      // Suite: YouTube's 2026 mobile watch page puts the channel avatar and
      // the Subscribe button in the same row as like/dislike. The upstream
      // "second child of the row" guess then pointed at Subscribe, and its
      // label was overwritten with the dislike count. Find the dislike
      // control by name, else take the control right after the like button.
      const named = buttons.querySelector("dislike-button-view-model, ytm-dislike-button-renderer, #dislike-button");
      if (named) {
        return named;
      }
      const likeControl = getLikeButton();
      if (likeControl?.matches?.("like-button-view-model, ytm-like-button-renderer, #like-button")) {
        let next = likeControl.nextElementSibling;
        while (next?.hasAttribute("data-ioss-owned")) {
          next = next.nextElementSibling;
        }
        if (next) {
          return next;
        }
      }
      return isMobile ? null : ownChildren(buttons)[1] ?? null;
    }
  }
}

// Suite: the downloader puts its button in front of the like button. Skip
// elements the suite owns so the like/dislike buttons are still found by
// position.
function ownChildren(buttons) {
  return Array.from(buttons?.children ?? []).filter((child) => !child.hasAttribute("data-ioss-owned"));
}

function getLikeButton() {
  const buttons = getButtons();
  const firstButton = ownChildren(buttons)[0];
  if (!firstButton) {
    return null;
  }

  if (firstButton.tagName === "YTD-SEGMENTED-LIKE-DISLIKE-BUTTON-RENDERER") {
    return buttons.querySelector("#segmented-like-button") !== null
      ? buttons.querySelector("#segmented-like-button")
      : firstButton.children[0];
  }
  // Suite: on mobile the first item of the row can be the channel avatar,
  // so only accept a control that is actually a like button there.
  const namedLike = buttons.querySelector("like-button-view-model, ytm-like-button-renderer, #like-button");
  return namedLike ?? (isMobile ? null : firstButton);
}

function getLikeTextContainer() {
  // Suite: null-safe (threw when YouTube had not rendered the button yet).
  const likeButton = getLikeButton();
  if (!likeButton) return null;
  return (
    likeButton.querySelector("#text") ??
    likeButton.getElementsByTagName("yt-formatted-string")[0] ??
    likeButton.querySelector("span[role='text']")
  );
}

function getDislikeTextContainer() {
  const dislikeButton = getDislikeButton();
  let result =
    dislikeButton?.querySelector("#text") ??
    dislikeButton?.getElementsByTagName("yt-formatted-string")[0] ??
    dislikeButton?.querySelector("span[role='text']");
  // Suite: null-safe (crashed when the dislike button had no <button>).
  const nativeDislikeButton = dislikeButton?.querySelector("button");
  if (result === null && nativeDislikeButton) {
    let textSpan = document.createElement("span");
    textSpan.id = "text";
    textSpan.style.marginLeft = "6px";
    nativeDislikeButton.appendChild(textSpan);
    nativeDislikeButton.style.width = "auto";
    result = textSpan;
  }
  return result;
}

function setSyntheticShortsPressed(pressed, dislikeButton = getDislikeButton()) {
  if (!dislikeButton?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    return;
  }
  dislikeButton.classList.toggle("style-default-active", pressed);
  dislikeButton.classList.toggle("style-text", !pressed);
  dislikeButton.querySelector("button")?.setAttribute("aria-pressed", String(pressed));
}

function persistSyntheticShortsState(videoId, disliked) {
  void syntheticDislikeStore.setDisliked(videoId, disliked).catch(reportVoteFailure);
}

async function readSyntheticShortsDisliked(videoId) {
  try {
    return await syntheticDislikeStore.isDisliked(videoId);
  } catch (error) {
    reportVoteFailure(error);
    return false;
  }
}

async function restoreSyntheticShortsState(
  videoId,
  dislikeButton = getDislikeButton(),
  initialVisibleState = getState(),
) {
  if (!dislikeButton?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    return false;
  }

  const disliked = await readSyntheticShortsDisliked(videoId);

  return {
    disliked,
    submittedState: initialVisibleState === LIKED_STATE ? LIKED_STATE : disliked ? DISLIKED_STATE : initialVisibleState,
  };
}

function createObserver(options, callback) {
  const observerWrapper = new Object();
  observerWrapper.options = options;
  observerWrapper.observer = new MutationObserver(callback);
  observerWrapper.observe = function (element) {
    this.observer.observe(element, this.options);
  };
  observerWrapper.disconnect = function () {
    this.observer.disconnect();
  };
  return observerWrapper;
}

let shortsObserver = null;

function getShortsObserver() {
  if (shortsObserver) {
    return shortsObserver;
  }
  cLog("Initializing shorts mutation observer");
  shortsObserver = createObserver(
    {
      attributes: true,
      attributeFilter: ["aria-pressed"],
    },
    (mutationList) => {
      mutationList.forEach((mutation) => {
        if (mutation.type === "attributes") {
          cLog("Short thumb button status changed");
          if (mutation.target.getAttribute("aria-pressed") === "true") {
            mutation.target.style.color = mutation.target.closest("like-button-view-model")
              ? getColorFromTheme(true)
              : getColorFromTheme(false);
          } else {
            mutation.target.style.color = "unset";
          }
        }
      });
    },
  );
  return shortsObserver;
}

function isVideoLiked() {
  const likeButton = getLikeButton();
  const nativeButton = likeButton?.querySelector("button");
  if (isMobile) {
    return nativeButton?.getAttribute("aria-pressed") === "true" || nativeButton?.getAttribute("aria-label") === "true";
  }
  return (
    likeButton?.classList.contains("style-default-active") || nativeButton?.getAttribute("aria-pressed") === "true"
  );
}

function isVideoDisliked() {
  const dislikeButton = getDislikeButton();
  const nativeButton = dislikeButton?.querySelector("button");
  if (isMobile) {
    return nativeButton?.getAttribute("aria-pressed") === "true" || nativeButton?.getAttribute("aria-label") === "true";
  }
  return (
    dislikeButton?.classList.contains("style-default-active") || nativeButton?.getAttribute("aria-pressed") === "true"
  );
}

function isVideoNotLiked() {
  if (isMobile) {
    return !isVideoLiked();
  }
  return getLikeButton()?.classList.contains("style-text");
}

function isVideoNotDisliked() {
  if (isMobile) {
    return !isVideoDisliked();
  }
  return getDislikeButton()?.classList.contains("style-text");
}

function isSignedOut() {
  const signInLink = document.querySelector("a[href^='https://accounts.google.com/ServiceLogin']");
  return signInLink !== null || (!isMobile && document.querySelector("#avatar-btn") === null);
}

function getState() {
  if (isVideoLiked()) {
    return LIKED_STATE;
  }
  if (isVideoDisliked()) {
    return DISLIKED_STATE;
  }
  return NEUTRAL_STATE;
}

function setLikes(likesCount) {
  if (isMobile) {
    // iOS fix: the old ".button-renderer-text" class no longer exists on
    // every mobile layout; writing to it threw an error.
    const likeText =
      getLikeButton()?.querySelector(".button-renderer-text") ??
      getLikeButton()?.querySelector("#text, span[role='text']");
    if (likeText) {
      likeText.innerText = likesCount;
    }
    return;
  }
  const container = getLikeTextContainer();
  if (container) {
    container.innerText = likesCount;
  }
}

function setDislikes(dislikesCount) {
  if (isMobile) {
    mobileDislikes = dislikesCount;
    writeMobileDislikes();
    return;
  }

  const _container = getDislikeTextContainer();
  if (!_container) {
    return;
  }
  _container.removeAttribute("is-empty");
  if (_container.innerText !== dislikesCount) {
    _container.innerText = dislikesCount;
  }
}

function getLikeCountFromButton() {
  try {
    if (isShorts()) {
      //Youtube Shorts don't work with this query. It's not necessary; we can skip it and still see the results.
      //It should be possible to fix this function, but it's not critical to showing the dislike count.
      return false;
    }
    let likeButton =
      getLikeButton().querySelector("yt-formatted-string#text") ?? getLikeButton().querySelector("button");

    let likesStr = likeButton.getAttribute("aria-label").replace(/\D/g, "");
    return likesStr.length > 0 ? parseInt(likesStr) : false;
  } catch {
    return false;
  }
}

api.addStyle(`
    #return-youtube-dislike-bar-container {
      background: #737373;
      background: color-mix(
        in srgb,
        var(--yt-spec-text-primary, #f1f1f1) 55%,
        var(--yt-spec-base-background, #0f0f0f) 45%
      );
      border-radius: 2px;
    }

    #return-youtube-dislike-bar {
      background: var(--yt-spec-text-primary);
      border-radius: 2px;
      transition: all 0.15s ease-in-out;
    }

    .ryd-synthetic-shorts-dislike svg {
      display: block;
      fill: currentColor;
      height: 24px;
      pointer-events: none;
      width: 24px;
    }

    .ryd-synthetic-shorts-dislike {
      box-sizing: content-box;
      display: block;
      flex: 0 0 auto;
      height: 70px;
      margin: 0 !important;
      padding: 0 0 8px;
      width: 100%;
    }

    .ryd-synthetic-shorts-dislike-label {
      align-items: center;
      display: flex;
      flex-direction: column;
    }

    .ryd-synthetic-shorts-dislike .ytSpecButtonShapeNextIcon {
      flex: 0 0 24px;
      height: 24px;
      min-width: 24px;
      width: 24px;
    }

    .ryd-synthetic-shorts-dislike button {
      color: inherit;
      cursor: pointer;
    }

    .ryd-synthetic-shorts-dislike button[aria-pressed="true"] {
      color: var(--yt-spec-call-to-action, #3ea6ff);
    }

    .ryd-tooltip {
      bottom: -10px;
      display: block;
      height: 2px;
      outline: none;
      position: absolute;
    }

    .ryd-tooltip-bar-container {
      width: 100%;
      height: 2px;
      position: absolute;
      padding-top: 6px;
      padding-bottom: 12px;
      top: -6px;
    }

    .ryd-tooltip-label {
      background: rgba(28, 28, 28, 0.96);
      border-radius: 4px;
      bottom: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      box-sizing: border-box;
      color: #fff;
      font-family: Roboto, Arial, sans-serif;
      font-size: 12px;
      font-weight: 500;
      line-height: 16px;
      max-width: calc(100vw - 24px);
      opacity: 0;
      overflow: hidden;
      padding: 6px 8px;
      pointer-events: none;
      position: absolute;
      right: 0;
      text-overflow: ellipsis;
      transform: translateY(4px);
      transition: opacity 0.12s ease-out, transform 0.12s ease-out, visibility 0s linear 0.12s;
      visibility: hidden;
      white-space: nowrap;
      width: max-content;
      z-index: 2200;
    }

    .ryd-tooltip:hover .ryd-tooltip-label,
    .ryd-tooltip:focus-within .ryd-tooltip-label {
      opacity: 1;
      transform: translateY(0);
      transition-delay: 0s;
      visibility: visible;
    }

    .ryd-tooltip:focus-visible .ryd-tooltip-bar-container {
      outline: 2px solid var(--yt-spec-call-to-action, #3ea6ff);
      outline-offset: 2px;
    }

    ytd-menu-renderer.ytd-watch-metadata {
      overflow-y: visible !important;
    }

    #top-level-buttons-computed {
      position: relative !important;
    }
  `);

function createRateBar(likes, dislikes) {
  if (isMobile || isShorts() || !extConfig.rateBarEnabled) {
    return;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton) {
    return;
  }

  // YouTube retains the outgoing watch metadata tree during some SPA
  // transitions. A document-wide ID lookup can therefore find the old bar,
  // update it with the new video's counts, and then lose it when YouTube
  // removes that stale tree. Keep the single owned bar scoped to the active
  // reaction controls instead.
  for (const candidate of document.querySelectorAll("#return-youtube-dislike-bar-container")) {
    if (!buttons.contains(candidate)) {
      (candidate.closest(".ryd-tooltip") ?? candidate).remove();
    }
  }
  let rateBar = buttons.querySelector("#return-youtube-dislike-bar-container");
  if (rateBar && !watchRateBarIsHealthy(buttons, getVideoId())) {
    removeWatchRateBarArtifacts(buttons);
    rateBar = null;
  }

  const widthPx = likeButton.clientWidth + (dislikeButton?.clientWidth ?? 52);

  const widthPercent = likes + dislikes > 0 ? (likes / (likes + dislikes)) * 100 : 50;

  var likePercentage = parseFloat(widthPercent.toFixed(1));
  const dislikePercentage = (100 - likePercentage).toLocaleString();
  likePercentage = likePercentage.toLocaleString();

  const separator = "\u00a0/\u00a0";
  const percentageSeparator = "\u00a0\u00a0-\u00a0\u00a0";
  let tooltipText;
  switch (extConfig.tooltipPercentageMode) {
    case "dash_like":
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}${percentageSeparator}${likePercentage}%`;
      break;
    case "dash_dislike":
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}${percentageSeparator}${dislikePercentage}%`;
      break;
    case "both":
      tooltipText = `${likePercentage}%${separator}${dislikePercentage}%`;
      break;
    case "only_like":
      tooltipText = `${likePercentage}%`;
      break;
    case "only_dislike":
      tooltipText = `${dislikePercentage}%`;
      break;
    default:
      tooltipText = `${likes.toLocaleString()}${separator}${dislikes.toLocaleString()}`;
  }

  if (!rateBar && !isMobile) {
    const tooltip = document.createElement("div");
    tooltip.className = "ryd-tooltip";
    tooltip.setAttribute("data-ryd-rate-bar-wrapper", "true");
    tooltip.setAttribute("data-ryd-video-id", getVideoId());
    tooltip.style.width = `${widthPx}px`;
    tooltip.setAttribute("aria-describedby", "ryd-dislike-tooltip");
    tooltip.setAttribute("tabindex", "0");

    const tooltipBarContainer = document.createElement("div");
    tooltipBarContainer.className = "ryd-tooltip-bar-container";

    rateBar = document.createElement("div");
    rateBar.id = "return-youtube-dislike-bar-container";
    rateBar.style.width = "100%";
    rateBar.style.height = "2px";

    const rateBarFill = document.createElement("div");
    rateBarFill.id = "return-youtube-dislike-bar";
    rateBarFill.style.width = `${widthPercent}%`;
    rateBarFill.style.height = "100%";
    if (extConfig.coloredBar) {
      rateBar.style.backgroundColor = getColorFromTheme(false);
      rateBarFill.style.backgroundColor = getColorFromTheme(true);
    }
    rateBar.appendChild(rateBarFill);
    tooltipBarContainer.appendChild(rateBar);

    const tooltipLabel = document.createElement("div");
    tooltipLabel.id = "ryd-dislike-tooltip";
    tooltipLabel.className = "ryd-tooltip-label";
    tooltipLabel.setAttribute("role", "tooltip");
    tooltipLabel.textContent = tooltipText;

    tooltip.append(tooltipBarContainer, tooltipLabel);
    buttons.appendChild(tooltip);
    const descriptionAndActionsElement = buttons.closest("#top-row");
    if (descriptionAndActionsElement) {
      descriptionAndActionsElement.style.borderBottom = "1px solid var(--yt-spec-10-percent-layer)";
      descriptionAndActionsElement.style.paddingBottom = "10px";
    }
  } else {
    const tooltip = rateBar.closest(".ryd-tooltip");
    const rateBarFill = rateBar.querySelector("#return-youtube-dislike-bar");
    if (!tooltip || !rateBarFill) {
      (tooltip ?? rateBar).remove();
      createRateBar(likes, dislikes);
      return;
    }
    tooltip.setAttribute("data-ryd-video-id", getVideoId());
    tooltip.style.width = widthPx + "px";
    rateBarFill.style.width = widthPercent + "%";
    const tooltipLabel = tooltip.querySelector("#ryd-dislike-tooltip");
    if (tooltipLabel) {
      tooltipLabel.textContent = tooltipText;
    }

    if (extConfig.coloredBar) {
      rateBar.style.backgroundColor = getColorFromTheme(false);
      rateBarFill.style.backgroundColor = getColorFromTheme(true);
    }
  }
}

function elementTouchesWatchRateBar(element) {
  return Boolean(
    element?.matches?.(
      ".ryd-tooltip, .ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
    ) ||
      element?.matches?.('[data-ryd-rate-bar-wrapper="true"]') ||
      element?.closest?.(".ryd-tooltip, .ryd-tooltip-bar-container, #return-youtube-dislike-bar-container") ||
      element?.querySelector?.(
        ".ryd-tooltip, .ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
      ),
  );
}

function mutationTouchesWatchRateBar(mutation) {
  if (mutation.type === "attributes") {
    return elementTouchesWatchRateBar(mutation.target);
  }
  return (
    mutation.type === "childList" &&
    [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) => node.nodeType === Node.ELEMENT_NODE && elementTouchesWatchRateBar(node),
    )
  );
}

function watchRateBarIsHealthy(buttons, videoId) {
  if (!buttons || !videoId) {
    return false;
  }

  const wrappers = Array.from(buttons.querySelectorAll('[data-ryd-rate-bar-wrapper="true"]'));
  const containers = Array.from(buttons.querySelectorAll("#return-youtube-dislike-bar-container"));
  const fills = Array.from(buttons.querySelectorAll("#return-youtube-dislike-bar"));
  const labels = Array.from(buttons.querySelectorAll("#ryd-dislike-tooltip"));
  if (wrappers.length !== 1 || containers.length !== 1 || fills.length !== 1 || labels.length !== 1) {
    return false;
  }

  const [wrapper] = wrappers;
  const [container] = containers;
  const [fill] = fills;
  const [label] = labels;
  if (
    wrapper.parentElement !== buttons ||
    !wrapper.matches(".ryd-tooltip") ||
    wrapper.getAttribute("data-ryd-video-id") !== videoId ||
    !wrapper.contains(container) ||
    !container.contains(fill) ||
    !wrapper.contains(label) ||
    !hasRenderedBox(wrapper) ||
    !hasRenderedBox(container)
  ) {
    return false;
  }

  const fillStyle = getComputedStyle(fill);
  const fillBounds = fill.getBoundingClientRect();
  return (
    fillStyle.display !== "none" &&
    fillStyle.visibility !== "hidden" &&
    fillStyle.visibility !== "collapse" &&
    Number.parseFloat(fillStyle.opacity) !== 0 &&
    fillBounds.height > 0
  );
}

function removeWatchRateBarArtifacts(buttons) {
  if (!buttons) {
    return;
  }

  for (const wrapper of buttons.querySelectorAll('.ryd-tooltip, [data-ryd-rate-bar-wrapper="true"]')) {
    wrapper.remove();
  }
  for (const fragment of buttons.querySelectorAll(
    ".ryd-tooltip-bar-container, .ryd-tooltip-label, #return-youtube-dislike-bar-container, #return-youtube-dislike-bar, #ryd-dislike-tooltip",
  )) {
    fragment.remove();
  }
}

function clearStaleWatchPresentation(buttons, dislikeButton, videoId) {
  if (isMobile || isShorts() || !initializedVideoId || initializedVideoId === videoId) {
    return;
  }

  removeWatchRateBarArtifacts(buttons);
  const dislikeText =
    dislikeButton?.querySelector("#text") ??
    dislikeButton?.getElementsByTagName("yt-formatted-string")[0] ??
    dislikeButton?.querySelector("span[role='text']");
  if (dislikeText) {
    dislikeText.textContent = "";
  }
}

function canRepairWatchRateBar(buttons, videoId) {
  if (
    isMobile ||
    isShorts() ||
    !extConfig.rateBarEnabled ||
    !videoId ||
    !countStateLoaded ||
    countStateVideoId !== videoId ||
    initializedVideoId !== videoId ||
    getVideoId() !== videoId ||
    !buttons?.isConnected ||
    getButtons() !== buttons ||
    !hasRenderedBox(buttons)
  ) {
    return false;
  }

  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  return (
    likeButton === initializedLikeButton &&
    dislikeButton === initializedDislikeButton &&
    buttons.contains(likeButton) &&
    buttons.contains(dislikeButton) &&
    !watchRateBarIsHealthy(buttons, videoId)
  );
}

function repairWatchRateBar(buttons = getButtons(), videoId = getVideoId()) {
  if (canRepairWatchRateBar(buttons, videoId)) {
    removeWatchRateBarArtifacts(buttons);
    createRateBar(likesvalue, dislikesvalue);
  }
}

function scheduleWatchRateBarRepair() {
  if (watchRateBarRepairTimer !== null) {
    return;
  }
  watchRateBarRepairTimer = setTimeout(() => {
    watchRateBarRepairTimer = null;
    repairWatchRateBar(watchRateBarObserverTarget, watchRateBarObserverVideoId);
  }, 0);
}

function disconnectWatchRateBarObserver() {
  watchRateBarObserver?.disconnect();
  watchRateBarObserver = null;
  watchRateBarObserverTarget = null;
  watchRateBarObserverVideoId = null;
  if (watchRateBarRepairTimer !== null) {
    clearTimeout(watchRateBarRepairTimer);
    watchRateBarRepairTimer = null;
  }
}

function observeWatchRateBar(buttons, videoId) {
  if (isMobile || isShorts() || !extConfig.rateBarEnabled || !buttons) {
    disconnectWatchRateBarObserver();
    return;
  }

  if (watchRateBarObserverTarget === buttons) {
    watchRateBarObserverVideoId = videoId;
    return;
  }

  disconnectWatchRateBarObserver();
  watchRateBarObserverTarget = buttons;
  watchRateBarObserverVideoId = videoId;
  watchRateBarObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesWatchRateBar)) {
      scheduleWatchRateBarRepair();
    }
  });
  watchRateBarObserver.observe(buttons, {
    attributeFilter: ["aria-hidden", "class", "hidden", "inert", "style"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

function setState() {
  const videoId = getVideoId();
  previousState = getState();
  if (countStateVideoId === videoId && (activeCountRequest?.videoId === videoId || countStateLoaded)) {
    updateDOMDislikes();
    refreshFormattedLikes();
    return;
  }
  if (countStateVideoId !== videoId) {
    likesvalue = 0;
    dislikesvalue = 0;
    countStateVideoId = videoId;
    countStateLoaded = false;
    countStateEpoch += 1;
  }
  const countRequest = {
    dislikesDelta: 0,
    likesDelta: 0,
    videoId,
  };
  activeCountRequest = countRequest;
  cLog("Fetching votes...");

  fetchImpl(`${API_BASE_URL}/votes?videoId=${videoId}`)
    .then((response) => response.json())
    .then((json) => {
      if (getVideoId() !== videoId || activeCountRequest !== countRequest) {
        return;
      }
      if (json && !("traceId" in json)) {
        const { dislikes, likes } = json;
        cLog(`Received count: ${dislikes}`);
        likesvalue = Math.max(0, likes + countRequest.likesDelta);
        dislikesvalue = Math.max(0, dislikes + countRequest.dislikesDelta);
        countStateLoaded = true;
        setDislikes(numberFormat(dislikesvalue));
        if (extConfig.numberDisplayReformatLikes === true) {
          const nativeLikes = getLikeCountFromButton();
          if (nativeLikes !== false) {
            setLikes(numberFormat(nativeLikes));
          }
        }
        createRateBar(likesvalue, dislikesvalue);
        if (extConfig.coloredThumbs === true) {
          const dislikeButton = getDislikeButton();
          if (isShorts()) {
            // for shorts, leave deactived buttons in default color
            const shortLikeButton = getLikeButton()?.querySelector("button, tp-yt-paper-button#button");
            const shortDislikeButton = dislikeButton?.querySelector("button, tp-yt-paper-button#button");
            if (shortLikeButton?.getAttribute("aria-pressed") === "true") {
              shortLikeButton.style.color = getColorFromTheme(true);
            }
            if (shortDislikeButton?.getAttribute("aria-pressed") === "true") {
              shortDislikeButton.style.color = getColorFromTheme(false);
            }
            const observer = getShortsObserver();
            if (shortLikeButton) observer.observe(shortLikeButton);
            if (shortDislikeButton) observer.observe(shortDislikeButton);
          } else {
            const likeButtonForColor = getLikeButton();
            if (likeButtonForColor) likeButtonForColor.style.color = getColorFromTheme(true);
            if (dislikeButton) dislikeButton.style.color = getColorFromTheme(false);
          }
        }
      }
    })
    .catch((error) => cLog("Fetching votes failed", error instanceof Error ? error.message : String(error)))
    .finally(() => {
      if (activeCountRequest === countRequest) {
        activeCountRequest = null;
      }
    });
}

function updateDOMDislikes() {
  setDislikes(numberFormat(dislikesvalue));
  createRateBar(likesvalue, dislikesvalue);
}

function reportVoteFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  cLog("Vote submission failed", message);
}

function refreshFormattedLikes() {
  if (extConfig.numberDisplayReformatLikes !== true) {
    return;
  }

  const nativeLikes = getLikeCountFromButton();
  if (nativeLikes !== false) {
    setLikes(numberFormat(nativeLikes));
  }
}

function getVoteStateCounts(state) {
  return {
    dislikes: state === DISLIKED_STATE ? 1 : 0,
    likes: state === LIKED_STATE ? 1 : 0,
  };
}

function getShortsCountTransition(videoId, transition) {
  if (!isShorts() || shortsSubmittedStateVideoId !== videoId) {
    return transition;
  }
  const previousCounts = getVoteStateCounts(shortsSubmittedState);
  const nextCounts = getVoteStateCounts(transition.nextState);
  return {
    ...transition,
    dislikesDelta: nextCounts.dislikes - previousCounts.dislikes,
    likesDelta: nextCounts.likes - previousCounts.likes,
  };
}

function applyCountTransition(videoId, countTransition) {
  const counts = applyVoteTransitionCounts(likesvalue, dislikesvalue, countTransition);
  if (activeCountRequest?.videoId === videoId) {
    activeCountRequest.likesDelta += countTransition.likesDelta;
    activeCountRequest.dislikesDelta += countTransition.dislikesDelta;
  }
  likesvalue = counts.likes;
  dislikesvalue = counts.dislikes;
}

function applyVoteTransition(videoId, transition, syntheticShortsDislike) {
  const countTransition = getShortsCountTransition(videoId, transition);
  applyCountTransition(videoId, countTransition);
  previousState = transition.nextState;
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
  if (isShorts()) {
    shortsSubmittedStateVideoId = videoId;
    shortsSubmittedState = previousState;
    persistSyntheticShortsState(videoId, previousState === DISLIKED_STATE);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function applyHydratingVoteTransition(hydration, transition, syntheticShortsDislike) {
  applyCountTransition(hydration.videoId, transition);
  previousState = transition.nextState;
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function reconcileHydratingVoteTransition(hydration, transition, syntheticShortsDislike) {
  const submittedCountTransition = getShortsCountTransition(hydration.videoId, transition);
  if (transition.optimisticCountStateEpoch === countStateEpoch) {
    applyCountTransition(hydration.videoId, {
      ...transition,
      dislikesDelta: submittedCountTransition.dislikesDelta - transition.dislikesDelta,
      likesDelta: submittedCountTransition.likesDelta - transition.likesDelta,
    });
  }
  previousState = transition.nextState;
  shortsSubmittedStateVideoId = hydration.videoId;
  shortsSubmittedState = previousState;
  persistSyntheticShortsState(hydration.videoId, previousState === DISLIKED_STATE);
  if (syntheticShortsDislike) {
    setSyntheticShortsPressed(previousState === DISLIKED_STATE);
  }
}

function submitVoteTransition(videoId, transition, signedOut) {
  if (shouldSubmitVote({ disableVoteSubmission: extConfig.disableVoteSubmission, signedOut })) {
    void voteClient.submitVote(videoId, transition.value).catch(reportVoteFailure);
  }
}

function clearNativeLikeForSyntheticDislike(action, stateBeforeActivation, syntheticShortsDislike) {
  if (!syntheticShortsDislike || action !== DISLIKE_ACTION || stateBeforeActivation !== LIKED_STATE) {
    return;
  }

  const nativeLikeButton = getLikeButton()?.querySelector("button");
  if (nativeLikeButton && isVideoLiked()) {
    suppressNextLikeActivation = true;
    try {
      nativeLikeButton.click();
    } finally {
      suppressNextLikeActivation = false;
    }
  }
}

function handleVoteActivation(action) {
  const signedOut = isSignedOut();
  if (signedOut) {
    return;
  }

  const videoId = getVideoId();
  if (!videoId) {
    return;
  }

  const transition = resolveVoteTransition(previousState, action);
  const syntheticShortsDislike = getDislikeButton()?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR) === true;
  clearNativeLikeForSyntheticDislike(action, previousState, syntheticShortsDislike);
  applyVoteTransition(videoId, transition, syntheticShortsDislike);
  submitVoteTransition(videoId, transition, signedOut);
}

function captureHydratingShortsActivation(event, action) {
  const hydration = hydratingShortsActivationTargets.get(event.currentTarget);
  if (!hydration) {
    return false;
  }
  if (hydration.videoId !== getVideoId()) {
    return true;
  }

  const signedOut = isSignedOut();
  const syntheticShortsDislike = getDislikeButton()?.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR) === true;
  if (!signedOut) {
    clearNativeLikeForSyntheticDislike(action, hydration.visibleState, syntheticShortsDislike);
  }
  const transition = {
    ...resolveVoteTransition(hydration.visibleState, action),
    optimisticCountStateEpoch: countStateEpoch,
  };
  hydration.visibleState = transition.nextState;
  if (!signedOut) {
    hydration.activations.push(transition);
    applyHydratingVoteTransition(hydration, transition, syntheticShortsDislike);
    submitVoteTransition(hydration.videoId, transition, signedOut);
  }
  return true;
}

function likeClicked(event) {
  if (suppressNextLikeActivation) {
    return;
  }
  if (boundActivationVideoIds.get(event.currentTarget) !== getVideoId()) {
    suppressStaleTargetRefresh(event.currentTarget);
    return;
  }
  if (captureHydratingShortsActivation(event, LIKE_ACTION)) {
    return;
  }
  handleVoteActivation(LIKE_ACTION);
}

function dislikeClicked(event) {
  if (boundActivationVideoIds.get(event.currentTarget) !== getVideoId()) {
    suppressStaleTargetRefresh(event.currentTarget);
    return;
  }
  if (captureHydratingShortsActivation(event, DISLIKE_ACTION)) {
    return;
  }
  handleVoteActivation(DISLIKE_ACTION);
}

function refreshDislikesForBoundControl(event) {
  if (boundActivationVideoIds.get(event.currentTarget) === getVideoId()) {
    updateDOMDislikes();
  }
}

function getVideoId() {
  const urlObject = new URL(window.location.href);
  const pathname = urlObject.pathname;
  if (pathname.startsWith("/clip")) {
    return (document.querySelector("meta[itemprop='videoId']") || document.querySelector("meta[itemprop='identifier']"))
      ?.content;
  } else {
    const shortVideoId = getShortVideoIdFromPathname(pathname);
    if (shortVideoId) {
      return shortVideoId;
    }
    return urlObject.searchParams.get("v");
  }
}

function isVideoLoaded() {
  if (isMobile) {
    // iOS fix: don't depend only on the "loading" attribute of #player;
    // also accept a present <video> element in the mobile player.
    return (
      document.getElementById("player")?.getAttribute("loading") == "false" ||
      document.querySelector("#player video, ytm-player video, #player-container-id video, video.html5-main-video") !==
        null
    );
  }
  const videoId = getVideoId();

  return (
    // desktop: spring 2024 UI
    document.querySelector(`ytd-watch-grid[video-id='${videoId}']`) !== null ||
    // desktop: older UI
    document.querySelector(`ytd-watch-flexy[video-id='${videoId}']`) !== null ||
    // mobile: no video-id attribute
    document.querySelector('#player[loading="false"]:not([hidden])') !== null
  );
}

function roundDown(num) {
  if (num < 1000) return num;
  const int = Math.floor(Math.log10(num) - 2);
  const decimal = int + (int % 3 ? 1 : 0);
  const value = Math.floor(num / 10 ** decimal);
  return value * 10 ** decimal;
}

function numberFormat(numberState) {
  let numberDisplay;
  if (extConfig.numberDisplayRoundDown === false) {
    numberDisplay = numberState;
  } else {
    numberDisplay = roundDown(numberState);
  }
  return getNumberFormatter(extConfig.numberDisplayFormat).format(numberDisplay);
}

function getNumberFormatter(optionSelect) {
  let userLocales;
  if (document.documentElement.lang) {
    userLocales = document.documentElement.lang;
  } else if (navigator.language) {
    userLocales = navigator.language;
  } else {
    try {
      userLocales = new URL(
        Array.from(document.querySelectorAll("head > link[rel='search']"))
          ?.find((n) => n?.getAttribute("href")?.includes("?locale="))
          ?.getAttribute("href"),
      )?.searchParams?.get("locale");
    } catch {
      cLog("Cannot find browser locale. Use en as default for number formatting.");
      userLocales = "en";
    }
  }

  let formatterNotation;
  let formatterCompactDisplay;
  switch (optionSelect) {
    case "compactLong":
      formatterNotation = "compact";
      formatterCompactDisplay = "long";
      break;
    case "standard":
      formatterNotation = "standard";
      formatterCompactDisplay = "short";
      break;
    case "compactShort":
    default:
      formatterNotation = "compact";
      formatterCompactDisplay = "short";
  }

  const formatter = Intl.NumberFormat(userLocales, {
    notation: formatterNotation,
    compactDisplay: formatterCompactDisplay,
  });
  return formatter;
}

function getColorFromTheme(voteIsLike) {
  let colorString;
  switch (extConfig.colorTheme) {
    case "accessible":
      if (voteIsLike === true) {
        colorString = "dodgerblue";
      } else {
        colorString = "gold";
      }
      break;
    case "neon":
      if (voteIsLike === true) {
        colorString = "aqua";
      } else {
        colorString = "magenta";
      }
      break;
    case "classic":
    default:
      if (voteIsLike === true) {
        colorString = "lime";
      } else {
        colorString = "red";
      }
  }
  return colorString;
}

let smartimationObserver = null;
let initializedVideoId = null;
let initializedButtons = null;
let initializedLikeButton = null;
let initializedDislikeButton = null;
let lifecyclePageKey = null;

const SHORTS_RENDERER_SELECTOR =
  "ytd-reel-video-renderer, ytm-reel-video-renderer, ytm-shorts-video-renderer, ytm-reel-player-overlay-renderer";
const SHORTS_CONTROL_SELECTOR = `like-button-view-model, dislike-button-view-model, ${SYNTHETIC_SHORTS_DISLIKE_SELECTOR}`;

function getShortsRenderer(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  return element.matches(SHORTS_RENDERER_SELECTOR) ? element : element.closest?.(SHORTS_RENDERER_SELECTOR) ?? null;
}

function rendererOwnsCurrentShort(renderer) {
  if (!renderer) {
    return false;
  }
  return (
    renderer.hasAttribute("is-active") ||
    rendererMatchesShort(renderer, getVideoId()) ||
    (initializedLikeButton && renderer.contains(initializedLikeButton)) ||
    (initializedDislikeButton && renderer.contains(initializedDislikeButton))
  );
}

function elementTouchesCurrentShortRenderer(element) {
  const containingRenderer = getShortsRenderer(element);
  if (containingRenderer) {
    return rendererOwnsCurrentShort(containingRenderer);
  }
  return Array.from(element?.querySelectorAll?.(SHORTS_RENDERER_SELECTOR) ?? []).some(rendererOwnsCurrentShort);
}

function mutationTouchesShortsControls(mutation) {
  if (mutation.type === "attributes") {
    if (mutation.attributeName === "is-active" && mutation.target.matches(SHORTS_RENDERER_SELECTOR)) {
      return true;
    }
    if (
      (mutation.target.matches(SHORTS_RENDERER_SELECTOR) || mutation.target.matches("a")) &&
      elementTouchesCurrentShortRenderer(mutation.target)
    ) {
      return true;
    }
    return false;
  }
  if (mutation.type !== "childList") {
    return false;
  }
  const changedElements = [...mutation.addedNodes, ...mutation.removedNodes].filter(
    (node) => node.nodeType === Node.ELEMENT_NODE,
  );
  if (
    changedElements.some(
      (node) =>
        node.matches(`reel-action-bar-view-model, ${SHORTS_CONTROL_SELECTOR}`) ||
        node.querySelector?.(`reel-action-bar-view-model, ${SHORTS_CONTROL_SELECTOR}`),
    )
  ) {
    return [mutation.target, ...changedElements].some(elementTouchesCurrentShortRenderer);
  }
  return (
    mutation.target.closest?.(SHORTS_CONTROL_SELECTOR) &&
    elementTouchesCurrentShortRenderer(mutation.target) &&
    changedElements.some(
      (node) =>
        node.matches("button, tp-yt-paper-button#button") || node.querySelector?.("button, tp-yt-paper-button#button"),
    )
  );
}

function shortsControlsNeedInitialization() {
  const videoId = getVideoId();
  if (!isShorts() || !videoId) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return true;
  }
  if (
    initializedVideoId !== videoId ||
    initializedLikeButton !== likeButton ||
    initializedDislikeButton !== dislikeButton
  ) {
    return true;
  }

  return (
    boundActivationVideoIds.get(getActivationTarget(likeButton)) !== videoId ||
    boundActivationVideoIds.get(getActivationTarget(dislikeButton)) !== videoId
  );
}

function disconnectShortsLifecycleObserver() {
  shortsLifecycleObserver?.disconnect();
  shortsLifecycleObserverTarget = null;
}

function observeShortsLifecycle(buttons) {
  if (!isShorts() || !buttons) {
    disconnectShortsLifecycleObserver();
    return;
  }
  clearPendingWatchControlObservers();

  const isDesktopActionBar = buttons.tagName === "REEL-ACTION-BAR-VIEW-MODEL";
  const isMobileActionBar = isMobile && buttons.tagName === "YTM-LIKE-BUTTON-RENDERER";
  if (!isDesktopActionBar && !isMobileActionBar) {
    disconnectShortsLifecycleObserver();
    return;
  }

  const renderer = isMobileActionBar
    ? buttons.closest("ytm-reel-video-renderer, ytm-shorts-video-renderer") ?? getMobileShortOwnership(buttons).owner
    : buttons.closest("ytd-reel-video-renderer") ?? buttons;
  const observerTarget =
    renderer.closest(
      "ytd-shorts, ytd-shorts-container, ytm-shorts, ytm-shorts-container, #shorts-container, #shorts-inner-container",
    ) ??
    renderer.parentElement ??
    document.body;
  if (shortsLifecycleObserverTarget === observerTarget) {
    return;
  }
  disconnectShortsLifecycleObserver();
  shortsLifecycleObserver = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesShortsControls) && shortsControlsNeedInitialization()) {
      setEventListeners();
    }
  });
  shortsLifecycleObserver.observe(observerTarget, {
    attributeFilter: ["href", "is-active", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
  shortsLifecycleObserverTarget = observerTarget;
}

function getActivationTarget(control) {
  if (control.matches("button, tp-yt-paper-button#button")) {
    return control;
  }
  return control.querySelector("button, tp-yt-paper-button#button") ?? control;
}

function beginShortsHydration(videoId, likeButton, dislikeButton, initialVisibleState) {
  const previousCompletion = shortsHydrationTails.get(videoId) ?? Promise.resolve();
  let resolveCompletion;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const hydration = {
    activations: [],
    completion,
    initialVisibleState,
    previousCompletion,
    resolveCompletion,
    videoId,
    visibleState: initialVisibleState,
  };
  shortsHydrationTails.set(videoId, completion);
  hydratingShortsActivationTargets.set(getActivationTarget(likeButton), hydration);
  hydratingShortsActivationTargets.set(getActivationTarget(dislikeButton), hydration);
  return hydration;
}

function finishShortsHydration(hydration, likeButton, dislikeButton) {
  for (const target of [getActivationTarget(likeButton), getActivationTarget(dislikeButton)]) {
    if (hydratingShortsActivationTargets.get(target) === hydration) {
      hydratingShortsActivationTargets.delete(target);
    }
  }
  if (shortsHydrationTails.get(hydration.videoId) === hydration.completion) {
    shortsHydrationTails.delete(hydration.videoId);
  }
  hydration.resolveCompletion();
}

function persistFinalHydratingActivation(hydration) {
  const finalActivation = hydration.activations[hydration.activations.length - 1];
  if (finalActivation) {
    persistSyntheticShortsState(hydration.videoId, finalActivation.nextState === DISLIKED_STATE);
  }
}

function reconcileStaleShortsHydration(hydration, submittedState, storedDisliked) {
  if (getVideoId() !== hydration.videoId || hydration.activations.length === 0) {
    persistFinalHydratingActivation(hydration);
    return;
  }

  const currentDislikeButton = getDislikeButton();
  if (!currentDislikeButton) {
    persistFinalHydratingActivation(hydration);
    return;
  }

  applyHydratedShortsState(hydration, submittedState, currentDislikeButton, storedDisliked);
}

function applyHydratedShortsState(hydration, submittedState, dislikeButton, storedDisliked) {
  const syntheticShortsDislike = dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR);
  shortsSubmittedStateVideoId = hydration.videoId;
  shortsSubmittedState = submittedState;

  if (hydration.activations.length === 0) {
    previousState = syntheticShortsDislike ? submittedState : hydration.initialVisibleState;
    if (syntheticShortsDislike) {
      setSyntheticShortsPressed(submittedState === DISLIKED_STATE, dislikeButton);
    }
    if (hydration.initialVisibleState === LIKED_STATE && storedDisliked) {
      persistSyntheticShortsState(hydration.videoId, false);
    }
    return;
  }

  for (const transition of hydration.activations) {
    reconcileHydratingVoteTransition(hydration, transition, syntheticShortsDislike);
  }
  updateDOMDislikes();
  refreshFormattedLikes();
}

function bindVoteButtonListeners(likeButton, dislikeButton, { enableSynthetic = true } = {}) {
  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const videoId = getVideoId();
  boundActivationVideoIds.set(likeActivationTarget, videoId);
  boundActivationVideoIds.set(dislikeActivationTarget, videoId);
  if (!boundLikeButtons.has(likeActivationTarget)) {
    likeActivationTarget.addEventListener("click", likeClicked);
    boundLikeButtons.add(likeActivationTarget);
  }
  if (!boundDislikeButtons.has(dislikeActivationTarget)) {
    dislikeActivationTarget.addEventListener("click", dislikeClicked);
    dislikeActivationTarget.addEventListener("focusin", refreshDislikesForBoundControl);
    dislikeActivationTarget.addEventListener("focusout", refreshDislikesForBoundControl);
    boundDislikeButtons.add(dislikeActivationTarget);
  }
  if (enableSynthetic && dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
    dislikeActivationTarget.disabled = false;
    dislikeActivationTarget.setAttribute("aria-disabled", "false");
  }
}

async function initializeCurrentButtons(generation) {
  const videoId = getVideoId();
  if (!videoId) {
    // Channel/search/home pages have no video controls to initialize. The
    // lightweight lifecycle monitor will restart initialization when a video
    // route appears, instead of polling the whole page every 111 ms forever.
    return true;
  }

  if (!(isShorts() || (hasRenderedBox(getButtons()) && isVideoLoaded()))) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return false;
  }
  if (!isShorts() && !watchControlsAreReadyForVideo(buttons, likeButton, dislikeButton, videoId)) {
    return false;
  }

  observeShortsLifecycle(buttons);
  observeWatchRateBar(buttons, videoId);
  const stateNeedsInitialization =
    initializedVideoId !== videoId ||
    initializedButtons !== buttons ||
    initializedLikeButton !== likeButton ||
    initializedDislikeButton !== dislikeButton;
  if (stateNeedsInitialization) {
    clearStaleWatchPresentation(buttons, dislikeButton, videoId);
    initializedVideoId = videoId;
    initializedButtons = buttons;
    initializedLikeButton = likeButton;
    initializedDislikeButton = dislikeButton;
    setState();
  }

  if (isShorts()) {
    const initialVisibleState = getState();
    const likeActivationTarget = getActivationTarget(likeButton);
    const dislikeActivationTarget = getActivationTarget(dislikeButton);
    const existingLikeHydration = hydratingShortsActivationTargets.get(likeActivationTarget);
    const existingDislikeHydration = hydratingShortsActivationTargets.get(dislikeActivationTarget);
    if (
      existingLikeHydration &&
      existingLikeHydration === existingDislikeHydration &&
      existingLikeHydration.videoId === videoId
    ) {
      return false;
    }
    const hydration = beginShortsHydration(videoId, likeButton, dislikeButton, initialVisibleState);
    bindVoteButtonListeners(likeButton, dislikeButton, { enableSynthetic: false });
    let storedDisliked;
    let submittedState;
    try {
      await hydration.previousCompletion;
      if (dislikeButton.matches(SYNTHETIC_SHORTS_DISLIKE_SELECTOR)) {
        const restored = await restoreSyntheticShortsState(videoId, dislikeButton, initialVisibleState);
        if (!restored) {
          persistFinalHydratingActivation(hydration);
          return false;
        }
        storedDisliked = restored.disliked;
        submittedState = restored.submittedState;
      } else {
        storedDisliked = await readSyntheticShortsDisliked(videoId);
        submittedState =
          initialVisibleState === LIKED_STATE ? LIKED_STATE : storedDisliked ? DISLIKED_STATE : initialVisibleState;
      }

      if (
        generation !== initializationGeneration ||
        getVideoId() !== videoId ||
        getLikeButton() !== likeButton ||
        getDislikeButton() !== dislikeButton
      ) {
        reconcileStaleShortsHydration(hydration, submittedState, storedDisliked);
        return false;
      }

      applyHydratedShortsState(hydration, submittedState, dislikeButton, storedDisliked);
      bindVoteButtonListeners(likeButton, dislikeButton);
    } finally {
      finishShortsHydration(hydration, likeButton, dislikeButton);
    }
  } else {
    if (
      generation !== initializationGeneration ||
      getVideoId() !== videoId ||
      getLikeButton() !== likeButton ||
      getDislikeButton() !== dislikeButton
    ) {
      return false;
    }
    bindVoteButtonListeners(likeButton, dislikeButton);
  }

  if (!smartimationObserver) {
    smartimationObserver = createObserver(
      {
        attributes: true,
        subtree: true,
        childList: true,
      },
      updateDOMDislikes,
    );
    smartimationObserver.container = null;
  }

  const smartimationContainer = buttons.querySelector("yt-smartimation");
  if (smartimationContainer && smartimationObserver.container != smartimationContainer) {
    cLog("Initializing smartimation mutation observer");
    smartimationObserver.disconnect();
    smartimationObserver.observe(smartimationContainer);
    smartimationObserver.container = smartimationContainer;
  }

  return true;
}

function setEventListeners(evt) {
  const generation = ++initializationGeneration;
  let checkRunning = false;
  if (initializationTimer) {
    clearInterval(initializationTimer);
  }

  async function checkForJSFinish() {
    if (generation !== initializationGeneration || checkRunning) {
      return;
    }
    checkRunning = true;
    try {
      const initialized = await initializeCurrentButtons(generation);
      if (initialized && generation === initializationGeneration) {
        clearInterval(initializationTimer);
        initializationTimer = null;
      }
    } catch (error) {
      reportVoteFailure(error);
    } finally {
      checkRunning = false;
    }
  }

  cLog("Setting up...");
  // Suite: poll quickly at first, then back off, and skip ticks while the
  // tab is hidden. The original polled at 9 Hz forever on pages where the
  // buttons never appear (e.g. members-only or age-gated videos).
  const setupStarted = Date.now();
  initializationTimer = setInterval(() => {
    if (document.hidden) return;
    const elapsed = Date.now() - setupStarted;
    if (elapsed > 10000 && elapsed < 60000 && Math.floor(elapsed / 111) % 5 !== 0) return;
    if (elapsed >= 60000 && Math.floor(elapsed / 111) % 18 !== 0) return;
    void checkForJSFinish();
  }, 111);
  void checkForJSFinish();
}

function getLifecyclePageKey() {
  const videoId = getVideoId();
  if (!videoId) {
    return null;
  }
  return `${isShorts() ? "shorts" : "watch"}:${videoId}`;
}

function watchControlsNeedReinitialization() {
  // iOS fix: also re-bind on m.youtube.com when YouTube re-renders the buttons
  if (isShorts() || initializationTimer !== null) {
    return false;
  }

  const videoId = getVideoId();
  if (!videoId || initializedVideoId !== videoId) {
    return false;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  return (
    !initializedButtons?.isConnected ||
    buttons !== initializedButtons ||
    likeButton !== initializedLikeButton ||
    dislikeButton !== initializedDislikeButton ||
    !initializedLikeButton?.isConnected ||
    !initializedDislikeButton?.isConnected ||
    !buttons?.contains(initializedLikeButton) ||
    !buttons?.contains(initializedDislikeButton)
  );
}

function checkPageLifecycle() {
  const pageKey = getLifecyclePageKey();
  if (pageKey !== lifecyclePageKey) {
    lifecyclePageKey = pageKey;
    if (!isShorts()) {
      disconnectShortsLifecycleObserver();
      if (!pageKey) {
        clearPendingWatchControlObservers();
      }
    }
    setEventListeners();
    return;
  }
  if (watchControlsNeedReinitialization()) {
    setEventListeners();
    return;
  }
  repairWatchRateBar();
}

function handleNavigateStart() {
  disconnectWatchRateBarObserver();
  clearPendingWatchNavigationBoundary();
  clearPendingWatchControlObservers();
  if (isShorts()) {
    return;
  }

  const buttons = getButtons();
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (!buttons || !likeButton || !dislikeButton) {
    return;
  }

  const likeActivationTarget = getActivationTarget(likeButton);
  const dislikeActivationTarget = getActivationTarget(dislikeButton);
  const likeVideoId = boundActivationVideoIds.get(likeActivationTarget);
  const dislikeVideoId = boundActivationVideoIds.get(dislikeActivationTarget);
  if (
    !likeVideoId ||
    likeVideoId !== dislikeVideoId ||
    likeVideoId !== getVideoId() ||
    !buttons.contains(likeActivationTarget) ||
    !buttons.contains(dislikeActivationTarget)
  ) {
    return;
  }

  const boundary = {
    buttons,
    completedVideoId: null,
    dislike: {
      activationTarget: dislikeActivationTarget,
      host: dislikeButton,
      refreshed: false,
    },
    like: {
      activationTarget: likeActivationTarget,
      host: likeButton,
      refreshed: false,
    },
    observer: null,
    sourceVideoId: likeVideoId,
  };
  const observer = new MutationObserver((mutations) => {
    captureWatchNavigationBoundaryRefreshes(boundary, mutations);
  });
  boundary.observer = observer;
  pendingWatchNavigationBoundary = boundary;
  observer.observe(buttons, {
    attributeFilter: ["aria-disabled", "aria-label", "data-video-id", "disabled", "title", "video-id"],
    attributes: true,
    childList: true,
    subtree: true,
  });
}

function handleNavigateFinish(event) {
  lifecyclePageKey = getLifecyclePageKey();
  if (isShorts()) {
    clearPendingWatchControlObservers();
    clearPendingWatchNavigationBoundary();
  } else {
    disconnectShortsLifecycleObserver();
    const videoId = getVideoId();
    if (pendingWatchNavigationBoundary && videoId !== pendingWatchNavigationBoundary.sourceVideoId) {
      pendingWatchNavigationBoundary.completedVideoId = videoId;
    }
    if (!getVideoId()) {
      clearPendingWatchControlObservers();
      clearPendingWatchNavigationBoundary();
    }
  }
  setEventListeners(event);
}

(function () {
  "use strict";
  void voteClient.ensureRegistered().catch(reportVoteFailure);
  window.addEventListener("yt-navigate-start", handleNavigateStart, true);
  window.addEventListener("yt-navigate-finish", handleNavigateFinish, true);
  window.addEventListener("popstate", checkPageLifecycle, true);
  lifecyclePageKey = getLifecyclePageKey();
  api.every(500, checkPageLifecycle);
  setEventListeners();
})();
if (isMobile) {
  // iOS fix: write the count every 500 ms (YouTube's mobile site re-renders
  // the buttons often), only once the real count has loaded, and never
  // throw when the buttons aren't on the page.
  api.every(500, writeMobileDislikes);
}

function writeMobileDislikes() {
  try {
    if (!countStateLoaded || countStateVideoId !== getVideoId()) {
      return;
    }
    const dislikeButton = getDislikeButton();
    if (!dislikeButton) {
      return;
    }
    const target = dislikeButton.querySelector(".button-renderer-text") ?? getDislikeTextContainer();
    if (target && target.innerText !== String(mobileDislikes)) {
      target.innerText = mobileDislikes;
    }
  } catch (error) {
    cLog("Mobile dislike update failed", error instanceof Error ? error.message : String(error));
  }
}
  }
}));

  /* ---- module: yt-player v1.4.0 ---- */
  register(({
  id: 'yt-player',
  name: 'YouTube: Picture-in-Picture & player tweaks',
  version: '1.4.0',
  api: 1,
  source: 'YouTube PIP Button (iOS Safari) 1.3 + YouTube options from Bypass All Shortlinks',
  description: 'Adds a Picture-in-Picture button to the YouTube player (m.youtube.com and desktop site). Optional: open Shorts in the normal player and keep playing in the background.',
  runAt: 'start',
  frames: false,
  match: (u) => /^(m|www)\.youtube\.com$/.test(u.hostname),
  defaults: { pipButton: true, shortsToWatch: false, backgroundPlay: false },
  options: [
    { key: 'pipButton', type: 'bool', label: 'Picture-in-Picture button' },
    { key: 'shortsToWatch', type: 'bool', label: 'Open Shorts in the normal player' },
    { key: 'backgroundPlay', type: 'bool', label: 'Keep playing when Safari is in the background', help: 'Experimental: stops YouTube from noticing the page is hidden. Resume from Control Center if iOS pauses.' }
  ],

  pageVisibility: function () {
    if (window.__iossVis) return;
    window.__iossVis = true;
    const P = Document.prototype;
    const def = (name, value) => { try { Object.defineProperty(P, name, { configurable: true, get: () => value }); } catch (_) { /* ignore */ } };
    def('hidden', false);
    def('webkitHidden', false);
    def('visibilityState', 'visible');
    def('webkitVisibilityState', 'visible');
    try { Document.prototype.hasFocus = () => true; } catch (_) { /* ignore */ }
  },

  run(api, cfg) {
    const VIDEO_SEL = '#movie_player video, .html5-video-player video, video.html5-main-video';
    const getVideo = () => document.querySelector(VIDEO_SEL) || document.querySelector('video');

    // ---- Shorts -> normal player. Fix: the Bypass script always redirected
    // to www.youtube.com, which on iPhone bounced back to m.youtube.com.
    if (cfg.shortsToWatch) {
      const redirect = () => {
        const m = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{6,})/);
        if (m) location.replace(`${location.origin}/watch?v=${m[1]}`);
      };
      redirect();
      api.onUrlChange(redirect);
    }

    // ---- Background play
    if (cfg.backgroundPlay) {
      const block = (e) => e.stopImmediatePropagation();
      for (const ev of ['visibilitychange', 'webkitvisibilitychange', 'pagehide', 'blur']) {
        window.addEventListener(ev, block, true);
        document.addEventListener(ev, block, true);
      }
      if (!api.pageRun(this.pageVisibility)) api.onReady(() => api.pageRun(this.pageVisibility));
    }

    if (!cfg.pipButton) return;

    function togglePip(e) {
      e.preventDefault();
      e.stopPropagation();
      // Fix: resolve the <video> at tap time. The original captured it when
      // the button was created and kept a stale element after navigation.
      const v = getVideo();
      if (!v) return api.toast('No video found');
      try {
        v.removeAttribute('disablepictureinpicture');
        v.disablePictureInPicture = false;
        if (typeof v.webkitSetPresentationMode === 'function' &&
            (typeof v.webkitSupportsPresentationMode !== 'function' || v.webkitSupportsPresentationMode('picture-in-picture'))) {
          v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
        } else if (document.pictureInPictureEnabled) {
          (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture())
            .catch((err) => api.toast('Picture-in-Picture failed: ' + err.message));
        } else {
          api.toast('Picture-in-Picture is not supported here');
        }
      } catch (err) {
        api.toast('Picture-in-Picture failed: ' + err.message);
      }
    }

    api.addStyle(`
      .ioss-pip-btn { background: rgba(0,0,0,.3) !important; color: #fff !important; border: 0 !important; border-radius: 50% !important;
        width: 40px !important; height: 40px !important; margin: 4px 6px !important; padding: 0 !important; display: inline-flex !important;
        align-items: center; justify-content: center; flex: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent;
        pointer-events: auto !important; vertical-align: middle; }
      .ioss-pip-btn svg { width: 22px; height: 22px; filter: drop-shadow(0 0 2px rgba(0,0,0,.6)); pointer-events: none; }
      .ytp-right-controls .ioss-pip-btn { background: transparent !important; height: 100% !important; margin: 0 !important; border-radius: 0 !important; width: 48px !important; }
    `, 'ioss-pip-css');

    const PIP_PATH = 'M19 7h-8v6h8V7zm2-4H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18v14z';
    const makeButton = () => {
      const b = api.el('button', { type: 'button', class: 'ioss-pip-btn', title: 'Picture-in-Picture', 'aria-label': 'Picture-in-Picture' }, [api.icon(PIP_PATH)]);
      b.addEventListener('click', togglePip, true);
      // Keep YouTube's mobile overlay from treating the tap as "hide controls".
      b.addEventListener('touchend', (e) => e.stopPropagation(), { passive: true });
      return b;
    };

    const CONTAINERS = [
      ['.player-controls-bottom-left', 'append'], // m.youtube.com
      ['.ytp-right-controls', 'prepend'] // desktop site
    ];
    function inject() {
      if (!getVideo()) return;
      const roots = [document];
      const host = document.querySelector('ytp-player');
      if (host && host.shadowRoot) roots.push(host.shadowRoot);
      for (const root of roots) {
        for (const [sel, how] of CONTAINERS) {
          for (const c of root.querySelectorAll(sel)) {
            if (c.querySelector('.ioss-pip-btn')) continue;
            if (how === 'prepend') c.prepend(makeButton()); else c.appendChild(makeButton());
          }
        }
      }
    }

    // Fix: the original re-scanned the page on every DOM mutation.
    api.onReady(() => {
      inject();
      api.observe(document.body, { childList: true, subtree: true }, inject, { throttle: 250 });
      api.onUrlChange(() => setTimeout(inject, 300));
    });
  }
}));

  /* ---- module: downloader v1.2.1 ---- */
  register(({
  id: 'downloader',
  name: 'Video downloader',
  version: '1.2.1',
  api: 1,
  source: 'All-in-One Video Downloader 1.0.19 (Daniel)',
  description: 'Adds a download button for videos on YouTube, YouTube Music, TikTok, Instagram, X/Twitter, Threads, Facebook, Pinterest, Snapchat, TED, Douyin, Xiaohongshu and Spotify. Tapping it opens the downloader service with the current video. Opening a direct video file shows a Save button.',
  runAt: 'ready',
  frames: false,
  SITES: /(^|\.)(youtube\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com|threads\.(com|net)|facebook\.com|pinterest\.[a-z.]+|snapchat\.com|ted\.com|douyin\.com|xiaohongshu\.com|spotify\.com)$/,
  CDN: /(googlevideo\.com|tiktokcdn(-eu|-us|-af)?\.com|douyinvod\.com|fbcdn\.net|twimg\.com|zjcdn\.com|snssdk\.com|tiktokv\.com|douyinstatic\.com|xhscdn\.com|amemv\.com|tikwm\.com|douyinpic\.com|douyinmusicpromotion\.com|cdninstagram\.com|licdn\.com|sc-cdn\.net|pinimg\.com|tedcdn\.com|dmcdn\.net|tumblr\.com|rutube\.ru|uma\.media)$/,
  match: function (u) { return this.SITES.test(u.hostname) || this.CDN.test(u.hostname); },
  defaults: { fab: true, ytInline: true, inlineX: true, service: 'tool77', copyOnLongPress: true },
  options: [
    { key: 'fab', type: 'bool', label: 'Floating download button on video pages' },
    { key: 'ytInline', type: 'bool', label: 'YouTube: download button left of the like button', help: 'Replaces the floating button on watch pages' },
    { key: 'inlineX', type: 'bool', label: 'Download button in X/Twitter & Threads posts' },
    { key: 'copyOnLongPress', type: 'bool', label: 'Long-press the button to copy the video link' },
    { key: 'service', type: 'select', label: 'Downloader service', choices: [['tool77', 'tool77.com (original service)'], ['copy', 'Just copy the link']] }
  ],

  run(api, cfg) {
    const self = this;
    const host = location.hostname;
    const DL_PATH = 'M5 20h14v-2H5v2zm7-3 6-6-1.41-1.41L13 13.17V4h-2v9.17L7.41 9.59 6 11l6 6z';
    const lang = (navigator.language || 'en').split('-')[0];

    function openService(url) {
      if (!url) return api.toast('No video found on this page');
      if (cfg.service === 'copy') return api.copy(url).then((ok) => api.toast(ok ? 'Video link copied' : url));
      api.openTab(`https://www.tool77.com/${lang}/v/downloader?v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel&url=${encodeURIComponent(url)}`);
    }

    // ------------------------------------------------------------------
    // Direct media files (opened from a CDN): in-page Save button.
    // Fix: StreamSaver (and the two unused crypto libraries the original
    // @required) do not work in iOS Safari. The file is fetched with
    // GM.xmlHttpRequest and handed to the iOS share sheet ("Save Video")
    // or saved through a download link.
    // ------------------------------------------------------------------
    if (self.CDN.test(host) && document.contentType !== 'text/html') {
      const ext = (() => {
        const v = document.querySelector('video source, video');
        const t = (v && v.type) || document.contentType || '';
        const map = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        const fromPath = (location.pathname.match(/\.([a-z0-9]{2,4})$/i) || [])[1];
        return map[t.split(';')[0]] || (fromPath && fromPath.toLowerCase()) || 'mp4';
      })();
      const name = `${Date.now()}.${ext}`;
      let blob = null;
      const btn = api.fab({
        title: 'Save file',
        path: DL_PATH,
        onTap: async () => {
          if (blob) return share();
          api.toast('Downloading…', { timeout: 2000 });
          try {
            const r = await api.request({ url: location.href, responseType: 'blob', timeout: 300000,
              onprogress: (e) => { if (e.lengthComputable && e.total) btn.element.title = Math.round((e.loaded / e.total) * 100) + '%'; } });
            if (r.status < 200 || r.status >= 300 || !r.response) throw new Error('HTTP ' + r.status);
            blob = r.response instanceof Blob ? r.response : new Blob([r.response]);
            // Sharing needs a fresh tap (iOS user-activation rules).
            api.toast('Ready.', { timeout: 15000, action: 'Save', onAction: share });
          } catch (e) {
            api.toast('Download failed. Long-press the video and choose "Save to Files" instead.', { timeout: 6000 });
          }
        }
      });
      async function share() {
        const file = new File([blob], name, { type: blob.type || 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        const a = api.el('a', { href: URL.createObjectURL(blob), download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
      btn.show();
      return;
    }

    // ------------------------------------------------------------------
    // Finding "the video the user means" on a touch screen. The original
    // relied on mouse hover, which never happens on an iPhone, so its
    // buttons never appeared there; it also ignored m.youtube.com.
    // ------------------------------------------------------------------
    const visibleScore = (n) => {
      const r = n.getBoundingClientRect();
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      return h > 0 && w > 0 ? h * w : 0;
    };
    const mostVisible = (nodes) => {
      let best = null;
      let score = 0;
      for (const n of nodes) { const s = visibleScore(n); if (s > score) { score = s; best = n; } }
      return best;
    };
    const videoContainer = (sel) => {
      const vids = Array.from(document.querySelectorAll('video'));
      const v = mostVisible(vids);
      return v ? v.closest(sel) : null;
    };
    const clean = (u) => String(u).split('?')[0];
    const abs = (href) => { try { return new URL(href, location.href).href; } catch (_) { return null; } };

    const resolvers = [
      [/(^|\.)music\.youtube\.com$/, () => {
        const id = new URLSearchParams(location.search).get('v');
        if (!id) return null;
        const list = new URLSearchParams(location.search).get('list');
        return { direct: `https://www.ytgogo.com/?url=${encodeURIComponent(`https://music.youtube.com/watch?v=${id}${list ? '&list=' + list : ''}`)}&v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel` };
      }],
      [/(^|\.)youtube\.com$/, () => {
        const id = new URLSearchParams(location.search).get('v');
        if (location.pathname === '/watch' && id) return `https://www.youtube.com/watch?v=${id}`;
        const s = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
        return s ? `https://www.youtube.com/shorts/${s[1]}` : null;
      }],
      [/(^|\.)tiktok\.com$/, () => {
        if (/\/video\/\d+/.test(location.pathname)) return clean(location.href);
        const c = videoContainer('[class*="xgplayer-container"], [id^="xgwrapper"], [data-e2e="recommend-list-item-container"], article');
        const id = c && ((c.id || '').match(/-(\d{8,})$/) || [])[1];
        if (id) return 'https://www.tiktok.com/@_/video/' + id;
        const link = c && c.querySelector('a[href*="/video/"]');
        return link ? clean(abs(link.getAttribute('href'))) : (document.querySelector('video') ? clean(location.href) : null);
      }],
      [/(^|\.)instagram\.com$/, () => {
        if (/^\/(p|reel|reels|tv)\//.test(location.pathname)) return clean(location.href);
        const art = videoContainer('article, [role="presentation"]');
        const link = art && art.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
        return link ? clean(abs(link.getAttribute('href'))) : null;
      }],
      [/(^|\.)(x|twitter)\.com$/, () => {
        const m = location.pathname.match(/\/status\/(\d+)/);
        if (m) return 'https://x.com/_/status/' + m[1];
        const art = videoContainer('article');
        const link = art && art.querySelector('a[href*="/status/"]');
        const id = link && (link.getAttribute('href').match(/\/status\/(\d+)/) || [])[1];
        return id ? 'https://x.com/_/status/' + id : null;
      }],
      [/(^|\.)threads\.(com|net)$/, () => {
        if (/\/post\//.test(location.pathname)) return clean(location.href);
        const c = videoContainer("[data-pressable-container='true']");
        const link = c && Array.from(c.querySelectorAll('a[href*="/post/"]')).pop();
        return link ? clean(abs(link.getAttribute('href'))) : null;
      }],
      [/(^|\.)facebook\.com$/, () => {
        const id = (location.href.match(/(?:v=|\/videos\/|\/reel\/|\/reels\/|\/watch\/\?v=)(\d+)/) || [])[1];
        if (id) return 'https://www.facebook.com/reel/' + id;
        return /\/(watch|reel|reels|videos)/.test(location.pathname) ? clean(location.href) : null;
      }],
      [/(^|\.)pinterest\.[a-z.]+$/, () => {
        if (/\/pin\//.test(location.pathname)) return clean(location.href);
        const v = mostVisible(document.querySelectorAll('video'));
        const a = v && v.closest('a[href*="/pin/"]');
        return a ? clean(a.href) : null;
      }],
      [/(^|\.)snapchat\.com$/, () => (/^\/(@[^/]+\/[^/?]+|(@[^/]+\/)?spotlight\/[^/?]+|p\/[^/]+\/[^/?]+)/.test(location.pathname) ? location.href : null)],
      [/(^|\.)ted\.com$/, () => (/^\/talks\//.test(location.pathname) ? clean(location.href) : null)],
      [/(^|\.)douyin\.com$/, () => {
        const id = new URLSearchParams(location.search).get('modal_id') || (location.pathname.match(/\/video\/(\d+)/) || [])[1];
        return id ? 'https://www.douyin.com/video/' + id : (document.querySelector('video') ? location.href : null);
      }],
      [/(^|\.)xiaohongshu\.com$/, () => (/^\/(explore|discovery\/item)\//.test(location.pathname) ? location.href : null)],
      [/(^|\.)open\.spotify\.com$/, () => {
        let id = (location.pathname.match(/\/track\/([A-Za-z0-9]+)/) || [])[1];
        if (!id) {
          const now = document.querySelector('[data-testid="now-playing-widget"] a[href*="/track/"], [data-testid="context-item-link"][href*="/track/"], aside a[href*="/track/"]');
          id = now && (now.getAttribute('href').match(/track\/([A-Za-z0-9]+)/) || [])[1];
        }
        if (!id) return null;
        return { direct: `https://www.spotmelo.com/en?url=${encodeURIComponent('https://open.spotify.com/track/' + id)}&v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel` };
      }]
    ];
    const resolver = (resolvers.find(([re]) => re.test(host)) || [])[1];
    if (!resolver) return;

    const resolve = () => { try { return resolver(); } catch (e) { api.log('resolver failed', e); return null; } };
    const act = () => {
      const target = resolve();
      if (target && typeof target === 'object') return api.openTab(target.direct);
      openService(target);
    };

    // ---- YouTube: a download pill in the action bar, left of the like
    // button (m.youtube.com and the desktop site). Shorts keep the floating
    // button because their buttons are a vertical column on the video.
    const isYouTubeWatch = () => /(^|\.)(m|www)\.youtube\.com$/.test(host) && location.pathname === '/watch';
    const inlineYouTube = () => {
      if (!cfg.ytInline || !isYouTubeWatch()) return null;
      const like = document.querySelector(
        '.slim-video-action-bar-actions like-button-view-model, .slim-video-action-bar-actions ytm-segmented-like-dislike-button-renderer, ' +
        'ytm-slim-video-action-bar-renderer like-button-view-model, #top-level-buttons-computed segmented-like-dislike-button-view-model, ' +
        '#top-level-buttons-computed ytd-segmented-like-dislike-button-renderer, #top-level-buttons-computed like-button-view-model');
      if (!like) return null;
      const row = like.closest('.slim-video-action-bar-actions, #top-level-buttons-computed') || like.parentElement;
      let slot = like;
      while (slot.parentElement && slot.parentElement !== row) slot = slot.parentElement;
      const existing = row.querySelector(':scope > .ioss-yt-dl');
      if (existing) {
        if (existing.nextElementSibling !== slot) row.insertBefore(existing, slot);
        matchNative(existing, like);
        return existing;
      }
      const btn = api.el('button', {
        type: 'button', class: 'ioss-yt-dl', 'data-ioss-owned': '1', 'aria-label': 'Download video', title: 'Download video'
      }, [api.icon(DL_PATH, 22)]);
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); act(); });
      let pressTimer = 0;
      btn.addEventListener('touchstart', () => {
        if (!cfg.copyOnLongPress) return;
        pressTimer = setTimeout(() => {
          pressTimer = -1;
          const t = resolve();
          if (t) api.copy(t).then((ok) => api.toast(ok ? 'Video link copied' : t));
        }, 600);
      }, { passive: true });
      btn.addEventListener('touchend', (e) => { if (pressTimer === -1) e.preventDefault(); clearTimeout(pressTimer); pressTimer = 0; });
      btn.addEventListener('touchmove', () => { clearTimeout(pressTimer); pressTimer = 0; }, { passive: true });
      row.insertBefore(btn, slot);
      matchNative(btn, like);
      return btn;
    };
    // Fix: the button used YouTube's theme variables, which the 2026 mobile
    // layout no longer sets where we looked, so it rendered dark-on-dark and
    // was practically invisible. It now copies the like button's own colour,
    // background and height (icon-only in the new layout, a pill in the old).
    function matchNative(btn, like) {
      const native = like.querySelector('button') || like;
      const st = getComputedStyle(native);
      const iconOnly = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor);
      btn.classList.toggle('ioss-yt-dl-icon', iconOnly);
      btn.style.setProperty('color', st.color, 'important');
      btn.style.setProperty('background', iconOnly ? 'transparent' : st.backgroundColor, 'important');
      const h = Math.round(native.getBoundingClientRect().height);
      if (h >= 28 && h <= 64) btn.style.setProperty('height', h + 'px', 'important');
    }
    if (cfg.ytInline && /(^|\.)(m|www)\.youtube\.com$/.test(host)) {
      api.addStyle(`
        .ioss-yt-dl { flex: none; display: inline-flex; align-items: center; justify-content: center; height: 36px; min-width: 44px;
          padding: 0 12px; margin: 0 8px 0 0; border: 0; border-radius: 18px; cursor: pointer; align-self: center;
          color: var(--yt-spec-text-primary, #0f0f0f); background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05));
          -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        html[dark] .ioss-yt-dl, [dark] .ioss-yt-dl { color: var(--yt-spec-text-primary, #f1f1f1); background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1)); }
        .ioss-yt-dl:active { opacity: .6; }
        .ioss-yt-dl svg { width: 22px; height: 22px; pointer-events: none; }
        .ioss-yt-dl.ioss-yt-dl-icon { padding: 0; width: 44px; margin: 0 2px; border-radius: 50%; }
        .ioss-yt-dl.ioss-yt-dl-icon svg { width: 24px; height: 24px; }
      `, 'ioss-yt-dl-css');
      inlineYouTube();
      api.observe(document.body, { childList: true, subtree: true }, inlineYouTube, { throttle: 400 });
      api.onUrlChange(() => setTimeout(inlineYouTube, 300));
    }

    if (cfg.fab) {
      const button = api.fab({
        title: 'Download video',
        path: DL_PATH,
        onTap: act,
        onLongPress: cfg.copyOnLongPress ? () => {
          const t = resolve();
          const url = t && typeof t === 'object' ? t.direct : t;
          if (url) api.copy(url).then((ok) => api.toast(ok ? 'Video link copied' : url));
        } : null
      });
      // Show the button only where there is something to download.
      // Fix: the original kept several 700-800 ms intervals running forever.
      const refresh = () => {
        const hasVideo = !!document.querySelector('video');
        const t = resolve();
        const inline = isYouTubeWatch() && document.querySelector('.ioss-yt-dl');
        if (!inline && (t || (hasVideo && !/(^|\.)youtube\.com$/.test(host)))) button.show(); else button.hide();
      };
      refresh();
      api.onUrlChange(() => setTimeout(refresh, 400));
      api.every(2000, refresh);
    }

    // ---- inline buttons in X/Twitter & Threads posts (taps, not hover)
    if (!cfg.inlineX) return;
    if (/(^|\.)(x|twitter)\.com$/.test(host)) {
      const SVG = 'M11.99 16l-5.7-5.7L7.7 8.88l3.29 3.3V2.59h2v9.59l3.3-3.3 1.41 1.42-5.71 5.7zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z';
      api.addStyle(`.ioss-x-dl{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;margin-left:4px;color:rgb(113,118,123);border:0;background:none;padding:0;-webkit-tap-highlight-color:transparent}
        .ioss-x-dl:active{color:rgb(29,155,240)} .ioss-x-dl svg{width:20px;height:20px}`);
      const scan = () => {
        for (const art of document.querySelectorAll('article:not([data-ioss-dl])')) {
          const media = art.querySelector('[data-testid="videoComponent"], [data-testid="videoPlayer"], button[data-testid="playButton"], div[role="progressbar"]');
          if (!media) continue;
          const group = art.querySelector('div[role="group"]:last-of-type');
          const link = art.querySelector('a[href*="/status/"]');
          const id = link && (link.getAttribute('href').match(/\/status\/(\d+)/) || [])[1];
          if (!group || !id) continue;
          art.setAttribute('data-ioss-dl', '1');
          group.appendChild(api.el('button', { type: 'button', class: 'ioss-x-dl', 'aria-label': 'Download video',
            onclick: (e) => { e.preventDefault(); e.stopPropagation(); openService('https://x.com/_/status/' + id); } }, [api.icon(SVG, 20)]));
        }
      };
      scan();
      api.observe(document.body, { childList: true, subtree: true }, scan, { throttle: 400 });
    } else if (/(^|\.)threads\.(com|net)$/.test(host)) {
      const scan = () => {
        for (const c of document.querySelectorAll("[data-pressable-container='true']:not([data-ioss-dl])")) {
          if (!c.querySelector('video')) continue;
          const buttons = Array.from(c.querySelectorAll("[role='button']"));
          if (buttons.length <= 1) continue;
          c.setAttribute('data-ioss-dl', '1');
          const withNum = buttons.filter((b) => /\d/.test(b.textContent || ''));
          const share = (withNum.length ? withNum : buttons).pop().parentElement;
          const b = share.cloneNode(false);
          b.style.cssText += ';display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:pointer';
          b.appendChild(api.icon(DL_PATH, 20));
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const post = Array.from(c.querySelectorAll("a[role='link'][href*='/post/']")).pop();
            openService(post ? abs(post.getAttribute('href')) : location.href);
          });
          share.insertAdjacentElement('afterend', b);
        }
      };
      scan();
      api.observe(document.body, { childList: true, subtree: true }, scan, { throttle: 500 });
    }
  }
}));

  /* ---- module: shortlinks v96.9.0 ---- */
  register(({
  id: 'shortlinks',
  name: 'Bypass All Shortlinks',
  version: '96.9.0',
  api: 1,
  source: 'Bypass All Shortlinks 96.8 by Bloggerpemula (bloggerpemula.pythonanywhere.com) — thanks to @JustOlaf, @Konf, @hacker09, @juansi, @NotYou, @cunaqr, @Rust1667 and @varram',
  description: 'Skips link-shortener waiting pages (AdLinkFly "go-link" sites and the supported shortener families), plus optional tools: block anti-adblock scripts, prompts & cookie banners, popups, timers, focus checks and anti-debugging, re-enable right-click, Flickr image saving.',
  runAt: 'start',
  frames: false,
  EXCLUDE: [
    /^(https?:\/\/)([^\/]+\.)?((cloudflare|github|aliyun|reddit|bing|yahoo|microsoft|whatsapp|amazon|ebay|payoneer|paypal|skrill|stripe|stripecdn|tipalti|wise|discord|tokopedia|taobao|taboola|aliexpress|netflix|citigroup|spotify|bankofamerica|hsbc|blogger|(accounts|studio).youtube|atlassian|pinterest|twitter|x|live|linkedin|fastbull|tradingview|deepseek|chatgpt|openai|grok|bilibili|indodax|bmcdn6|fbsbx|googlesyndication|amazon-adsystem|pubmatic|gstatic).com|(greasyfork|openuserjs|telegram|wikipedia|lichess).org|(doubleclick|yahoo).net|proton.me|stripe.network|meta.ai|codepen.io|(shopee|lazada|rakuten|maybank|binance).*|(dana|ovo|bca.co|bri.co|bni.co|bankmandiri.co|desa|(.*).go).id|(.*).(edu|gov))(\/.*)/,
    /^https?:\/\/(?!(www\.google\.com\/(recaptcha\/|url)|docs\.google\.com\/|drive\.google\.com\/)).*google\..*/,
    /^https?:\/\/([a-z0-9]+\.)*(facebook|instagram|tiktok)\.com\/(?!(flx\/warn\/|linkshim\/|link\/v2)).*/,
    /^https?:\/\/raw\.githubusercontent\.com\//
  ],
  match: function (u) { return /^https?:$/.test(u.protocol) && !this.EXCLUDE.some((r) => r.test(u.href)); },
  defaults: {
    BlogDelay: false, SetDelay: 5, TimerFC: false, TDelay: 1000, SameTab: false, RightFC: false, BlockFC: false,
    BlockPop: false, AntiDebug: false, Adblock: false, Prompt: false, Flickr: false
  },
  options: [
    { key: 'BlogDelay', type: 'bool', label: "Route results through the author's blog (delay)", help: 'Shows the destination on bloggerpemula.pythonanywhere.com first' },
    { key: 'SetDelay', type: 'number', label: 'Blog delay (seconds)', min: 0, max: 60 },
    { key: 'TimerFC', type: 'bool', label: 'Fast timers', help: 'Speeds up page countdowns' },
    { key: 'TDelay', type: 'number', label: 'Speed up timers longer than (ms)', min: 100, max: 60000 },
    { key: 'SameTab', type: 'bool', label: 'Open links in the same tab' },
    { key: 'RightFC', type: 'bool', label: 'Re-enable long-press menu, copy & select' },
    { key: 'BlockFC', type: 'bool', label: 'Always "focused" (pages keep counting when you switch tabs)' },
    { key: 'BlockPop', type: 'bool', label: 'Popup blocker (asks before opening)' },
    { key: 'AntiDebug', type: 'bool', label: 'Anti-debug & console-clear protection' },
    { key: 'Adblock', type: 'bool', label: 'Remove anti-adblock scripts' },
    { key: 'Prompt', type: 'bool', label: 'Block alerts, notification prompts & cookie banners' },
    { key: 'Flickr', type: 'bool', label: 'Flickr: add "Save image" links' }
  ],

  /* ---------------- page-world helpers (serialised, keep self-contained) */

  pageTimers: function (targetDelay) {
    if (window.__iossTimers) return;
    window.__iossTimers = true;
    const wrap = (orig) => function (fn, delay, ...rest) {
      return orig.call(this, fn, (typeof delay === 'number' && delay >= targetDelay) ? 50 : delay, ...rest);
    };
    window.setTimeout = wrap(window.setTimeout);
    window.setInterval = wrap(window.setInterval);
  },

  pageNoFocus: function () {
    if (window.__iossFocus) return;
    window.__iossFocus = true;
    const P = Document.prototype;
    const def = (n, v) => { try { Object.defineProperty(P, n, { configurable: true, get: () => v }); } catch (_) { /* ignore */ } };
    def('hidden', false);
    def('webkitHidden', false);
    def('visibilityState', 'visible');
    def('webkitVisibilityState', 'visible');
    document.hasFocus = () => true;
    window.addEventListener('focus', (e) => e.stopImmediatePropagation(), true);
    window.addEventListener('blur', (e) => e.stopImmediatePropagation(), true);
    document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);
  },

  pageFakeHidden: function () {
    try { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); } catch (_) { /* ignore */ }
  },

  pageNoPrompts: function () {
    if (window.__iossPrompts) return;
    window.__iossPrompts = true;
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => null;
    try { Object.defineProperty(window, 'onbeforeunload', { configurable: true, get: () => null, set: () => {} }); } catch (_) { /* ignore */ }
    if (window.Notification) {
      try {
        window.Notification.requestPermission = () => Promise.resolve('denied');
        Object.defineProperty(window.Notification, 'permission', { configurable: true, get: () => 'denied' });
      } catch (_) { /* ignore */ }
    }
  },

  pageAntiDebug: function () {
    if (window.__iossAntiDebug) return;
    window.__iossAntiDebug = true;
    const F = Function.prototype.constructor;
    const strip = (args) => { if (typeof args[args.length - 1] === 'string') args[args.length - 1] = args[args.length - 1].replace(/\bdebugger\b/g, ''); return args; };
    try { Function.prototype.constructor = new Proxy(F, { apply: (t, c, a) => t.apply(c, strip(a)), construct: (t, a) => new t(...strip(a)) }); } catch (_) { /* ignore */ }
    try { console.clear = () => {}; } catch (_) { /* ignore */ }
    const scrub = (item) => {
      if (typeof item === 'function') return 'Hidden Function';
      if (!item || typeof item !== 'object') return item;
      try {
        const d = Object.getOwnPropertyDescriptors(item);
        if (d.toString || Object.values(d).some((x) => 'get' in x)) return 'Hidden Accessor';
      } catch (_) { return 'Hidden Object'; }
      return item;
    };
    for (const m of ['log', 'debug', 'info', 'warn', 'error', 'table', 'dir']) {
      const orig = console[m];
      if (typeof orig === 'function') console[m] = function (...a) { return orig.apply(this, a.map(scrub)); };
    }
    try { const now = performance.now.bind(performance); performance.now = () => now() + Math.random() * 2; } catch (_) { /* ignore */ }
  },

  pageSameTab: function () {
    try {
      Object.defineProperty(window, 'open', { configurable: false, writable: false, value: function (url) { if (url) location.href = url; return null; } });
    } catch (_) { /* ignore */ }
  },

  pageBlockPopup: function () {
    if (window.__iossPopup) return;
    window.__iossPopup = true;
    const originalOpen = window.open.bind(window);
    function ask(url, onAllow) {
      const old = document.querySelector('ioss-popup-ask');
      if (old) old.remove();
      const host = document.createElement('ioss-popup-ask');
      host.style.cssText = 'position:fixed;z-index:2147483647;top:calc(env(safe-area-inset-top,0px) + 10px);left:50%;transform:translateX(-50%);width:min(92vw,380px)';
      const root = host.attachShadow({ mode: 'open' });
      const box = document.createElement('div');
      box.style.cssText = 'background:#fff;color:#111;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:12px;font:15px -apple-system,system-ui,sans-serif';
      const title = document.createElement('div');
      title.textContent = 'This page wants to open a popup';
      title.style.cssText = 'font-weight:600;margin-bottom:6px';
      const u = document.createElement('div');
      u.textContent = url || 'about:blank';
      u.style.cssText = 'font-size:13px;word-break:break-all;background:#f2f2f7;border-radius:8px;padding:8px;margin-bottom:10px;max-height:4.5em;overflow:hidden';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px';
      const mk = (label, bg, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `flex:1;min-height:44px;border:0;border-radius:10px;font:600 15px -apple-system,system-ui,sans-serif;color:#fff;background:${bg}`;
        b.addEventListener('click', () => { host.remove(); fn && fn(); });
        return b;
      };
      row.append(mk('Open', '#34c759', onAllow), mk('Same tab', '#0a84ff', () => { if (url) location.href = url; }), mk('Block', '#ff3b30'));
      box.append(title, u, row);
      root.appendChild(box);
      (document.body || document.documentElement).appendChild(host);
    }
    // Fix: the original returned a Promise from window.open, which broke
    // pages that use the returned window object. Now it returns null.
    window.open = function (url, name, features) {
      ask(url ? String(url) : '', () => originalOpen(url, name, features));
      return null;
    };
    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[target="_blank"][href]');
      if (a && !/^javascript:/i.test(a.getAttribute('href'))) { e.preventDefault(); ask(a.href, () => originalOpen(a.href)); }
    }, true);
    document.addEventListener('submit', (e) => {
      const f = e.target;
      if (f.target === '_blank' && f.action) { e.preventDefault(); ask(f.action, () => originalOpen(f.action)); }
    }, true);
  },

  pageTrustMe: function () {
    if (window.__iossTrust) return;
    window.__iossTrust = true;
    const add = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'message' || typeof listener !== 'function') return add.call(this, type, listener, options);
      const wrapped = function (event) {
        let proxied = event;
        try { proxied = new Proxy(event, { get: (t, p) => (p === 'isTrusted' ? true : (typeof t[p] === 'function' ? t[p].bind(t) : t[p])) }); } catch (_) { /* keep */ }
        return listener.call(this, proxied);
      };
      return add.call(this, type, wrapped, options);
    };
    const MO = window.MutationObserver;
    window.MutationObserver = function (cb) {
      if (/monitorSuspiciousAttributes/.test(new Error().stack || '')) return { observe() {}, disconnect() {}, takeRecords() { return []; } };
      return new MO(cb);
    };
    window.MutationObserver.prototype = MO.prototype;
  },

  pageGoLink: function (blogDelay, autoList) {
    const $ = window.jQuery;
    if (!$ || !$('form[id=go-link]').length || autoList.includes(location.host)) return;
    const redirect = (url) => { location = blogDelay ? 'https://bloggerpemula.pythonanywhere.com/?BypassResults=' + url : url; };
    $('form[id=go-link]').off('submit').on('submit', function (e) {
      e.preventDefault();
      const form = $(this);
      const pesan = form.find('button');
      $.ajax({
        type: 'POST', url: form.attr('action'), data: form.serialize(), dataType: 'json',
        beforeSend: function () {
          pesan.attr('disabled', 'disabled');
          $('a.get-link').text('Bypassed by Bloggerpemula');
          const btn = '<button class="btn btn-default , col-md-12 text-center" onclick="javascript: return false;"><b>Thanks for using Bypass All Shortlinks Scripts and for Donations , Regards : Bloggerpemula</b></button>';
          $('.navbar-collapse.collapse').replaceWith(btn);
          $('.main-header').replaceWith(btn);
          $('.col-sm-6.hidden-xs').replaceWith(btn);
        },
        success: function (result, status, xhr) {
          let finalUrl = result.url;
          if (finalUrl.includes('swiftcut.xyz')) {
            finalUrl = finalUrl.replace(/[?&]i=[^&]*/g, '').replace(/[?]&/, '?').replace(/&&/, '&').replace(/[?&]$/, '');
            location.href = finalUrl;
          } else if (xhr.responseText.match(/(a-s-cracks.top|mdiskshortner.link|exashorts.fun|bigbtc.win|slink.bid|clockads.in)/)) {
            location.href = finalUrl;
          } else {
            redirect(finalUrl);
          }
        }
      });
    });
    document.documentElement.setAttribute('data-ioss-golink', '1');
  },

  /* ------------------------------------------------------------ module */

  run(api, cfg) {
    const self = this;
    const host = location.host;
    const BpParams = new URLSearchParams(location.search);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ---- selector helper with :contains("x") / :innerText("x") / :has(x)
    const bp = function (query, all = false) {
      const containsMatch = query.match(/:contains\("([^"]+)"\)$/);
      const innerTextMatch = query.match(/:innerText\("([^"]+)"\)$/);
      let base = query;
      let text = null;
      let useInner = false;
      if (containsMatch) { base = query.replace(/:contains\("[^"]+"\)$/, ''); text = containsMatch[1]; } else if (innerTextMatch) { base = query.replace(/:innerText\("[^"]+"\)$/, ''); text = innerTextMatch[1]; useInner = true; }
      let elements;
      try { elements = Array.from(document.querySelectorAll(base || '*')); } catch (_) { return all ? [] : null; }
      if (text) elements = elements.filter((e) => (useInner ? e.innerText : e.textContent).trim().toLowerCase().includes(text.toLowerCase()));
      return all ? elements : elements[0] || null;
    };
    const elementExists = (q) => bp(q) !== null;
    const isCloudflare = () => document.title === 'Just a moment...' || !!document.querySelector('.spacer-top.spacer.core-msg');
    const redirect = (url, blog = true) => { location = blog && cfg.BlogDelay ? 'https://bloggerpemula.pythonanywhere.com/?BypassResults=' + url : url; };
    const page = (fn, ...args) => api.pageRun(fn, ...args);

    function elementReady(selector) {
      return new Promise((resolve) => {
        const hit = bp(selector);
        if (hit) return resolve(hit);
        const stop = api.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] }, () => {
          const e = bp(selector);
          if (e) { stop(); resolve(e); }
        });
      });
    }
    function ReadytoClick(selector, sleepTime = 0) {
      const selectors = selector.split(', ');
      if (selectors.length > 1) return selectors.forEach((s) => ReadytoClick(s, sleepTime));
      if (sleepTime > 0) return sleep(sleepTime * 1000).then(() => ReadytoClick(selector, 0));
      for (const ev of ['mousemove', 'touchstart']) document.dispatchEvent(new Event(ev, { bubbles: true }));
      elementReady(selector).then((e) => {
        e.removeAttribute('disabled');
        e.removeAttribute('target');
        for (const ev of ['mouseover', 'mousedown', 'mouseup', 'click']) e.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
      });
    }
    function setActiveElement(selector) {
      elementReady(selector).then((e) => { const t = e.tabIndex; e.tabIndex = 0; e.focus(); e.tabIndex = t; });
    }
    const isVisible = (e) => !!e && (e.offsetHeight || e.offsetWidth) && getComputedStyle(e).visibility !== 'hidden';
    function CheckVisibility(selector, callback) {
      const id = setInterval(() => { if (isVisible(bp(selector))) { clearInterval(id); callback(); } }, 1000);
    }
    function whenText(text, callback) {
      const id = setInterval(() => { if (document.body && document.body.innerText.includes(text)) { clearInterval(id); callback(); } }, 1000);
    }
    // Captcha tokens land in hidden form fields that the content world can
    // read; the original polled grecaptcha/hcaptcha objects, which are
    // invisible from Safari's sandbox.
    function CaptchaDone(callback) {
      if (isCloudflare()) return;
      const id = setInterval(() => {
        const solved = elementExists('.iconcaptcha-modal__body-checkmark') ||
          Array.from(document.querySelectorAll('[name="g-recaptcha-response"], [name="h-captcha-response"], [name="cf-turnstile-response"]')).some((f) => f.value && f.value.length > 0);
        if (solved) { clearInterval(id); callback(); }
      }, 1000);
    }
    function DoIfExists(query, seconds = 1) {
      const e = bp(query);
      if (e && typeof e.click === 'function') setTimeout(() => e.click(), seconds * 1000);
    }

    const WIDGET_SITES = /(bitwidgets|virtuous-tech|coinilium|adwarden)\.net|(bubblix|dailytech-news)\.eu|(biit|carfocus|blogfly|multimix)\.site|(newsminer|adwyn|coderun)\.uno|wii\.si|(cryptics|uiio|kiit|liln|dailynewshub|nanolink)\.fun|cryptorealm\.online/;

    // ---- document-start work
    if (WIDGET_SITES.test(host)) page(self.pageTrustMe);

    const features = [];
    if (cfg.Adblock) {
      features.push('Adblock');
      const re = /adblock|AdbModel|AdblockReg|AntiAdblock|blockAdBlock|checkAdBlock|detectAnyAdb|detectAdBlock|justDetectAdb|FuckAdBlock|TestAdBlock|DisableDevtool|devtools/;
      const zap = (n) => { if ((n.tagName === 'SCRIPT' || n.tagName === 'IFRAME') && re.test(n.src || n.textContent || '')) n.remove(); };
      const mo = new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) zap(n); });
      const startAdb = () => { mo.observe(document.documentElement, { childList: true, subtree: true }); document.querySelectorAll('script, iframe').forEach(zap); };
      if (document.documentElement) startAdb(); else api.onReady(startAdb);
    }
    if (cfg.TimerFC) { features.push('Fast Timer'); page(self.pageTimers, Number(cfg.TDelay) || 1000); }
    if (cfg.BlockFC) { features.push('Focus Control'); page(self.pageNoFocus); }
    if (cfg.AntiDebug) { features.push('Anti-Debug'); page(self.pageAntiDebug); }
    if (cfg.BlockPop) {
      features.push('Popup Blocker');
      if (!page(self.pageBlockPopup)) api.onReady(() => page(self.pageBlockPopup));
    }
    if (cfg.SameTab) {
      features.push('SameTab');
      page(self.pageSameTab);
      document.addEventListener('click', (e) => {
        const a = e.target && e.target.closest && e.target.closest('a[target="_blank"][href]');
        if (a && /^https?:/i.test(a.href)) { e.preventDefault(); location.href = a.href; }
      }, true);
      document.addEventListener('submit', (e) => { const f = e.target; if (f.target === '_blank') f.target = '_self'; }, true);
    }
    if (cfg.RightFC) {
      features.push('Right Click Control');
      for (const ev of ['contextmenu', 'copy', 'cut', 'paste', 'select', 'selectstart', 'dragstart', 'drop']) {
        window.addEventListener(ev, (e) => e.stopPropagation(), true);
      }
      api.addStyle('*{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default!important}');
    }
    if (cfg.Prompt) {
      features.push('Disable Prompts & Notifications');
      if (!page(self.pageNoPrompts)) api.onReady(() => page(self.pageNoPrompts));
      // Fix: the original re-scheduled itself on every DOM mutation, so the
      // number of timers grew without bound and pages slowed to a crawl.
      // It also removed ANY element whose class contained "banner" or
      // "notice" (sometimes the whole page). Only fixed/sticky overlays
      // that look like cookie/consent banners are removed now.
      const sweep = () => {
        if (!document.body) return;
        for (const b of document.querySelectorAll('[class*="cookie" i], [id*="cookie" i], [class*="consent" i], [id*="consent" i], [class*="gdpr" i], [id*="gdpr" i], [aria-label*="cookie" i], [aria-label*="consent" i], [role="dialog"]')) {
          if (b === document.body || b === document.documentElement || b.contains(document.querySelector('main'))) continue;
          const pos = getComputedStyle(b).position;
          if ((pos === 'fixed' || pos === 'sticky') && b.textContent.length < 3000 && /cookie|consent|gdpr|tracking|privacy/i.test(b.textContent)) b.remove();
        }
      };
      api.onReady(() => { sweep(); api.observe(document.body, { childList: true, subtree: true }, sweep, { throttle: 800 }); });
    }
    if (features.length) api.log(`Activated features: ${features.join(', ')}`);

    // ---- DOM-ready work (injecting code from start and the end of document coded by @Konf)
    api.onReady(() => {
      if (isCloudflare()) return;

      // Result page on the author's blog
      if (host === 'bloggerpemula.pythonanywhere.com' && location.pathname === '/' && BpParams.has('BypassResults')) {
        const link = decodeURIComponent(location.href.split('BypassResults=')[1].replace('&m=1', ''));
        const delay = Math.max(0, Number(cfg.SetDelay) || 0);
        api.toast(`Redirecting to your destination in ${delay} s — thanks!`, { timeout: delay * 1000 + 500, action: 'Go now', onAction: () => { location.href = link; } });
        setTimeout(() => { location.href = link; }, delay * 1000);
        return;
      }

      // coinclix.co + its step sites
      if (/coinclix\.co|coinhub\.wiki|(vitalityvista|geekgrove)\.net/.test(host)) {
        const url = location.href;
        if (url.includes('go/')) {
          api.toast('Reload the page if the copied key is different', { timeout: 6000 });
          sleep(1000).then(async () => {
            const link = bp('p.mb-2:nth-child(2) > strong > a');
            const key = bp('p.mb-2:nth-child(3) > kbd > code') || bp('p.mb-2:nth-child(4) > kbd > code');
            if (link && key) {
              const keyText = key.textContent.trim();
              await api.copy(keyText);
              await api.storage.set('lastKey', keyText);
              api.openTab(link.href, true);
            } else {
              const p = Array.from(document.getElementsByTagName('p')).find((x) => x.textContent.toLowerCase().includes('step 1') && x.textContent.toLowerCase().includes('google'));
              if (p) {
                await sleep(1000);
                const t = p.textContent.toLowerCase();
                const site = t.includes('vitalityvista') ? 'vitalityvista.net' : t.includes('coinhub') ? 'coinhub.wiki' : 'geekgrove.net';
                api.openTab('https://www.google.com/url?q=https://' + site, true);
              }
            }
          });
        }
        if (['geekgrove.net', 'vitalityvista.net', 'coinhub.wiki'].some((s) => url.includes(s))) {
          ReadytoClick('a.btn:has(.mdi-check)', 2);
          ReadytoClick('#btnLinkStart', 2);
          CaptchaDone(() => ReadytoClick('#btnLinkContinue'));
          CheckVisibility('#btnLinkContinue', () => { if (!elementExists('.iconcaptcha-modal')) ReadytoClick('#btnLinkContinue'); else ReadytoClick('.iconcaptcha-modal__body'); });
          CheckVisibility('.alert-success.alert-inline.alert', () => ReadytoClick('#btnLpcont'));
          sleep(1000).then(async () => {
            const input = bp('#linkInput.form-control');
            if (input) {
              input.value = await api.storage.get('lastKey', '');
              input.dispatchEvent(new Event('input', { bubbles: true }));
              sleep(1000).then(() => { const b = bp('.btn-primary.btn-ripple'); if (b) b.click(); });
            }
            const stop = api.observe(document.body, { childList: true, subtree: true }, () => {
              const codeEl = bp('.link_code');
              if (!codeEl) return;
              const code = codeEl.textContent.trim();
              api.copy(code);
              const footer = document.querySelector('#link_result_footer > div > div');
              if (footer) footer.textContent = `The Copied Code is / Kode yang tersalin adalah: ${code} , Please Paste the Code on the coinclix.co Site Manually / Silahkan Paste Kodenya di Situs coinclix.co secara manual`;
              stop();
            });
          });
        }
      }

      // Generic AdLinkFly-style "go-link" shorteners
      if (document.querySelector('form[id=go-link]')) {
        const List = ['lopteapi.com', '3link.co', 'exeygo.com', 'vuotlink.vip'];
        if (List.includes(host)) {
          ReadytoClick('a.btn.btn-success.btn-lg.get-link:not([disabled])', 3);
        } else {
          page(self.pageGoLink, !!cfg.BlogDelay, List);
          if (!document.documentElement.hasAttribute('data-ioss-golink')) {
            // Fallback when the page world is unreachable (strict CSP): wait
            // until the site fills in the final link, then follow it at once.
            const follow = () => {
              const a = document.querySelector('a.get-link');
              const href = a && a.getAttribute('href');
              if (href && /^https?:\/\//i.test(href) && !a.hasAttribute('disabled') && !a.classList.contains('disabled')) { stop(); redirect(a.href); }
            };
            const stop = api.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'class', 'disabled'] }, follow, { throttle: 200 });
          }
        }
      }

      // Flickr: save links for every size
      if (/(^|\.)flickr\.com$/.test(location.hostname) && cfg.Flickr) {
        api.waitFor('a[href*="/sizes/"]', { timeout: 20000 }).then(async (sizesLink) => {
          if (!sizesLink) return api.log('Flickr: "View all sizes" link not found');
          try {
            const r = await api.request({ url: sizesLink.href });
            const doc = new DOMParser().parseFromString(r.text, 'text/html');
            const items = Array.from(doc.querySelectorAll('.sizes-list li ol li'));
            if (!items.length) return;
            const box = api.el('div', { style: { background: '#fff', color: '#333', border: '1px solid #ccc', padding: '10px', margin: '0 0 6px', position: 'relative', borderRadius: '8px', fontSize: '15px' } },
              [api.el('div', { text: 'Bloggerpemula Script', style: { textAlign: 'center', fontWeight: 'bold' } }),
                api.el('button', { type: 'button', text: '✕', style: { position: 'absolute', top: '2px', right: '6px', border: '0', background: 'none', fontSize: '18px', minWidth: '36px', minHeight: '36px' }, onclick: () => box.remove() })]);
            for (const it of items) {
              const a = it.querySelector('a');
              const label = `${a ? a.textContent.trim() : it.textContent.trim()} ${(it.querySelector('small') || {}).textContent || ''}`.trim();
              if (!a) continue;
              const sr = await api.request({ url: new URL(a.getAttribute('href'), sizesLink.href).href }).catch(() => null);
              const img = sr && new DOMParser().parseFromString(sr.text, 'text/html').querySelector('#allsizes-photo img[src]');
              if (!img) continue;
              box.appendChild(api.el('a', { href: img.getAttribute('src'), text: `Save ${label}`, style: { display: 'block', padding: '8px 0' }, onclick: (e) => { e.preventDefault(); api.openTab(img.getAttribute('src'), true); } }));
            }
            (sizesLink.parentElement || document.body).insertBefore(box, sizesLink);
          } catch (e) { api.log('Flickr failed', e.message); }
        });
      }

      if (/(^|\.)bigbtc\.win$/.test(location.hostname)) {
        CaptchaDone(() => DoIfExists('#claimbutn'));
        if (location.href.includes('/bonus')) DoIfExists('#clickhere', 3);
      }

      if (WIDGET_SITES.test(host)) {
        const fakeHidden = () => page(self.pageFakeHidden);
        whenText('Failed! Please reload', () => sleep(1000).then(() => location.reload()));
        whenText('Verified', () => setTimeout(() => {
          for (const b of document.querySelectorAll('[type="button"]')) {
            if (/Continue|Verify/.test(b.textContent)) b.click();
          }
        }, 1000));
        const clickMsg = '#clickMessage[style*="display: block"], #clickMessage[style*="display:block"]';
        CheckVisibility('#captcha-container', () => {
          const id = setInterval(() => {
            const mb = bp('.mb-2');
            if (mb && mb.innerText.includes('Verified')) { clearInterval(id); ReadytoClick('button:contains("Verify")', 2); }
          }, 1000);
        });
        elementReady('#loadingDiv[style*="display:block"] button, #loadingDiv[style*="display: block"] button').then(() => ReadytoClick('#loadingDiv button', 2));
        elementReady(clickMsg).then(() => { setActiveElement('[data-placement-id="revbid-leaderboard"]'); fakeHidden(); });
      }
    });
  }
}));

  /* ---- module: dark-mode v1.6.0 ---- */
  register(({
  id: 'dark-mode',
  name: 'Dark Mode (eye protection)',
  version: '1.6.0',
  api: 1,
  source: 'Dark Mode 护眼模式 1.5.8 (X.I.U, GPL-3.0)',
  description: 'Dims, warms or inverts every website for night reading. Skips sites that already have their own dark theme, can follow the iPhone\'s dark mode, and can use a different mode by day and by night.',
  runAt: 'start',
  frames: false,
  match: (u) => /^https?:$/.test(u.protocol) && u.hostname !== 'live.bilibili.com',
  defaults: {
    mode: '2',
    nightMode: 'same',
    followSystem: false,
    runDuringTheDay: true,
    dayStart: '6:00',
    nightStart: '18:00',
    autoRecognition: true,
    m1Day: 60, m1Night: 50,
    m2Day: 60, m2DayWarm: 40, m2Night: 50, m2NightWarm: 50,
    m3Invert: 90,
    m3Exclude: 'img, .img, video, [style*="background"][style*="url"], svg',
    forcedSites: '',
    disabledSites: ''
  },
  options: [
    { key: 'mode', type: 'select', label: 'Mode', choices: [['1', '1 · Dim'], ['2', '2 · Dim + warm'], ['3', '3 · Invert (true dark)']] },
    { key: 'nightMode', type: 'select', label: 'At night use', choices: [['same', 'Same mode'], ['1', '1 · Dim'], ['2', '2 · Dim + warm'], ['3', '3 · Invert']] },
    { key: 'followSystem', type: 'bool', label: 'Only when the iPhone is in Dark Mode' },
    { key: 'runDuringTheDay', type: 'bool', label: 'Also during the day (a little brighter)', help: 'Modes 1 and 2' },
    { key: 'dayStart', type: 'text', label: 'Day starts at', help: 'e.g. 6:00' },
    { key: 'nightStart', type: 'text', label: 'Night starts at', help: 'e.g. 18:00' },
    { key: 'autoRecognition', type: 'bool', label: 'Skip sites that are already dark' },
    { key: 'm1Day', type: 'number', label: 'Mode 1 brightness by day (%)', min: 1, max: 100 },
    { key: 'm1Night', type: 'number', label: 'Mode 1 brightness at night (%)', min: 1, max: 100 },
    { key: 'm2Day', type: 'number', label: 'Mode 2 brightness by day (%)', min: 1, max: 100 },
    { key: 'm2DayWarm', type: 'number', label: 'Mode 2 warmth by day (%)', min: 0, max: 100 },
    { key: 'm2Night', type: 'number', label: 'Mode 2 brightness at night (%)', min: 1, max: 100 },
    { key: 'm2NightWarm', type: 'number', label: 'Mode 2 warmth at night (%)', min: 0, max: 100 },
    { key: 'm3Invert', type: 'number', label: 'Mode 3 invert strength (%)', min: 50, max: 100 },
    { key: 'm3Exclude', type: 'text', label: 'Mode 3: keep these un-inverted', help: 'CSS selectors, comma-separated' },
    { key: 'forcedSites', type: 'text', label: 'Always darken these sites', help: 'Even if they look dark already, e.g. example.com' },
    { key: 'disabledSites', type: 'text', label: 'Never darken these sites', help: 'Comma-separated hosts' }
  ],

  run(api, cfg) {
    const host = location.host.toLowerCase();
    const list = (s) => String(s || '').split(',').map((x) => x.trim().toLowerCase().replace(/^www\./, '')).filter(Boolean);
    const bare = host.replace(/^www\./, '');
    if (list(cfg.disabledSites).includes(bare)) return;
    const forced = list(cfg.forcedSites).includes(bare);
    const systemDark = matchMedia('(prefers-color-scheme: dark)');
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

    const minutes = (t, d) => {
      const m = String(t || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
      return m ? Math.min(23, +m[1]) * 60 + Math.min(59, +(m[2] || 0)) : d;
    };
    function isDaytime() {
      const now = new Date();
      const t = now.getHours() * 60 + now.getMinutes();
      const a = minutes(cfg.dayStart, 360);
      const b = minutes(cfg.nightStart, 1080);
      return a < b ? t >= a && t < b : t >= a || t < b;
    }

    function buildCss() {
      if (cfg.followSystem && !systemDark.matches) return '';
      const day = isDaytime();
      let mode = String(cfg.mode);
      if (!day && cfg.nightMode && cfg.nightMode !== 'same') mode = String(cfg.nightMode);
      if (mode === '1') {
        if (day && !cfg.runDuringTheDay) return '';
        return `html { filter: brightness(${num(day ? cfg.m1Day : cfg.m1Night, 60)}%) !important; }`;
      }
      if (mode === '2') {
        if (day && !cfg.runDuringTheDay) return '';
        return `html { filter: brightness(${num(day ? cfg.m2Day : cfg.m2Night, 60)}%) sepia(${num(day ? cfg.m2DayWarm : cfg.m2NightWarm, 40)}%) !important; }`;
      }
      // Mode 3: invert everything, then invert media back. The suite's own
      // UI is inverted back too so toasts and the settings sheet look right.
      let css = `html { filter: invert(${num(cfg.m3Invert, 90)}%) !important; text-shadow: 0 0 0 !important; }
        ${cfg.m3Exclude || 'img, video, svg'}, ioss-ui, ioss-popup-ask { filter: invert(1) !important; }
        img[alt="[公式]"] { filter: none !important; }`;
      if (/(^|\.)search\.bilibili\.com$/.test(location.hostname)) {
        css += 'ul.video-list img, ul.video-list .video-item .img .mask-video, ul.video-list .video-item .img .van-danmu, ul.video-list .video-item .img .van-framepreview { filter: none !important; }';
      } else if (/\.bilibili\.com$/.test(location.hostname)) {
        css += '.bpx-player-container[data-screen="full"] .bpx-player-video-wrap, .bpx-player-container[data-screen="web"] { filter: invert(1) !important; } .bpx-player-container[data-screen="web"] video { filter: none !important; }';
      } else if (/\.huya\.com$/.test(location.hostname)) {
        css += '#player-wrap[style="height: 100%;"], .player-loading, .sidebar-show, #player-ctrl-wrap { filter: invert(1) !important; }';
      }
      return css;
    }

    const style = api.addStyle('', 'ioss-darkmode');
    let backdrop = null;
    let skipped = false;
    const apply = () => { style.textContent = skipped ? '' : buildCss(); };
    apply();

    // Fix: the original compared colours by gluing R, G and B together as
    // text ("100"+"5"+"5" = 10055 counted as dark, rgb(95,95,95) did not)
    // and missed YouTube's html[dark]. This uses real luminance.
    function luminance(el) {
      const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
      if (!m || (m.length === 4 && +m[3] < 0.5)) return null;
      const [r, g, b] = m.slice(0, 3).map((v) => { v = +v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function looksDark() {
      const root = document.documentElement;
      const body = document.body;
      if (!body) return false;
      if (document.querySelector('html[dark], html[class*=dark], html[data-dark-theme*=dark], html[data-theme*=dark], html[data-color-mode*=dark], html[data-bs-theme=dark], body[class*=dark]')) return true;
      const meta = document.querySelector('head > meta[name="color-scheme"]');
      if (meta && /dark/.test(meta.content) && systemDark.matches) return true;
      if (systemDark.matches && document.querySelector('head > meta[content*="https://challenges.cloudflare.com"]')) return true;
      const lb = luminance(body);
      const lr = luminance(root);
      const l = lb != null ? lb : lr;
      return l != null && l < 0.2;
    }
    function check() {
      if (!document.body) return;
      // Measure the page's own colours, not our white fallback background.
      if (backdrop && backdrop.sheet) backdrop.sheet.disabled = true;
      const dark = looksDark();
      if (backdrop && backdrop.sheet) backdrop.sheet.disabled = false;
      if (cfg.autoRecognition && !forced && dark) {
        if (!skipped) api.log('site has its own dark theme, filter removed');
        skipped = true;
        apply();
        if (backdrop) { backdrop.remove(); backdrop = null; }
        return;
      }
      // Transparent pages need a white background or the filter has nothing to dim.
      if (!backdrop && luminance(document.body) == null && luminance(document.documentElement) == null) {
        backdrop = api.addStyle('html, body { background-color: #ffffff !important; }', 'ioss-darkmode-bg');
      }
    }
    api.onReady(() => setTimeout(check, 150));
    api.onLoad(() => setTimeout(check, 1500));

    // Live updates: iPhone appearance changes, and day/night boundaries
    // (checked once a minute, only while the tab is visible).
    try { systemDark.addEventListener('change', apply); } catch (_) { systemDark.addListener(apply); }
    let lastDay = isDaytime();
    api.every(60000, () => { const d = isDaytime(); if (d !== lastDay) { lastDay = d; apply(); } });
  }
}));

  /* ---- module: web-limits v1.4.0 ---- */
  register(({
  id: 'web-limits',
  name: 'Remove web limits (copy & select)',
  version: '1.4.0',
  api: 1,
  source: 'Remove web limits 网页限制解除 1.3 (Cat73, LGPL-3.0)',
  description: 'Lets you select and copy text, and use the long-press menu, on sites that block it.',
  runAt: 'start',
  frames: false,
  match: (u) => /^https?:$/.test(u.protocol),
  defaults: {
    dropHandlers: true,
    allowDrag: false,
    aggressive: false,
    excludeSites: 'youtube.com, wikipedia.org, mail.qq.com, translate.google.*, docs.google.com, notion.so, office.com, figma.com, github.com'
  },
  options: [
    { key: 'dropHandlers', type: 'bool', label: 'Ignore sites\' copy/select/long-press blockers', help: 'Off: only stop them from cancelling the action' },
    { key: 'allowDrag', type: 'bool', label: 'Also unblock dragging text', help: 'Can break drag-and-drop on some sites' },
    { key: 'aggressive', type: 'bool', label: 'Aggressive: also unblock mouse-down', help: 'For sites that block selection on press' },
    { key: 'excludeSites', type: 'text', label: 'Leave these sites alone', help: 'Comma-separated; * matches any ending, e.g. translate.google.*' }
  ],

  // Runs in the page world: the original hooked addEventListener and
  // preventDefault from Safari's isolated world, where the page never sees it.
  pageUnlock: function (cfg) {
    if (window.__iossUnlock) return;
    window.__iossUnlock = true;
    const blocked = ['contextmenu', 'select', 'selectstart', 'copy', 'cut']
      .concat(cfg.allowDrag ? ['dragstart'] : [])
      .concat(cfg.aggressive ? ['mousedown', 'mouseup'] : []);
    const isBlocked = (t) => blocked.indexOf(t) !== -1;

    // Fix: the original also ignored preventDefault() for keydown/keyup and
    // mouse events on every site (Enter-to-send in chats inserted newlines
    // too, custom drag/focus broke) and dropped every dragstart listener.
    // Only the events that actually block copying are touched now.
    const pd = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function () { if (!isBlocked(this.type)) return pd.apply(this, arguments); };
    try {
      const rv = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
      if (rv && rv.set) {
        Object.defineProperty(Event.prototype, 'returnValue', {
          configurable: true, enumerable: rv.enumerable, get: rv.get,
          set(v) { if (v === false && isBlocked(this.type)) return; rv.set.call(this, v); }
        });
      }
    } catch (_) { /* ignore */ }

    // Fix: the original wrapped listeners and called them without `this`,
    // ignored listener objects and passive/once options, and treated an
    // options object as "capture". Listeners for blocking events are now
    // simply not registered; everything else goes through untouched.
    if (cfg.dropHandlers) {
      const add = EventTarget.prototype.addEventListener;
      const drop = ['contextmenu', 'select', 'selectstart', 'copy', 'cut'].concat(cfg.allowDrag ? ['dragstart'] : []);
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (drop.indexOf(type) !== -1 && (this === window || this === document || this === document.documentElement || this === document.body || (this && this.nodeType === 1 && !this.isContentEditable && !/^(INPUT|TEXTAREA)$/.test(this.tagName)))) return undefined;
        return add.call(this, type, listener, options);
      };
    }

    // DOM0 handlers such as oncopy="return false" cancel events without
    // calling preventDefault(), so they are cleared. Only the usual hosts and
    // elements with such attributes are visited, not every element.
    const props = blocked.map((n) => 'on' + n);
    const clear = (el) => { for (const p of props) { try { if (el && el[p]) el[p] = null; } catch (_) { /* ignore */ } } };
    const sweep = () => {
      clear(window);
      clear(document);
      clear(document.documentElement);
      clear(document.body);
      try { document.querySelectorAll(props.map((p) => `[${p}]`).join(',')).forEach(clear); } catch (_) { /* ignore */ }
    };
    sweep();
    document.addEventListener('DOMContentLoaded', sweep, true);
    window.addEventListener('load', sweep, true);
    setTimeout(sweep, 2500);
    setInterval(() => { if (!document.hidden) sweep(); }, 30000);
  },

  run(api, cfg) {
    const target = (location.host + location.pathname).toLowerCase();
    const excluded = String(cfg.excludeSites || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).some((pat) => {
      const re = new RegExp('(^|\\.)' + pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/|$)');
      return re.test(target);
    });
    if (excluded) return;

    // iPhone: long-press callouts are blocked with -webkit-touch-callout,
    // which the original never reset. Form fields keep their own behaviour.
    api.addStyle(`
      html, *:not(input):not(textarea):not([contenteditable]) { -webkit-user-select: text !important; user-select: text !important; -webkit-touch-callout: default !important; }
    `, 'ioss-web-limits');

    const snapshot = JSON.parse(JSON.stringify(cfg));
    if (!api.pageRun(this.pageUnlock, snapshot)) {
      // Strict CSP: retry once the page exposes a nonce. preventDefault and
      // DOM0 clearing still apply to everything registered before that.
      api.onReady(() => api.pageRun(this.pageUnlock, snapshot) || api.log('page access blocked; CSS unlock only'));
    }
  }
}));

  /* ---- module: clean-urls v0.8.0 ---- */
  register(({
  id: 'clean-urls',
  name: 'Clean tracking URLs',
  version: '0.8.0',
  api: 1,
  source: 'Clean Tracking URLs 跟踪链接净化 0.7.8 (cilxe)',
  description: 'Removes tracking parameters from links and from the address bar on every site, with extra rules for Bilibili, Baidu, CSDN, Alibaba/Taobao, Douyin/TikTok, Amazon, YouTube, Google, Reddit, LinkedIn, eBay, JD and more.',
  runAt: 'start',
  frames: false,
  match: (u) => /^https?:$/.test(u.protocol) && !/(^|\.)(hdslb\.com|csdnimg\.cn)$/.test(u.hostname),
  defaults: { cleanAddressBar: true, aggressive: false, siteExtras: true, extraParams: '', keepParams: '', excludeSites: '' },
  options: [
    { key: 'cleanAddressBar', type: 'bool', label: 'Also clean the address bar', help: 'Never on sign-in / OAuth pages' },
    { key: 'aggressive', type: 'bool', label: 'Aggressive (original list)', help: 'Also strips ref, from, source, src, redir, … everywhere. Can break logins, GitHub branch links and searches.' },
    { key: 'siteExtras', type: 'bool', label: 'Site extras', help: 'Bilibili/Baidu ads & login pop-ups, Zhihu/Xiaohongshu login modals, …' },
    { key: 'extraParams', type: 'text', label: 'Also remove these parameters', help: 'Space or comma separated' },
    { key: 'keepParams', type: 'text', label: 'Never remove these parameters' },
    { key: 'excludeSites', type: 'text', label: 'Leave these sites alone', help: 'Comma-separated hosts' }
  ],

  run(api, cfg) {
    const host = location.hostname.toLowerCase();
    const words = (s) => String(s || '').split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    if (words(cfg.excludeSites).some((h) => host === h.toLowerCase() || host.endsWith('.' + h.toLowerCase()))) return;

    // ---- parameter tables -------------------------------------------------
    // Clearly-tracking parameters, removed everywhere.
    const SAFE = new Set(['utm_id', 'utm_content', 'utm_source', 'utm_medium', 'utm_sources', 'utm_term', 'utm_campaign',
      'utm_referrer', 'utm_keyword', 'spm', 'scm', 'vd_source', 'spm_id_from', 'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid',
      'msclkid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'mkt_tok', 'trk', 'trkInfo']);
    const SAFE_RE = /^(utm_|spm_|scm_|share_(medium|plat|source|tag|session_id|from)$|embeds_(referring_euri|euri|referring_origin)$)/;
    // The original's generic list: these are often functional (ref, from,
    // source, src, redir, …), so they are only removed in aggressive mode.
    const AGGRESSIVE = new Set(['mkt', 'src', 'from', 'source', 'alias', 'brand', 'curator_clanid', 'snr', 'redir', 'sprefix', 'ref', 'feature']);
    const AGGRESSIVE_RE = /^(spm|from_|ref_|track|trk|share_|embeds_|refer_)|_from$|scm|referrer/;

    const ALI_RE = /^(utm_|spm_|from_|ref|track|wh_|wx_)/;
    const AMZN_RE = /_ref|^(utm_|ref|pd_rd_|pf_rd_|track|sc_)/i;
    const commonPlus = (list, re) => ({ params: list, re });
    // [host test, rule]. Rules: params (removed on this site, from all links),
    // re (regex of names), keep (never removed), extra (site extras).
    const SITES = [
      [/(^|\.)(bilibili|biligame)\.com$/, { params: ['vd_source', 'hotRank', 'launch_id', 'popular_rank', 'session_id', 'business', 'sort_field',
        'is_room_feed', 'visit_id', 'is_live_full_webview', 'is_live_webview', 'vt', 'theme', 'noReffer', 'timestamp', 'unique_k', 'hasBack',
        'noTitleBar', 'plat_id', 'is_preview', 'buvid', 'up_id', 'is_story_h5', 'hybrid_set_header', 'lottery_id', 'seid', '-Abrowser', 'from',
        'pagefrom', 'schema', 'preUrl', 'jumpLinkType', 'referfrom', 'spm_id', 'p2p_type', 'broadcast_type', 'event_source_type'],
      re: /^(utm_|share_|spm|from_)|(From|_from|source)$/, extra: 'bilibili' }],
      [/(^|\.)baidu\.com$/, { params: ['rsv_idx', 'hisfilter', 'rsf', 'rsv_pq', 'rsv_t', 'qid', 'rsv_dl', 'oq', 'gpc', 'usm', 'tfflag', 'bs', 'rqlang',
        'tn', 'sc_us', 'wfr', 'fenlei', 'platform', 'rqid', 'base_query', 'entry', 'qbl', 'for', 'from', 'topic_pn', 'rsp', 'rs_src', 'f', 'rsv_page',
        'dyTabStr', 'ct', 'lm', 'site', 'sites', 'fr', 'cl', 'bsst', 'lid', 'rsv_spt', 'rsv_bp', 'src', 'sfrom', 'refer', 'zp_fr', 'channel', 'p_from',
        'n_type', 'eqid', '_at_', 'sa', 'pd', 'source', 'tag_key', 'uname', 'uid', 'fromModule', 'lemmaFrom', 'structureId', 'structureClickId',
        'structureItemId', 'xzhid', 'rsv_enter', 'rsv_btype', 'prefixsug', 'client_type', 'task', 'locate', 'is_new_user', 'frwh', 'obj_id',
        'fid', 'fname', '_t', 'topic_name', 'frs', 'share_from', 'tpl', 'tb_mod', 'tb_fr', 'share', 'sfc', 'idfrom', 'client_version', 'st',
        'qq-pf-to', 'unique', 'is_video', '_wkts_', 'ai', 'ck', 'shh', 'toc_style_id', 'share_to', 'track_id'],
      // Fix: the original also removed "page", "type" and "u" (pagination,
      // tabs and sign-in return links on Tieba/Passport) and "ie" on Tieba.
      keep: ['page', 'type', 'u', 'ie', 'pn', 'kw', 'wd', 'word'], extra: 'baidu' }],
      [/(^|\.)(tiktok|douyin)\.com$/, { params: ['rsv_idx', 'hisfilter', 'source', 'aid', 'enter_from', 'focus_method', 'previous_page', 'extra_params',
        'gid', 'enter_method', 'is_from_webapp', 'sender_device', 'web_id'] }],
      [/(^|\.)csdn\.net$/, { params: ['ops_request_misc', 'request_id', 'biz_id', 'ydreferer', 'usp', 'spm', 'utm_source', 'utm_medium'], extra: 'csdn' }],
      [/(^|\.)(youku|tudou)\.com$/, { params: ['spm', 'scm', 'from', 's', 'playMode', 'client_id'], re: ALI_RE }],
      [/(^|\.)((alibaba|alibabagroup|aliyun|alimama|aliexpress|taobao|tmall|1688|jiyoujia|fliggy)\.(com|hk|cn)|(lazada|trendyol)\.[a-z.]{2,15})$/,
        { params: ['spm', 'acm', 'scm', 'scene', 'from', 'pvid', 'pvid2', 'scm2', 'stats_click', 'initiative_id', 'source', 'suggest', 'suggest_query',
          'iconType', 'traceId', 'relationId', 'union_lens', 'ref', 'ali_trackid', 'ak', 'detailSharePosition', 'topOfferIds', 'sp_abtk',
          'search_condition', 'industryCatId', 'tbSocialPopKey', 'bxsign', 'utparam', 'eurl', 'itemIds', 'country', 'epid', 'user_number_id',
          'rootPageId', 'lwfrom', 'disableNav', 'es', 'rand', '_lgt_', 'x5referer', 'status_bar_transparent', 'tracelog', 'ad_id', 'am_id', 'cm_id',
          'pm_id', '_k', '__pageId__', 'resourceId', 'udsPoolId', 'resultType', 'cms_id', 'pha_html', '__existtitle__', 'object_type',
          'delivery_pool_id', 'delivery_pool_type', 'ilike_session', 'clickid', 'sessionid', 'cosite', '_p_isad', 'exp', 'hpageId',
          'shareUniqueId', 'clickTrackInfo', 'data_prefetch', 'at_iframe', 'prefetch_replace', 'wc'], re: ALI_RE }],
      [/(^|\.)amazon\.[a-z.]{2,15}$/, { params: ['content-id', 'qid', 'crid', 'isAmazonFulfilled', 'sbo', 'plattr', 'sprefix', 'ld', '_encoding', 'ds'],
        re: AMZN_RE, extra: 'amazon' }],
      // Fix: "redir_token" is required by youtube.com/redirect links (the
      // original removed it, breaking external links in descriptions).
      [/(^|\.)youtube\.com$/, { params: ['embeds_referring_euri', 'embeds_euri', 'source_ve_path', 'feature', 'embeds_referring_origin', 'pp',
        'ab_channel', 'si'], keep: ['redir_token', 'v', 'list', 't', 'index', 'q', 'event'] }],
      // Fix: "hl" (language) and "sig" (signed redirect links) are functional.
      [/(^|\.)google\.[a-z.]{2,15}$|^(about|wellbeing)\.google$/, { params: ['device', 'pcampaignid', 'subid', 'fg', 'ved', 'ei', 'prev', 'sca_esv',
        'visit_id', 'dest_src'], extra: 'google' }],
      [/(^|\.)facebook\.com$/, commonPlus(['privacy_mutation_token', 'ars', 'helpref', 'search_session_id', 'entry_point', 'campaign_id', 'nav_source',
        'placement', 'privacy_source', '__cft__[0]', '__tn__'])],
      [/(^|\.)(twitter|x)\.com$/, commonPlus(['screen_name'])],
      [/(^|\.)reddit\.com$/, commonPlus(['embed_host_url', 'actionSource', 'shreddit'], /^(utm_|spm_|from_|ref_|track|trk|experiment_d2x_|experiment_mweb)/)],
      [/(^|\.)linkedin\.com$/, commonPlus(['original_referer', 'lipi', 'desktopBackground', 'profileFormEntryPoint', 'veh', 'upsellTrk',
        'upsellTrackingId', 'refId', 'trackingId'])],
      [/(^|\.)dzen\.ru$/, commonPlus(['rid', 'clid', 'stid', 'issue_tld', 'parent_rid', 'persistent_id', 'utr', 'secdata', 'feed_exp',
        'force_common_feed', 'feed_filter_type', 'feed_filter_source'])],
      [/(^|\.)vk\.com$/, commonPlus(['initial_stats_info'])],
      [/(^|\.)(microsoft|bing|xbox|skype|office|microsoft365)\.com$/, commonPlus(['ocid', 'OCID', 'ICID', 'icid', 'WT.mc_id', 'xr', 'cat0'])],
      [/(^|\.)msn\.(com|cn)$/, commonPlus(['ocid', 'cvid', 'ei'])],
      [/(^|\.)bestbuy\.(com|ca)$/, commonPlus(['irgwc', 'mpid', 'irclickid', 'intlreferer', 'cmp', 'icmp', 'ks'], /^(utm_|nrtv_|subId)/)],
      // Fix: the original's generic "ref" removal broke GitHub ?ref=<branch> links.
      [/(^|\.)github\.com$/, { params: ['ref_cta', 'ref_loc', 'ref_page'], keep: ['ref'] }],
      [/(^|\.)stackoverflow\.com$/, commonPlus([], /^(utm_|spm_|from_|track|trk|so_)/)],
      [/(^|\.)pixiv\.net$/, commonPlus(['provider'])],
      [/(^|\.)music\.apple\.com$/, commonPlus(['at', 'ct', 'itscg', 'itsct'])],
      [/(^|\.)zhihu\.com$/, { params: ['search_source', 'hybrid_search_source', 'hybrid_search_extra', 'utm_psn'], extra: 'zhihu' }],
      [/(^|\.)(163|126|yeah)\.(com|net)$/, commonPlus(['fromDlpro', 'dltype'])],
      [/(^|\.)weibo\.com$/, commonPlus(['mark_id', '_rand', 'sudaref', 'band_rank'])],
      [/(^|\.)qq\.com$/, commonPlus(['ADTAG', 'fromSource'])],
      [/(^|\.)ebay\.[a-z.]{2,15}$/, commonPlus(['_trkparms', '_trksid', 'ssPageName', 'amdata', 'mc', 'hash', 'epid', 'var', '_ssn', 'store_name',
        'requested', 'itmprp', 'itmmeta'])],
      [/(^|\.)jd\.com$/, commonPlus(['gx', 'ad_od', 'needRecommendFlag', 'uabt', '_fd', 'pvid', 'jxsid', 'csid', 'ss_projid', 'scan_orig', 'ss_expid',
        'ss_sexpid', 'ss_ruleid', 'ss_sruleid', 'ss_symbol', 'ss_mtest', 'sceneval'], /^(track|wxa_|spm_|from_)/)],
      [/(^|\.)yangkeduo\.com$/, commonPlus(['gx', 'ad_od', 'needRecommendFlag', 'uabt', 'pxq_secret_key', 'cpsSignjb_act', 'launch_pdd',
        'customParameters', 'duoduo_type', 'goods_sign'], /^(track|from_|utm_|_oak_|_wv|_x_)/)],
      [/(^|\.)(hoyolab|hoyoverse|mihoyo|miyoushe|mihoyogift)\.com$/, { params: ['game_version', 'visit_device', 'device_type', 'plat_type'],
        re: /^(track|utm|spm_|from_|hyl_|bbs_|mhy_)|_from$/, extra: 'hoyo' }],
      [/(^|\.)douban\.com$/, commonPlus(['target_user_id', 'dcs', 'dcm', 'dt_time_source'])],
      [/(^|\.)(imdb|boxofficemojo)\.com$/, { params: ['rf', 'imdbPageAction'], re: AMZN_RE }],
      [/(^|\.)gitee\.com$/, { params: [], extra: 'gitee' }],
      [/(^|\.)xda-developers\.com$/, commonPlus(['ascsubtag', 'asc_refurl', 'asc_campaign', 'newsletter_popup'])],
      [/(^|\.)cctv\.com$/, commonPlus(['toc_style_id'])],
      [/(^|\.)fiverr\.com$/, commonPlus(['pckg_id', 'funnel', 'context_type', 'context_alg', 'imp_id', 'pos', 'context'])],
      [/(^|\.)newegg\.com$/, commonPlus(['cm_sp'])],
      [/(^|\.)theverge\.com$/, commonPlus(['u1', 'ascsubtag', 'subId1', 'subId2', 'subId3'])],
      [/(^|\.)bluestacks\.com$/, commonPlus(['client_uuid', 'gaCookie', 'gclid', 'clickid', 'msclkid', 'affiliateId', 'offerId', 'transaction_id',
        'aff_sub', 'first_landing_page', 'download_page_referrer'], /^device_|(_version|utm_campaign)$/)],
      [/(^|\.)xiaohongshu\.com$/, { params: [], extra: 'xiaohongshu' }],
      [/(^|\.)nicovideo\.jp$/, commonPlus(['cmnhd_ref'])]
    ];
    const site = (SITES.find(([re]) => re.test(host)) || [null, { params: [] }])[1];
    const siteParams = new Set(site.params || []);
    const keep = new Set([...(site.keep || []), ...words(cfg.keepParams)]);
    const extra = new Set(words(cfg.extraParams));

    const drop = (k) => {
      if (keep.has(k)) return false;
      if (SAFE.has(k) || SAFE_RE.test(k) || extra.has(k) || siteParams.has(k) || (site.re && site.re.test(k))) return true;
      return !!cfg.aggressive && (AGGRESSIVE.has(k) || AGGRESSIVE_RE.test(k));
    };

    // Fix: the original rebuilt URLs with URLSearchParams, which re-encodes
    // every remaining parameter (GBK searches on Chinese sites came out
    // garbled; hence its Taobao "q" workaround). Parameters are removed from
    // the raw query text, leaving the rest byte-for-byte unchanged.
    function stripQuery(search) {
      if (!search || search.length < 2) return search;
      const parts = search.slice(1).split('&');
      const kept = parts.filter((part) => {
        if (!part) return false;
        let k = part.split('=')[0];
        try { k = decodeURIComponent(k.replace(/\+/g, ' ')); } catch (_) { /* keep raw */ }
        return !drop(k);
      });
      if (kept.length === parts.length) return search;
      return kept.length ? '?' + kept.join('&') : '';
    }

    function cleanHref(href) {
      let u;
      try { u = new URL(href, location.href); } catch (_) { return null; }
      if (!/^https?:$/.test(u.protocol) || !/[a-z0-9-]{1,128}\.[a-z]{2,15}$/i.test(u.hostname)) return null;
      const search = stripQuery(u.search);
      let path = u.pathname;
      let hash = u.hash;
      if (site.extra === 'amazon' && /(^|\.)amazon\./.test(u.hostname)) {
        const i = path.indexOf('/ref=');
        if (i > 0) path = path.slice(0, i + 1);
      }
      // Fix: the original deleted 8 items at a time while looping, removing
      // non-tracking parts of the fragment too.
      if (site.extra === 'google' && /utm_/.test(hash)) {
        const rest = hash.slice(1).split('&').filter((x) => !/^utm_/.test(x));
        hash = rest.length ? '#' + rest.join('&') : '';
      }
      if (search === u.search && path === u.pathname && hash === u.hash) return null;
      return u.origin + path + search + hash;
    }

    function cleanLink(a) {
      const raw = a.getAttribute('href');
      if (!raw || raw[0] === '#' || /^(javascript|mailto|tel):/i.test(raw)) return;
      const out = cleanHref(a.href);
      if (out) a.setAttribute('href', out);
      if (site.extra === 'bilibili') {
        a.removeAttribute('data-spmid');
        a.removeAttribute('data-mod');
        const du = a.getAttribute('data-url');
        if (du && /^(https?:)?\/\//.test(du)) {
          const cleaned = cleanHref(du.startsWith('//') ? 'https:' + du : du);
          if (cleaned) { a.href = cleaned; a.classList.remove('jump-link'); }
        }
      }
    }

    // ---- address bar --------------------------------------------------------
    // Fix: the original replaced history.state with {} (breaking Back on
    // single-page sites) and also rewrote sign-in/OAuth return URLs.
    const isAuthPage = () => /^(accounts|login|auth|signin|passport|sso|id)\./.test(host) ||
      /\/(oauth2?|login|signin|sign-in|authorize|callback|sso|consent)(\/|$)/i.test(location.pathname);
    function cleanAddressBar() {
      if (!cfg.cleanAddressBar || isAuthPage()) return;
      const out = cleanHref(location.href);
      if (out && out !== location.href) {
        try { history.replaceState(history.state, '', out); } catch (_) { /* cross-origin edge cases */ }
      }
    }

    // ---- link cleaning: batched observer + one tap handler -----------------
    // Fix: the original attached four listeners to every <div> with a class
    // and re-cleaned on mouse movement and window.onscroll (overwriting the
    // site's own handler). Here new links are cleaned once per frame and the
    // tapped link right before the site sees the tap.
    const pending = new Set();
    let queued = false;
    const flush = () => {
      queued = false;
      const nodes = Array.from(pending);
      pending.clear();
      for (const n of nodes) {
        if (!n.isConnected) continue;
        if (n.tagName === 'A' || n.tagName === 'AREA') cleanLink(n);
        if (n.querySelectorAll) n.querySelectorAll('a[href], area[href]').forEach(cleanLink);
      }
      if (cfg.siteExtras) siteSweep();
    };
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') pending.add(m.target);
        else for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
      }
      if (pending.size && !queued) { queued = true; if (document.hidden) setTimeout(flush, 200); else requestAnimationFrame(flush); }
    });
    const startObserver = () => mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'data-url'] });
    if (document.documentElement) startObserver(); else api.onReady(startObserver);

    const onTap = (e) => {
      const t = e.target && (e.target.nodeType === 3 ? e.target.parentElement : e.target);
      const a = t && t.closest && t.closest('a[href], area[href]');
      if (a) cleanLink(a);
    };
    for (const ev of ['touchstart', 'pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu', 'keydown']) {
      window.addEventListener(ev, onTap, { capture: true, passive: true });
    }

    const fullClean = () => {
      cleanAddressBar();
      document.querySelectorAll('a[href], area[href]').forEach(cleanLink);
      if (cfg.siteExtras) siteSweep();
    };
    cleanAddressBar();
    api.onReady(fullClean);
    api.onLoad(() => setTimeout(fullClean, 1000));
    api.onUrlChange(() => setTimeout(fullClean, 300));
    // Manual clean: Alt+Shift+X (iPad keyboards), as in the original.
    window.addEventListener('keydown', (e) => { if (e.altKey && e.shiftKey && (e.key === 'X' || e.key === 'x')) { fullClean(); api.toast('Links cleaned'); } });

    // ---- site extras --------------------------------------------------------
    const css = {
      bilibili: '#right-bottom-banner, #anchor-guest-box-id, iframe[src*="live-lottery"] { display: none !important; }',
      hoyo: 'body { overflow: auto !important; }',
      baidu: location.pathname === '/s' ? '.EC_result { display: none !important; }' : ''
    };
    if (cfg.siteExtras && css[site.extra]) api.addStyle(css[site.extra], 'ioss-clean-urls-css');

    const closeOnce = (modal, close, ms) => {
      const end = Date.now() + ms;
      const stop = api.observe(document.documentElement, { childList: true, subtree: true }, () => {
        if (Date.now() > end) return stop();
        const m = document.querySelector(modal);
        const b = m && (m.querySelector(close) || document.querySelector(close));
        if (b) { b.click(); stop(); }
      }, { throttle: 100 });
      setTimeout(stop, ms);
    };
    if (cfg.siteExtras && site.extra === 'zhihu') api.onReady(() => closeOnce('.Modal-content', '.Modal-closeButton', 4000));
    if (cfg.siteExtras && site.extra === 'xiaohongshu') api.onReady(() => closeOnce('.login-container', '.close-button', 4000));
    if (cfg.siteExtras && site.extra === 'gitee') {
      const stop = api.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }, () => {
        const m = document.querySelector('.menu.transition.visible');
        if (m) m.style.setProperty('display', 'none', 'important');
      }, { throttle: 50 });
      api.onReady(() => setTimeout(stop, 3000));
    }
    if (cfg.siteExtras && site.extra === 'csdn') {
      // As in the original: CSDN's click trackers never see link taps; the
      // browser still follows the link normally.
      window.addEventListener('click', (e) => {
        const a = e.target && e.target.closest && e.target.closest('a[href]');
        if (a && a.hostname && !/^javascript:/i.test(a.getAttribute('href'))) e.stopImmediatePropagation();
      }, true);
    }

    function siteSweep() {
      if (site.extra === 'bilibili') {
        document.querySelectorAll('meta[name="spm_prefix"]').forEach((m) => m.remove());
        // Fix: the original crashed when a card had no data-report or the
        // banner was missing, and its live pop-up timer never ran.
        document.querySelectorAll('a[href*="cm.bilibili.com"]').forEach((a) => a.remove());
        document.querySelectorAll('.bili-video-card[data-report*="tianma."]').forEach((c) => c.setAttribute('data-report', '0'));
        const entry = document.querySelector('.right-entry-item');
        if (entry && entry.innerText.includes('登录') && !document.getElementById('ioss-bili-login-css')) {
          api.addStyle('.lt-row, .bili-login-card, .bili-mini-mask, .unlogin-popover { display: none !important; }', 'ioss-bili-login-css');
        }
      } else if (site.extra === 'baidu') {
        if (location.pathname === '/s') document.querySelectorAll('.EC_result').forEach((n) => n.remove());
        document.querySelectorAll('a[href*="zhidao.baidu.com/q"]').forEach((a) => { if (a.pathname === '/q') a.pathname = '/search'; });
      }
    }
  }
}));


  boot().catch((e) => console.warn('[iOS Suite] boot failed', e));
})();
