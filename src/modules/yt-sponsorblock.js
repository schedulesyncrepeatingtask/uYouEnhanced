({
  id: 'yt-sponsorblock',
  name: 'SponsorBlock: skip sponsors',
  version: '2026.4.0',
  api: 1,
  source: 'Simple Sponsor Skipper 2026.03 (mthsk)',
  description: 'Skips sponsors, intros, outros, self-promotion and other segments on YouTube, its embeds, Invidious instances and Odysee using the SponsorBlock database.',
  runAt: 'start',
  frames: true,
  INVIDIOUS: ['yt.artemislena.eu', 'tube.cadence.moe', 'y.com.sb', 'invidious.esmailelbob.xyz', 'invidious.flokinet.to', 'inv.frail.com.br',
    'invidious.garudalinux.org', 'invidious.kavin.rocks', 'inv.nadeko.net', 'invidious.namazso.eu', 'iv.nboeck.de', 'invidious.nerdvpn.de',
    'youtube.owacon.moe', 'inv.pistasjis.net', 'invidious.projectsegfau.lt', 'inv.bp.projectsegfau.lt', 'inv.in.projectsegfau.lt',
    'inv.us.projectsegfau.lt', 'vid.puffyan.us', 'invidious.sethforprivacy.com', 'invidious.slipfox.xyz', 'invidious.snopyta.org',
    'inv.vern.cc', 'invidious.weblibre.org', 'youchu.be', 'yewtu.be'],
  match: function (u) {
    const h = u.hostname;
    if (/^(m|www)\.youtube\.com$/.test(h)) return true;
    if (h === 'www.youtube-nocookie.com') return u.pathname.startsWith('/embed/');
    return h === 'odysee.com' || this.INVIDIOUS.includes(h);
  },
  defaults: {
    cat_sponsor: true, cat_intro: true, cat_outro: true, cat_interaction: true, cat_selfpromo: true, cat_preview: true,
    cat_music_offtopic: true, cat_filler: false, highlight: true, toasts: true, upvotes: -2, hashing: true, instance: 'sponsor.ajay.app'
  },
  options: [
    { key: 'cat_sponsor', type: 'bool', label: 'Skip sponsors' },
    { key: 'cat_intro', type: 'bool', label: 'Skip intros' },
    { key: 'cat_outro', type: 'bool', label: 'Skip outros / end cards' },
    { key: 'cat_interaction', type: 'bool', label: 'Skip "like & subscribe" reminders' },
    { key: 'cat_selfpromo', type: 'bool', label: 'Skip self-promotion' },
    { key: 'cat_preview', type: 'bool', label: 'Skip previews / recaps' },
    { key: 'cat_music_offtopic', type: 'bool', label: 'Skip non-music parts of music videos' },
    { key: 'cat_filler', type: 'bool', label: 'Skip filler (very aggressive)' },
    { key: 'highlight', type: 'bool', label: 'Offer to jump to the highlight' },
    { key: 'toasts', type: 'bool', label: 'Show a message (with Undo) when skipping' },
    { key: 'upvotes', type: 'number', label: 'Minimum segment votes', min: -2, max: 100 },
    { key: 'hashing', type: 'bool', label: 'Private lookups (hash prefix)', help: 'Never sends the full video ID' },
    { key: 'instance', type: 'text', label: 'Database server' }
  ],

  run(api, cfg) {
    const CATS = ['sponsor', 'intro', 'outro', 'interaction', 'selfpromo', 'preview', 'music_offtopic', 'filler'];
    const LABEL = { sponsor: 'sponsor', intro: 'intro', outro: 'outro', interaction: 'interaction reminder', selfpromo: 'self-promotion',
      preview: 'preview', music_offtopic: 'non-music', filler: 'filler', combined: 'combined' };
    const PLAYER_SEL = '#movie_player video, video.html5-main-video, video#player_html5_api, video#player, video#video, video#vjs_video_3_html5_api, .vjs-tech';
    const isOdysee = location.hostname === 'odysee.com';
    const notify = (msg, extra) => { if (cfg.toasts && api.isTop) api.toast(msg, extra); };

    const fmt = (s) => {
      s = Math.max(0, Math.floor(s));
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const sec = String(s % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
    };

    function videoIdFromUrl() {
      const p = new URLSearchParams(location.search);
      if (p.get('v')) return p.get('v');
      const m = location.pathname.match(/^\/(?:embed|v|shorts|live)\/([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    }

    // Fix: the original crashed with a TypeError whenever a segment was
    // dropped before the first kept one (newSegments[-1]), and then skipped
    // nothing at all. It also compared highlight votes to a non-existent
    // "upvotes" field. Segments are now sorted and merged safely.
    function processSegments(segments) {
      if (!Array.isArray(segments)) return { list: [], poi: null };
      const sorted = segments.slice().sort((a, b) => a.segment[0] - b.segment[0]);
      const list = [];
      let poi = null;
      for (const s of sorted) {
        if (s.votes < cfg.upvotes) continue;
        if (s.category === 'poi_highlight') { if (!poi || s.votes > poi.votes) poi = s; continue; }
        if (s.actionType && s.actionType !== 'skip') continue;
        const last = list[list.length - 1];
        if (last && last.segment[1] >= s.segment[0]) {
          if (s.segment[1] > last.segment[1]) { last.segment = [last.segment[0], s.segment[1]]; last.category = last.category === s.category ? s.category : 'combined'; }
          continue;
        }
        list.push({ category: s.category, segment: [s.segment[0], s.segment[1]], videoDuration: s.videoDuration });
      }
      return { list, poi: poi ? poi.segment[0] : null };
    }

    async function fetchSegments(videoId) {
      const categories = CATS.filter((c) => cfg['cat_' + c]);
      if (!categories.length) categories.push('sponsor');
      if (cfg.highlight) categories.push('poi_highlight');
      const inst = String(cfg.instance || 'sponsor.ajay.app').replace(/^https?:\/\//, '').replace(/\s*\(.*$/, '').replace(/\/+$/, '');
      const cat = encodeURIComponent(JSON.stringify(categories));
      let url;
      if (cfg.hashing) {
        const hash = await api.sha256(videoId);
        url = `https://${inst}/api/skipSegments/${hash.slice(0, 4)}?categories=${cat}`;
      } else {
        url = `https://${inst}/api/skipSegments?videoID=${encodeURIComponent(videoId)}&categories=${cat}`;
      }
      const r = await api.request({ url, headers: { Accept: 'application/json' }, timeout: 15000 });
      if (r.status === 404) return [];
      if (r.status !== 200) throw new Error('SponsorBlock HTTP ' + r.status);
      const data = JSON.parse(r.text);
      if (!cfg.hashing) return data;
      const hit = data.find((v) => v.videoID === videoId);
      return hit ? hit.segments : [];
    }

    let session = null;

    function start(videoId) {
      if (session && session.videoId === videoId) return;
      if (session) session.stop();
      session = makeSession(videoId);
    }

    function makeSession(videoId) {
      const s = { videoId, stopped: false, player: null, segs: [], poi: null, ignore: new Set(), timers: [] };
      const later = (fn, ms) => { const t = setTimeout(fn, ms); s.timers.push(t); return t; };
      let precise = 0;

      const onTime = () => {
        const v = s.player;
        if (s.stopped || !v || v.paused || v.seeking) return;
        const t = v.currentTime;
        for (let i = 0; i < s.segs.length; i++) {
          const seg = s.segs[i];
          if (s.ignore.has(i)) continue;
          const [a, b] = seg.segment;
          if (t >= a && t < b - 0.2) {
            v.currentTime = b;
            api.log(`skipped ${seg.category} ${a}-${b}`);
            notify(`Skipped ${LABEL[seg.category] || seg.category} (${i + 1}/${s.segs.length})`, {
              action: 'Undo', onAction: () => { s.ignore.add(i); v.currentTime = a; }
            });
            return;
          }
          // timeupdate only fires every ~250 ms on iOS: schedule an exact
          // jump when a segment is about to start so less of it is heard.
          if (a > t && a - t < 1 && !precise) {
            precise = later(() => { precise = 0; onTime(); }, ((a - t) / (v.playbackRate || 1)) * 1000 + 15);
          }
        }
      };

      const bind = (v) => {
        if (s.player === v) return;
        if (s.player) { s.player.removeEventListener('timeupdate', onTime); s.player.removeEventListener('seeked', onTime); s.player.removeEventListener('play', onTime); }
        s.player = v;
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('seeked', onTime);
        v.addEventListener('play', onTime);
      };

      // Fix: the original polled for the player every 10 ms forever (also
      // after leaving the page) and stacked listeners on every navigation.
      const findPlayer = () => {
        if (s.stopped) return;
        const v = document.querySelector(PLAYER_SEL);
        if (v) bind(v);
      };
      s.watch = setInterval(findPlayer, 1000);

      fetchSegments(videoId).then((segments) => {
        if (s.stopped) return;
        const { list, poi } = processSegments(segments);
        s.segs = list;
        s.poi = poi;
        api.log(`${list.length} segment(s) for ${videoId}`);
        findPlayer();
        if (list.length) {
          let dur = list[0].videoDuration || 0;
          for (const seg of list) dur -= seg.segment[1] - seg.segment[0];
          notify(`${list.length} skippable segment${list.length > 1 ? 's' : ''} found` + (dur > 0 ? ` · ${fmt(dur)} without them` : ''), { timeout: 2500 });
        }
        if (poi != null && cfg.highlight) {
          later(() => {
            if (!s.stopped && (!s.player || s.player.currentTime < poi)) {
              api.toast(`Highlight at ${fmt(poi)}`, { timeout: 7000, action: 'Jump', onAction: () => { if (s.player) s.player.currentTime = poi; } });
            }
          }, 1500);
        }
        onTime();
      }).catch((e) => api.log('lookup failed', e.message));

      s.stop = () => {
        s.stopped = true;
        clearInterval(s.watch);
        s.timers.forEach(clearTimeout);
        if (s.player) { s.player.removeEventListener('timeupdate', onTime); s.player.removeEventListener('seeked', onTime); s.player.removeEventListener('play', onTime); }
      };
      return s;
    }

    function check() {
      const id = videoIdFromUrl();
      if (id) start(id);
      else if (session && !isOdysee) { session.stop(); session = null; }
    }

    if (isOdysee) {
      // Odysee mirrors many YouTube uploads; the YouTube ID is in the cover art.
      api.onReady(() => api.observe(document.body, { childList: true, subtree: true }, () => {
        const cover = document.querySelector('div.content__cover');
        if (!cover || !document.querySelector('#vjs_video_3')) return;
        const bg = cover.style.backgroundImage || '';
        const thumb = bg.substring(bg.indexOf('"') + 1).split('"')[0];
        let id = null;
        if (/ytimg\.com|img\.youtube\.com/.test(thumb)) id = thumb.split('/vi/').pop().split('/')[0];
        else if (thumb && !/\.(webp|jpe?g|gif|png)$/i.test(thumb)) id = thumb.split('/').pop();
        if (id) start(id);
      }, { throttle: 500 }));
      return;
    }

    check();
    api.onUrlChange(check);
  }
})
