/* ClearTube — a home-screen video app for iPhone.
 *
 * Runs as a standalone web app (no Safari bar) and brings the suite's
 * YouTube features with it, because they are part of the app instead of an
 * extension: SponsorBlock skipping, dislike counts, resume, local
 * subscriptions, history and Watch later. Playback uses YouTube's official
 * embedded player; search and channel data use the YouTube Data API with the
 * user's own free API key. Everything is stored on the device.
 */
'use strict';

const APP_VERSION = '1.0.0';
const API = 'https://www.googleapis.com/youtube/v3/';
const EMBED_HOST = 'https://www.youtube-nocookie.com';
const SB_API = 'https://sponsor.ajay.app/api/skipSegments/';
const RYD_API = 'https://returnyoutubedislikeapi.com/votes?videoId=';

/* ------------------------------------------------------------ utilities */

const $ = (sel, root = document) => root.querySelector(sel);

// Small DOM builder; never uses innerHTML for data.
function h(tag, props, ...children) {
  const el = tag === 'svg' || tag === 'path' ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else if (k in el && tag !== 'svg' && tag !== 'path' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}
const icon = (d) => h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, h('path', { d }));
const ICONS = {
  like: 'M2 21h4V9H2zm20-11a2 2 0 0 0-2-2h-6.3l1-4.6v-.3c0-.4-.2-.8-.4-1.1L13.2 1 6.6 7.6C6.2 8 6 8.5 6 9v10a2 2 0 0 0 2 2h9c.8 0 1.5-.5 1.8-1.2l3-7.1.2-.7z',
  dislike: 'M22 3h-4v12h4zM2 14a2 2 0 0 0 2 2h6.3l-1 4.6v.3c0 .4.2.8.4 1.1l1.1 1 6.6-6.6c.4-.4.6-.9.6-1.4V5a2 2 0 0 0-2-2H7c-.8 0-1.5.5-1.8 1.2l-3 7.1L2 12z',
  later: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.2 14.2L11 13V7h1.5v5.2l4.5 2.7z',
  share: 'M18 16c-.8 0-1.5.3-2 .8l-7.1-4.2c.1-.2.1-.4.1-.6s0-.4-.1-.6L16 7.2c.5.5 1.2.8 2 .8a3 3 0 1 0-3-3v.6L7.9 9.8A3 3 0 1 0 6 15c.8 0 1.5-.3 2-.8l7.1 4.2-.1.6a3 3 0 1 0 3-3z',
  open: 'M14 3v2h3.6l-9.8 9.8 1.4 1.4L19 6.4V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2v-7h-2z',
  download: 'M5 20h14v-2H5zm7-3 6-6-1.4-1.4-3.6 3.6V4h-2v9.2L7.4 9.6 6 11z',
  pip: 'M19 7h-8v6h8zm2-4H3a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H3V5h18z',
  sub: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z'
};

