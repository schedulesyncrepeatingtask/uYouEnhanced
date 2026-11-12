({
  id: 'downloader',
  name: 'Video downloader',
  version: '2.1.0',
  api: 1,
  source: 'All-in-One Video Downloader 1.0.19 (Daniel) + ideas from All-in-One Video Downloader 2026.1108 (classccai, MIT)',
  description: 'Saves videos straight to your iPhone from YouTube (up to 1080p, picture and sound joined on the phone), YouTube Music (sound), X/Twitter, TikTok, Instagram, Facebook, Threads, Pinterest, Snapchat, TED, Douyin and Xiaohongshu. Tap the download button, pick a quality, then tap Save and "Save Video". No downloader website is opened.',
  runAt: 'ready',
  frames: false,
  SITES: /(^|\.)(youtube\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com|threads\.(com|net)|facebook\.com|pinterest\.[a-z.]+|snapchat\.com|ted\.com|douyin\.com|xiaohongshu\.com|spotify\.com)$/,
  CDN: /(googlevideo\.com|tiktokcdn(-eu|-us|-af)?\.com|douyinvod\.com|fbcdn\.net|twimg\.com|zjcdn\.com|snssdk\.com|tiktokv\.com|douyinstatic\.com|xhscdn\.com|amemv\.com|tikwm\.com|douyinpic\.com|douyinmusicpromotion\.com|cdninstagram\.com|licdn\.com|sc-cdn\.net|pinimg\.com|tedcdn\.com|dmcdn\.net|tumblr\.com|rutube\.ru|uma\.media)$/,
  match: function (u) { return this.SITES.test(u.hostname) || this.CDN.test(u.hostname); },
  defaults: { mode: 'save', quality: 'ask', maxHeight: 1080, prefer60: false, thumbnail: true, warnMB: 600, fab: true, ytInline: true, inlineX: true, copyOnLongPress: true, siteFallback: false },
  options: [
    { key: 'mode', type: 'select', label: 'Download button', choices: [['save', 'Save on the iPhone (direct)'], ['service', 'Open a downloader website']] },
    { key: 'quality', type: 'select', label: 'Quality', choices: [['ask', 'Ask each time'], ['best', 'Best available'], ['1080', 'Up to 1080p'], ['720', 'Up to 720p'], ['360', '360p (quickest)'], ['audio', 'Sound only']],
      help: 'YouTube Music always saves the sound when set to "Ask"' },
    { key: 'maxHeight', type: 'select', label: 'YouTube: highest quality offered', choices: [['1080', '1080p'], ['720', '720p'], ['480', '480p']],
      help: 'Higher YouTube qualities are VP9/AV1, which Photos cannot store' },
    { key: 'prefer60', type: 'bool', label: 'YouTube: prefer 60 fps', help: 'About twice the size' },
    { key: 'thumbnail', type: 'bool', label: 'YouTube: offer the thumbnail too', help: 'Saved as a picture (Save Image)' },
    { key: 'warnMB', type: 'number', label: 'Ask before files larger than (MB)', min: 50, max: 4000, step: 50 },
    { key: 'fab', type: 'bool', label: 'Floating download button on video pages' },
    { key: 'ytInline', type: 'bool', label: 'YouTube: download button left of the like button', help: 'Replaces the floating button on watch pages' },
    { key: 'inlineX', type: 'bool', label: 'Download button in X/Twitter & Threads posts' },
    { key: 'copyOnLongPress', type: 'bool', label: 'Long-press the button to copy the video link' },
    { key: 'siteFallback', type: 'bool', label: 'Offer a downloader website when saving fails', help: 'Off: never leaves the page. On: a "Website" button (tool77.com) after a failure, and Spotify support' }
  ],

  // ---------------------------------------------------------------------
  // MP4 joiner. YouTube sends HD as two files: picture only and sound only
  // (usually fragmented "DASH" MP4). iOS can only save ONE ordinary video
  // file, so this reads the samples of both and writes a normal MP4 with
  // the index (moov) at the front, the way a camera app would. No
  // re-encoding: it only re-packs, so it is fast and keeps full quality.
  // Pure functions on Uint8Arrays; returns the parts of a Blob.
  // ---------------------------------------------------------------------
  mp4: (function () {
    const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
    const i32 = (b, o) => u32(b, o) | 0;
    const kind = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

    function boxes(b, parent) {
      const out = [];
      let o = parent.body;
      const end = parent.end;
      while (o + 8 <= end) {
        let size = u32(b, o);
        const type = kind(b, o + 4);
        let hdr = 8;
        if (size === 1) { size = u64(b, o + 8); hdr = 16; } else if (size === 0) size = end - o;
        if (size < hdr) break;
        if (o + size > end) { if (type === 'mdat' || type === 'moof') size = end - o; else break; }
        out.push({ type, start: o, end: o + size, body: o + hdr });
        o += size;
      }
      return out;
    }
    const find = (b, parent, type) => (parent ? boxes(b, parent).find((x) => x.type === type) || null : null);
    const dig = (b, box, ...types) => types.reduce((cur, t) => find(b, cur, t), box);

    // ---- reading
    function readTrack(b) {
      const root = { body: 0, end: b.length };
      const top = boxes(b, root);
      const moov = top.find((x) => x.type === 'moov');
      if (!moov) throw new Error('not an MP4 file');
      const trak = find(b, moov, 'trak');
      const tkhd = find(b, trak, 'tkhd');
      const mdhd = dig(b, trak, 'mdia', 'mdhd');
      const hdlr = dig(b, trak, 'mdia', 'hdlr');
      const minf = dig(b, trak, 'mdia', 'minf');
      const stbl = find(b, minf, 'stbl');
      const stsd = find(b, stbl, 'stsd');
      if (!tkhd || !mdhd || !hdlr || !stsd) throw new Error('incomplete MP4 track');
      const tv = b[tkhd.body];
      const trackId = u32(b, tkhd.body + (tv === 1 ? 20 : 12));
      const wh = tkhd.body + (tv === 1 ? 88 : 76);
      const mv = b[mdhd.body];
      const t = {
        handler: kind(b, hdlr.body + 8),
        timescale: u32(b, mdhd.body + (mv === 1 ? 20 : 12)),
        width: u32(b, wh), height: u32(b, wh + 4),
        hdlr: b.subarray(hdlr.start, hdlr.end),
        stsd: b.subarray(stsd.start, stsd.end),
        media: find(b, minf, 'vmhd') || find(b, minf, 'smhd'),
        samples: [],
        bytes: b
      };
      t.media = t.media ? b.subarray(t.media.start, t.media.end) : null;
      const mvex = find(b, moov, 'mvex');
      if (mvex && top.some((x) => x.type === 'moof')) readFragments(b, top, mvex, trackId, t.samples);
      else readTables(b, stbl, t.samples);
      if (!t.samples.length) throw new Error('no samples in ' + t.handler + ' track');
      return t;
    }

    function readTables(b, stbl, out) {
      const box = (n) => find(b, stbl, n);
      const sizes = [];
      const stsz = box('stsz');
      const stz2 = box('stz2');
      if (stsz) {
        const def = u32(b, stsz.body + 4);
        const n = u32(b, stsz.body + 8);
        for (let i = 0; i < n; i++) sizes.push(def || u32(b, stsz.body + 12 + i * 4));
      } else if (stz2) {
        const field = b[stz2.body + 7];
        const n = u32(b, stz2.body + 8);
        for (let i = 0; i < n; i++) {
          const p = stz2.body + 12;
          sizes.push(field === 16 ? (b[p + i * 2] << 8) | b[p + i * 2 + 1] : field === 8 ? b[p + i] : (b[p + (i >> 1)] >> ((i & 1) ? 0 : 4)) & 15);
        }
      }
      const chunks = [];
      const stco = box('stco');
      const co64 = box('co64');
      if (stco) for (let i = 0, n = u32(b, stco.body + 4); i < n; i++) chunks.push(u32(b, stco.body + 8 + i * 4));
      else if (co64) for (let i = 0, n = u32(b, co64.body + 4); i < n; i++) chunks.push(u64(b, co64.body + 8 + i * 8));
      const stsc = box('stsc');
      const runs = [];
      for (let i = 0, n = stsc ? u32(b, stsc.body + 4) : 0; i < n; i++) runs.push([u32(b, stsc.body + 8 + i * 12), u32(b, stsc.body + 12 + i * 12)]);
      const durs = [];
      const stts = box('stts');
      for (let i = 0, n = stts ? u32(b, stts.body + 4) : 0; i < n; i++) {
        const c = u32(b, stts.body + 8 + i * 8);
        const d = u32(b, stts.body + 12 + i * 8);
        for (let k = 0; k < c; k++) durs.push(d);
      }
      const ctos = [];
      const ctts = box('ctts');
      if (ctts) {
        const v = b[ctts.body];
        for (let i = 0, n = u32(b, ctts.body + 4); i < n; i++) {
          const c = u32(b, ctts.body + 8 + i * 8);
          const o = v === 1 ? i32(b, ctts.body + 12 + i * 8) : u32(b, ctts.body + 12 + i * 8);
          for (let k = 0; k < c; k++) ctos.push(o);
        }
      }
      const stss = box('stss');
      const sync = stss ? new Set() : null;
      if (stss) for (let i = 0, n = u32(b, stss.body + 4); i < n; i++) sync.add(u32(b, stss.body + 8 + i * 4));
      let s = 0;
      for (let r = 0; r < runs.length; r++) {
        const first = runs[r][0];
        const last = r + 1 < runs.length ? runs[r + 1][0] - 1 : chunks.length;
        for (let c = first; c <= last && s < sizes.length; c++) {
          let off = chunks[c - 1];
          for (let k = 0; k < runs[r][1] && s < sizes.length; k++, s++) {
            out.push({ offset: off, size: sizes[s], dur: durs[s] || 0, cto: ctos[s] || 0, sync: !sync || sync.has(s + 1) });
            off += sizes[s];
          }
        }
      }
    }

    function readFragments(b, top, mvex, trackId, out) {
      let trex = null;
      for (const x of boxes(b, mvex)) if (x.type === 'trex' && (u32(b, x.body + 4) === trackId || !trex)) trex = x;
      const T = trex ? { dur: u32(b, trex.body + 12), size: u32(b, trex.body + 16), flags: u32(b, trex.body + 20) } : { dur: 0, size: 0, flags: 0 };
      for (const moof of top) {
        if (moof.type !== 'moof') continue;
        for (const traf of boxes(b, moof)) {
          if (traf.type !== 'traf') continue;
          const tfhd = find(b, traf, 'tfhd');
          if (!tfhd) continue;
          const tf = u32(b, tfhd.body) & 0xffffff;
          if (u32(b, tfhd.body + 4) !== trackId && trackId) continue;
          let p = tfhd.body + 8;
          let base = moof.start;
          if (tf & 0x1) { base = u64(b, p); p += 8; }
          if (tf & 0x2) p += 4;
          let dDur = T.dur; let dSize = T.size; let dFlags = T.flags;
          if (tf & 0x8) { dDur = u32(b, p); p += 4; }
          if (tf & 0x10) { dSize = u32(b, p); p += 4; }
          if (tf & 0x20) { dFlags = u32(b, p); p += 4; }
          let pos = base;
          for (const trun of boxes(b, traf)) {
            if (trun.type !== 'trun') continue;
            const v = b[trun.body];
            const rf = u32(b, trun.body) & 0xffffff;
            const n = u32(b, trun.body + 4);
            let q = trun.body + 8;
            if (rf & 0x1) { pos = base + i32(b, q); q += 4; }
            let firstFlags = null;
            if (rf & 0x4) { firstFlags = u32(b, q); q += 4; }
            for (let i = 0; i < n; i++) {
              let dur = dDur; let size = dSize; let flags = i === 0 && firstFlags !== null ? firstFlags : dFlags; let cto = 0;
              if (rf & 0x100) { dur = u32(b, q); q += 4; }
              if (rf & 0x200) { size = u32(b, q); q += 4; }
              if (rf & 0x400) { flags = u32(b, q); q += 4; }
              if (rf & 0x800) { cto = v === 1 ? i32(b, q) : u32(b, q); q += 4; }
              if (pos + size > b.length) return; // truncated download: keep what is complete
              out.push({ offset: pos, size, dur, cto, sync: !(flags & 0x10000) });
              pos += size;
            }
          }
        }
      }
    }

    // ---- writing
    const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
    function box(type, ...parts) {
      let len = 8;
      for (const p of parts) len += p.length;
      const o = new Uint8Array(len);
      new DataView(o.buffer).setUint32(0, len);
      o.set(ascii(type), 4);
      let at = 8;
      for (const p of parts) { o.set(p, at); at += p.length; }
      return o;
    }
    function words(list, bits = 32) {
      const o = new Uint8Array(list.length * (bits / 8));
      const dv = new DataView(o.buffer);
      list.forEach((x, i) => {
        if (bits === 64) { dv.setUint32(i * 8, Math.floor(x / 4294967296)); dv.setUint32(i * 8 + 4, x >>> 0); } else if (bits === 16) dv.setUint16(i * 2, x); else dv.setUint32(i * 4, x >>> 0);
      });
      return o;
    }
    const full = (type, version, flags, ...parts) => box(type, Uint8Array.of(version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255), ...parts);
    const MATRIX = words([0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000]);
    const runLength = (values) => {
      const out = [];
      for (const v of values) { const last = out[out.length - 1]; if (last && last[1] === v) last[0]++; else out.push([1, v]); }
      return out;
    };
    const table = (type, rows, version = 0) => full(type, version, 0, words([rows.length]), words(rows.flat()));

    function trakBox(t, id, movieDur, offsets, big) {
      const s = t.samples;
      const dur = s.reduce((a, x) => a + x.dur, 0);
      const isVideo = t.handler === 'vide';
      const tkhd = full('tkhd', 0, 3, words([0, 0, id, 0, movieDur, 0, 0]), words([0, 0, isVideo ? 0 : 0x0100, 0], 16), MATRIX,
        words([isVideo ? t.width : 0, isVideo ? t.height : 0]));
      const mdhd = full('mdhd', 0, 0, words([0, 0, t.timescale, dur]), words([0x55c4, 0], 16));
      const stbl = [t.stsd, table('stts', runLength(s.map((x) => x.dur)))];
      if (s.some((x) => x.cto)) stbl.push(table('ctts', runLength(s.map((x) => x.cto)), s.some((x) => x.cto < 0) ? 1 : 0));
      if (s.some((x) => !x.sync)) stbl.push(full('stss', 0, 0, words([s.filter((x) => x.sync).length]), words(s.map((x, i) => (x.sync ? i + 1 : 0)).filter(Boolean))));
      stbl.push(full('stsc', 0, 0, words([1, 1, 1, 1])));
      stbl.push(full('stsz', 0, 0, words([0, s.length]), words(s.map((x) => x.size))));
      stbl.push(big ? full('co64', 0, 0, words([offsets.length]), words(offsets, 64)) : full('stco', 0, 0, words([offsets.length]), words(offsets)));
      const dinf = box('dinf', full('dref', 0, 0, words([1]), full('url ', 0, 1)));
      const media = t.media || (isVideo ? full('vmhd', 0, 1, new Uint8Array(8)) : full('smhd', 0, 0, new Uint8Array(4)));
      // B-frames start presenting a little after 0: an edit list keeps
      // picture and sound in sync.
      const shift = s[0].cto > 0 ? s[0].cto : 0;
      const edts = shift ? [box('edts', full('elst', 0, 0, words([1, movieDur, shift, 0x10000])))] : [];
      return box('trak', tkhd, ...edts, box('mdia', mdhd, t.hdlr, box('minf', media, dinf, box('stbl', ...stbl))));
    }

    // join([file, file?]) -> { parts, size, duration, tracks }
    function join(files) {
      const tracks = files.map(readTrack);
      tracks.sort((a, b) => (a.handler === 'vide' ? -1 : b.handler === 'vide' ? 1 : 0));
      // Interleave by time so players never seek far between picture and sound.
      const order = [];
      const pos = tracks.map(() => ({ i: 0, t: 0 }));
      for (;;) {
        let pick = -1;
        for (let k = 0; k < tracks.length; k++) {
          if (pos[k].i >= tracks[k].samples.length) continue;
          if (pick < 0 || pos[k].t / tracks[k].timescale < pos[pick].t / tracks[pick].timescale) pick = k;
        }
        if (pick < 0) break;
        const s = tracks[pick].samples[pos[pick].i++];
        pos[pick].t += s.dur;
        order.push([pick, s]);
      }
      const payload = order.reduce((a, [, s]) => a + s.size, 0);
      const movieDur = Math.round(Math.max(...tracks.map((t) => t.samples.reduce((a, x) => a + x.dur, 0) / t.timescale)) * 1000);
      const audioOnly = tracks.every((t) => t.handler === 'soun');
      const ftyp = box('ftyp', ascii(audioOnly ? 'M4A ' : 'isom'), words([0x200]), ascii(audioOnly ? 'M4A isomiso2mp41' : 'isomiso2avc1mp41'));
      const bigMdat = payload + 16 > 0xffffffff;
      const mdatHead = bigMdat ? box('mdat', words([0, 0])) : box('mdat');
      if (bigMdat) { new DataView(mdatHead.buffer).setUint32(0, 1); new DataView(mdatHead.buffer).setUint32(8, Math.floor((payload + 16) / 4294967296)); new DataView(mdatHead.buffer).setUint32(12, (payload + 16) >>> 0); } else new DataView(mdatHead.buffer).setUint32(0, payload + 8);
      const build = (start, big) => {
        const offs = tracks.map(() => []);
        let at = start;
        for (const [k, s] of order) { offs[k].push(at); at += s.size; }
        const mvhd = full('mvhd', 0, 0, words([0, 0, 1000, movieDur, 0x10000]), words([0x0100, 0, 0, 0, 0, 0], 16), MATRIX, new Uint8Array(24), words([tracks.length + 1]));
        return box('moov', mvhd, ...tracks.map((t, k) => trakBox(t, k + 1, movieDur, offs[k], big)));
      };
      const probe = build(0, false);
      let big = ftyp.length + probe.length + mdatHead.length + payload > 0xffffffff;
      let moov = build(0, big);
      moov = build(ftyp.length + moov.length + mdatHead.length, big);
      // Sample data: neighbouring samples of one file are passed as one slice.
      const parts = [ftyp, moov, mdatHead];
      let run = null;
      for (const [k, s] of order) {
        const b = tracks[k].bytes;
        if (run && run.b === b && run.end === s.offset) run.end += s.size;
        else { if (run) parts.push(run.b.subarray(run.start, run.end)); run = { b, start: s.offset, end: s.offset + s.size }; }
      }
      if (run) parts.push(run.b.subarray(run.start, run.end));
      return { parts, size: ftyp.length + moov.length + mdatHead.length + payload, duration: movieDur / 1000,
        tracks: tracks.map((t) => ({ handler: t.handler, samples: t.samples.length })) };
    }
    return { join, readTrack };
  })(),

  run(api, cfg) {
    const self = this;
    const host = location.hostname;
    const DL_PATH = 'M5 20h14v-2H5v2zm7-3 6-6-1.41-1.41L13 13.17V4h-2v9.17L7.41 9.59 6 11l6 6z';
    const lang = (navigator.language || 'en').split('-')[0];
    const isYT = /(^|\.)youtube\.com$/.test(host);
    const isYTMusic = /(^|\.)music\.youtube\.com$/.test(host);
    const MB = 1048576;

    // Only when "Website as a last resort" is on, or the user asked for
    // the website mode: a downloader page in a new tab.
    function openService(url) {
      if (!url) return api.toast('No video found on this page');
      api.openTab(`https://www.tool77.com/${lang}/v/downloader?v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel&url=${encodeURIComponent(url)}`);
    }

    // ------------------------------------------------------------------
    // Saving: iOS only lets a web page put a video in the camera roll
    // through the share sheet ("Save Video"), and only from a fresh tap.
    // ------------------------------------------------------------------
    const sanitize = (t) => (String(t || 'video').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video');
    async function shareFile(blob, name) {
      const type = /\.m4a$/.test(name) ? 'audio/mp4' : /\.jpg$/.test(name) ? 'image/jpeg' : blob.type && blob.type !== 'application/octet-stream' ? blob.type : 'video/mp4';
      const file = new File([blob], name, { type });
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

    // Direct media files (opened from a CDN): in-page Save button.
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
          if (blob) return shareFile(blob, name);
          api.toast('Downloading…', { timeout: 2000 });
          try {
            const r = await api.request({ url: location.href, responseType: 'blob', timeout: 300000 });
            if (r.status < 200 || r.status >= 300 || !r.response) throw new Error('HTTP ' + r.status);
            blob = r.response instanceof Blob ? r.response : new Blob([r.response]);
            api.toast('Ready.', { timeout: 15000, action: 'Save', onAction: () => shareFile(blob, name) });
          } catch (e) {
            api.toast('Download failed. Long-press the video and choose "Save to Files" instead.', { timeout: 6000 });
          }
        }
      });
      btn.show();
      return;
    }

    // ------------------------------------------------------------------
    // Which video does the user mean? On a touch screen there is no hover,
    // so it is the video that covers most of the screen.
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
    const onScreenVideo = () => mostVisible(document.querySelectorAll('video'));
    const videoContainer = (sel) => { const v = onScreenVideo(); return v ? v.closest(sel) : null; };
    const clean = (u) => String(u).split('?')[0];
    const abs = (href) => { try { return new URL(href, location.href).href; } catch (_) { return null; } };
    const ytId = () => new URLSearchParams(location.search).get('v') || (location.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})/) || [])[1] || null;

    // The link of the video (used for titles, "copy link" and the optional website).
    const resolvers = [
      [/(^|\.)music\.youtube\.com$/, () => (ytId() ? `https://music.youtube.com/watch?v=${ytId()}` : null)],
      [/(^|\.)youtube\.com$/, () => {
        if (location.pathname === '/watch' && ytId()) return `https://www.youtube.com/watch?v=${ytId()}`;
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
        return link ? clean(abs(link.getAttribute('href'))) : (onScreenVideo() ? location.href : null);
      }],
      [/(^|\.)facebook\.com$/, () => {
        const id = (location.href.match(/(?:v=|\/videos\/|\/reel\/|\/reels\/|\/watch\/\?v=)(\d+)/) || [])[1];
        if (id) return 'https://www.facebook.com/reel/' + id;
        const c = videoContainer('[role="article"], [data-pagelet], div[data-video-id]');
        const link = c && c.querySelector('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/?v="]');
        const fid = link && (link.getAttribute('href').match(/(?:\/videos\/|\/reel\/|v=)(\d+)/) || [])[1];
        if (fid) return 'https://www.facebook.com/reel/' + fid;
        return onScreenVideo() ? location.href : null;
      }],
      [/(^|\.)pinterest\.[a-z.]+$/, () => {
        if (/\/pin\//.test(location.pathname)) return clean(location.href);
        const v = onScreenVideo();
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
      // Spotify songs are DRM-protected: only the website can help there.
      [/(^|\.)open\.spotify\.com$/, () => {
        if (!cfg.siteFallback) return null;
        let id = (location.pathname.match(/\/track\/([A-Za-z0-9]+)/) || [])[1];
        if (!id) {
          const now = document.querySelector('[data-testid="now-playing-widget"] a[href*="/track/"], [data-testid="context-item-link"][href*="/track/"], aside a[href*="/track/"]');
          id = now && (now.getAttribute('href').match(/track\/([A-Za-z0-9]+)/) || [])[1];
        }
        return id ? { direct: `https://www.spotmelo.com/en?url=${encodeURIComponent('https://open.spotify.com/track/' + id)}&v=${encodeURIComponent(api.version)}&namespace=AllInOneDownloader_Daniel` } : null;
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
    // Finding the actual video file. Ideas from "All-in-One Video
    // Downloader" (tenzaa.com, classccai, MIT): the sites' own embed
    // data, page JSON, og:video and the player's network requests. Its
    // two cloud engines are not used: they borrow another service's API
    // keys and pretend to be that service's website.
    // ------------------------------------------------------------------
    const norm = (raw) => {
      if (!raw) return '';
      let u = String(raw);
      for (let i = 0; i < 3 && /\\/.test(u); i++) {
        u = u.replace(/\\u002F/gi, '/').replace(/\\u0026/gi, '&').replace(/\\u003D/gi, '=').replace(/\\u003F/gi, '?')
          .replace(/\\u0025/gi, '%').replace(/\\u003A/gi, ':').replace(/\\\//g, '/');
      }
      u = u.replace(/&amp;/g, '&');
      return /^https?:\/\//i.test(u) ? u : '';
    };
    const JUNK = /\/obj\/eden-|\/obj\/ies-|apk_new|avatar|profile_image|-thumbnail|thumbnail\.|favicon|\/img\/|sprite|logo\.|\.jpe?g|\.webp|\.png|\.gif|\.css|\.js(\?|$)|\.json(\?|$)|\.woff|\.m3u8(\?|$)|\.m4s(\?|$)|\.ts(\?|$)/i;
    const scoreUrl = (u) => (/hd|1080|720|high|_hd\.|hd_/i.test(u) ? 40 : 0) - (/(^|[^a-z])sd|360|low/i.test(u) ? 10 : 0) + (/\.mp4/i.test(u) ? 15 : 0) - (/audio|\.m4a|\.mp3/i.test(u) ? 25 : 0);
    function add(list, url, score, extra) {
      const u = norm(url);
      if (!u || JUNK.test(u) || list.some((c) => c.url === u)) return;
      list.push(Object.assign({ url: u, score: score || 0 }, extra));
    }
    function fromVideoTag(list, v, base = 90) {
      if (!v) return;
      const area = Math.min((v.videoWidth || 0) * (v.videoHeight || 0), 3840 * 2160) / 12000;
      for (const src of [v.currentSrc, v.src, ...Array.from(v.querySelectorAll('source'), (s) => s.src)]) if (/^https?:/i.test(src || '')) add(list, src, base + area, { height: v.videoHeight || 0 });
      for (const k of ['src', 'videoUrl', 'video_url', 'downloadUrl']) if (v.dataset && v.dataset[k]) add(list, v.dataset[k], base - 5 + area);
    }
    function fromMeta(list) {
      for (const p of ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream']) {
        const m = document.querySelector(`meta[property="${p}"], meta[name="${p}"]`);
        if (m && m.content) add(list, m.content, 85);
      }
    }
    // Players that stream through MediaSource never show their file in
    // the page, but the browser's own list of loaded files does.
    function fromNetwork(list, hostRe) {
      try {
        for (const e of performance.getEntriesByType('resource')) {
          const n = e.name;
          if (/^https?:/.test(n) && (!hostRe || hostRe.test(n)) && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(n)) add(list, n, 70 + scoreUrl(n));
        }
      } catch (_) { /* not available */ }
    }
    // anchor: the video's id. Links far from it in the page data most
    // likely belong to another post in the feed and score lower.
    function fromText(list, text, patterns, base, anchor) {
      const at = [];
      if (anchor) for (let i = text.indexOf(anchor); i !== -1 && at.length < 50; i = text.indexOf(anchor, i + 1)) at.push(i);
      if (anchor && !at.length) return;
      for (const [re, weight] of patterns) {
        re.lastIndex = 0;
        let m;
        let guard = 0;
        while ((m = re.exec(text)) && guard++ < 200) {
          const dist = at.length ? Math.min(...at.map((i) => Math.abs(i - m.index))) : 0;
          if (dist > 200000) continue;
          add(list, m[1] || m[0], base + weight + scoreUrl(m[1] || m[0]) - dist / 1000);
        }
      }
    }
    // The page's inline data (cheaper than serialising the whole DOM).
    const pageData = () => Array.from(document.querySelectorAll('script:not([src])'), (s) => s.textContent).join('\n');
    // Around one video's id only, so a feed full of videos gives the right one.
    const near = (text, id, span = 60000) => {
      const i = id ? text.indexOf(id) : -1;
      return i === -1 ? '' : text.slice(Math.max(0, i - span), i + span);
    };
    async function fetchText(url) {
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'text/html,application/xhtml+xml' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }
    const best = (list) => list.slice().sort((a, b) => b.score - a.score)[0] || null;

    const FB = [[/"playable_url_quality_hd"\s*:\s*"([^"]+)"/g, 50], [/"browser_native_hd_url"\s*:\s*"([^"]+)"/g, 48], [/hd_src\s*:\s*"([^"]+)"/g, 45],
      [/"progressive_url"\s*:\s*"([^"]+)"/g, 40], [/"playable_url"\s*:\s*"([^"]+)"/g, 35], [/"browser_native_sd_url"\s*:\s*"([^"]+)"/g, 30], [/sd_src\s*:\s*"([^"]+)"/g, 25]];
    const IG = [[/"video_versions"\s*:\s*\[\s*\{[^}]*?"url"\s*:\s*"([^"]+)"/g, 55], [/"video_url"\s*:\s*"([^"]+)"/g, 50],
      [/"url"\s*:\s*"(https?:\\?\/\\?\/[^"]*?\.mp4[^"]*)"/g, 35]];
    const TW = [[/"playbackUrl"\s*:\s*"([^"]+)"/g, 45], [/(https?:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4[^"'\s\\]*)/g, 40]];
    let titleHint = '';

    // X/Twitter only streams in pieces (HLS) to its own player. Twitter's
    // public embed service still lists the ordinary MP4 files (with sound).
    async function xVideos(id) {
      if (!id) return [];
      const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
      for (const t of [token, 'x']) {
        try {
          const r = await api.request({ url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${t}`, headers: { Accept: 'application/json' }, timeout: 12000 });
          if (r.status !== 200) continue;
          const data = JSON.parse(r.text);
          if (data.text) titleHint = data.text;
          const media = [data.video].concat((data.mediaDetails || []).map((m) => m.video_info && { variants: m.video_info.variants.map((v) => ({ src: v.url, type: v.content_type, bitrate: v.bitrate })) }));
          const out = [];
          for (const m of media) {
            for (const v of (m && m.variants) || []) {
              const src = v.src || v.url;
              if (!/^https?:/.test(src || '') || /\.m3u8(\?|$)/.test(src) || (v.type && !/mp4/.test(v.type))) continue;
              const dim = src.match(/\/(\d{2,4})x(\d{2,4})\//);
              const height = dim ? Math.min(+dim[1], +dim[2]) : 0;
              if (!out.some((o) => o.url === src)) out.push({ url: src, height, score: 100 + height / 10, label: height ? height + 'p' : 'MP4' });
            }
          }
          if (out.length) return out.sort((a, b) => b.height - a.height);
        } catch (e) { api.log('x embed data failed', e && e.message); }
      }
      return [];
    }
    const statusId = (u) => (String(u || '').match(/\/status(?:es)?\/(\d{6,25})/) || [])[1] || null;

    // Every option for the video on screen: [{ label, sub, url | video+audio, size, height, audio }]
    async function siteOptions(ctx = {}) {
      const target = ctx.url || resolve();
      const url = typeof target === 'string' ? target : location.href;
      const v = ctx.video || onScreenVideo();
      const list = [];
      if (/(^|\.)(x|twitter)\.com$/.test(host)) {
        const vids = await xVideos(ctx.statusId || statusId(url));
        if (vids.length) return vids;
        fromMeta(list); fromVideoTag(list, v); fromText(list, pageData(), TW, 20);
        fromNetwork(list, /video\.twimg\.com\/(ext_tw_video|amplify_video|tweet_video)\//);
      } else if (/(^|\.)tiktok\.com$/.test(host)) {
        fromVideoTag(list, v, 100);
        const raw = Array.from(document.querySelectorAll('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE, script#__NEXT_DATA__'), (s) => s.textContent).join('\n');
        const id = (url.match(/\/video\/(\d+)/) || [])[1];
        const scope = (id && near(raw, '"' + id + '"', 40000)) || raw;
        ['playAddr', 'play_addr', 'downloadAddr', 'download_addr'].forEach((k, i) => {
          const m = scope.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]+)"'));
          if (m) add(list, m[1], 95 - i * 3);
        });
        const desc = scope.match(/"desc"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (desc) { try { titleHint = JSON.parse('"' + desc[1] + '"'); } catch (_) { titleHint = desc[1]; } }
        fromMeta(list);
        fromNetwork(list, /(tiktokcdn|tiktok\.com\/video|akamaized\.net)/);
      } else if (/(^|\.)instagram\.com$/.test(host)) {
        fromVideoTag(list, v, 100);
        const code = (url.match(/\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[2];
        const data = pageData();
        fromText(list, (code && near(data, code)) || (/^\/(p|reel|reels|tv)\//.test(location.pathname) ? data : ''), IG, 30);
        fromMeta(list);
        if (!list.length && code) {
          const kind = /\/reels?\//.test(url) ? 'reel' : 'p';
          for (const u of [`/${kind}/${code}/embed/captioned/`, `/${kind}/${code}/embed/`]) {
            try { fromText(list, await fetchText(u), IG, 30); } catch (_) { /* try the next */ }
            if (list.length) break;
          }
        }
      } else if (/(^|\.)facebook\.com$/.test(host)) {
        if (v && (v.videoWidth || 0) >= 480) fromVideoTag(list, v, 120);
        const id = (url.match(/(?:v=|\/videos\/|\/reel\/|\/reels\/)(\d+)/) || [])[1];
        fromText(list, pageData(), FB, 30, id ? '"' + id + '"' : null);
        fromMeta(list);
        if (!list.length && id) {
          for (const u of [`/video/embed?video_id=${id}`, `https://m.facebook.com/video/embed?video_id=${id}`]) {
            try { fromText(list, await fetchText(u), FB, 30); } catch (_) { /* try the next */ }
            if (list.length) break;
          }
        }
      } else {
        // Threads, Pinterest, Snapchat, TED, Douyin, Xiaohongshu…
        fromVideoTag(list, v, 100);
        fromMeta(list);
        fromNetwork(list);
      }
      const b = best(list);
      return b ? [b] : [];
    }

    // ---- YouTube: ask YouTube's app API for the files. App clients get
    // plain links (the website's own links are scrambled). Up to 360p
    // comes as one file; HD comes as picture + sound, joined here.
    //
    // YouTube's servers sometimes refuse (HTTP 403) links that were made
    // for another app or network path. The links the page's own player is
    // streaming right now are accepted by definition, so those are tried
    // first, then every app client in turn.
    const YT_CLIENTS = [
      { name: 'ANDROID_VR', id: 28, version: '1.65.10', extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L', androidSdkVersion: 32 } },
      { name: 'ANDROID_VR', id: 28, version: '1.62.27', extra: { deviceMake: 'Oculus', deviceModel: 'Quest 3', osName: 'Android', osVersion: '12L', androidSdkVersion: 32 } },
      { name: 'IOS', id: 5, version: '20.10.4', extra: { deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' } }
    ];
    const ITAG_HEIGHT = { 160: 144, 133: 240, 134: 360, 135: 480, 136: 720, 137: 1080, 298: 720, 299: 1080 };
    const ITAG_FPS = { 298: 60, 299: 60 };
    const ITAG_MUXED = { 18: 360, 22: 720 };
    const ITAG_AUDIO = { 139: 48, 140: 128, 141: 256 };
    const pageValue = (key) => {
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const m = sc.textContent.match(new RegExp('"' + key + '":"([^"]+)"'));
        if (m) return m[1];
      }
      return '';
    };

    // The page player's stream links (from the browser's list of loaded
    // files). Only plain byte-range links are usable; "SABR"/UMP streams
    // are a YouTube-specific protocol.
    const playerLinks = new Map(); // itag -> { base, clen, dur, at }
    let navAt = 0;
    if (isYT) {
      const take = (name, at) => {
        if (at < navAt || !/\.googlevideo\.com\/videoplayback/.test(name)) return;
        let u;
        try { u = new URL(name); } catch (_) { return; }
        const q = u.searchParams;
        const itag = q.get('itag');
        const clen = Number(q.get('clen'));
        if (!itag || !clen || q.has('sabr') || q.get('ump') === '1') return;
        for (const k of ['range', 'rn', 'rbuf']) q.delete(k);
        playerLinks.set(itag, { base: u.href, clen, dur: Number(q.get('dur')) || 0, at });
      };
      try { if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(1500); } catch (_) { /* optional */ }
      try {
        new PerformanceObserver((list) => { for (const e of list.getEntries()) take(e.name, e.startTime); }).observe({ type: 'resource', buffered: true });
      } catch (_) {
        // Older Safari: read the list when the button is tapped instead.
        self.readLinks = () => { try { for (const e of performance.getEntriesByType('resource')) take(e.name, e.startTime); } catch (_) { /* none */ } };
      }
      api.onUrlChange(() => { navAt = performance.now(); playerLinks.clear(); });
    }
    function pagePlayerLinks(expected) {
      if (self.readLinks) self.readLinks();
      const all = Array.from(playerLinks, ([itag, l]) => Object.assign({ itag: Number(itag) }, l));
      // Ads stream from the same servers: keep the links whose length
      // matches the video (or the longest, when the length is unknown).
      const longest = Math.max(0, ...all.map((l) => l.dur));
      return all.filter((l) => (expected ? Math.abs(l.dur - expected) < 2 : l.dur === longest));
    }

    async function youtubeOptions(videoId, report) {
      const responses = [];
      const visitor = pageValue('VISITOR_DATA');
      for (const c of YT_CLIENTS) {
        if (responses.some((r) => r.via === c.name)) continue; // one version per client is enough
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
          const j = r.ok ? await r.json() : null;
          const sd = (j && j.streamingData) || {};
          const links = (sd.formats || []).concat(sd.adaptiveFormats || []).filter((f) => f.url).length;
          report.push(`${c.name} ${c.version}: HTTP ${r.status}, ${(j && j.playabilityStatus && j.playabilityStatus.status) || '?'}, ${links} links`);
          if (links) responses.push({ via: c.name, resp: j });
          else if (j && j.videoDetails) responses.push({ via: c.name, resp: { videoDetails: j.videoDetails } });
        } catch (e) { report.push(`${c.name} ${c.version}: ${e && e.message}`); }
      }
      // Fresh page load: the website's own player data sometimes has plain links.
      for (const sc of document.querySelectorAll('script:not([src])')) {
        const i = sc.textContent.indexOf('ytInitialPlayerResponse = ');
        if (i === -1) continue;
        try {
          const resp = JSON.parse(sc.textContent.slice(i + 26).replace(/;\s*(var |<\/script|$)[\s\S]*/, ''));
          if (resp.videoDetails && resp.videoDetails.videoId === videoId) responses.push({ via: 'page', resp });
        } catch (_) { /* not parseable */ }
      }
      const details = (responses.find((r) => r.resp.videoDetails && r.resp.videoDetails.title) || { resp: { videoDetails: {} } }).resp.videoDetails;
      if (details.title) titleHint = details.title;
      const expected = Number(details.lengthSeconds) || 0;

      // Every source, grouped by what it is: picture at a height, sound, or both.
      const size = (f) => Number(f.contentLength) || 0;
      const pics = []; // { via, url, size, height, fps, bitrate }
      const sounds = []; // { via, url, size, bitrate }
      const muxed = []; // { via, url, size, height }
      const player = pagePlayerLinks(expected);
      for (const l of player) {
        if (ITAG_HEIGHT[l.itag]) pics.push({ via: 'player', url: l.base, size: l.clen, height: ITAG_HEIGHT[l.itag], fps: ITAG_FPS[l.itag] || 30, bitrate: 0, itag: l.itag });
        else if (ITAG_AUDIO[l.itag]) sounds.push({ via: 'player', url: l.base, size: l.clen, bitrate: ITAG_AUDIO[l.itag] * 1000 });
        else if (ITAG_MUXED[l.itag]) muxed.push({ via: 'player', url: l.base, size: l.clen, height: ITAG_MUXED[l.itag] });
      }
      report.push(`player: ${player.length ? player.map((l) => l.itag).join(', ') : 'no stream links yet'}`);
      for (const { via, resp } of responses) {
        const sd = resp.streamingData || {};
        for (const f of sd.formats || []) if (f.url && /^video\/mp4/.test(f.mimeType || '')) muxed.push({ via, url: f.url, size: size(f), height: f.height || 360 });
        for (const f of sd.adaptiveFormats || []) {
          if (!f.url) continue;
          // H.264 only: the iPhone's Photos app cannot store VP9/AV1.
          if (/^video\/mp4/.test(f.mimeType || '') && /avc1/.test(f.mimeType)) pics.push({ via, url: f.url, size: size(f), height: f.height, fps: f.fps || 30, bitrate: f.bitrate || 0, itag: f.itag });
          else if (/^audio\/mp4/.test(f.mimeType || '') && /mp4a/.test(f.mimeType) && (!f.audioTrack || f.audioTrack.audioIsDefault !== false)) sounds.push({ via, url: f.url, size: size(f), bitrate: f.bitrate || 0 });
        }
      }
      // Player first (known to work), then the clients in the order asked.
      const rank = (via) => (via === 'player' ? 0 : via === 'page' ? 9 : 1 + YT_CLIENTS.findIndex((c) => c.name === via));
      const bySource = (a, b) => rank(a.via) - rank(b.via) || (b.bitrate || 0) - (a.bitrate || 0);
      sounds.sort(bySource);
      const soundFor = (via) => sounds.find((s) => s.via === via) || sounds[0];

      const maxH = Number(cfg.maxHeight) || 1080;
      const opts = [];
      if (sounds.length) {
        const heights = Array.from(new Set(pics.map((p) => p.height))).filter((h) => h && h <= maxH).sort((a, b) => b - a);
        for (const h of heights) {
          if (h <= 360 && muxed.some((m) => m.height >= h)) continue; // the one-file version is quicker
          // Same height: prefer 30 fps over 60 (half the size) unless asked.
          const fpsOk = (p) => (cfg.prefer60 ? p.fps >= 50 : p.fps <= 30);
          const at = pics.filter((p) => p.height === h);
          const chosen = (at.some(fpsOk) ? at.filter(fpsOk) : at).sort(bySource);
          const sources = chosen.map((p) => ({ via: p.via, video: p, audio: soundFor(p.via) }));
          const fps = chosen[0].fps;
          opts.push({ height: h, fps, sources, size: chosen[0].size + soundFor(chosen[0].via).size });
        }
      }
      const heightsMuxed = Array.from(new Set(muxed.map((m) => m.height))).sort((a, b) => b - a);
      for (const h of heightsMuxed) {
        if (opts.some((o) => o.height === h)) continue;
        const sources = muxed.filter((m) => m.height === h).sort(bySource).map((m) => ({ via: m.via, url: m.url, size: m.size }));
        opts.push({ height: h, single: true, sources, size: sources[0].size });
      }
      opts.sort((a, b) => b.height - a.height);
      for (const o of opts) {
        o.label = `${o.height}p${o.fps > 30 ? o.fps : ''} video`;
        o.sub = [o.size ? `${(o.size / MB).toFixed(o.size < 10 * MB ? 1 : 0)} MB` : '', o.single ? 'one file' : ''].filter(Boolean).join(' · ');
      }
      if (sounds.length) {
        opts.push({ audioOnly: true, sources: sounds.map((s) => ({ via: s.via, url: s.url, size: s.size })), size: sounds[0].size,
          label: 'Sound only (M4A)', sub: sounds[0].size ? `${(sounds[0].size / MB).toFixed(1)} MB` : '' });
      }
      if (cfg.thumbnail) opts.push({ thumb: videoId, label: 'Thumbnail (JPG)', sub: 'picture', sources: [{ via: 'i.ytimg.com' }] });
      return opts;
    }

    // ------------------------------------------------------------------
    // Downloading
    // ------------------------------------------------------------------
    // Page fetch first (googlevideo allows YouTube's origin; most CDNs allow
    // any), then GM.xmlHttpRequest, which is not limited by CORS and takes
    // a different path (some servers refuse one and accept the other).
    async function getBytes(url) {
      let first = 0;
      try {
        const r = await fetch(url, { credentials: 'omit' });
        if (r.ok) return await r.blob();
        first = r.status;
      } catch (_) { /* CORS or network: try the manager */ }
      let r;
      try { r = await api.request({ url, responseType: 'blob', timeout: 180000 }); } catch (e) {
        if (first) throw Object.assign(new Error('HTTP ' + first), { fatal: first === 403 || first === 404 || first === 410 });
        throw e;
      }
      if (r.status >= 200 && r.status < 300 && r.response) return r.response instanceof Blob ? r.response : new Blob([r.response]);
      const status = first || r.status;
      throw Object.assign(new Error('HTTP ' + status), { fatal: status === 403 || status === 404 || status === 410 });
    }
    // googlevideo serves whole files slowly; 5 MB ranges, 3 at a time.
    async function downloadRanged(url, size, onProgress) {
      const CHUNK = 5 * MB;
      const parts = [];
      const ranges = [];
      for (let start = 0; start < size; start += CHUNK) ranges.push([start, Math.min(size, start + CHUNK) - 1]);
      let next = 0;
      let done = 0;
      let failed = false;
      const worker = async () => {
        while (next < ranges.length && !failed) {
          const i = next++;
          const [a, b] = ranges[i];
          const sep = url.includes('?') ? '&' : '?';
          let blob = null;
          for (let attempt = 0; attempt < 3 && !blob && !failed; attempt++) {
            try { blob = await getBytes(`${url}${sep}range=${a}-${b}`); } catch (e) { if (e.fatal || attempt === 2) { failed = true; throw e; } }
          }
          if (!blob) return;
          parts[i] = blob;
          done += blob.size;
          onProgress(done);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return new Blob(parts, { type: 'video/mp4' });
    }

    function titleFor() {
      const generic = /^(facebook|instagram|watch|reels?|video|tiktok|twitter|x|youtube|log ?in|sign ?in)$/i;
      const tidy = (raw) => String(raw || '')
        .replace(/[​-‏‪-‮﻿�]/g, '')
        .replace(/^.+?\bon (Instagram|Facebook|TikTok|YouTube|X)\s*[:：]\s*/i, '')
        .replace(/\s*[|•\-–]\s*(Facebook|Instagram|Watch|Reels?|TikTok|YouTube|X)\s*$/i, '')
        .replace(/\s+on\s+(TikTok|Instagram|Facebook|YouTube|X)\s*$/i, '')
        .replace(/https?:\/\/\S+/g, '').replace(/^\(\d+\)\s*/, '').replace(/\s+/g, ' ').trim();
      const v = onScreenVideo();
      const art = v && v.closest('article');
      const caption = art && art.querySelector('h1, h2, [dir="auto"]');
      const og = document.querySelector('meta[property="og:title"]');
      for (const c of [titleHint, caption && caption.textContent, og && og.content, document.title.replace(/ - YouTube$/, '')]) {
        const t = tidy(c);
        if (t.length >= 3 && !generic.test(t)) return t;
      }
      return host.split('.').slice(-2, -1)[0] + ' video';
    }

    let saving = null; // the download that is running or ready
    let lastReport = [];
    // What went wrong, for a bug report. No addresses, tokens or cookies:
    // links are reduced to their host and a few harmless parameters.
    const redact = (u) => {
      try {
        const x = new URL(u);
        const keep = ['itag', 'c', 'mime', 'clen'].filter((k) => x.searchParams.has(k)).map((k) => `${k}=${x.searchParams.get(k)}`);
        return `${x.hostname.replace(/^rr\d+---sn-[a-z0-9-]+\./, 'rr*.')}${x.pathname}${keep.length ? ' ' + keep.join(' ') : ''}${x.searchParams.has('pot') ? ' +pot' : ''}`;
      } catch (_) { return '?'; }
    };
    function copyReport(report) {
      const gm = (typeof GM === 'object' && GM && GM.info) || {};
      const ios = (navigator.userAgent.match(/OS (\d+[._]\d+)/) || [])[1];
      const text = [`Video downloader ${api.version} (suite ${api.suiteVersion}) on ${host}`,
        `iOS ${ios ? ios.replace('_', '.') : '?'} · ${gm.scriptHandler || 'unknown manager'} ${gm.version || ''}`, ...report].join('\n');
      api.copy(text).then((ok) => api.toast(ok ? 'Details copied. Paste them into a message or issue.' : text, { timeout: 5000 }));
    }

    async function save(ctx = {}) {
      const key = ctx.key || location.href;
      if (saving && saving.key === key) {
        if (saving.blob) return shareFile(saving.blob, saving.name);
        return api.toast('Still downloading…', { timeout: 1500 });
      }
      const job = { key, blob: null, name: '' };
      saving = job;
      titleHint = '';
      const report = [];
      lastReport = report;
      const progress = api.toast('Looking for the video…', { timeout: 0 });
      const setText = (t) => progress && progress.update && progress.update(t);
      const fail = (why, hint) => {
        if (saving === job) saving = null;
        progress && progress.close();
        report.push('result: ' + (why || 'failed'));
        const more = async () => {
          if (!api.choose) return save(ctx);
          const what = await api.choose({ title: 'Download failed', note: why || '', items: [
            { label: 'Try again', value: 'retry' },
            { label: 'Copy error details', sub: 'for a bug report', value: 'copy' },
            cfg.siteFallback ? { label: 'Open downloader website', sub: 'tool77.com', value: 'site' } : null
          ].filter(Boolean) });
          if (what === 'retry') save(ctx);
          else if (what === 'copy') copyReport(report);
          else if (what === 'site') openWebsite();
        };
        api.toast(`Couldn't save this video${why ? ` (${why})` : ''}.${hint ? '\n' + hint : ''}`, { timeout: 12000, action: 'Options', onAction: more });
      };
      try {
        const id = isYT ? ytId() : null;
        const opts = id ? await youtubeOptions(id, report) : await siteOptions(ctx);
        for (const o of opts) if (!o.sources) o.sources = [{ via: host, url: o.url, size: 0 }];
        if (saving !== job) return;
        if (!opts.length || opts.every((o) => o.thumb)) {
          const v = ctx.video || onScreenVideo();
          return fail(id ? 'YouTube did not offer a downloadable file' : v && /^blob:/.test(v.currentSrc || v.src || '') ? 'this site streams video in pieces' : 'no video file found',
            id ? 'Play the video for a few seconds, then tap download again.' : '');
        }
        // Pick: ask when there is a real choice, unless a quality is set.
        let pick = null;
        const videos = opts.filter((o) => !o.audioOnly && !o.thumb);
        const pref = isYTMusic && cfg.quality === 'ask' ? 'audio' : cfg.quality;
        if (pref === 'audio') pick = opts.find((o) => o.audioOnly) || null;
        else if (pref !== 'ask' && pref !== 'best') pick = videos.find((o) => !o.height || o.height <= Number(pref)) || videos[videos.length - 1];
        else if (pref === 'best' || opts.filter((o) => !o.thumb).length === 1 || !api.choose) pick = videos[0] || opts[0];
        if (!pick) {
          setText('Choose a quality…');
          pick = await api.choose({ title: 'Save video', note: titleFor(), items: opts.map((o) => ({ label: o.label || 'Video', sub: o.sub || '', value: o })) });
          if (!pick) { if (saving === job) saving = null; progress && progress.close(); return; }
        }
        const total = pick.size || 0;
        if (total > Number(cfg.warnMB || 600) * MB && !confirm(`This video is ${(total / MB).toFixed(0)} MB. Saving it needs about that much memory. Continue?`)) {
          if (saving === job) saving = null;
          progress && progress.close();
          return;
        }
        const pct = (n) => (total ? ` ${Math.min(99, Math.floor((n / total) * 100))}%` : '');
        const label = pick.thumb ? 'thumbnail' : pick.height ? `${pick.height}p` : pick.audioOnly ? 'sound' : '';
        const fetchOne = (url, size, offset) => (size ? downloadRanged(url, size, (n) => setText(`Downloading ${label}…${pct(offset + n)}`)) : getBytes(url));
        let ext = pick.thumb ? 'jpg' : pick.audioOnly ? 'm4a' : 'mp4';
        // One source after the other until one works.
        const fromSource = async (src) => {
          if (pick.thumb) {
            for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
              const b = await getBytes(`https://i.ytimg.com/vi/${pick.thumb}/${q}.jpg`).catch(() => null);
              if (b && b.size > 5000) return new Blob([b], { type: 'image/jpeg' }); // 120x90 grey = missing
            }
            throw new Error('no thumbnail');
          }
          if (src.video) {
            const vBlob = await fetchOne(src.video.url, src.video.size, 0);
            const aBlob = await fetchOne(src.audio.url, src.audio.size, src.video.size || vBlob.size);
            if (saving !== job) return null;
            setText('Joining picture and sound…');
            const joined = self.mp4.join([new Uint8Array(await vBlob.arrayBuffer()), new Uint8Array(await aBlob.arrayBuffer())]);
            return new Blob(joined.parts, { type: 'video/mp4' });
          }
          const b = await fetchOne(src.url, isYT ? src.size : 0, 0);
          // YouTube's sound files are streaming fragments; re-pack them as an
          // ordinary .m4a so Files, Music apps and editors open it.
          if (pick.audioOnly) { try { return new Blob(self.mp4.join([new Uint8Array(await b.arrayBuffer())]).parts, { type: 'audio/mp4' }); } catch (_) { return b; } }
          return b;
        };
        let blob = null;
        let lastError = null;
        for (const src of pick.sources) {
          if (saving !== job) return;
          setText(`Downloading ${label}…${pct(0)}`);
          try {
            blob = await fromSource(src);
            report.push(`${label} via ${src.via}: ok`);
            break;
          } catch (e) {
            lastError = e;
            const link = src.video ? src.video.url : src.url;
            report.push(`${label} via ${src.via}: ${e && e.message}${link ? ' · ' + redact(link) : ''}`);
          }
        }
        if (saving !== job) return; // navigated away or restarted
        if (!blob) {
          const refused = lastError && /HTTP 403/.test(lastError.message);
          const triedPlayer = pick.sources.some((s) => s.via === 'player');
          return fail(lastError ? lastError.message : '', refused && isYT && !triedPlayer ? 'Play the video for a few seconds, then tap download again.' : '');
        }
        if (blob.size < 1000) return fail('the file was empty');
        job.blob = blob;
        job.name = sanitize(titleFor()) + '.' + ext;
        progress && progress.close();
        // A fresh tap is required before iOS shows the share sheet.
        const where = ext === 'm4a' ? 'Save to Files' : ext === 'jpg' ? 'Save Image' : 'Save Video';
        api.toast(`Ready: ${(blob.size / MB).toFixed(1)} MB.\nTap Save, then "${where}".`, {
          timeout: 120000, action: 'Save', onAction: () => shareFile(job.blob, job.name)
        });
      } catch (e) {
        api.log('save failed', e);
        fail(e && e.message);
      }
    }

    const act = (ctx) => {
      if (cfg.mode === 'service') return openWebsite();
      const target = resolve();
      if (target && typeof target === 'object') return openWebsite(); // Spotify (website only)
      return save(ctx);
    };
    const copyLink = () => {
      const t = resolve();
      const url = t && typeof t === 'object' ? t.direct : t;
      if (url) api.copy(url).then((ok) => api.toast(ok ? 'Video link copied' : url));
    };

    // ---- YouTube: a download pill in the action bar, left of the like
    // button (m.youtube.com and the desktop site). Shorts keep the floating
    // button because their buttons are a vertical column on the video.
    const isYouTubeWatch = () => /(^|\.)(m|www)\.youtube\.com$/.test(host) && location.pathname === '/watch';
    // In the Aero look the button is a glossy blue orb/pill of its own and
    // only takes its shape and height from the like button. The like button
    // is measured once per button (and again if YouTube swaps it), not on
    // every page change.
    const glossy = api.aeroCss ? api.aeroCss('.ioss-yt-dl') : '';
    const matched = new WeakMap();
    function matchNative(btn, like) {
      const native = like.querySelector('button') || like;
      const seen = matched.get(btn);
      if (seen && seen.native === native && Date.now() - seen.at < 5000) return;
      const st = getComputedStyle(native);
      const iconOnly = /^(transparent|rgba\(0, 0, 0, 0\))$/.test(st.backgroundColor);
      btn.classList.toggle('ioss-yt-dl-icon', iconOnly);
      if (!glossy) {
        btn.style.setProperty('color', st.color, 'important');
        btn.style.setProperty('background', iconOnly ? 'transparent' : st.backgroundColor, 'important');
      }
      const h = Math.round(native.getBoundingClientRect().height);
      if (h >= 28 && h <= 64) {
        // The orb is capped at 44pt (Apple's tap size) so its rim and glow
        // do not touch the neighbouring 48pt icon buttons.
        const size = glossy && iconOnly ? Math.min(h, 44) : h;
        btn.style.setProperty('height', size + 'px', 'important');
        if (glossy && iconOnly) btn.style.setProperty('width', size + 'px', 'important');
        matched.set(btn, { native, at: Date.now() });
      }
    }
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
        pressTimer = setTimeout(() => { pressTimer = -1; copyLink(); }, 600);
      }, { passive: true });
      btn.addEventListener('touchend', (e) => { if (pressTimer === -1) e.preventDefault(); clearTimeout(pressTimer); pressTimer = 0; });
      btn.addEventListener('touchmove', () => { clearTimeout(pressTimer); pressTimer = 0; }, { passive: true });
      row.insertBefore(btn, slot);
      matchNative(btn, like);
      return btn;
    };
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
      ` + glossy + (glossy ? '.ioss-yt-dl.ioss-yt-dl-icon { margin: 0 5px !important; } .ioss-yt-dl.ioss-yt-dl-icon svg { width: 22px; height: 22px; }' : ''), 'ioss-yt-dl-css');
      inlineYouTube();
      api.observe(document.body, { childList: true, subtree: true }, inlineYouTube, { throttle: 400 });
      api.onUrlChange(() => setTimeout(inlineYouTube, 300));
    }

    if (cfg.fab) {
      const button = api.fab({ title: 'Download video', path: DL_PATH, onTap: () => act(), onLongPress: cfg.copyOnLongPress ? copyLink : null });
      // Show the button only where there is something to download.
      const refresh = () => {
        const hasVideo = !!document.querySelector('video');
        const t = resolve();
        const inline = isYouTubeWatch() && document.querySelector('.ioss-yt-dl');
        if (!inline && (t || (hasVideo && !isYT))) button.show(); else button.hide();
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
        .ioss-x-dl:active{color:rgb(29,155,240)} .ioss-x-dl svg{width:20px;height:20px}` +
        (api.aeroCss && api.aeroCss('.ioss-x-dl') ? api.aeroCss('.ioss-x-dl') + '.ioss-x-dl{min-width:34px;min-height:34px;width:34px;height:34px;border-radius:50%!important;align-self:center} .ioss-x-dl svg{width:18px;height:18px}' : ''));
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
            onclick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (cfg.mode === 'service') return openService('https://x.com/_/status/' + id);
              save({ key: 'x:' + id, statusId: id, url: 'https://x.com/_/status/' + id, video: art.querySelector('video') });
            } }, [api.icon(SVG, 20)]));
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
            const url = post ? abs(post.getAttribute('href')) : location.href;
            if (cfg.mode === 'service') return openService(url);
            save({ key: 'threads:' + url, url, video: c.querySelector('video') });
          });
          share.insertAdjacentElement('afterend', b);
        }
      };
      scan();
      api.observe(document.body, { childList: true, subtree: true }, scan, { throttle: 500 });
    }
  }
})
