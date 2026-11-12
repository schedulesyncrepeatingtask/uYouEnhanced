({
  id: 'yt-tweaks',
  name: 'YouTube: app tweaks',
  version: '1.0.0',
  api: 1,
  source: 'Feature ideas from YouTube Plus / YTLite (dayanch96), rebuilt for the website',
  description: 'Features known from tweaked YouTube apps, for m.youtube.com and the desktop site: default and remembered playback speed, preferred quality, subtitles off, no "Video paused. Continue watching?", autoplay off, a seek bar on Shorts, a start page, and hiding end-screen cards, Shorts, Premium promotions, comments or related videos.',
  runAt: 'start',
  frames: false,
  match: (u) => /^(m|www)\.youtube\.com$/.test(u.hostname),
  defaults: {
    speed: '1', rememberSpeed: false, quality: 'auto', captions: 'auto', autoplay: 'keep', keepWatching: true, shortsBar: true,
    startPage: 'home', hideEndCards: true, hideShorts: false, hidePremium: true, hideComments: false, hideRelated: false
  },
  options: [
    { key: 'speed', type: 'select', label: 'Default playback speed', choices: [['1', 'Normal'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['1.75', '1.75×'], ['2', '2×']] },
    { key: 'rememberSpeed', type: 'bool', label: 'Remember the speed I last chose', help: 'Changing the speed in the player becomes the new default' },
    { key: 'quality', type: 'select', label: 'Preferred quality', choices: [['auto', 'Auto (YouTube decides)'], ['max', 'Highest available'], ['hd1080', '1080p'], ['hd720', '720p'], ['large', '480p (saves data)'], ['medium', '360p']],
      help: 'Uses the nearest lower quality when a video has no exact match' },
    { key: 'captions', type: 'select', label: 'Subtitles', choices: [['auto', 'As YouTube decides'], ['off', 'Always off']] },
    { key: 'autoplay', type: 'select', label: 'Autoplay next video', choices: [['keep', 'As set in YouTube'], ['off', 'Off']] },
    { key: 'keepWatching', type: 'bool', label: 'Skip "Video paused. Continue watching?"', help: 'Only when you did not pause it yourself' },
    { key: 'shortsBar', type: 'bool', label: 'Seek bar on Shorts (iPhone site)', help: 'Tap or drag to jump' },
    { key: 'startPage', type: 'select', label: 'Open YouTube at', choices: [['home', 'Home'], ['subscriptions', 'Subscriptions'], ['you', 'You / Library'], ['history', 'History']] },
    { key: 'hideEndCards', type: 'bool', label: 'Hide end-screen cards and channel watermark' },
    { key: 'hideShorts', type: 'bool', label: 'Hide Shorts in feeds, search and the tab bar' },
    { key: 'hidePremium', type: 'bool', label: 'Hide Premium and app promotions' },
    { key: 'hideComments', type: 'bool', label: 'Hide comments' },
    { key: 'hideRelated', type: 'bool', label: 'Hide related videos under the player' }
  ],

  // Runs in the page world: the player's own API (quality, speed,
  // subtitles) is only reachable there.
  pageApply: function (o) {
    const p = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!p || p.classList.contains('ad-showing')) return;
    try {
      if (o.quality !== 'auto' && typeof p.setPlaybackQualityRange === 'function') {
        const order = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
        const levels = ((p.getAvailableQualityLevels && p.getAvailableQualityLevels()) || []).filter((l) => l !== 'auto');
        let q = o.quality === 'max' ? levels[0] : o.quality;
        if (q && levels.length && levels.indexOf(q) === -1) {
          const want = order.indexOf(q);
          q = levels.find((l) => order.indexOf(l) >= want) || levels[levels.length - 1];
        }
        if (q && (!p.getPlaybackQuality || p.getPlaybackQuality() !== q)) {
          p.setPlaybackQualityRange(q, q);
          if (p.setPlaybackQuality) p.setPlaybackQuality(q);
        }
      }
    } catch (_) { /* player API changed */ }
    try {
      if (o.speed && typeof p.setPlaybackRate === 'function' && p.getPlaybackRate() !== o.speed) p.setPlaybackRate(o.speed);
    } catch (_) { /* ignore */ }
    try {
      if (o.captionsOff && p.unloadModule) { p.unloadModule('captions'); p.unloadModule('cc'); }
    } catch (_) { /* ignore */ }
  },

  run(api, cfg) {
    const self = this;
    const mobile = location.hostname === 'm.youtube.com';

    // ---- Start page: only when YouTube is opened, not when you tap Home later.
    const START = { subscriptions: '/feed/subscriptions', you: '/feed/you', history: '/feed/history' };
    if (START[cfg.startPage] && location.pathname === '/' && !location.search && !/^https?:\/\/(m|www)\.youtube\.com\//.test(document.referrer)) {
      location.replace(START[cfg.startPage]);
      return;
    }

    // ---- Hiding things: one stylesheet, nothing scanned in a loop.
    const css = [];
    if (cfg.hideEndCards) {
      css.push('.ytp-ce-element, .ytp-cards-teaser, .ytp-cards-button, .ytp-cards-teaser-box, .iv-branding, .ytp-iv-video-content, .annotation { display: none !important; }');
    }
    if (cfg.hideShorts) {
      css.push([
        // desktop
        'ytd-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]', 'ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts])',
        'ytd-video-renderer:has(a[href^="/shorts/"])', 'ytd-grid-video-renderer:has(a[href^="/shorts/"])', 'ytd-rich-item-renderer:has(a[href^="/shorts/"])',
        'ytd-guide-entry-renderer:has(a[title="Shorts"])', 'ytd-mini-guide-entry-renderer[aria-label="Shorts"]',
        // m.youtube.com
        'ytm-reel-shelf-renderer', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
        'ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytm-reel-shelf-renderer)',
        'grid-shelf-view-model:has(ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2)',
        'ytm-video-with-context-renderer:has(a[href^="/shorts/"])', 'ytm-compact-video-renderer:has(a[href^="/shorts/"])',
        'ytm-pivot-bar-item-renderer:has(.pivot-shorts)'
      ].join(',\n') + ' { display: none !important; }');
    }
    if (cfg.hidePremium) {
      css.push([
        'ytd-banner-promo-renderer', 'ytd-statement-banner-renderer', 'ytd-primetime-promo-renderer', 'ytd-mealbar-promo-renderer',
        'ytd-guide-entry-renderer:has(a[href="/premium"])', '#premium-upsell', 'tp-yt-paper-dialog:has(ytd-mealbar-promo-renderer)',
        'ytm-statement-banner-renderer', 'ytm-mealbar-promo-renderer', 'ytm-upsell-dialog-renderer', 'ytm-promoted-sparkles-web-renderer'
      ].join(',\n') + ' { display: none !important; }');
    }
    if (cfg.hideComments) {
      css.push('ytd-comments#comments, ytm-comments-entry-point-header-renderer, ytm-comment-section-renderer, ytm-item-section-renderer[section-identifier="comments-entry-point"], ytm-item-section-renderer[section-identifier="comment-item-section"] { display: none !important; }');
    }
    if (cfg.hideRelated) {
      css.push('#related, ytd-watch-next-secondary-results-renderer, ytm-item-section-renderer[section-identifier="related-items"], ytm-single-column-watch-next-results-renderer ytm-video-with-context-renderer { display: none !important; }');
    }
    if (css.length) api.addStyle(css.join('\n'), 'ioss-yt-tweaks-css');

    // ---- The player
    const playerEl = () => document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    const adShowing = () => { const p = playerEl(); return !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting'))); };
    const mainVideo = () => document.querySelector('#movie_player video, .html5-video-player video, video.html5-main-video');
    const speed = () => Math.min(4, Math.max(0.25, Number(cfg.speed) || 1));
    const needsApply = () => speed() !== 1 || cfg.quality !== 'auto' || cfg.captions === 'off';
    let ourRate = 0; // the speed we set, and until when its "ratechange" is ours
    let ourRateUntil = 0;
    let lastInput = 0;
    for (const ev of ['pointerdown', 'touchstart', 'keydown', 'mousedown']) window.addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });

    function apply() {
      if (!needsApply() || adShowing()) return;
      const o = { speed: speed(), quality: String(cfg.quality), captionsOff: cfg.captions === 'off' };
      ourRate = o.speed;
      ourRateUntil = Date.now() + 1500;
      const ran = api.pageRun(self.pageApply, o);
      // Without page access (strict CSP): the speed still works from here.
      const v = mainVideo();
      if (!ran && v && v.playbackRate !== o.speed) v.playbackRate = o.speed;
    }

    const bound = new WeakSet();
    let appliedFor = '';
    function bindVideo(v) {
      if (!v || bound.has(v)) return;
      bound.add(v);
      v.addEventListener('playing', () => {
        // Once per video (and again shortly after: YouTube may reset quality right after starting).
        const key = location.href + '|' + (v.currentSrc || v.src || '');
        if (key === appliedFor || adShowing()) return;
        appliedFor = key;
        apply();
        setTimeout(apply, 800);
      });
      v.addEventListener('ratechange', () => {
        const r = v.playbackRate;
        if (!cfg.rememberSpeed || adShowing() || (r === ourRate && Date.now() < ourRateUntil)) return;
        if (!(r >= 0.25 && r <= 4) || String(r) === String(cfg.speed)) return;
        cfg.speed = String(r);
        api.save();
        api.log('speed remembered', r);
      });
      v.addEventListener('pause', () => {
        if (!cfg.keepWatching || document.hidden || Date.now() - lastInput < 1500) return;
        setTimeout(() => confirmKeepWatching(v), 350);
      });
      v.addEventListener('ended', () => { if (cfg.autoplay === 'off') setTimeout(cancelAutoplay, 200); });
    }

    // "Video paused. Continue watching?": YouTube pauses, then asks.
    // Only answered when the pause did not come from you.
    function confirmKeepWatching(v) {
      const dialogs = document.querySelectorAll('yt-confirm-dialog-renderer, ytm-confirm-dialog-renderer, ytd-popup-container tp-yt-paper-dialog, ytm-dialog');
      for (const d of dialogs) {
        if (!d.offsetParent && !d.getClientRects().length) continue;
        // One selector at a time: a list would return the outer wrapper first.
        let btn = null;
        for (const sel of ['#confirm-button button', '.confirm-button button', '.dialog-buttons button:last-child', '#confirm-button', '.confirm-button']) {
          btn = d.querySelector(sel);
          if (btn) break;
        }
        if (!btn) continue;
        btn.click();
        api.log('answered "continue watching?"');
        if (v.paused) v.play().catch(() => {});
        return true;
      }
      return false;
    }

    // Autoplay off: flip YouTube's own toggle once (YouTube remembers it),
    // and cancel the "Up next" countdown if one still appears.
    let autoplayDone = false;
    function autoplayOff() {
      if (cfg.autoplay !== 'off' || autoplayDone) return;
      const t = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"], .ytm-autonav-toggle-button-container[aria-pressed="true"], button.ytm-autonav-toggle-button-container[aria-pressed="true"]');
      if (!t) return;
      autoplayDone = true;
      t.click();
      api.log('autoplay switched off');
    }
    function cancelAutoplay() {
      const c = document.querySelector('.ytp-autonav-endscreen-upnext-cancel-button, .ytm-autonav-endscreen-cancel-button, .autonav-endscreen-cancel-button, button[aria-label="Cancel autoplay"]');
      if (c) c.click();
    }

    // ---- Shorts seek bar (the iPhone site has none)
    let bar = null;
    let barVideo = null;
    const onTime = () => {
      if (!bar || !barVideo || !barVideo.duration) return;
      bar.firstChild.style.transform = `scaleX(${Math.min(1, barVideo.currentTime / barVideo.duration)})`;
    };
    const mostVisibleVideo = () => {
      let best = null;
      let score = 0;
      for (const v of document.querySelectorAll('video')) {
        const r = v.getBoundingClientRect();
        const s = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) * Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        if (s > score) { score = s; best = v; }
      }
      return best;
    };
    function bindBar(v) {
      if (barVideo === v) return;
      if (barVideo) barVideo.removeEventListener('timeupdate', onTime);
      barVideo = v;
      if (v) v.addEventListener('timeupdate', onTime);
      onTime();
    }
    function shortsBar() {
      const on = cfg.shortsBar && mobile && location.pathname.startsWith('/shorts/');
      if (!on) {
        if (bar) { bar.remove(); bar = null; bindBar(null); }
        return;
      }
      if (!bar) {
        api.addStyle(`
          #ioss-shorts-bar { position: fixed; left: 0; right: 0; bottom: calc(48px + env(safe-area-inset-bottom, 0px)); height: 28px; z-index: 2147483000;
            display: flex; align-items: flex-end; touch-action: none; -webkit-tap-highlight-color: transparent; }
          #ioss-shorts-bar::before { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.3); }
          #ioss-shorts-bar i { position: relative; display: block; width: 100%; height: 3px; transform-origin: left; transform: scaleX(0);
            background: var(--yt-spec-static-brand-red, #f03); }
          #ioss-shorts-bar.drag::before, #ioss-shorts-bar.drag i { height: 6px; }
        `, 'ioss-shorts-bar-css');
        bar = api.el('div', { id: 'ioss-shorts-bar', role: 'slider', 'aria-label': 'Seek' }, [api.el('i')]);
        const seek = (e) => {
          const v = barVideo;
          if (!v || !v.duration) return;
          const r = bar.getBoundingClientRect();
          v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration;
          onTime();
        };
        let dragging = false;
        bar.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          dragging = true;
          bar.classList.add('drag');
          try { bar.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
          seek(e);
        });
        bar.addEventListener('pointermove', (e) => { if (dragging) { e.stopPropagation(); seek(e); } });
        const end = () => { dragging = false; bar.classList.remove('drag'); };
        bar.addEventListener('pointerup', end);
        bar.addEventListener('pointercancel', end);
        // Keep YouTube's swipe-to-next from reacting to the bar.
        for (const ev of ['touchstart', 'touchmove', 'click']) bar.addEventListener(ev, (e) => e.stopPropagation(), { passive: ev !== 'click' });
        document.body.appendChild(bar);
      }
      bindBar(mostVisibleVideo());
    }

    // ---- One shared page observer (the core merges it with the other
    // YouTube modules'), plus navigation events. No timers.
    const sweep = () => {
      const v = mainVideo();
      if (v) bindVideo(v);
      for (const x of document.querySelectorAll('video')) bindVideo(x);
      autoplayOff();
      shortsBar();
    };
    // The video that starts playing is the one on screen (Shorts: after a swipe).
    document.addEventListener('playing', (e) => { if (bar && e.target && e.target.tagName === 'VIDEO') bindBar(e.target); }, true);
    api.onReady(() => {
      sweep();
      api.observe(document.body, { childList: true, subtree: true }, sweep, { throttle: 400 });
      api.onUrlChange(() => { appliedFor = ''; autoplayDone = false; setTimeout(sweep, 300); });
    });
  }
})