const store = {
  get(k, d) { try { const v = localStorage.getItem('ct:' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('ct:' + k, JSON.stringify(v)); } catch (_) { toast('Storage is full: clear history in Settings.'); } }
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  sb: { sponsor: true, selfpromo: true, interaction: true, intro: false, outro: false, preview: false, music_offtopic: true, filler: false },
  sbToasts: true,
  ryd: true,
  resume: true,
  hideShorts: false,
  feedHours: 0.5
};
const settings = Object.assign({}, DEFAULT_SETTINGS, store.get('settings', {}));
settings.sb = Object.assign({}, DEFAULT_SETTINGS.sb, settings.sb || {});
const saveSettings = () => store.set('settings', settings);

let subs = store.get('subs', []); // [{ id, title, thumb, uploads }]
let watched = store.get('history', []); // [{ id, title, channel, channelId, pos, dur, at }]
let later = store.get('later', []); // [{ id, title, channel, channelId, dur }]
const saveSubs = () => store.set('subs', subs);
const saveHistory = () => store.set('history', watched.slice(0, 500));
const saveLater = () => store.set('later', later);

const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = (n) => (n == null || isNaN(n) ? '' : nf.format(Number(n)));
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function ago(date) {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), u);
  return rtf.format(Math.round(s), 'second');
}
function isoDuration(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
function clock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const hh = Math.floor(sec / 3600);
  const mm = Math.floor((sec % 3600) / 60);
  const ss = String(sec % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
const thumbUrl = (id, q = 'mqdefault') => `https://i.ytimg.com/vi/${id}/${q}.jpg`;
const VIDEO_ID_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
function parseVideoId(text) {
  const t = String(text || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  const m = t.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

let toastTimer = 0;
function toast(msg, { action, onAction, timeout = 3500 } = {}) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = h('div', { class: 'toast', role: 'status' }, h('span', { text: msg }),
    action ? h('button', { type: 'button', text: action, onclick: () => { t.remove(); onAction && onAction(); } }) : null);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, timeout);
}

/* ------------------------------------------------------------ data API */

class NeedKeyError extends Error {}
class ApiError extends Error {
  constructor(reason, message) { super(message || reason); this.reason = reason; }
}

// Rough daily quota tracking (YouTube gives 10,000 units/day per key).
function addQuota(units) {
  const day = new Date().toISOString().slice(0, 10);
  const q = store.get('quota', { day, used: 0 });
  if (q.day !== day) { q.day = day; q.used = 0; }
  q.used += units;
  store.set('quota', q);
}

async function api(endpoint, params) {
  if (!settings.apiKey) throw new NeedKeyError('An API key is needed for this.');
  const u = new URL(API + endpoint);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  u.searchParams.set('key', settings.apiKey);
  const r = await fetch(u.href);
  const j = await r.json().catch(() => ({}));
  addQuota(endpoint === 'search' ? 100 : 1);
  if (!r.ok) {
    const reason = (j.error && j.error.errors && j.error.errors[0] && j.error.errors[0].reason) || String(r.status);
    throw new ApiError(reason, j.error && j.error.message);
  }
  return j;
}

// Cache API results in localStorage to save quota.
async function cached(key, ttlMs, fn) {
  const c = store.get('cache:' + key);
  if (c && Date.now() - c.at < ttlMs) return c.v;
  const v = await fn();
  store.set('cache:' + key, { at: Date.now(), v });
  return v;
}

const detailCache = new Map(Object.entries(store.get('details', {})));
function rememberDetails() {
  // Keep the newest 400 entries, without descriptions (they can be long).
  const entries = Array.from(detailCache.entries()).slice(-400).map(([k, v]) => [k, Object.assign({}, v, { description: undefined })]);
  store.set('details', Object.fromEntries(entries));
}
async function videoDetails(ids, { fresh = false } = {}) {
  const need = ids.filter((id) => fresh || !detailCache.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const j = await api('videos', { part: 'snippet,contentDetails,statistics', id: need.slice(i, i + 50).join(','), maxResults: 50 });
    for (const it of j.items || []) {
      detailCache.set(it.id, {
        id: it.id, title: it.snippet.title, channel: it.snippet.channelTitle, channelId: it.snippet.channelId,
        published: it.snippet.publishedAt, description: it.snippet.description, dur: isoDuration(it.contentDetails.duration),
        live: it.snippet.liveBroadcastContent !== 'none', views: it.statistics.viewCount, likes: it.statistics.likeCount,
        comments: it.statistics.commentCount
      });
    }
  }
  if (need.length) rememberDetails();
  return ids.map((id) => detailCache.get(id)).filter(Boolean);
}

async function channelInfo(idOrHandle) {
  const params = { part: 'snippet,statistics,contentDetails' };
  if (/^UC[\w-]{22}$/.test(idOrHandle)) params.id = idOrHandle;
  else params.forHandle = idOrHandle.startsWith('@') ? idOrHandle : '@' + idOrHandle;
  return cached('chan:' + idOrHandle, 24 * 3600e3, async () => {
    const j = await api('channels', params);
    const it = (j.items || [])[0];
    if (!it) return null;
    return {
      id: it.id, title: it.snippet.title, handle: it.snippet.customUrl, thumb: (it.snippet.thumbnails.default || {}).url,
      subs: it.statistics.subscriberCount, videos: it.statistics.videoCount, uploads: it.contentDetails.relatedPlaylists.uploads,
      description: it.snippet.description
    };
  });
}

async function uploads(playlistId, pageToken) {
  const j = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: 25, pageToken });
  return { ids: (j.items || []).map((i) => i.contentDetails.videoId), next: j.nextPageToken };
}

/* ------------------------------------------------------------ helpers for views */

function explainError(e) {
  if (e instanceof NeedKeyError) return 'Add your free YouTube API key in Settings to use search, channels and subscriptions.';
  if (e && e.reason === 'quotaExceeded') return 'Today\'s API quota is used up. It resets at midnight Pacific time.';
  if (e && (e.reason === 'keyInvalid' || e.reason === 'badRequest')) return 'The API key was rejected. Check it in Settings.';
  if (e && e.reason === 'forbidden') return 'The API key is not allowed here. Check the key\'s website restriction.';
  return 'Something went wrong: ' + (e && e.message || e);
}
function errorView(e) {
  return h('div', { class: 'empty' }, h('h2', { text: 'Can\'t load this' }), h('p', { text: explainError(e) }),
    e instanceof NeedKeyError || (e && /key/i.test(e.reason || '')) ? h('a', { class: 'btn primary', href: '#/settings', text: 'Open Settings' }) : null);
}
const spinner = () => h('div', { class: 'spinner', 'aria-label': 'Loading' });

function progressOf(id) {
  const e = watched.find((x) => x.id === id);
  return e && e.dur ? Math.min(1, e.pos / e.dur) : 0;
}

