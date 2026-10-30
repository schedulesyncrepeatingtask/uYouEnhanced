({
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
})
