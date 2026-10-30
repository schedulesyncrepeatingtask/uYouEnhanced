({
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
})