function videoCard(v) {
  const p = progressOf(v.id);
  return h('a', { class: 'vcard', href: '#/watch/' + v.id },
    h('span', { class: 'thumb' }, h('img', { src: thumbUrl(v.id, 'hqdefault'), alt: '', loading: 'lazy', decoding: 'async' }),
      v.dur ? h('span', { class: 'dur', text: v.live ? 'LIVE' : clock(v.dur) }) : null,
      p > 0.02 ? h('span', { class: 'prog', style: { width: (p * 100).toFixed(1) + '%' } }) : null),
    h('div', { class: 'vmeta' },
      h('div', { style: { minWidth: '0' } },
        h('div', { class: 'vtitle', text: v.title }),
        h('div', { class: 'vsub', text: [v.channel, v.views ? fmtNum(v.views) + ' views' : '', v.published ? ago(v.published) : ''].filter(Boolean).join(' · ') }))));
}
function compactCard(v) {
  const p = progressOf(v.id);
  return h('a', { class: 'compact', href: '#/watch/' + v.id },
    h('span', { class: 'thumb' }, h('img', { src: thumbUrl(v.id), alt: '', loading: 'lazy', decoding: 'async' }),
      v.dur ? h('span', { class: 'dur', text: clock(v.dur) }) : null,
      p > 0.02 ? h('span', { class: 'prog', style: { width: (p * 100).toFixed(1) + '%' } }) : null),
    h('div', { style: { minWidth: '0' } }, h('div', { class: 'vtitle', text: v.title }),
      h('div', { class: 'vsub', text: [v.channel, v.views ? fmtNum(v.views) + ' views' : '', v.published ? ago(v.published) : ''].filter(Boolean).join(' · ') })));
}
const notShort = (v) => !settings.hideShorts || v.dur > 61 || v.live;

/* ------------------------------------------------------------ YouTube IFrame player */

let ytReady = null;
function loadPlayerApi() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = h('script', { src: 'https://www.youtube.com/iframe_api', async: true });
    s.onerror = () => { ytReady = null; reject(new Error('Could not load the YouTube player. Are you offline?')); };
    document.head.appendChild(s);
  });
  return ytReady;
}

/* ------------------------------------------------------------ SponsorBlock & dislikes */

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sponsorSegments(id) {
  const cats = Object.entries(settings.sb).filter(([, on]) => on).map(([c]) => c);
  if (!cats.length) return [];
  const prefix = (await sha256(id)).slice(0, 4);
  const r = await fetch(SB_API + prefix + '?categories=' + encodeURIComponent(JSON.stringify(cats)));
  if (r.status === 404) return [];
  if (!r.ok) throw new Error('SponsorBlock ' + r.status);
  const hit = (await r.json()).find((x) => x.videoID === id);
  const segs = ((hit && hit.segments) || []).filter((s) => !s.actionType || s.actionType === 'skip')
    .map((s) => ({ start: s.segment[0], end: s.segment[1], category: s.category })).sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push(Object.assign({}, s));
  }
  return merged;
}
async function dislikes(id) {
  const r = await fetch(RYD_API + id);
  if (!r.ok) throw new Error('RYD ' + r.status);
  return r.json();
}
const SB_SETTING_LABEL = { sponsor: 'Skip sponsors', selfpromo: 'Skip self-promotion', interaction: 'Skip "like & subscribe" reminders',
  intro: 'Skip intros', outro: 'Skip outros & end cards', preview: 'Skip previews & recaps', music_offtopic: 'Skip non-music parts in music videos',
  filler: 'Skip filler (aggressive)' };
const SB_LABEL = { sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'reminder', intro: 'intro', outro: 'outro', preview: 'preview',
  music_offtopic: 'non-music part', filler: 'filler' };

/* ------------------------------------------------------------ views */

const view = $('#view');
const titleEl = $('#title');
const backBtn = $('#back');
const refreshBtn = $('#refresh');
let cleanup = [];
let refreshHandler = null;
const scrollPos = new Map();

function setChrome({ title, back = false, tab, refresh = null }) {
  titleEl.textContent = title;
  backBtn.hidden = !back;
  refreshHandler = refresh;
  refreshBtn.hidden = !refresh;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === tab));
}
backBtn.addEventListener('click', () => { if (window.history.length > 1) window.history.back(); else location.hash = '#/'; });
refreshBtn.addEventListener('click', () => refreshHandler && refreshHandler());

