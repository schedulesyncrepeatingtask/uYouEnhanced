({
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
})
