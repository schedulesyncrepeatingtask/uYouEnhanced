({
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
})