// ---- Home: subscription feed
async function viewHome() {
  setChrome({ title: 'ClearTube', tab: 'home', refresh: () => renderFeed(true) });
  const box = h('div', { class: 'feed' });
  view.append(box);
  async function renderFeed(force) {
    box.replaceChildren(spinner());
    if (!subs.length) {
      box.replaceChildren(h('div', { class: 'empty' },
        h('h2', { text: 'Your feed is empty' }),
        h('p', { text: settings.apiKey ? 'Subscribe to channels (or import your YouTube subscriptions in Library) to see their new videos here.' : 'Paste a YouTube link into Search to watch it right away, or add your free API key in Settings for search, channels and a subscription feed.' }),
        h('div', { class: 'row', style: { justifyContent: 'center', flexWrap: 'wrap' } },
          h('a', { class: 'btn primary', href: settings.apiKey ? '#/library' : '#/settings', text: settings.apiKey ? 'Import subscriptions' : 'Add API key' }),
          h('a', { class: 'btn', href: '#/search', text: 'Search' }))));
      return;
    }
    try {
      const ttl = force ? 0 : settings.feedHours * 3600e3;
      const lists = await Promise.all(subs.map((s) => cached('up:' + s.id, ttl, () => uploads(s.uploads).then((r) => r.ids.slice(0, 15)))
        .catch(() => [])));
      const ids = Array.from(new Set(lists.flat()));
      const vids = (await videoDetails(ids)).filter(notShort).sort((a, b) => new Date(b.published) - new Date(a.published)).slice(0, 80);
      box.replaceChildren(...vids.map(videoCard));
      if (!vids.length) box.replaceChildren(h('div', { class: 'empty', text: 'No recent videos.' }));
    } catch (e) { box.replaceChildren(errorView(e)); }
  }
  await renderFeed(false);
}

// ---- Search
async function viewSearch(params) {
  const q = params.get('q') || '';
  setChrome({ title: 'Search', tab: 'search' });
  const input = h('input', { type: 'search', placeholder: 'Search or paste a YouTube link', value: q, enterkeyhint: 'search', autocapitalize: 'off', autocorrect: 'off' });
  const form = h('form', { class: 'pad row', onsubmit: (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const id = parseVideoId(text);
    if (id) { location.hash = '#/watch/' + id; return; }
    const ch = text.match(/youtube\.com\/(@[\w.-]+|channel\/(UC[\w-]{22}))/);
    if (ch) { location.hash = '#/channel/' + encodeURIComponent(ch[2] || ch[1]); return; }
    if (text) location.hash = '#/search?q=' + encodeURIComponent(text);
  } }, h('label', { class: 'searchbox' }, input), h('button', { class: 'btn', type: 'submit', text: 'Go' }));
  const results = h('div', { class: 'feed' });
  view.append(form, results);
  if (!q) {
    setTimeout(() => input.focus(), 50);
    results.append(h('p', { class: 'pad muted small', text: settings.apiKey ? 'Tip: paste a video or channel link to open it directly.' : 'Without an API key you can still paste video links here. Add a free key in Settings to search.' }));
    return;
  }
  results.append(spinner());
  try {
    const j = await cached('search:' + q, 3600e3, async () => {
      const r = await api('search', { part: 'snippet', q, type: 'video,channel', maxResults: 25, safeSearch: 'none' });
      return {
        channels: (r.items || []).filter((i) => i.id.kind === 'youtube#channel')
          .map((i) => ({ id: i.id.channelId, title: i.snippet.channelTitle, thumb: (i.snippet.thumbnails.default || {}).url })),
        ids: (r.items || []).filter((i) => i.id.kind === 'youtube#video').map((i) => i.id.videoId)
      };
    });
    const channels = j.channels;
    const ids = j.ids;
    const vids = (await videoDetails(ids)).filter(notShort);
    results.replaceChildren(
      ...channels.slice(0, 3).map((c) => h('a', { class: 'chan', href: '#/channel/' + c.id },
        h('img', { class: 'avatar', src: c.thumb, alt: '' }),
        h('div', {}, h('div', { class: 'vtitle', text: c.title }), h('div', { class: 'vsub', text: 'Channel' })))),
      ...vids.map(videoCard));
    if (!vids.length && !channels.length) results.replaceChildren(h('div', { class: 'empty', text: 'No results.' }));
  } catch (e) { results.replaceChildren(errorView(e)); }
}

