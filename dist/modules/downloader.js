({
  id: 'downloader',
  name: 'Video downloader',
  version: '1.3.0',
  api: 1,
  source: 'All-in-One Video Downloader 1.0.19 (Daniel)',
  description: 'Adds a download button for videos on YouTube, YouTube Music, TikTok, Instagram, X/Twitter, Threads, Facebook, Pinterest, Snapchat, TED, Douyin, Xiaohongshu and Spotify. Tapping it downloads the video and offers "Save Video" (camera roll) in the iPhone share sheet; YouTube saves up to 360p this way. Where a site does not allow that, or in website mode, it opens the downloader service instead.',
  runAt: 'ready',
  frames: false,
  SITES: /(^|\.)(youtube\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com|threads\.(com|net)|facebook\.com|pinterest\.[a-z.]+|snapchat\.com|ted\.com|douyin\.com|xiaohongshu\.com|spotify\.com)$/,
  CDN: /(googlevideo\.com|tiktokcdn(-eu|-us|-af)?\.com|douyinvod\.com|fbcdn\.net|twimg\.com|zjcdn\.com|snssdk\.com|tiktokv\.com|douyinstatic\.com|xhscdn\.com|amemv\.com|tikwm\.com|douyinpic\.com|douyinmusicpromotion\.com|cdninstagram\.com|licdn\.com|sc-cdn\.net|pinimg\.com|tedcdn\.com|dmcdn\.net|tumblr\.com|rutube\.ru|uma\.media)$/,
  match: function (u) { return this.SITES.test(u.hostname) || this.CDN.test(u.hostname); },
  defaults: { mode: 'save', fab: true, ytInline: true, inlineX: true, service: 'tool77', copyOnLongPress: true },
  options: [
    { key: 'mode', type: 'select', label: 'Download button', choices: [['save', 'Save to Photos (direct; YouTube up to 360p)'], ['service', 'Open downloader website (HD)']] },
    { key: 'fab', type: 'bool', label: 'Floating download button on video pages' },
    { key: 'ytInline', type: 'bool', label: 'YouTube: download button left of the like button', help: 'Replaces the floating button on watch pages' },
    { key: 'inlineX', type: 'bool', label: 'Download button in X/Twitter & Threads posts' },
    { key: 'copyOnLongPress', type: 'bool', label: 'Long-press the button to copy the video link' },
    { key: 'service', type: 'select', label: 'Website mode / fallback', choices: [['tool77', 'tool77.com (original service)'], ['copy', 'Just copy the link']] }
  ],

  run(api, cfg) {
    const self = this;
    const host = location.hostname;
    const DL_PATH = 'M5 20h14v-2H5v2zm7-3 6-6-1.41-1.41L13 13.17V4h-2v9.17L7.41 9.59 6 11l6 6z';
    const lang = (navigator.language || 'en').split('-')[0];

    function openService(url) {
      if (!url) return api.toast('No video found on this page');
      if (cfg.service === 'copy') return api.copy(url).then((ok) => api.toast(ok ? 'Video link copied' : url));
      api.openTab(`https://www.tool77.com/${lang}/v/downloader?v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel&url=${encodeURIComponent(url)}`);
    }

    // ------------------------------------------------------------------
    // Direct media files (opened from a CDN): in-page Save button.
    // Fix: StreamSaver (and the two unused crypto libraries the original
    // @required) do not work in iOS Safari. The file is fetched with
    // GM.xmlHttpRequest and handed to the iOS share sheet ("Save Video")
    // or saved through a download link.
    // ------------------------------------------------------------------
    if (self.CDN.test(host) && document.contentType !== 'text/html') {
      const ext = (() => {
        const v = document.querySelector('video source, video');
        const t = (v && v.type) || document.contentType || '';
        const map = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
        const fromPath = (location.pathname.match(/\.([a-z0-9]{2,4})$/i) || [])[1];
        return map[t.split(';')[0]] || (fromPath && fromPath.toLowerCase()) || 'mp4';
      })();
      const name = `${Date.now()}.${ext}`;
      let blob = null;
      const btn = api.fab({
        title: 'Save file',
        path: DL_PATH,
        onTap: async () => {
          if (blob) return share();
          api.toast('Downloading…', { timeout: 2000 });
          try {
            const r = await api.request({ url: location.href, responseType: 'blob', timeout: 300000,
              onprogress: (e) => { if (e.lengthComputable && e.total) btn.element.title = Math.round((e.loaded / e.total) * 100) + '%'; } });
            if (r.status < 200 || r.status >= 300 || !r.response) throw new Error('HTTP ' + r.status);
            blob = r.response instanceof Blob ? r.response : new Blob([r.response]);
            // Sharing needs a fresh tap (iOS user-activation rules).
            api.toast('Ready.', { timeout: 15000, action: 'Save', onAction: share });
          } catch (e) {
            api.toast('Download failed. Long-press the video and choose "Save to Files" instead.', { timeout: 6000 });
          }
        }
      });
      async function share() {
        const file = new File([blob], name, { type: blob.type || 'video/mp4' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
        }
        const a = api.el('a', { href: URL.createObjectURL(blob), download: name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
      btn.show();
      return;
    }

    // ------------------------------------------------------------------
    // Finding "the video the user means" on a touch screen. The original
    // relied on mouse hover, which never happens on an iPhone, so its
    // buttons never appeared there; it also ignored m.youtube.com.
    // ------------------------------------------------------------------
    const visibleScore = (n) => {
      const r = n.getBoundingClientRect();
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      return h > 0 && w > 0 ? h * w : 0;
    };
    const mostVisible = (nodes) => {
      let best = null;
      let score = 0;
      for (const n of nodes) { const s = visibleScore(n); if (s > score) { score = s; best = n; } }
      return best;
    };
    const videoContainer = (sel) => {
      const vids = Array.from(document.querySelectorAll('video'));
      const v = mostVisible(vids);
      return v ? v.closest(sel) : null;
    };
    const clean = (u) => String(u).split('?')[0];
    const abs = (href) => { try { return new URL(href, location.href).href; } catch (_) { return null; } };

    const resolvers = [
      [/(^|\.)music\.youtube\.com$/, () => {
        const id = new URLSearchParams(location.search).get('v');
        if (!id) return null;
        const list = new URLSearchParams(location.search).get('list');
        return { direct: `https://www.ytgogo.com/?url=${encodeURIComponent(`https://music.youtube.com/watch?v=${id}${list ? '&list=' + list : ''}`)}&v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel` };
      }],
      [/(^|\.)youtube\.com$/, () => {
        const id = new URLSearchParams(location.search).get('v');
        if (location.pathname === '/watch' && id) return `https://www.youtube.com/watch?v=${id}`;
        const s = location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
        return s ? `https://www.youtube.com/shorts/${s[1]}` : null;
      }],
      [/(^|\.)tiktok\.com$/, () => {
        if (/\/video\/\d+/.test(location.pathname)) return clean(location.href);
        const c = videoContainer('[class*="xgplayer-container"], [id^="xgwrapper"], [data-e2e="recommend-list-item-container"], article');
        const id = c && ((c.id || '').match(/-(\d{8,})$/) || [])[1];
        if (id) return 'https://www.tiktok.com/@_/video/' + id;
        const link = c && c.querySelector('a[href*="/video/"]');
        return link ? clean(abs(link.getAttribute('href'))) : (document.querySelector('video') ? clean(location.href) : null);
      }],
      [/(^|\.)instagram\.com$/, () => {
        if (/^\/(p|reel|reels|tv)\//.test(location.pathname)) return clean(location.href);
        const art = videoContainer('article, [role="presentation"]');
        const link = art && art.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"]');
        return link ? clean(abs(link.getAttribute('href'))) : null;
      }],
      [/(^|\.)(x|twitter)\.com$/, () => {
        const m = location.pathname.match(/\/status\/(\d+)/);
        if (m) return 'https://x.com/_/status/' + m[1];
        const art = videoContainer('article');
        const link = art && art.querySelector('a[href*="/status/"]');
        const id = link && (link.getAttribute('href').match(/\/status\/(\d+)/) || [])[1];
        return id ? 'https://x.com/_/status/' + id : null;
      }],
      [/(^|\.)threads\.(com|net)$/, () => {
        if (/\/post\//.test(location.pathname)) return clean(location.href);
        const c = videoContainer("[data-pressable-container='true']");
        const link = c && Array.from(c.querySelectorAll('a[href*="/post/"]')).pop();
        return link ? clean(abs(link.getAttribute('href'))) : null;
      }],
      [/(^|\.)facebook\.com$/, () => {
        const id = (location.href.match(/(?:v=|\/videos\/|\/reel\/|\/reels\/|\/watch\/\?v=)(\d+)/) || [])[1];
        if (id) return 'https://www.facebook.com/reel/' + id;
        return /\/(watch|reel|reels|videos)/.test(location.pathname) ? clean(location.href) : null;
      }],
      [/(^|\.)pinterest\.[a-z.]+$/, () => {
        if (/\/pin\//.test(location.pathname)) return clean(location.href);
        const v = mostVisible(document.querySelectorAll('video'));
        const a = v && v.closest('a[href*="/pin/"]');
        return a ? clean(a.href) : null;
      }],
      [/(^|\.)snapchat\.com$/, () => (/^\/(@[^/]+\/[^/?]+|(@[^/]+\/)?spotlight\/[^/?]+|p\/[^/]+\/[^/?]+)/.test(location.pathname) ? location.href : null)],
      [/(^|\.)ted\.com$/, () => (/^\/talks\//.test(location.pathname) ? clean(location.href) : null)],
      [/(^|\.)douyin\.com$/, () => {
        const id = new URLSearchParams(location.search).get('modal_id') || (location.pathname.match(/\/video\/(\d+)/) || [])[1];
        return id ? 'https://www.douyin.com/video/' + id : (document.querySelector('video') ? location.href : null);
      }],
      [/(^|\.)xiaohongshu\.com$/, () => (/^\/(explore|discovery\/item)\//.test(location.pathname) ? location.href : null)],
      [/(^|\.)open\.spotify\.com$/, () => {
        let id = (location.pathname.match(/\/track\/([A-Za-z0-9]+)/) || [])[1];
        if (!id) {
          const now = document.querySelector('[data-testid="now-playing-widget"] a[href*="/track/"], [data-testid="context-item-link"][href*="/track/"], aside a[href*="/track/"]');
          id = now && (now.getAttribute('href').match(/track\/([A-Za-z0-9]+)/) || [])[1];
        }
        if (!id) return null;
        return { direct: `https://www.spotmelo.com/en?url=${encodeURIComponent('https://open.spotify.com/track/' + id)}&v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel` };
      }]
    ];
    const resolver = (resolvers.find(([re]) => re.test(host)) || [])[1];
    if (!resolver) return;

    const resolve = () => { try { return resolver(); } catch (e) { api.log('resolver failed', e); return null; } };
    const openWebsite = () => {
      const target = resolve();
      if (target && typeof target === 'object') return api.openTab(target.direct);
      openService(target);
    };

    // ------------------------------------------------------------------
    // Save to Photos. iOS only lets web pages put a video in the camera
    // roll through the share sheet ("Save Video"), and only from a tap, so
    // this downloads the file first and then asks for one more tap.
    // ------------------------------------------------------------------
    let saving = null; // { key, blob, name } while a download is ready/running
    const sanitize = (t) => (String(t || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video');

    async function shareFile(blob, name) {
      const file = new File([blob], name, { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'video/mp4' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      // No share sheet (e.g. desktop): regular download into Files/Downloads.
      const a = api.el('a', { href: URL.createObjectURL(blob), download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }

    // Binary GET: page fetch first (googlevideo allows YouTube's origin),
    // then GM.xmlHttpRequest, which is not limited by CORS.
    async function getBytes(url) {
      try {
        const r = await fetch(url, { credentials: 'omit' });
        if (r.ok) return await r.blob();
        if (r.status === 403 || r.status === 404) throw Object.assign(new Error('HTTP ' + r.status), { fatal: true });
      } catch (e) { if (e && e.fatal) throw e; }
      const r = await api.request({ url, responseType: 'blob', timeout: 120000 });
      if (r.status < 200 || r.status >= 300 || !r.response) throw new Error('HTTP ' + r.status);
      return r.response instanceof Blob ? r.response : new Blob([r.response]);
    }

    // googlevideo serves whole files slowly; 5 MB ranges, 3 at a time.
    async function downloadRanged(url, size, onProgress) {
      const CHUNK = 5 * 1024 * 1024;
      const parts = [];
      let done = 0;
      const ranges = [];
      for (let start = 0; start < size; start += CHUNK) ranges.push([start, Math.min(size, start + CHUNK) - 1]);
      let next = 0;
      const worker = async () => {
        while (next < ranges.length) {
          const i = next++;
          const [a, b] = ranges[i];
          const sep = url.includes('?') ? '&' : '?';
          let blob = null;
          for (let attempt = 0; attempt < 3 && !blob; attempt++) {
            try { blob = await getBytes(`${url}${sep}range=${a}-${b}`); } catch (e) { if (e.fatal || attempt === 2) throw e; }
          }
          parts[i] = blob;
          done += blob.size;
          onProgress(done / size);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return new Blob(parts, { type: 'video/mp4' });
    }

    // YouTube: ask YouTube's mobile-app API for the video. App clients get
    // direct MP4 links (the website's own links are scrambled). Only the
    // combined video+audio files can be saved on the phone; YouTube offers
    // those up to 360p. Higher qualities are separate video and audio
    // streams that would need merging.
    const YT_CLIENTS = [
      { name: 'ANDROID_VR', id: 28, version: '1.62.27', extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L', androidSdkVersion: 32 } },
      { name: 'IOS', id: 5, version: '20.10.4', extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } }
    ];
    const pageValue = (key) => {
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const m = sc.textContent.match(new RegExp('"' + key + '":"([^"]+)"'));
        if (m) return m[1];
      }
      return '';
    };
    const pickMuxed = (resp) => {
      const formats = ((resp && resp.streamingData && resp.streamingData.formats) || [])
        .filter((f) => f.url && /^video\/mp4/.test(f.mimeType || ''))
        .sort((a, b) => (b.height || 0) - (a.height || 0));
      return formats.map((f) => ({ url: f.url, size: Number(f.contentLength) || 0, quality: f.qualityLabel || (f.height ? f.height + 'p' : ''),
        title: resp.videoDetails && resp.videoDetails.title }));
    };
    async function youtubeCandidates(videoId) {
      const out = [];
      const visitor = pageValue('VISITOR_DATA');
      for (const c of YT_CLIENTS) {
        try {
          const r = await fetch('/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json', 'X-YouTube-Client-Name': String(c.id), 'X-YouTube-Client-Version': c.version },
              visitor ? { 'X-Goog-Visitor-Id': visitor } : {}),
            body: JSON.stringify({
              context: { client: Object.assign({ clientName: c.name, clientVersion: c.version, hl: document.documentElement.lang || 'en' }, c.extra, visitor ? { visitorData: visitor } : {}) },
              videoId, contentCheckOk: true, racyCheckOk: true
            })
          });
          if (r.ok) out.push(...pickMuxed(await r.json()));
        } catch (e) { api.log('player request failed', c.name, e && e.message); }
      }
      // Fresh page load: the website's own player data sometimes has plain links.
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const i = sc.textContent.indexOf('ytInitialPlayerResponse = ');
        if (i === -1) continue;
        try {
          const json = sc.textContent.slice(i + 26).replace(/;\s*(var |<\/script|$)[\s\S]*/, '');
          const resp = JSON.parse(json);
          if (resp.videoDetails && resp.videoDetails.videoId === videoId) out.push(...pickMuxed(resp));
        } catch (_) { /* not parseable */ }
      }
      return out;
    }

    async function saveDirect() {
      const key = location.href;
      if (saving && saving.key === key) {
        if (saving.blob) return shareFile(saving.blob, saving.name);
        return api.toast('Still downloading…', { timeout: 1500 });
      }
      const ytId = /(^|\.)youtube\.com$/.test(host) && !/(^|\.)music\.youtube\.com$/.test(host)
        ? (new URLSearchParams(location.search).get('v') || (location.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/) || [])[1])
        : null;
      const job = { key, blob: null, name: '' };
      saving = job;
      const progress = api.toast('Preparing download…', { timeout: 0 });
      const setText = (t) => progress && progress.update && progress.update(t);
      const fail = (why) => {
        if (saving === job) saving = null;
        progress && progress.close();
        api.toast(`Couldn't save this video directly${why ? ` (${why})` : ''}.`, { timeout: 9000, action: 'Open website', onAction: openWebsite });
      };
      try {
        let blob = null;
        let title = document.title.replace(/ - YouTube$/, '');
        if (ytId) {
          const candidates = await youtubeCandidates(ytId);
          if (!candidates.length) return fail('YouTube did not offer a downloadable file');
          let lastError = null;
          for (const c of candidates) {
            try {
              if (c.title) title = c.title;
              const size = c.size;
              if (size > 800 * 1024 * 1024 && !confirm(`This video is ${(size / 1048576).toFixed(0)} MB. Saving it needs that much memory. Continue?`)) {
                return fail('too large');
              }
              const label = `Downloading${c.quality ? ' ' + c.quality : ''}…`;
              setText(`${label} 0%`);
              blob = size
                ? await downloadRanged(c.url, size, (p) => setText(`${label} ${Math.floor(p * 100)}%`))
                : await getBytes(c.url);
              break;
            } catch (e) { lastError = e; api.log('candidate failed', e && e.message); }
          }
          if (!blob) return fail(lastError ? lastError.message : '');
        } else {
          // Other sites: the video on screen, if it plays from a real file.
          const v = mostVisible(document.querySelectorAll('video'));
          const src = v && (v.currentSrc || v.src || (v.querySelector('source') || {}).src);
          if (!src || !/^https?:/i.test(src)) return fail('this site streams video in pieces');
          setText('Downloading…');
          blob = await getBytes(src);
          const art = v.closest('article');
          const caption = art && art.querySelector('h1, h2, [dir="auto"]');
          if (caption && caption.textContent.trim()) title = caption.textContent.trim();
        }
        if (saving !== job) return; // navigated away / restarted
        job.blob = blob;
        job.name = sanitize(title) + '.mp4';
        progress && progress.close();
        // A fresh tap is required before iOS shows the share sheet.
        api.toast(`Ready: ${(blob.size / 1048576).toFixed(1)} MB.\nTap Save, then "Save Video".`, {
          timeout: 120000, action: 'Save', onAction: () => shareFile(job.blob, job.name)
        });
      } catch (e) {
        fail(e && e.message);
      }
    }

    const act = () => {
      const target = resolve();
      if (cfg.mode === 'service' || (target && typeof target === 'object')) return openWebsite();
      return saveDirect();
    };

    // ---- YouTube: a download pill in the action bar, left of the like
    // button (m.youtube.com and the desktop site). Shorts keep the floating
    // button because their buttons are a vertical column on the video.
    const isYouTubeWatch = () => /(^|\.)(m|www)\.youtube\.com$/.test(host) && location.pathname === '/watch';
    const inlineYouTube = () => {
      if (!cfg.ytInline || !isYouTubeWatch()) return null;
      const like = document.querySelector(
        '.slim-video-action-bar-actions like-button-view-model, .slim-video-action-bar-actions ytm-segmented-like-dislike-button-renderer, ' +
        'ytm-slim-video-action-bar-renderer like-button-view-model, #top-level-buttons-computed segmented-like-dislike-button-view-model, ' +
        '#top-level-buttons-computed ytd-segmented-like-dislike-button-renderer, #top-level-buttons-computed like-button-view-model');
      if (!like) return null;
      const row = like.closest('.slim-video-action-bar-actions, #top-level-buttons-computed') || like.parentElement;
      let slot = like;
      while (slot.parentElement && slot.parentElement !== row) slot = slot.parentElement;
      const existing = row.querySelector(':scope > .ioss-yt-dl');
      if (existing) {
        if (existing.nextElementSibling !== slot) row.insertBefore(existing, slot);
        matchNative(existing, like);
        return existing;
      }
      const btn = api.el('button', {
        type: 'button', class: 'ioss-yt-dl', 'data-ioss-owned': '1', 'aria-label': 'Download video', title: 'Download video'
      }, [api.icon(DL_PATH, 22)]);
      btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); act(); });
      let pressTimer = 0;
      btn.addEventListener('touchstart', () => {
        if (!cfg.copyOnLongPress) return;
        pressTimer = setTimeout(() => {
          pressTimer = -1;
          const t = resolve();
          if (t) api.copy(t).then((ok) => api.toast(ok ? 'Video link copied' : t));
        }, 600);
      }, { passive: true });
      btn.addEventListener('touchend', (e) => { if (pressTimer === -1) e.preventDefault(); clearTimeout(pressTimer); pressTimer = 0; });
      btn.addEventListener('touchmove', () => { clearTimeout(pressTimer); pressTimer = 0; }, { passive: true });
      row.insertBefore(btn, slot);
      matchNative(btn, like);
      return btn;
    };
    // Fix: the button used YouTube's theme variables, which the 2026 mobile
    // layout no longer sets where we looked, so it rendered dark-on-dark and
    // was practically invisible. It now copies the like button's own colour,
    // background and height (icon-only in the new layout, a pill in the old).
    function matchNative(btn, like) {
      const native = like.querySelector('button') || like;
      const st = getComputedStyle(native);
      const iconOnly = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor);
      btn.classList.toggle('ioss-yt-dl-icon', iconOnly);
      btn.style.setProperty('color', st.color, 'important');
      btn.style.setProperty('background', iconOnly ? 'transparent' : st.backgroundColor, 'important');
      const h = Math.round(native.getBoundingClientRect().height);
      if (h >= 28 && h <= 64) btn.style.setProperty('height', h + 'px', 'important');
    }
    if (cfg.ytInline && /(^|\.)(m|www)\.youtube\.com$/.test(host)) {
      api.addStyle(`
        .ioss-yt-dl { flex: none; display: inline-flex; align-items: center; justify-content: center; height: 36px; min-width: 44px;
          padding: 0 12px; margin: 0 8px 0 0; border: 0; border-radius: 18px; cursor: pointer; align-self: center;
          color: var(--yt-spec-text-primary, #0f0f0f); background: var(--yt-spec-badge-chip-background, rgba(0,0,0,.05));
          -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        html[dark] .ioss-yt-dl, [dark] .ioss-yt-dl { color: var(--yt-spec-text-primary, #f1f1f1); background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.1)); }
        .ioss-yt-dl:active { opacity: .6; }
        .ioss-yt-dl svg { width: 22px; height: 22px; pointer-events: none; }
        .ioss-yt-dl.ioss-yt-dl-icon { padding: 0; width: 44px; margin: 0 2px; border-radius: 50%; }
        .ioss-yt-dl.ioss-yt-dl-icon svg { width: 24px; height: 24px; }
      `, 'ioss-yt-dl-css');
      inlineYouTube();
      api.observe(document.body, { childList: true, subtree: true }, inlineYouTube, { throttle: 400 });
      api.onUrlChange(() => setTimeout(inlineYouTube, 300));
    }

    if (cfg.fab) {
      const button = api.fab({
        title: 'Download video',
        path: DL_PATH,
        onTap: act,
        onLongPress: cfg.copyOnLongPress ? () => {
          const t = resolve();
          const url = t && typeof t === 'object' ? t.direct : t;
          if (url) api.copy(url).then((ok) => api.toast(ok ? 'Video link copied' : url));
        } : null
      });
      // Show the button only where there is something to download.
      // Fix: the original kept several 700-800 ms intervals running forever.
      const refresh = () => {
        const hasVideo = !!document.querySelector('video');
        const t = resolve();
        const inline = isYouTubeWatch() && document.querySelector('.ioss-yt-dl');
        if (!inline && (t || (hasVideo && !/(^|\.)youtube\.com$/.test(host)))) button.show(); else button.hide();
      };
      refresh();
      api.onUrlChange(() => setTimeout(refresh, 400));
      api.every(2000, refresh);
    }

    // ---- inline buttons in X/Twitter & Threads posts (taps, not hover)
    if (!cfg.inlineX) return;
    if (/(^|\.)(x|twitter)\.com$/.test(host)) {
      const SVG = 'M11.99 16l-5.7-5.7L7.7 8.88l3.29 3.3V2.59h2v9.59l3.3-3.3 1.41 1.42-5.71 5.7zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z';
      api.addStyle(`.ioss-x-dl{display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;margin-left:4px;color:rgb(113,118,123);border:0;background:none;padding:0;-webkit-tap-highlight-color:transparent}
        .ioss-x-dl:active{color:rgb(29,155,240)} .ioss-x-dl svg{width:20px;height:20px}`);
      const scan = () => {
        for (const art of document.querySelectorAll('article:not([data-ioss-dl])')) {
          const media = art.querySelector('[data-testid="videoComponent"], [data-testid="videoPlayer"], button[data-testid="playButton"], div[role="progressbar"]');
          if (!media) continue;
          const group = art.querySelector('div[role="group"]:last-of-type');
          const link = art.querySelector('a[href*="/status/"]');
          const id = link && (link.getAttribute('href').match(/\/status\/(\d+)/) || [])[1];
          if (!group || !id) continue;
          art.setAttribute('data-ioss-dl', '1');
          group.appendChild(api.el('button', { type: 'button', class: 'ioss-x-dl', 'aria-label': 'Download video',
            onclick: (e) => { e.preventDefault(); e.stopPropagation(); openService('https://x.com/_/status/' + id); } }, [api.icon(SVG, 20)]));
        }
      };
      scan();
      api.observe(document.body, { childList: true, subtree: true }, scan, { throttle: 400 });
    } else if (/(^|\.)threads\.(com|net)$/.test(host)) {
      const scan = () => {
        for (const c of document.querySelectorAll("[data-pressable-container='true']:not([data-ioss-dl])")) {
          if (!c.querySelector('video')) continue;
          const buttons = Array.from(c.querySelectorAll("[role='button']"));
          if (buttons.length <= 1) continue;
          c.setAttribute('data-ioss-dl', '1');
          const withNum = buttons.filter((b) => /\d/.test(b.textContent || ''));
          const share = (withNum.length ? withNum : buttons).pop().parentElement;
          const b = share.cloneNode(false);
          b.style.cssText += ';display:flex;align-items:center;justify-content:center;min-width:40px;min-height:40px;cursor:pointer';
          b.appendChild(api.icon(DL_PATH, 20));
          b.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const post = Array.from(c.querySelectorAll("a[role='link'][href*='/post/']")).pop();
            openService(post ? abs(post.getAttribute('href')) : location.href);
          });
          share.insertAdjacentElement('afterend', b);
        }
      };
      scan();
      api.observe(document.body, { childList: true, subtree: true }, scan, { throttle: 500 });
    }
  }
})
