({
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
})