// ---- Watch
async function viewWatch(id, params) {
  setChrome({ title: '', back: true, tab: null });

  const playerBox = h('div', { class: 'player' }, h('div', { id: 'ct-player' }));
  const titleBox = h('div', { class: 'wtitle', text: '' });
  const subLine = h('div', { class: 'pad small muted', style: { paddingTop: '0', paddingBottom: '0' } });
  const sbBar = h('div', { class: 'sbbar', hidden: true });
  const likeAct = h('span', { class: 'act' }, icon(ICONS.like), h('span', { text: '…' }));
  const dislikeAct = h('span', { class: 'act' }, icon(ICONS.dislike), h('span', { text: '…' }));
  const laterBtn = h('button', { class: 'act', type: 'button' }, icon(ICONS.later), h('span', { text: 'Later' }));
  const watchUrl = 'https://www.youtube.com/watch?v=' + id;
  const acts = h('div', { class: 'acts' },
    likeAct, dislikeAct, laterBtn,
    h('button', { class: 'act', type: 'button', onclick: () => (navigator.share ? navigator.share({ url: watchUrl }).catch(() => {}) : navigator.clipboard.writeText(watchUrl).then(() => toast('Link copied'))) }, icon(ICONS.share), 'Share'),
    h('button', { class: 'act', type: 'button', onclick: () => toast('Tap ⛶ (fullscreen) in the player, then the PiP icon in the top-left corner. Or start fullscreen and swipe home.', { timeout: 7000 }) }, icon(ICONS.pip), 'PiP'),
    h('a', { class: 'act', href: 'https://www.tool77.com/en/v/downloader?url=' + encodeURIComponent(watchUrl), target: '_blank', rel: 'noopener' }, icon(ICONS.download), 'Download'),
    h('a', { class: 'act', href: watchUrl, target: '_blank', rel: 'noopener' }, icon(ICONS.open), 'YouTube'));
  const chanRow = h('div', { class: 'chan' });
  const desc = h('div', { class: 'desc clamped pad', style: { paddingTop: '4px' } });
  const descToggle = h('button', { class: 'desc-toggle', type: 'button', text: 'Show more', onclick: () => {
    const c = desc.classList.toggle('clamped');
    descToggle.textContent = c ? 'Show more' : 'Show less';
  } });
  const more = h('div', {});
  view.append(playerBox, titleBox, subLine, sbBar, acts, chanRow, desc, descToggle, h('div', { class: 'section', text: 'More from this channel' }), more);

  // Basic info works without an API key (oEmbed), details need one.
  let info = detailCache.get(id) || null;
  const fillInfo = (v) => {
    info = v;
    titleBox.textContent = v.title;
    document.title = v.title + ' · ClearTube';
    subLine.textContent = [v.views ? fmtNum(v.views) + ' views' : '', v.published ? ago(v.published) : ''].filter(Boolean).join(' · ');
    likeAct.lastChild.textContent = v.likes ? fmtNum(v.likes) : 'Like';
    if (v.description) { desc.replaceChildren(...linkify(v.description)); } else { desc.hidden = true; descToggle.hidden = true; }
  };
  if (info) fillInfo(info);
  else {
    fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watchUrl)).then((r) => r.ok ? r.json() : null).then((o) => {
      if (o && !info) fillInfo({ id, title: o.title, channel: o.author_name, description: '' });
    }).catch(() => {});
  }
  if (settings.apiKey) {
    videoDetails([id], { fresh: true }).then(async ([v]) => {
      if (!v) return;
      fillInfo(v);
      const c = await channelInfo(v.channelId).catch(() => null);
      if (!c) return;
      renderChannelRow(c);
      const r = await uploads(c.uploads).catch(() => null);
      const vs = r ? await videoDetails(r.ids.filter((x) => x !== id).slice(0, 12)).catch(() => []) : [];
      more.replaceChildren(...vs.filter(notShort).map(compactCard));
    }).catch((e) => { if (!(e instanceof NeedKeyError)) toast(explainError(e)); });
  } else {
    more.replaceChildren(h('p', { class: 'pad small muted', text: 'Add an API key in Settings to see more videos, views and the channel.' }));
  }

  function renderChannelRow(c) {
    const isSub = () => subs.some((s) => s.id === c.id);
    const btn = h('button', { class: 'btn' + (isSub() ? '' : ' primary'), type: 'button', text: isSub() ? 'Subscribed' : 'Subscribe', onclick: (e) => {
      e.preventDefault();
      toggleSub(c);
      btn.textContent = isSub() ? 'Subscribed' : 'Subscribe';
      btn.className = 'btn' + (isSub() ? '' : ' primary');
    } });
    chanRow.replaceChildren(
      h('a', { href: '#/channel/' + c.id, class: 'row', style: { flex: '1', minWidth: '0', textDecoration: 'none', color: 'inherit' } },
        h('img', { class: 'avatar', src: c.thumb, alt: '' }),
        h('div', { style: { minWidth: '0' } }, h('div', { class: 'vtitle', text: c.title }), h('div', { class: 'vsub', text: fmtNum(c.subs) + ' subscribers' }))),
      btn);
  }

  // Watch later
  const inLater = () => later.some((x) => x.id === id);
  const syncLater = () => { laterBtn.classList.toggle('on', inLater()); laterBtn.lastChild.textContent = inLater() ? 'Saved' : 'Later'; };
  syncLater();
  laterBtn.addEventListener('click', () => {
    if (inLater()) later = later.filter((x) => x.id !== id);
    else later.unshift({ id, title: info ? info.title : id, channel: info && info.channel, channelId: info && info.channelId, dur: info && info.dur });
    saveLater();
    syncLater();
  });

  // Dislikes
  if (settings.ryd) {
    dislikes(id).then((d) => {
      dislikeAct.lastChild.textContent = fmtNum(d.dislikes);
      if (!info || !info.likes) likeAct.lastChild.textContent = fmtNum(d.likes);
    }).catch(() => { dislikeAct.lastChild.textContent = 'Dislike'; });
  } else dislikeAct.remove();

  // Player
  const seen = watched.find((x) => x.id === id);
  const urlT = Number(params.get('t')) || 0;
  const start = urlT || (settings.resume && seen && seen.dur && seen.pos > 10 && seen.pos < seen.dur - 15 ? Math.floor(seen.pos) : 0);
  let player = null;
  let segments = [];
  const ignored = new Set();
  try {
    const YT = await loadPlayerApi();
    if (!document.getElementById('ct-player')) return; // navigated away meanwhile
    player = new YT.Player('ct-player', {
      host: EMBED_HOST, videoId: id,
      playerVars: { playsinline: 1, rel: 0, autoplay: 1, start, modestbranding: 1, iv_load_policy: 3 },
      events: { onReady: (e) => { try { e.target.playVideo(); } catch (_) { /* autoplay may be refused */ } } }
    });
  } catch (e) { playerBox.replaceChildren(h('div', { class: 'empty', text: e.message })); }

  sponsorSegments(id).then((segs) => {
    segments = segs;
    if (!segs.length) return;
    sbBar.hidden = false;
    const showBar = (dur) => {
      if (!dur) return;
      sbBar.replaceChildren(...segs.map((s) => h('span', { style: { left: (s.start / dur * 100) + '%', width: Math.max(0.5, (s.end - s.start) / dur * 100) + '%' } })));
    };
    showBar(info && info.dur);
    const t = setInterval(() => { try { if (player && player.getDuration) showBar(player.getDuration()); clearInterval(t); } catch (_) { /* not ready */ } }, 1500);
    cleanup.push(() => clearInterval(t));
  }).catch(() => {});

  // Poll the player: SponsorBlock skips and history/resume position.
  let lastSave = 0;
  const tick = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    let t;
    let state;
    try { t = player.getCurrentTime(); state = player.getPlayerState(); } catch (_) { return; }
    if (state !== 1) return; // playing
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (ignored.has(i) || t < s.start || t >= s.end - 0.3) continue;
      player.seekTo(s.end, true);
      if (settings.sbToasts) toast(`Skipped ${SB_LABEL[s.category] || s.category}`, { action: 'Undo', onAction: () => { ignored.add(i); player.seekTo(s.start, true); } });
      break;
    }
    if (Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      let dur = 0;
      try { dur = player.getDuration(); } catch (_) { /* ignore */ }
      recordHistory({ id, title: info ? info.title : '', channel: info && info.channel, channelId: info && info.channelId, pos: t, dur });
    }
  }, 250);
  cleanup.push(() => clearInterval(tick));
  cleanup.push(() => {
    try {
      if (player && player.getCurrentTime) recordHistory({ id, title: info ? info.title : '', channel: info && info.channel, channelId: info && info.channelId, pos: player.getCurrentTime(), dur: player.getDuration() });
      if (player && player.destroy) player.destroy();
    } catch (_) { /* ignore */ }
  });

  function linkify(text) {
    const out = [];
    const re = /(https?:\/\/[^\s]+)|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1]) {
        const vid = parseVideoId(m[1]);
        out.push(h('a', vid ? { href: '#/watch/' + vid } : { href: m[1], target: '_blank', rel: 'noopener' }, m[1]));
      } else {
        const parts = m[2].split(':').map(Number);
        const sec = parts.reduce((a, b) => a * 60 + b, 0);
        out.push(h('button', { class: 'ts', type: 'button', text: m[2], onclick: () => { if (player && player.seekTo) { player.seekTo(sec, true); window.scrollTo({ top: 0, behavior: 'smooth' }); } } }));
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
}

