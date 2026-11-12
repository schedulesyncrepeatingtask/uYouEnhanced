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

  const SUITE = /*@@SUITE@@*/;
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
  //
  // Modules that watch the same node with the same options share ONE
  // MutationObserver (on YouTube several modules watch <body>): the browser
  // then builds one list of mutation records instead of one per module.
  const hubs = new WeakMap(); // node -> Map(optionsKey -> { mo, subs })
  let observerCount = 0; // live shared observers (shown with debug logging on)
  const hubKey = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, Array.isArray(o[k]) ? o[k].slice().sort() : o[k]]));
  function joinHub(node, options, notify) {
    let byKey = hubs.get(node);
    if (!byKey) hubs.set(node, (byKey = new Map()));
    const key = hubKey(options);
    let hub = byKey.get(key);
    if (!hub) {
      hub = { subs: new Set(), mo: null, leave: null };
      hub.mo = new MutationObserver(() => { for (const fn of hub.subs) fn(); });
      hub.mo.observe(node, options);
      byKey.set(key, hub);
      observerCount++;
      hub.leave = (fn) => {
        if (!hub.subs.delete(fn) || hub.subs.size) return;
        hub.mo.disconnect();
        byKey.delete(key);
        observerCount--;
      };
    }
    hub.subs.add(notify);
    return hub;
  }
  function observe(target, options, callback, { debounce = 0, throttle = 0 } = {}) {
    let scheduled = false;
    let timer = 0;
    let stopped = false;
    let hub = null;
    const run = () => { scheduled = false; if (!stopped) safe('observer', callback); };
    const notify = () => {
      if (debounce) {
        clearTimeout(timer);
        timer = setTimeout(run, debounce);
        return;
      }
      if (scheduled) return;
      scheduled = true;
      if (throttle) timer = setTimeout(run, throttle);
      else if (document.hidden) timer = setTimeout(run, 250);
      else requestAnimationFrame(run);
    };
    const start = () => {
      if (stopped) return;
      const t = typeof target === 'function' ? target() : target;
      if (!t) return;
      hub = joinHub(t, options, notify);
    };
    if (typeof target === 'function' || target) {
      if (!document.documentElement) whenRoot(start); else start();
    }
    return () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      if (hub) { hub.leave(notify); hub = null; }
    };
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
      // Where the Navigation API exists it reports every pushState and
      // replaceState, so the timer only remains as a slow safety net.
      let navApi = false;
      try {
        if (window.navigation && typeof window.navigation.addEventListener === 'function') {
          window.navigation.addEventListener('currententrychange', () => setTimeout(checkUrl, 0));
          window.navigation.addEventListener('navigatesuccess', checkUrl);
          navApi = true;
        }
      } catch (_) { /* optional */ }
      urlPoll = every(navApi ? 1200 : 400, checkUrl);
      window.addEventListener('popstate', checkUrl, true);
      window.addEventListener('hashchange', checkUrl, true);
      for (const ev of ['yt-navigate-finish', 'state-navigateend', 'yt-page-data-updated', 'spfdone']) {
        document.addEventListener(ev, () => setTimeout(checkUrl, 0), true);
      }
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
    .orb { display: none; }
    .pill { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 9px; font-size: 11px; font-weight: 600; line-height: 16px;
      background: rgba(52,199,89,.2); color: #1a8f3c; vertical-align: 1px; }
    @keyframes rise { from { transform: translateY(36px); opacity: 0; } }
    @keyframes fade { from { opacity: 0; } }
    @media (prefers-reduced-motion: no-preference) {
      .backdrop { animation: fade .2s ease-out; }
      @media (max-width: 619px) { .sheet { animation: rise .26s cubic-bezier(.2,.8,.2,1); } }
    }
  `;

  // The "Aero" look: glass panels, glossy buttons, sky blue and fresh green
  // (the Frutiger Aero style of the late 2000s). Layered on top of the plain
  // rules above, so "Plain" in the settings simply leaves this class off.
  const AERO_CSS = `
    .aero { --bg:#e6f5ff; --fg:#0c2c4d; --mut:#4a6a89; --line:rgba(20,95,170,.2); --acc:#0b7fe0; --card:rgba(255,255,255,.6);
      --rim:rgba(10,90,170,.5); --glow:rgba(0,90,190,.3); --head:#0a4f9e;
      --aqua:linear-gradient(180deg,#9be6ff 0%,#41b9f7 46%,#0f86e8 54%,#4bcbf9 100%);
      --leaf:linear-gradient(180deg,#d2f88a 0%,#86d632 46%,#43aa15 54%,#93e350 100%);
      --silver:linear-gradient(180deg,#fff 0%,#eef7fd 46%,#d3e6f4 54%,#f3faff 100%);
      --shine:linear-gradient(180deg,rgba(255,255,255,.85),rgba(255,255,255,.12));
      font-family: "Frutiger", "Frutiger Linotype", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif; }
    @media (prefers-color-scheme: dark) { .aero { --bg:#06203f; --fg:#eaf6ff; --mut:#a3c8ea; --line:rgba(150,210,255,.22); --acc:#6fd0ff;
      --card:rgba(130,195,255,.12); --rim:rgba(150,215,255,.45); --glow:rgba(0,0,0,.45); --head:#eaf6ff;
      --silver:linear-gradient(180deg,#6388af 0%,#3d638c 46%,#23456d 54%,#4874a0 100%); } }

    /* glossy buttons: a gradient body, a bright rim and a highlight on the top half */
    .aero .btn, .aero .fab, .aero .toast button { position: relative; overflow: hidden; isolation: isolate; border: 1px solid var(--rim);
      background: var(--silver); color: var(--fg);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.9), inset 0 -7px 9px -6px rgba(255,255,255,.6), 0 2px 7px var(--glow); }
    .aero .btn::before, .aero .fab::before, .aero .toast button::before, .aero .dot i::before, .aero .orb::before { content: ""; position: absolute;
      z-index: -1; left: 3px; right: 3px; top: 1px; height: 46%; border-radius: inherit; background: var(--shine); opacity: .8; pointer-events: none; }
    .aero .btn { border-radius: 22px; padding: 0 18px; }
    .aero .btn.primary { background: var(--aqua); color: #fff; text-shadow: 0 -1px 0 rgba(0,55,120,.55); border-color: rgba(8,84,170,.7); }
    .aero .btn:active, .aero .toast button:active, .aero .more:active { filter: brightness(.9); }

    /* orbs: floating buttons, the settings dot and the logo in the title bar */
    .aero .fab, .aero .dot i, .aero .orb { border-radius: 50%; border: 1px solid rgba(255,255,255,.8); color: #fff;
      background: radial-gradient(circle at 50% 118%, #9af6ff 0%, rgba(154,246,255,0) 58%), var(--aqua);
      box-shadow: inset 0 1px 1px rgba(255,255,255,.9), 0 0 0 1px rgba(0,80,170,.55), 0 4px 12px rgba(0,70,170,.5);
      -webkit-backdrop-filter: none; backdrop-filter: none; }
    .aero .fab::before, .aero .dot i::before, .aero .orb::before { left: 13%; right: 13%; top: 5%; height: 43%; border-radius: 50%; opacity: .9; }
    .aero .dot i, .aero .orb { position: relative; overflow: hidden; isolation: isolate; }
    .aero .fab svg, .aero .dot svg, .aero .orb svg { filter: drop-shadow(0 1px 1px rgba(0,50,120,.7)); }
    .aero .fab:active { filter: brightness(1.15); }
    .aero .dot.idle { opacity: .42; }
    .aero .orb { display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex: none; }
    .aero .orb svg { width: 17px; height: 17px; }

    /* messages */
    .aero .toast { position: relative; overflow: hidden; isolation: isolate; border-radius: 16px; border: 1px solid rgba(170,228,255,.65);
      background: linear-gradient(180deg, rgba(34,128,214,.92), rgba(6,58,128,.94)); text-shadow: 0 1px 1px rgba(0,30,80,.6);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.55), 0 8px 26px rgba(0,50,130,.45); }
    .aero .toast::before { content: ""; position: absolute; z-index: -1; left: 0; right: 0; top: 0; height: 50%; pointer-events: none;
      background: linear-gradient(180deg, rgba(255,255,255,.34), rgba(255,255,255,.04)); }
    .aero .toast button { border-radius: 16px; padding: 0 14px; background: var(--leaf); color: #fff; border-color: rgba(40,110,10,.65);
      text-shadow: 0 -1px 0 rgba(20,80,0,.55); }

    /* settings sheet: a glass panel with a sky-and-leaf glow and a title bar */
    .aero .backdrop { background: rgba(4,44,96,.42); }
    .aero .sheet { border-radius: 22px 22px 0 0; border-top: 1px solid rgba(255,255,255,.95);
      background: radial-gradient(70% 34% at 100% 0%, rgba(150,236,150,.5), transparent 70%),
        radial-gradient(90% 40% at 0% 0%, rgba(110,210,255,.8), transparent 72%),
        linear-gradient(180deg, rgba(236,248,255,.96), rgba(205,232,251,.96));
      -webkit-backdrop-filter: blur(22px) saturate(1.6); backdrop-filter: blur(22px) saturate(1.6);
      box-shadow: 0 -12px 44px rgba(0,60,140,.4), inset 0 1px 0 #fff; }
    .aero .grab { position: relative; z-index: 2; background: rgba(255,255,255,.95); box-shadow: 0 1px 2px rgba(0,60,130,.35); }
    /* the title bar reaches up behind the grab handle to the top edge */
    .aero .head { margin: -23px -16px 0; padding: 31px 16px 10px; top: -29px; gap: 10px; border-bottom: 1px solid rgba(255,255,255,.85);
      box-shadow: 0 1px 0 rgba(20,95,170,.16), 0 6px 14px -8px rgba(0,70,150,.35);
      background:
        radial-gradient(circle at 67.4% calc(100% - 43px), rgba(255,255,255,.95) 0 1.5px, transparent 2px),
        radial-gradient(circle at 69% calc(100% - 37px), transparent 0 8px, rgba(255,255,255,.75) 8.5px 9.5px, transparent 10px),
        radial-gradient(circle at 51.2% calc(100% - 12px), rgba(255,255,255,.9) 0 1px, transparent 1.5px),
        radial-gradient(circle at 52% calc(100% - 9px), transparent 0 4.5px, rgba(255,255,255,.7) 5px 5.8px, transparent 6.3px),
        radial-gradient(circle at 73% calc(100% - 9px), transparent 0 3px, rgba(255,255,255,.65) 3.5px 4.2px, transparent 4.7px),
        linear-gradient(180deg, rgba(150,220,255,.94), rgba(214,240,255,.9));
      -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
    .aero .head h2 { color: var(--head); text-shadow: 0 1px 0 rgba(255,255,255,.9); letter-spacing: -.2px; }
    .aero .card { border-radius: 16px; border: 1px solid rgba(255,255,255,.95);
      background: linear-gradient(180deg, rgba(255,255,255,.88), rgba(255,255,255,.52));
      box-shadow: 0 2px 9px rgba(0,70,150,.16), inset 0 1px 0 #fff; }
    .aero .banner { border-radius: 14px; border: 1px solid rgba(255,255,255,.85); box-shadow: inset 0 1px 0 rgba(255,255,255,.8);
      background: linear-gradient(180deg, rgba(120,210,255,.5), rgba(60,170,245,.26)); }
    .aero .pill { background: var(--leaf); color: #fff; border: 1px solid rgba(40,110,10,.5); text-shadow: 0 -1px 0 rgba(20,80,0,.5);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.7); }
    /* "Options": a 30pt glass chip inside a 44pt tap target */
    .aero .more { border: 7px solid transparent; border-radius: 22px; padding: 0 11px; font-weight: 600; font-size: 13px;
      background: var(--silver) padding-box; box-shadow: inset 0 0 0 1px var(--rim), inset 0 2px 0 rgba(255,255,255,.85); }
    .aero input[type=number], .aero input[type=text], .aero select { border: 1px solid var(--rim); border-radius: 10px;
      background: rgba(255,255,255,.78); box-shadow: inset 0 2px 3px rgba(0,50,110,.18); }
    .aero input.sw { border: 1px solid rgba(10,80,150,.38); background: linear-gradient(180deg, #aebfd0, #e4edf5);
      box-shadow: inset 0 2px 4px rgba(0,40,90,.35); }
    .aero input.sw::after { top: 1px; left: 1px; background: radial-gradient(circle at 36% 28%, #fff 0 28%, #e6eff7 58%, #b7c9db 100%);
      box-shadow: 0 1px 3px rgba(0,40,90,.45), inset 0 -1px 1px rgba(0,60,120,.2); }
    .aero input.sw:checked { background: var(--leaf); border-color: rgba(40,110,10,.6);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.55), inset 0 -8px 8px -6px rgba(255,255,255,.55), 0 0 8px rgba(120,220,60,.55); }
    @media (prefers-color-scheme: dark) {
      .aero .sheet { border-top-color: rgba(170,225,255,.55);
        background: radial-gradient(70% 34% at 100% 0%, rgba(70,200,140,.28), transparent 70%),
          radial-gradient(90% 40% at 0% 0%, rgba(40,150,255,.5), transparent 72%),
          linear-gradient(180deg, rgba(8,40,80,.95), rgba(4,22,48,.96));
        box-shadow: 0 -12px 44px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.3); }
      .aero .grab { background: rgba(200,235,255,.55); box-shadow: none; }
      .aero .head { border-bottom-color: rgba(160,220,255,.3); box-shadow: 0 6px 14px -8px rgba(0,0,0,.6);
        background:
          radial-gradient(circle at 67.4% calc(100% - 43px), rgba(255,255,255,.8) 0 1.5px, transparent 2px),
          radial-gradient(circle at 69% calc(100% - 37px), transparent 0 8px, rgba(190,235,255,.5) 8.5px 9.5px, transparent 10px),
          radial-gradient(circle at 51.2% calc(100% - 12px), rgba(255,255,255,.7) 0 1px, transparent 1.5px),
          radial-gradient(circle at 52% calc(100% - 9px), transparent 0 4.5px, rgba(190,235,255,.45) 5px 5.8px, transparent 6.3px),
          radial-gradient(circle at 73% calc(100% - 9px), transparent 0 3px, rgba(190,235,255,.4) 3.5px 4.2px, transparent 4.7px),
          linear-gradient(180deg, rgba(22,96,176,.94), rgba(9,48,98,.92)); }
      .aero .head h2 { text-shadow: 0 1px 2px rgba(0,20,60,.8); }
      .aero .card { border-color: rgba(165,220,255,.3); background: linear-gradient(180deg, rgba(150,210,255,.18), rgba(90,160,235,.07));
        box-shadow: 0 2px 10px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.2); }
      .aero .btn::before { opacity: .35; }
      .aero .btn.primary::before { opacity: .8; }
      .aero .banner { border-color: rgba(165,220,255,.35); box-shadow: inset 0 1px 0 rgba(255,255,255,.2);
        background: linear-gradient(180deg, rgba(60,160,245,.4), rgba(20,90,180,.25)); }
      .aero .more { box-shadow: inset 0 0 0 1px var(--rim), inset 0 2px 0 rgba(255,255,255,.25); color: #fff; }
      .aero input[type=number], .aero input[type=text], .aero select { background: rgba(0,20,50,.5); box-shadow: inset 0 2px 3px rgba(0,0,0,.4); }
      .aero input.sw { border-color: rgba(150,215,255,.35); background: linear-gradient(180deg, #0c2848, #2a4f79); }
    }
  `;

  const useAero = () => (state ? state.core : DEFAULT_CORE).look !== 'plain';

  // The same gloss for buttons that modules put into the page itself (the
  // YouTube download and Picture-in-Picture buttons). Returns '' in the plain
  // look, so a module can tell which style is in use.
  function aeroCss(selector) {
    if (!useAero()) return '';
    return `
      ${selector} { position: relative !important; overflow: hidden !important; isolation: isolate !important; color: #fff !important;
        border: 1px solid rgba(255,255,255,.75) !important;
        background: linear-gradient(180deg,#9be6ff 0%,#41b9f7 46%,#0f86e8 54%,#4bcbf9 100%) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.9), inset 0 -7px 9px -6px rgba(255,255,255,.6), 0 0 0 1px rgba(0,80,170,.45), 0 2px 7px rgba(0,70,170,.4) !important; }
      ${selector}::before { content: ""; position: absolute; z-index: -1; left: 8%; right: 8%; top: 3%; height: 45%; border-radius: 999px;
        background: linear-gradient(180deg, rgba(255,255,255,.85), rgba(255,255,255,.12)); pointer-events: none; }
      ${selector} svg { filter: drop-shadow(0 1px 1px rgba(0,50,120,.7)) !important; }
      ${selector}:active { filter: brightness(.9) !important; opacity: 1 !important; }`;
  }

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
    shadow.appendChild(el('style', { text: UI_CSS + AERO_CSS }));
    const wrap = el('div', { class: useAero() ? 'wrap aero' : 'wrap' }, [el('div', { class: 'toasts' }), el('div', { class: 'fabs' })]);
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
    // update(): change the text of a long-running toast (e.g. progress).
    return { close, update: (text) => { node.querySelector('.msg').textContent = text; } };
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
    look: 'aero',
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
      request, toast, fab, pageRun, openTab, copy, menu, isGoogleHost, sha256, aeroCss,
      storage: {
        get: (k, d) => storage.get(`ioss:${def.id}:${k}`, d),
        set: (k, v) => storage.set(`ioss:${def.id}:${k}`, v),
        del: (k) => storage.del(`ioss:${def.id}:${k}`)
      },
      openSettings: () => openPanel(def.id)
    };
  }

  // Would this module run here? (enabled, allowed in frames, URL matches)
  function wantsPage(def, url) {
    const ms = moduleState(def);
    if (!ms.enabled || (!isTop && !def.frames)) return false;
    try { return !!def.match(url); } catch (_) { return false; }
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
    const commit = (v) => {
      mstate.settings[opt.key] = v;
      saveState();
      markDirty();
      if (def.id === 'core' && uiRoot) { uiRoot.wrap.classList.toggle('aero', useAero()); positionFabs(); }
    };
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
    whenBody(async () => {
      // Modules that did not run here were not looked up yet (see boot).
      for (const [id, e] of active) {
        if (!e.lazy) continue;
        const r = await resolveModule(BUNDLED.find((b) => b.id === id));
        active.set(id, Object.assign(r, { matched: false }));
      }
      closePanel();
      const { wrap } = ui();
      const backdrop = el('div', { class: 'backdrop', onclick: closePanel });
      const sheet = el('div', { class: 'sheet', role: 'dialog', 'aria-label': `${SUITE.name} settings` });
      sheet.appendChild(el('div', { class: 'grab' }));
      sheet.appendChild(el('div', { class: 'head' }, [
        el('span', { class: 'orb' }, [icon(GEAR_PATH, 17)]),
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
              el('div', { class: 'v' }, [`v${def.version}${entry.source === 'updated' ? ' (hot-updated)' : ''}`,
                entry.matched ? el('span', { class: 'pill', text: 'on this page' }) : null]),
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
          { key: 'look', type: 'select', label: 'Look', choices: [['aero', 'Aero'], ['plain', 'Plain']],
            help: 'Aero: glossy glass. Buttons inside pages change after a reload.' },
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
    // Hot-updated copies are read from storage and compiled only for the
    // modules that will actually run on this page (the rest wait until the
    // settings sheet is opened).
    const entries = await Promise.all(BUNDLED.map((b) => (wantsPage(b, url) ? resolveModule(b) : { def: b, source: 'bundled', lazy: true })));
    for (const e of entries) active.set(e.def.id, e);
    for (const e of entries) if (!e.lazy) runModule(e, url);
    if (state.core.debug) console.log('[iOS Suite]', entries.filter((e) => !e.lazy).length, 'of', entries.length, 'modules on this page');
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

  /*@@MODULES@@*/

  boot().catch((e) => console.warn('[iOS Suite] boot failed', e));
})();
