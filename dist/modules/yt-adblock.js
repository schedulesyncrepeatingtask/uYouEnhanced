({
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
})