function recordHistory(entry) {
  if (!entry.id) return;
  const prev = watched.find((x) => x.id === entry.id) || {};
  watched = [Object.assign({}, prev, entry, { title: entry.title || prev.title || '', at: Date.now() }), ...watched.filter((x) => x.id !== entry.id)];
  saveHistory();
}

function toggleSub(c) {
  if (subs.some((s) => s.id === c.id)) { subs = subs.filter((s) => s.id !== c.id); toast('Unsubscribed from ' + c.title); }
  else { subs.push({ id: c.id, title: c.title, thumb: c.thumb, uploads: c.uploads }); toast('Subscribed to ' + c.title); }
  saveSubs();
}

// ---- Channel
async function viewChannel(idOrHandle) {
  setChrome({ title: 'Channel', back: true, tab: null });
  const top = h('div', {});
  const list = h('div', { class: 'feed' });
  const moreBtn = h('button', { class: 'btn more', type: 'button', text: 'Load more', hidden: true });
  view.append(top, list, moreBtn);
  list.append(spinner());
  try {
    const c = await channelInfo(decodeURIComponent(idOrHandle));
    if (!c) { list.replaceChildren(h('div', { class: 'empty', text: 'Channel not found.' })); return; }
    setChrome({ title: c.title, back: true, tab: null });
    const isSub = () => subs.some((s) => s.id === c.id);
    const subBtn = h('button', { class: 'btn' + (isSub() ? '' : ' primary'), type: 'button', text: isSub() ? 'Subscribed' : 'Subscribe', onclick: () => {
      toggleSub(c);
      subBtn.textContent = isSub() ? 'Subscribed' : 'Subscribe';
      subBtn.className = 'btn' + (isSub() ? '' : ' primary');
    } });
    top.replaceChildren(h('div', { class: 'chan' }, h('img', { class: 'avatar', src: c.thumb, alt: '' }),
      h('div', { style: { flex: '1', minWidth: '0' } }, h('div', { class: 'vtitle', text: c.title }),
        h('div', { class: 'vsub', text: [c.handle, fmtNum(c.subs) + ' subscribers', fmtNum(c.videos) + ' videos'].filter(Boolean).join(' · ') })), subBtn));
    let next = null;
    list.replaceChildren();
    const load = async () => {
      moreBtn.hidden = true;
      const r = await uploads(c.uploads, next);
      next = r.next;
      list.append(...(await videoDetails(r.ids)).filter(notShort).map(videoCard));
      moreBtn.hidden = !next;
    };
    moreBtn.addEventListener('click', () => load().catch((e) => toast(explainError(e))));
    await load();
  } catch (e) { list.replaceChildren(errorView(e)); }
}

