({
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
})
