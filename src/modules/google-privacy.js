({
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
})