// ---- Library
function viewLibrary() {
  setChrome({ title: 'Library', tab: 'library' });
  const sec = (title, items, empty) => [h('div', { class: 'section', text: title }),
    items.length ? h('div', {}, ...items) : h('p', { class: 'pad muted small', text: empty })];
  const card = (x) => compactCard({ id: x.id, title: x.title || x.id, channel: x.channel, dur: x.dur });
  const histCards = watched.slice(0, 30).map(card);
  const continueCards = watched.filter((x) => x.dur && x.pos > 10 && x.pos / x.dur < 0.95).slice(0, 10).map(card);
  const laterCards = later.map((x) => compactCard(x));
  const subRows = subs.slice().sort((a, b) => a.title.localeCompare(b.title)).map((s) => h('a', { class: 'chan', href: '#/channel/' + s.id },
    h('img', { class: 'avatar', src: s.thumb, alt: '', loading: 'lazy' }), h('div', { class: 'vtitle', text: s.title })));
  const importBox = h('textarea', { rows: 4, placeholder: 'One per line: channel links, @handles or channel IDs.\nOr pick the subscriptions.csv from a Google Takeout export.' });
  const fileInput = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', hidden: true, onchange: async () => {
    const f = fileInput.files[0];
    if (f) importBox.value = await f.text();
  } });
  const importCard = h('div', { class: 'card' },
    h('div', { class: 'vtitle', text: 'Import subscriptions' }),
    h('p', { class: 'small muted', text: 'Your subscriptions are stored only on this iPhone. To copy them from YouTube: takeout.google.com → YouTube and YouTube Music → subscriptions.csv.' }),
    h('div', { class: 'field' }, importBox),
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', text: 'Choose file', onclick: () => fileInput.click() }),
      h('button', { class: 'btn primary', type: 'button', text: 'Import', onclick: () => importSubs(importBox.value) })), fileInput);
  view.append(...sec('Continue watching', continueCards, 'Videos you start appear here.'),
    ...sec('Watch later', laterCards, 'Tap "Later" on a video to save it here.'),
    ...sec(`Subscriptions (${subs.length})`, subRows, 'No subscriptions yet.'),
    importCard,
    ...sec('History', histCards, 'Nothing watched yet.'));
}

async function importSubs(text) {
  if (!settings.apiKey) { toast('Add your API key in Settings first.'); return; }
  const tokens = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const id = line.match(/UC[\w-]{22}/);
    if (id) { tokens.add(id[0]); continue; }
    const handle = line.match(/@[\w.-]{3,}/);
    if (handle) tokens.add(handle[0]);
  }
  if (!tokens.size) { toast('No channels found in that text.'); return; }
  toast(`Importing ${tokens.size} channel(s)…`, { timeout: 60000 });
  let added = 0;
  for (const t of tokens) {
    try {
      const c = await channelInfo(t);
      if (c && !subs.some((s) => s.id === c.id)) { subs.push({ id: c.id, title: c.title, thumb: c.thumb, uploads: c.uploads }); added++; }
    } catch (e) { toast(explainError(e)); break; }
  }
  saveSubs();
  toast(`Imported ${added} new subscription(s).`);
  route();
}

// ---- Settings
function viewSettings() {
  setChrome({ title: 'Settings', tab: 'settings' });
  const keyInput = h('input', { type: 'text', value: settings.apiKey, placeholder: 'AIza…', autocapitalize: 'off', autocorrect: 'off', spellcheck: false });
  const sw = (label, get, set, help) => h('label', { class: 'switch' }, h('span', {}, label, help ? h('div', { class: 'small muted', text: help }) : null),
    h('input', { type: 'checkbox', checked: get(), onchange: (e) => { set(e.target.checked); saveSettings(); } }));
  const quota = store.get('quota', { used: 0, day: '' });
  view.append(
    h('div', { class: 'card' },
      h('div', { class: 'vtitle', text: 'YouTube API key' }),
      h('p', { class: 'small muted' }, 'Needed for search, channels and the subscription feed (free, about 100 searches a day). ',
        h('a', { href: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', target: '_blank', rel: 'noopener', text: 'Enable the YouTube Data API v3' }),
        ', then create an API key under "Credentials". Restrict it to this website for safety.'),
      h('div', { class: 'field' }, keyInput),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', type: 'button', text: 'Save key', onclick: async () => {
          settings.apiKey = keyInput.value.trim();
          saveSettings();
          if (!settings.apiKey) return toast('Key removed.');
          try { await api('videos', { part: 'id', id: 'dQw4w9WgXcQ' }); toast('Key works.'); } catch (e) { toast(explainError(e), { timeout: 7000 }); }
        } }),
        h('span', { class: 'small muted', text: quota.day === new Date().toISOString().slice(0, 10) ? `~${quota.used} of 10,000 units used today` : '' }))),
    h('div', { class: 'card' },
      h('div', { class: 'vtitle', text: 'SponsorBlock' }),
      ...Object.keys(DEFAULT_SETTINGS.sb).map((c) => sw(SB_SETTING_LABEL[c], () => settings.sb[c], (v) => { settings.sb[c] = v; })),
      sw('Show a message with Undo', () => settings.sbToasts, (v) => { settings.sbToasts = v; })),
    h('div', { class: 'card' },
      h('div', { class: 'vtitle', text: 'Playback & feed' }),
      sw('Show dislike counts', () => settings.ryd, (v) => { settings.ryd = v; }, 'From returnyoutubedislike.com'),
      sw('Resume where I left off', () => settings.resume, (v) => { settings.resume = v; }),
      sw('Hide Shorts', () => settings.hideShorts, (v) => { settings.hideShorts = v; })),
    h('div', { class: 'card' },
      h('div', { class: 'vtitle', text: 'Your data' }),
      h('p', { class: 'small muted', text: `${subs.length} subscriptions, ${watched.length} history entries, ${later.length} saved for later. Stored only on this device.` }),
      h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('button', { class: 'btn', type: 'button', text: 'Export', onclick: () => {
          const data = JSON.stringify({ settings: Object.assign({}, settings, { apiKey: '' }), subs, later, history: watched }, null, 1);
          const file = new File([data], 'cleartube-backup.json', { type: 'application/json' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file] }).catch(() => {});
          else navigator.clipboard.writeText(data).then(() => toast('Backup copied to the clipboard.'));
        } }),
        h('button', { class: 'btn', type: 'button', text: 'Clear history', onclick: () => { if (confirm('Clear watch history?')) { watched = []; saveHistory(); toast('History cleared.'); } } }))),
    h('p', { class: 'pad small muted', text: `ClearTube ${APP_VERSION}. Playback uses YouTube's embedded player; ad blockers keep working in this web app.` +
      (isStandalone() ? '' : ' Tip: tap Share → Add to Home Screen to open it full screen without the Safari bar.') }));
}

const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/* ------------------------------------------------------------ router */

function route() {
  scrollPos.set(currentKey, window.scrollY);
  cleanup.forEach((fn) => { try { fn(); } catch (_) { /* ignore */ } });
  cleanup = [];
  document.title = 'ClearTube';
  view.replaceChildren();
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  currentKey = hash;
  const parts = path.split('/').filter(Boolean);
  let p;
  if (parts[0] === 'watch' && parts[1]) p = viewWatch(parts[1], params);
  else if (parts[0] === 'search') p = viewSearch(params);
  else if (parts[0] === 'channel' && parts[1]) p = viewChannel(parts[1]);
  else if (parts[0] === 'library') p = viewLibrary();
  else if (parts[0] === 'settings') p = viewSettings();
  else p = viewHome();
  Promise.resolve(p).then(() => {
    const y = scrollPos.get(hash);
    window.scrollTo(0, parts[0] === 'watch' ? 0 : (y || 0));
  }).catch((e) => { view.replaceChildren(errorView(e)); });
}
let currentKey = '';

// Open links shared to the app as ?v=… or ?url=… (e.g. from a bookmark).
(() => {
  const q = new URLSearchParams(location.search);
  const id = parseVideoId(q.get('v') || q.get('url') || q.get('text') || '');
  if (id && !location.hash) window.history.replaceState(null, '', location.pathname + '#/watch/' + id);
})();

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
