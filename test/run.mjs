#!/usr/bin/env node
// End-to-end smoke tests in an emulated iPhone 13 mini (Playwright/Chromium).
// Each test serves a small fake copy of a site, loads the built userscript
// with an in-memory GM API, and checks the behaviour of one module.
//
// Usage: node test/run.mjs [filter]
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (_) { playwright = require('/usr/lib/node_modules/playwright'); }
const { chromium, devices } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suite = JSON.parse(readFileSync(join(root, 'src/suite.json'), 'utf8'));
const BUNDLE = readFileSync(join(root, `dist/${suite.file}.user.js`), 'utf8');
const RAW = `https://raw.githubusercontent.com/${suite.repo}/${suite.branch}/dist/`;

// In-memory GM API backed by Node, so storage survives page reloads.
const GM_SHIM = `
(() => {
  const call = (op, ...a) => window.__gm(op, ...a);
  window.GM = {
    getValue: (k, d) => call('get', k).then((v) => (v === undefined ? d : v)),
    setValue: (k, v) => call('set', k, v),
    deleteValue: (k) => call('del', k),
    openInTab: (url) => call('open', url),
    setClipboard: (t) => call('clip', t),
    xmlHttpRequest: (d) => {
      call('xhr', { url: d.url, method: d.method || 'GET', data: d.data || null }).then((r) => {
        if (!r) return d.onerror && d.onerror({});
        let response = r.text;
        if (d.responseType === 'blob') response = new Blob([r.text], { type: r.type || 'application/octet-stream' });
        d.onload && d.onload({ status: r.status, responseText: r.text, response, finalUrl: d.url, responseHeaders: '' });
      });
      return { abort() {} };
    }
  };
})();
`;

const results = [];
const filter = process.argv[2];

async function withPage(t, fn) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13 Mini'] });
  const store = new Map(Object.entries(t.store || {}));
  const opened = [];
  const clip = [];
  const xhrLog = [];
  const errors = [];
  const routes = t.routes || {};
  const xhr = t.xhr || {};
  await context.exposeBinding('__gm', (_src, op, ...a) => {
    if (op === 'get') return store.has(a[0]) ? JSON.parse(store.get(a[0])) : undefined;
    if (op === 'set') { store.set(a[0], JSON.stringify(a[1])); return undefined; }
    if (op === 'del') { store.delete(a[0]); return undefined; }
    if (op === 'open') { opened.push(a[0]); return undefined; }
    if (op === 'clip') { clip.push(a[0]); return undefined; }
    if (op === 'xhr') {
      xhrLog.push(a[0]);
      for (const [prefix, handler] of Object.entries(xhr)) {
        if (a[0].url.startsWith(prefix)) return typeof handler === 'function' ? handler(a[0]) : handler;
      }
      return { status: 404, text: '' };
    }
    return undefined;
  });
  await context.addInitScript({ content: GM_SHIM + '\n' + BUNDLE });
  const hits = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    hits.push(url);
    for (const [prefix, body] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        const r = typeof body === 'function' ? body(url) : body;
        if (r && typeof r === 'object') return route.fulfill(r);
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: r });
      }
    }
    return route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (/crashed|boot failed/.test(m.text())) errors.push(m.text()); });
  const ui = (sel) => page.evaluate((s) => {
    const host = document.querySelector('ioss-ui');
    return host && host.shadowRoot ? Array.from(host.shadowRoot.querySelectorAll(s)).map((n) => ({ text: n.textContent, cls: n.className })) : [];
  }, sel);
  try {
    await fn({ page, store, opened, clip, xhrLog, hits, errors, ui });
    if (errors.length) throw new Error('Page errors: ' + errors.join(' | '));
  } finally {
    await browser.close();
  }
}

async function test(name, t, fn) {
  if (filter && !name.includes(filter)) return;
  const started = Date.now();
  try {
    await withPage(t, fn);
    results.push([true, name]);
    console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n      ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error('Assertion failed: ' + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000, msg = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(100); }
  throw new Error('Timed out waiting for ' + msg + ' (last: ' + JSON.stringify(last) + ')');
}

/* ------------------------------------------------------------- fixtures */

// Strict CSP like Google/YouTube use: only scripts carrying the nonce run.
const CSP = "script-src 'nonce-n0nce' 'strict-dynamic'; object-src 'none'";
const strict = (body) => ({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': CSP }, body });
const html = (body, head = '') => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${head}</head><body>${body}</body></html>`;

const GOOGLE_SERP = html(`
  <script nonce="n0nce">window.__pageScript = 1;</script>
  <div role="dialog" id="consent"><button id="W0wltc">Reject all</button></div>
  <form action="/search" id="sf"><input name="q" value="test"></form>
  <a id="r1" href="/url?q=https%3A%2F%2Fexample.com%2Fpage%3Futm_source%3Dgoogle%26id%3D7&sa=U" ping="/url?sa=t" data-ved="abc" onmousedown="return rwt(this)" jsaction="click:h5M12e;mouseover:x">Result 1</a>
  <a id="r2" href="https://example.org/" ping="/gen_204?x" jsaction="click:abc">Result 2</a>
  <a id="inner" href="/search?q=more" jsaction="click:keep">More results</a>
  <a id="amp" href="https://www.google.com/amp/s/news.example.com/story.amp">AMP</a>
  <img id="pix" src="https://www.google.com/gen_204?pixel=1">
`);

const MYT_WATCH = html(`
  <div id="player"><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video>
    <div class="player-controls-bottom-left"></div></div></div>
  <div class="slim-video-action-bar-actions"><div class="segmented-buttons">
    <like-button-view-model><button aria-pressed="false" aria-label="like this video along with 1,000 other people"><span role="text">1K</span></button></like-button-view-model>
    <dislike-button-view-model><button aria-pressed="false" aria-label="Dislike this video"><span role="text"></span></button></dislike-button-view-model>
  </div></div>
  <ytm-promoted-sparkles-web-renderer id="ad1">Ad</ytm-promoted-sparkles-web-renderer>
  <script>
    // Fake media element: headless Chromium has no playable media here, so
    // expose the properties the modules use.
    const v = document.querySelector('video');
    let t = 0, paused = true, muted = false, rate = 1, dur = 100;
    Object.defineProperties(v, {
      currentTime: { get: () => t, set: (x) => { t = x; window.__seeks = (window.__seeks || []).concat(x); } },
      paused: { get: () => paused }, muted: { get: () => muted, set: (x) => { muted = x; } },
      playbackRate: { get: () => rate, set: (x) => { rate = x; } }, duration: { get: () => dur, set: (x) => { dur = x; } },
      readyState: { get: () => 4 }, seeking: { get: () => false }
    });
    v.play = () => { paused = false; return Promise.resolve(); };
    v.pause = () => { paused = true; };
    v.webkitSupportsPresentationMode = () => true;
    v.webkitSetPresentationMode = (m) => { v.webkitPresentationMode = m; window.__pip = m; };
    window.__setTime = (x) => { t = x; v.dispatchEvent(new Event('timeupdate')); };
  </script>
`);

const VIDEO_ID = 'dQw4w9WgXcQ';
const vidHash = createHash('sha256').update(VIDEO_ID).digest('hex');

/* ---------------------------------------------------------------- tests */

console.log(`Testing ${suite.name} ${suite.version} as iPhone 13 mini\n`);

await test('google: unwraps redirects, strips tracking, keeps internal controls', {
  routes: { 'https://www.google.com/search': strict(GOOGLE_SERP) }
}, async ({ page, hits }) => {
  await page.goto('https://www.google.com/search?q=test');
  await until(() => page.evaluate(() => location.search.includes('safe=off')), 5000, 'safe=off reload');
  await until(() => page.evaluate(() => document.getElementById('r1').getAttribute('href') === 'https://example.com/page?id=7'), 5000, 'r1 cleaned');
  const r = await page.evaluate(() => {
    const g = (id) => document.getElementById(id);
    const r1 = g('r1');
    const a = document.createElement('a');
    a.id = 'late';
    a.href = '/url?q=https://late.example/';
    document.body.appendChild(a);
    return {
      r1: [r1.hasAttribute('ping'), r1.getAttribute('rel'), r1.hasAttribute('onmousedown'), r1.getAttribute('jsaction'), r1.hasAttribute('data-ved')],
      r2: [g('r2').hasAttribute('ping'), g('r2').hasAttribute('jsaction')],
      inner: [g('inner').getAttribute('jsaction'), g('inner').getAttribute('href')],
      amp: g('amp').getAttribute('href'),
      pix: g('pix').hasAttribute('src'),
      safeInput: !!document.querySelector('#sf input[name="safe"][value="off"]'),
      cookie: document.cookie,
      dialog: getComputedStyle(document.getElementById('consent')).display,
      guards: !!window.__iossDtmg
    };
  });
  assert(JSON.stringify(r.r1) === JSON.stringify([false, 'noreferrer', false, 'mouseover:x', false]), 'r1 attrs ' + JSON.stringify(r.r1));
  assert(r.r2[0] === false && r.r2[1] === false, 'r2 ping/jsaction removed');
  assert(r.inner[0] === 'click:keep' && r.inner[1].includes('safe=off'), 'internal link keeps handler: ' + r.inner);
  assert(r.amp === 'https://news.example.com/story.amp', 'amp unwrapped: ' + r.amp);
  assert(r.pix === false, 'tracking pixel removed');
  assert(r.safeInput, 'safe=off added to search form');
  assert(/SOCS=CAI/.test(r.cookie), 'consent cookie set');
  assert(r.dialog === 'none', 'consent dialog hidden');
  assert(r.guards, 'page-world guards injected through the strict nonce CSP');
  await until(() => page.evaluate(() => document.getElementById('late').getAttribute('href') === 'https://late.example/'), 3000, 'late link cleaned');
  // Telemetry beacons are answered locally and never reach the network.
  const before = hits.filter((h) => h.includes('/gen_204?beacon')).length;
  const status = await page.evaluate(() => fetch('/gen_204?beacon=1').then((x) => x.status));
  assert(status === 204 && hits.filter((h) => h.includes('/gen_204?beacon')).length === before, 'beacon blocked');
});

await test('google: consent page gets "Reject all" tapped', {
  routes: { 'https://consent.google.com/': html(`<form action="/save"><input type="hidden" name="set_eom" value="true"><button onclick="event.preventDefault();window.__rej=1">Reject all</button></form>`) }
}, async ({ page }) => {
  await page.goto('https://consent.google.com/ml?continue=https://www.google.com/');
  await until(() => page.evaluate(() => window.__rej === 1), 4000, 'reject clicked');
});

await test('reddit: removes login wall, unblurs, sets over18', {
  routes: { 'https://www.reddit.com/': strict(html(`
    <xpromo-nsfw-blocking-modal-desktop id="m">Log in to continue</xpromo-nsfw-blocking-modal-desktop>
    <shreddit-blurred-container id="b"><img src="data:,"></shreddit-blurred-container>
    <xpromo-app-selector id="app">Open in app</xpromo-app-selector>
    <script nonce="n0nce">
      document.body.setAttribute('style', 'pointer-events: none; overflow: hidden;');
      customElements.define('shreddit-blurred-container', class extends HTMLElement { handleClick() { this.setAttribute('revealed', ''); } });
    </script>`)) }
}, async ({ page }) => {
  await page.goto('https://www.reddit.com/r/test/comments/1/x/');
  await until(() => page.evaluate(() => !document.getElementById('m') && document.getElementById('b').hasAttribute('revealed')), 4000, 'modal removed & unblurred');
  const r = await page.evaluate(() => ({ style: document.body.getAttribute('style'), cookie: document.cookie, app: !!document.getElementById('app') }));
  assert(!/pointer-events/.test(r.style), 'scroll unlocked: ' + r.style);
  assert(/over18=true/.test(r.cookie), 'over18 cookie');
  assert(!r.app, 'app prompt removed');
});

await test('youtube (m.): PiP button, ad hiding, ad skip, dislikes, SponsorBlock, download button', {
  routes: { 'https://m.youtube.com/watch': MYT_WATCH },
  xhr: {
    'https://returnyoutubedislikeapi.com/votes': { status: 200, text: JSON.stringify({ id: VIDEO_ID, likes: 1000, dislikes: 1234 }) },
    'https://returnyoutubedislikeapi.com/puzzle': { status: 500, text: '' },
    [`https://sponsor.ajay.app/api/skipSegments/${vidHash.slice(0, 4)}`]: { status: 200, text: JSON.stringify([
      { videoID: 'other', segments: [] },
      { videoID: VIDEO_ID, segments: [
        { category: 'sponsor', segment: [5, 6], votes: -5, videoDuration: 100 }, // below vote threshold (crashed the original)
        { category: 'sponsor', segment: [10, 20], votes: 2, videoDuration: 100, actionType: 'skip' },
        { category: 'selfpromo', segment: [18, 25], votes: 0, videoDuration: 100, actionType: 'skip' },
        { category: 'poi_highlight', segment: [50, 50], votes: 1, videoDuration: 100, actionType: 'poi' }
      ] }
    ]) }
  }
}, async ({ page, opened, ui }) => {
  await page.goto(`https://m.youtube.com/watch?v=${VIDEO_ID}`);
  // PiP
  await until(() => page.$('.player-controls-bottom-left .ioss-pip-btn'), 4000, 'PiP button');
  await page.tap('.ioss-pip-btn');
  assert(await page.evaluate(() => window.__pip) === 'picture-in-picture', 'PiP mode set');
  // feed/promoted ads hidden
  assert(await page.evaluate(() => getComputedStyle(document.getElementById('ad1')).display) === 'none', 'promoted ad hidden');
  // dislikes
  await until(() => page.evaluate(() => document.querySelector('dislike-button-view-model span[role=text]').textContent), 6000, 'dislike count');
  const dislikes = await page.evaluate(() => document.querySelector('dislike-button-view-model span[role=text]').textContent);
  assert(/1\.2K/.test(dislikes), 'dislike count formatted: ' + dislikes);
  // SponsorBlock: segments 10-20 and 18-25 are merged
  await page.evaluate(() => document.querySelector('video').play());
  await sleep(1500);
  await page.evaluate(() => window.__setTime(12));
  await until(() => page.evaluate(() => (window.__seeks || []).includes(25)), 3000, 'seek past merged segment');
  const toasts = await ui('.toast .msg');
  assert(toasts.some((x) => /Skipped/.test(x.text)), 'skip toast shown: ' + JSON.stringify(toasts));
  // Video ad: fast-forward + mute, restore afterwards
  await page.evaluate(() => { const v = document.querySelector('video'); v.duration = 30; window.__seeks = []; document.getElementById('movie_player').classList.add('ad-showing'); });
  await until(() => page.evaluate(() => (window.__seeks || []).some((x) => x > 29)), 3000, 'ad fast-forwarded');
  assert(await page.evaluate(() => document.querySelector('video').muted), 'ad muted');
  await page.evaluate(() => document.getElementById('movie_player').classList.remove('ad-showing'));
  await until(() => page.evaluate(() => !document.querySelector('video').muted && document.querySelector('video').playbackRate === 1), 3000, 'mute/rate restored');
  // Download button: in the action bar, directly left of the like button
  const order = await until(() => page.evaluate(() => {
    const row = document.querySelector('.slim-video-action-bar-actions');
    const dl = row.querySelector(':scope > .ioss-yt-dl');
    return dl && Array.from(row.children).map((c) => c.className || c.tagName.toLowerCase());
  }), 4000, 'inline download button');
  assert(order[0] === 'ioss-yt-dl' && order[1] === 'segmented-buttons', 'left of like: ' + JSON.stringify(order));
  const dlBox = await (await page.$('.ioss-yt-dl')).boundingBox();
  assert(dlBox.width >= 44 && dlBox.height >= 36, 'tap target: ' + JSON.stringify(dlBox));
  await sleep(2200);
  assert((await ui('.fab.show')).length === 0, 'floating button hidden on watch pages');
  await page.tap('.ioss-yt-dl');
  await until(() => opened.length > 0, 2000, 'download opened');
  assert(opened[0].startsWith('https://www.tool77.com/') && opened[0].includes(encodeURIComponent(`https://www.youtube.com/watch?v=${VIDEO_ID}`)), 'download url: ' + opened[0]);
  // Dislikes still land on the dislike button, not on ours.
  assert(/1\.2K/.test(await page.evaluate(() => document.querySelector('dislike-button-view-model span[role=text]').textContent)), 'dislikes intact');
});

await test('youtube: download button + dislikes when like/dislike sit directly in the row', {
  routes: { 'https://m.youtube.com/watch': html(`
    <div id="player"><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div></div>
    <div class="slim-video-action-bar-actions">
      <like-button-view-model><button aria-pressed="false"><span role="text">1K</span></button></like-button-view-model>
      <dislike-button-view-model><button aria-pressed="false"><span role="text"></span></button></dislike-button-view-model>
      <ytm-button-renderer id="share"><button>Share</button></ytm-button-renderer>
    </div>`) },
  xhr: { 'https://returnyoutubedislikeapi.com/votes': { status: 200, text: JSON.stringify({ likes: 10, dislikes: 2345 }) } }
}, async ({ page }) => {
  await page.goto(`https://m.youtube.com/watch?v=${VIDEO_ID}`);
  const order = await until(() => page.evaluate(() => {
    const row = document.querySelector('.slim-video-action-bar-actions');
    return row.querySelector(':scope > .ioss-yt-dl') && Array.from(row.children).map((c) => c.className || c.tagName.toLowerCase());
  }), 4000, 'inline button');
  assert(order.join() === 'ioss-yt-dl,like-button-view-model,dislike-button-view-model,ytm-button-renderer', 'order: ' + order);
  await until(() => page.evaluate(() => /2\.3K/.test(document.querySelector('dislike-button-view-model span[role=text]').textContent)), 6000, 'dislike count on the dislike button');
  assert(!(await page.evaluate(() => document.querySelector('.ioss-yt-dl').textContent.match(/\d/))), 'nothing written into the download button');
});

// YouTube's 2026 mobile watch page (from a user screenshot): dark theme, one
// row holding the channel avatar, the Subscribe pill and icon-only actions.
const MYT_2026 = html(`
  <style>
    body { background: #0f0f0f; color: #f1f1f1; margin: 0; }
    .slim-video-action-bar-actions { display: flex; align-items: center; gap: 8px; padding: 0 12px; }
    /* Like YouTube: native buttons are styled by their own class, so a
       foreign button in the row inherits nothing from these rules. */
    .yt-btn { background: transparent; border: 0; color: rgb(241, 241, 241); width: 44px; height: 44px; }
    #sub .yt-btn { background: #272727; width: auto; border-radius: 18px; padding: 0 14px; }
  </style>
  <div id="player"><div id="movie_player" class="html5-video-player" style="height:211px;background:#000"><video class="html5-main-video"></video></div></div>
  <ytm-slim-video-action-bar-renderer><div class="slim-video-action-bar-actions">
    <ytm-channel-thumbnail-with-link-renderer id="avatar"><a href="/@channel"><img alt=""></a></ytm-channel-thumbnail-with-link-renderer>
    <ytm-subscribe-button-renderer id="sub"><button class="yt-btn"><span role="text">Abonnieren</span></button></ytm-subscribe-button-renderer>
    <like-button-view-model><button class="yt-btn" aria-label="Mag ich"></button></like-button-view-model>
    <dislike-button-view-model><button class="yt-btn" aria-label="Mag ich nicht"></button></dislike-button-view-model>
    <ytm-button-renderer id="share"><button class="yt-btn" aria-label="Teilen"></button></ytm-button-renderer>
  </div></ytm-slim-video-action-bar-renderer>`);

await test('youtube 2026 layout: dislikes on the dislike button (not Subscribe), visible download button', {
  routes: { 'https://m.youtube.com/watch': MYT_2026 },
  xhr: { 'https://returnyoutubedislikeapi.com/votes': { status: 200, text: JSON.stringify({ likes: 211, dislikes: 3 }) } }
}, async ({ page, opened }) => {
  await page.goto(`https://m.youtube.com/watch?v=${VIDEO_ID}`);
  await until(() => page.evaluate(() => /3/.test(document.querySelector('dislike-button-view-model').textContent)), 6000, 'dislike count on the dislike button');
  await sleep(1200); // let the 500 ms mobile re-write loop run a few times
  const r = await page.evaluate(() => {
    const dl = document.querySelector('.ioss-yt-dl');
    const like = document.querySelector('like-button-view-model button');
    return {
      sub: document.querySelector('#sub').textContent.trim(),
      order: Array.from(document.querySelector('.slim-video-action-bar-actions').children).map((c) => c.id || c.className || c.tagName.toLowerCase()),
      dlColor: dl && getComputedStyle(dl).color,
      likeColor: getComputedStyle(like).color,
      dlBg: dl && getComputedStyle(dl).backgroundColor
    };
  });
  assert(r.sub === 'Abonnieren', 'Subscribe label untouched: ' + r.sub);
  assert(r.order.join() === 'avatar,sub,ioss-yt-dl ioss-yt-dl-icon,like-button-view-model,dislike-button-view-model,share', 'order: ' + r.order);
  assert(r.dlColor === r.likeColor, `download icon uses the like button colour (${r.dlColor} vs ${r.likeColor})`);
  assert(r.dlBg === 'rgba(0, 0, 0, 0)', 'icon-only like the other actions: ' + r.dlBg);
  await page.tap('.ioss-yt-dl');
  await until(() => opened.length > 0, 2000, 'download opened');
});

await test('youtube: Shorts keep the floating download button', {
  routes: { 'https://m.youtube.com/shorts': html('<video style="width:300px;height:500px"></video>') }
}, async ({ page, ui, opened }) => {
  await page.goto('https://m.youtube.com/shorts/abcdefghijk');
  await until(async () => (await ui('.fab.show')).length > 0, 4000, 'floating button on Shorts');
  await page.evaluate(() => document.querySelector('ioss-ui').shadowRoot.querySelector('.fab.show').click());
  await until(() => opened.length > 0, 2000, 'opened');
  assert(opened[0].includes(encodeURIComponent('https://www.youtube.com/shorts/abcdefghijk')), 'shorts url: ' + opened[0]);
});

await test('youtube: no download button on the home feed', {
  routes: { 'https://m.youtube.com/': html('<ytm-browse>home</ytm-browse>') }
}, async ({ page, ui }) => {
  await page.goto('https://m.youtube.com/');
  await sleep(2500);
  assert((await ui('.fab.show')).length === 0, 'no fab on home');
});

await test('settings sheet opens with #suite and saves toggles', {
  routes: { 'https://example.com/': html('<p>hello</p>') }
}, async ({ page, store }) => {
  await page.goto('https://example.com/#suite');
  await until(async () => page.evaluate(() => !!document.querySelector('ioss-ui') && !!document.querySelector('ioss-ui').shadowRoot.querySelector('.sheet')), 4000, 'sheet');
  const names = await page.evaluate(() => Array.from(document.querySelector('ioss-ui').shadowRoot.querySelectorAll('.mod .n')).map((n) => n.textContent));
  assert(names.length === 15, 'all modules listed: ' + names.join(', '));
  assert(await page.evaluate(() => location.hash === ''), 'hash removed');
  await page.evaluate(() => {
    const sw = document.querySelector('ioss-ui').shadowRoot.querySelector('input[aria-label="Enable Reddit: remove login wall"]');
    sw.click();
  });
  await until(() => store.has('ioss:state') && JSON.parse(store.get('ioss:state')).modules.reddit.enabled === false, 3000, 'saved');
  const fontSize = await page.evaluate(() => getComputedStyle(document.querySelector('ioss-ui').shadowRoot.querySelector('input[type=number]')).fontSize);
  assert(fontSize === '16px', 'inputs are 16px (no iOS zoom on focus): ' + fontSize);
});

await test('settings dot: visible by default, draggable, opens settings, remembers position', {
  routes: { 'https://example.com/': html('<p>hello</p>') }
}, async ({ page, store }) => {
  await page.goto('https://example.com/');
  const dotBox = async () => page.evaluate(() => {
    const d = document.querySelector('ioss-ui') && document.querySelector('ioss-ui').shadowRoot.querySelector('.dot');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const box = await until(dotBox, 4000, 'dot');
  assert(box.w >= 44 && box.h >= 44 && box.x + box.w <= 375, '44pt dot on screen: ' + JSON.stringify(box));
  // Drag it to the left edge.
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(box.x + 22 - 100, box.y + 22 + 120, { steps: 8 });
  await page.mouse.up();
  const moved = await dotBox();
  assert(moved.x < box.x - 80 && moved.y > box.y + 100, 'dragged: ' + JSON.stringify(moved));
  assert(!(await page.evaluate(() => !!document.querySelector('ioss-ui').shadowRoot.querySelector('.sheet'))), 'drag does not open settings');
  await until(() => store.has('ioss:state') && JSON.parse(store.get('ioss:state')).core.dotPos, 2000, 'position saved');
  // Tap opens the sheet.
  await page.mouse.click(moved.x + 22, moved.y + 22);
  await until(() => page.evaluate(() => !!document.querySelector('ioss-ui').shadowRoot.querySelector('.sheet')), 2000, 'sheet');
  // Position survives a reload.
  await page.reload();
  const again = await until(dotBox, 4000, 'dot after reload');
  assert(Math.abs(again.x - moved.x) < 2 && Math.abs(again.y - moved.y) < 2, 'position restored: ' + JSON.stringify(again));
});

await test('google lite: throttles YouTube telemetry but keeps watch history', {
  routes: { 'https://m.youtube.com/': strict(html('<script nonce="n0nce">window.__page = 1;</script><p>yt</p>')) }
}, async ({ page, hits }) => {
  await page.goto('https://m.youtube.com/');
  await until(() => page.evaluate(() => !!window.__iossGoogleLite), 4000, 'throttle injected through strict CSP');
  await page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await fetch('/api/stats/qoe?n=' + i);
    for (let i = 0; i < 3; i++) await fetch('/api/stats/watchtime?n=' + i);
    for (let i = 0; i < 2; i++) await fetch('/youtubei/v1/log_event?n=' + i, { method: 'POST' });
  });
  const count = (re) => hits.filter((h) => re.test(h)).length;
  assert(count(/\/api\/stats\/qoe/) === 5, 'performance pings capped at 5: ' + count(/\/api\/stats\/qoe/));
  assert(count(/\/api\/stats\/watchtime/) === 3, 'watch history untouched: ' + count(/\/api\/stats\/watchtime/));
  assert(count(/log_event/) === 1, 'event log throttled: ' + count(/log_event/));
});

await test('google lite: lazy-loads images added below the fold on Search', {
  routes: { 'https://www.google.com/search': html('<div style="height:3000px"></div><img id="top" src="data:,">') }
}, async ({ page }) => {
  await page.goto('https://www.google.com/search?q=x&safe=off');
  await page.evaluate(() => {
    const img = document.createElement('img');
    img.id = 'late';
    img.src = 'data:,';
    document.body.appendChild(img);
  });
  await until(() => page.evaluate(() => document.getElementById('late').getAttribute('loading') === 'lazy'), 3000, 'late image lazy');
  assert(await page.evaluate(() => !!document.querySelector('link[rel=preconnect][href="https://www.gstatic.com"]')), 'preconnect hint in head');
});

const htmlFilter = (page) => page.evaluate(() => getComputedStyle(document.documentElement).filter);

await test('dark mode: dims and warms light sites by default', {
  routes: { 'https://light.example/': html('<p>light page</p>') }
}, async ({ page }) => {
  await page.goto('https://light.example/');
  const f = await htmlFilter(page);
  assert(/brightness\(0\.[56]\) sepia\(0\.[45]\)/.test(f), 'mode 2 filter: ' + f);
  await sleep(400);
  assert(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(255, 255, 255)', 'white backdrop for transparent page');
});

await test('dark mode: skips sites that are already dark (luminance, html[dark])', {
  routes: {
    'https://dark.example/': html('<style>body{background:#1e1e1e;color:#eee}</style><p>dark page</p>'),
    'https://m.youtube.com/': html('<script>document.documentElement.setAttribute("dark", "")</script><p>yt</p>'),
    // The original glued R,G,B as text: orange rgb(255,80,0) -> 255800 < 898989
    // counted as "dark", while dark grey rgb(95,95,95) -> 959595 did not.
    'https://orange.example/': html('<style>body{background:rgb(255,80,0)}</style><p>orange</p>'),
    'https://grey.example/': html('<style>body{background:rgb(95,95,95)}</style><p>grey</p>')
  }
}, async ({ page }) => {
  for (const url of ['https://dark.example/', 'https://m.youtube.com/', 'https://grey.example/']) {
    await page.goto(url);
    await until(async () => (await htmlFilter(page)) === 'none', 3000, 'filter removed on ' + url);
  }
  await page.goto('https://orange.example/');
  await sleep(600);
  assert((await htmlFilter(page)) !== 'none', 'bright orange page still filtered');
});

await test('dark mode: invert mode keeps media and the suite UI un-inverted', {
  routes: { 'https://light.example/': html('<img id="i" src="data:,"><p>x</p>') },
  store: { 'ioss:state': JSON.stringify({ modules: { 'dark-mode': { settings: { mode: '3', nightMode: 'same' } } } }) }
}, async ({ page }) => {
  await page.goto('https://light.example/#suite');
  assert(/invert\(0\.9\)/.test(await htmlFilter(page)), 'page inverted');
  await until(() => page.evaluate(() => !!document.querySelector('ioss-ui')), 3000, 'ui');
  const r = await page.evaluate(() => [getComputedStyle(document.getElementById('i')).filter, getComputedStyle(document.querySelector('ioss-ui')).filter]);
  assert(r[0] === 'invert(1)' && r[1] === 'invert(1)', 'media & UI inverted back: ' + r);
  const sheet = await until(() => page.evaluate(() => {
    const s = document.querySelector('ioss-ui').shadowRoot.querySelector('.sheet');
    if (!s) return null;
    const b = s.getBoundingClientRect();
    return { top: b.top, bottom: Math.round(b.bottom), h: innerHeight };
  }), 3000, 'sheet');
  assert(sheet.bottom === sheet.h && sheet.top > 0, 'sheet still anchored to the bottom: ' + JSON.stringify(sheet));
});

await test('dark mode: "only in Dark Mode" follows the iPhone appearance live', {
  routes: { 'https://light.example/': html('<p>x</p>') },
  store: { 'ioss:state': JSON.stringify({ modules: { 'dark-mode': { settings: { followSystem: true } } } }) }
}, async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('https://light.example/');
  await sleep(300);
  assert((await htmlFilter(page)) === 'none', 'off in light appearance');
  await page.emulateMedia({ colorScheme: 'dark' });
  await until(async () => (await htmlFilter(page)) !== 'none', 2000, 'on after switching to dark');
});

const LOCKED = `
  <style>body{-webkit-user-select:none;user-select:none}</style>
  <p id="t">Protected text</p><textarea id="chat"></textarea>
  <script nonce="n0nce">
    document.addEventListener('copy', (e) => { e.preventDefault(); window.__copyHandler = 1; });
    document.oncontextmenu = () => false;
    document.body.setAttribute('oncopy', 'return false');
    document.getElementById('chat').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  </script>`;

for (const [label, body] of [['plain page', html(LOCKED)], ['strict CSP page', strict(html(LOCKED))]]) {
  await test(`web limits: copy, select and long-press unblocked (${label})`, {
    routes: { 'https://locked.example/': body }
  }, async ({ page }) => {
    await page.goto('https://locked.example/');
    await sleep(300);
    const r = await page.evaluate(() => {
      const fire = (target, type, init) => { const e = new Event(type, { bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e.defaultPrevented; };
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      document.getElementById('chat').dispatchEvent(enter);
      return {
        copyBlocked: fire(document.getElementById('t'), 'copy'),
        menuBlocked: fire(document.getElementById('t'), 'contextmenu'),
        oncopy: document.body.oncopy,
        select: getComputedStyle(document.body).userSelect,
        enterStillHandled: enter.defaultPrevented
      };
    });
    assert(!r.copyBlocked && !r.menuBlocked, 'copy/long-press not cancelled: ' + JSON.stringify(r));
    assert(r.oncopy === null, 'inline oncopy cleared');
    assert(r.select === 'text', 'text selectable: ' + r.select);
    assert(r.enterStillHandled, 'Enter-to-send keeps working (original broke this)');
  });
}

await test('web limits: leaves excluded sites alone', {
  routes: { 'https://m.youtube.com/': html(LOCKED.replace(/ nonce="n0nce"/, '')) }
}, async ({ page }) => {
  await page.goto('https://m.youtube.com/');
  await sleep(300);
  assert(await page.evaluate(() => { const e = new Event('copy', { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; }), 'youtube untouched');
});

const CLEAN_PAGE = html(`
  <a id="utm" href="https://shop.example/item?id=7&utm_source=news&fbclid=abc&utm_medium=mail">utm</a>
  <a id="func" href="https://flights.example/search?from=JFK&to=LHR&ref=main&source=en">functional</a>
  <a id="gbk" href="https://cn.example/s?q=%C4%E3%BA%C3&spm=a.b.c&page=2">gbk</a>
  <a id="mail" href="mailto:a@b.c?subject=hi">mail</a>`);

await test('clean urls: strips trackers, keeps functional params and their encoding', {
  routes: { 'https://news.example/': CLEAN_PAGE }
}, async ({ page }) => {
  await page.goto('https://news.example/a?utm_source=x&id=5');
  await until(() => page.evaluate(() => location.search === '?id=5'), 3000, 'address bar cleaned');
  const r = await page.evaluate(() => Object.fromEntries(['utm', 'func', 'gbk', 'mail'].map((id) => [id, document.getElementById(id).getAttribute('href')])));
  assert(r.utm === 'https://shop.example/item?id=7', 'trackers removed: ' + r.utm);
  assert(r.func === 'https://flights.example/search?from=JFK&to=LHR&ref=main&source=en', 'functional params kept: ' + r.func);
  assert(r.gbk === 'https://cn.example/s?q=%C4%E3%BA%C3&page=2', 'GBK encoding preserved byte-for-byte: ' + r.gbk);
  assert(r.mail === 'mailto:a@b.c?subject=hi', 'mailto untouched');
  // Single-page navigation: cleaned, and the app's history.state survives.
  await page.evaluate(() => {
    history.pushState({ app: 'route-1' }, '', '/b?utm_campaign=c&x=1');
    const a = document.createElement('a');
    a.id = 'late';
    a.href = 'https://x.example/?utm_term=t&ok=1';
    document.body.appendChild(a);
  });
  await until(() => page.evaluate(() => location.search === '?x=1'), 3000, 'SPA url cleaned');
  assert(JSON.stringify(await page.evaluate(() => history.state)) === '{"app":"route-1"}', 'history.state preserved');
  await until(() => page.evaluate(() => document.getElementById('late').getAttribute('href') === 'https://x.example/?ok=1'), 2000, 'new link cleaned');
});

await test('clean urls: aggressive mode uses the original list', {
  routes: { 'https://news.example/': CLEAN_PAGE },
  store: { 'ioss:state': JSON.stringify({ modules: { 'clean-urls': { settings: { aggressive: true } } } }) }
}, async ({ page }) => {
  await page.goto('https://news.example/');
  await until(() => page.evaluate(() => document.getElementById('func').getAttribute('href') === 'https://flights.example/search?to=LHR'), 3000, 'aggressive strip');
});

await test('clean urls: sign-in pages keep their address; site rules (YouTube, Amazon, Google, GitHub)', {
  routes: {
    'https://accounts.example.com/': html('<p>login</p>'),
    'https://m.youtube.com/': html(`<a id="redir" href="https://www.youtube.com/redirect?event=video_description&redir_token=TOKEN&q=https%3A%2F%2Fexample.com">x</a>
      <a id="share" href="https://youtu.be/abc?si=TRACK&t=42">s</a>`),
    'https://www.amazon.com/': html('<a id="p" href="https://www.amazon.com/Some-Thing/dp/B000123/ref=sr_1_1?crid=X&keywords=cup&qid=1&sprefix=c">p</a>'),
    'https://www.google.com/': html('<a id="h" href="https://example.com/page#utm_source=g&section=2&utm_medium=x">h</a>'),
    'https://github.com/': html('<a id="g" href="https://github.com/o/r/compare?ref=feature-x&ref_cta=y">g</a>')
  }
}, async ({ page }) => {
  await page.goto('https://accounts.example.com/oauth/authorize?utm_source=x&redir=%2Fhome');
  await sleep(600);
  assert(page.url().includes('utm_source=x&redir='), 'auth page untouched: ' + page.url());
  await page.goto('https://m.youtube.com/');
  await sleep(400);
  const yt = await page.evaluate(() => [document.getElementById('redir').getAttribute('href'), document.getElementById('share').getAttribute('href')]);
  assert(yt[0].includes('redir_token=TOKEN'), 'redir_token kept (original broke these links): ' + yt[0]);
  assert(yt[1] === 'https://youtu.be/abc?t=42', 'share tracking removed: ' + yt[1]);
  await page.goto('https://www.amazon.com/s');
  await sleep(400);
  const amz = await page.evaluate(() => document.getElementById('p').getAttribute('href'));
  assert(amz === 'https://www.amazon.com/Some-Thing/dp/B000123/?keywords=cup', 'amazon cleaned: ' + amz);
  await page.goto('https://www.google.com/');
  await sleep(400);
  const g = await page.evaluate(() => document.getElementById('h').getAttribute('href'));
  assert(g === 'https://example.com/page#section=2', 'fragment trackers removed, rest kept: ' + g);
  await page.goto('https://github.com/');
  await sleep(400);
  const gh = await page.evaluate(() => document.getElementById('g').getAttribute('href'));
  assert(gh === 'https://github.com/o/r/compare?ref=feature-x', 'github ref kept: ' + gh);
});

// YouTube (and other single-page apps) rewrite the address as soon as their
// scripts run, which drops "#suite" before the page has finished loading.
const STRIPS_HASH = html(`<script>
  history.replaceState(null, '', location.pathname + location.search);
  window.addEventListener('hashchange', () => history.replaceState(null, '', location.pathname + location.search));
</script><p>spa</p>`);

await test('settings sheet opens on sites that strip #suite (YouTube)', {
  routes: { 'https://m.youtube.com/': STRIPS_HASH }
}, async ({ page }) => {
  const sheetOpen = () => page.evaluate(() => !!document.querySelector('ioss-ui') && !!document.querySelector('ioss-ui').shadowRoot.querySelector('.sheet'));
  await page.goto('https://m.youtube.com/#suite');
  await until(sheetOpen, 4000, 'sheet on load');
  // Close it, then add #suite to the already-open page.
  await page.evaluate(() => document.querySelector('ioss-ui').shadowRoot.querySelector('.backdrop').click());
  assert(!(await sheetOpen()), 'closed');
  await page.evaluate(() => { location.hash = 'suite'; });
  await until(sheetOpen, 4000, 'sheet after adding #suite');
});

await test('shortlinks: AdLinkFly go-link page is followed as soon as the link is ready', {
  routes: {
    'https://short.example/': html(`<form id="go-link" action="/links/go"></form><a class="get-link btn disabled" href="javascript:void(0)">Please wait</a>
      <script>setTimeout(() => { const a = document.querySelector('a.get-link'); a.href = 'https://destination.example/file'; a.classList.remove('disabled'); }, 400);</script>`),
    'https://destination.example/': html('<h1>arrived</h1>')
  }
}, async ({ page }) => {
  await page.goto('https://short.example/abc');
  await until(() => page.url().startsWith('https://destination.example/file'), 5000, 'redirected');
});

await test('shortlinks: blog result page redirects', {
  routes: { 'https://bloggerpemula.pythonanywhere.com/': html('<p>result</p>'), 'https://final.example/': html('<p>final</p>') },
  store: { 'ioss:state': JSON.stringify({ modules: { shortlinks: { settings: { SetDelay: 1 } } }, core: { welcomed: true } }) }
}, async ({ page }) => {
  await page.goto('https://bloggerpemula.pythonanywhere.com/?BypassResults=https://final.example/x');
  await until(() => page.url().startsWith('https://final.example/x'), 5000, 'redirected');
});

await test('shortlinks: excluded on banking/major sites', {
  routes: { 'https://www.paypal.com/': html(`<form id="go-link"></form><a class="get-link" href="#">x</a><script>setTimeout(() => { document.querySelector('a.get-link').href = 'https://evil.example/'; }, 200);</script>`) }
}, async ({ page }) => {
  await page.goto('https://www.paypal.com/signin');
  await sleep(1500);
  assert(page.url().startsWith('https://www.paypal.com/'), 'stayed on paypal');
});

// Logged-out Instagram: a login wall appears after scrolling, a sign-up
// banner sits at the bottom, and a post viewer modal must stay usable.
const IG_PROFILE = html(`
  <a id="post" href="/p/POST1/">post</a> <a id="reel" href="/reel/REEL1/">reel</a> <a id="other" href="/explore/">explore</a>
  <div id="banner" style="position:fixed;bottom:0;left:0;right:0;height:60px"><a href="/accounts/login/">Log in</a> to see more</div>
  <div id="postmodal" style="position:fixed;inset:0"><div role="dialog"><article><img></article><a href="/accounts/login/">Log in to like</a></div></div>
  <script>
    document.getElementById('postmodal').remove(); // added later by the test
    setTimeout(() => {
      document.body.style.overflow = 'hidden';
      const wrap = document.createElement('div');
      wrap.id = 'wall';
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6)';
      wrap.innerHTML = '<div role="dialog"><form id="loginForm"><input name="username"><input name="password"></form><a href="/accounts/emailsignup/">Sign up</a></div>';
      document.body.appendChild(wrap);
    }, 300);
  </script>`);

await test('instagram: hides the login wall, unlocks scrolling, keeps post viewers', {
  routes: { 'https://www.instagram.com/': IG_PROFILE }
}, async ({ page }) => {
  await page.goto('https://www.instagram.com/someone/');
  await until(() => page.evaluate(() => { const w = document.getElementById('wall'); return w && getComputedStyle(w).display === 'none'; }), 4000, 'wall hidden');
  const r = await page.evaluate(() => {
    const m = document.createElement('div');
    m.id = 'postmodal';
    m.style.cssText = 'position:fixed;inset:0';
    m.innerHTML = '<div role="dialog"><article><img></article><a href="/accounts/login/">Log in to like</a></div>';
    document.body.appendChild(m);
    return { overflow: document.body.style.overflow, banner: getComputedStyle(document.getElementById('banner')).display, wallInDom: !!document.getElementById('wall') };
  });
  assert(r.overflow === '', 'scroll unlocked: ' + r.overflow);
  assert(r.banner === 'none', 'bottom login banner hidden');
  assert(r.wallInDom, 'wall hidden, not removed (React-safe)');
  await sleep(800);
  assert(await page.evaluate(() => getComputedStyle(document.getElementById('postmodal')).display !== 'none'), 'post viewer left alone');
});

await test('instagram: post & reel links open as full pages', {
  routes: { 'https://www.instagram.com/': IG_PROFILE }
}, async ({ page }) => {
  await page.goto('https://www.instagram.com/someone/');
  // Simulate Instagram's SPA handler, which would otherwise open the
  // login-gated in-feed viewer.
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a')) { e.preventDefault(); window.__spa = true; } }));
  await page.tap('#reel');
  await until(() => page.url() === 'https://www.instagram.com/reel/REEL1/', 4000, 'full navigation to reel');
  assert(!(await page.evaluate(() => window.__spa)), 'SPA handler bypassed');
  await page.goto('https://www.instagram.com/someone/');
  await page.evaluate(() => document.addEventListener('click', (e) => { if (e.target.closest('a')) { e.preventDefault(); window.__spa = true; } }));
  await page.tap('#other');
  await sleep(500);
  assert(await page.evaluate(() => window.__spa === true) && page.url().endsWith('/someone/'), 'other links untouched');
});

await test('instagram: close-button mode', {
  routes: { 'https://www.instagram.com/': IG_PROFILE },
  store: { 'ioss:state': JSON.stringify({ modules: { instagram: { settings: { autoClose: false } } }, core: { welcomed: true } }) }
}, async ({ page }) => {
  await page.goto('https://www.instagram.com/someone/');
  await until(() => page.$('#wall .ioss-ig-close'), 4000, 'close button');
  const box = await (await page.$('#wall .ioss-ig-close')).boundingBox();
  assert(box.width >= 44 && box.height >= 44 && box.x + box.width <= 375, 'button is 44pt and on screen: ' + JSON.stringify(box));
  await page.tap('#wall .ioss-ig-close');
  await until(() => page.evaluate(() => getComputedStyle(document.getElementById('wall')).display === 'none' && document.body.style.overflow === ''), 2000, 'closed');
});

await test('downloader: Instagram picks the reel that is on screen', {
  routes: { 'https://www.instagram.com/': html(`<div style="height:2000px"><article style="height:600px"><a href="/p/AAA/">a</a><video style="width:300px;height:500px"></video></article>
    <article style="height:600px"><a href="/reel/BBB/">b</a><video style="width:300px;height:500px"></video></article></div>`) }
}, async ({ page, opened }) => {
  await page.goto('https://www.instagram.com/');
  await page.evaluate(() => window.scrollTo(0, 650));
  await until(async () => page.evaluate(() => !!document.querySelector('ioss-ui') && !!document.querySelector('ioss-ui').shadowRoot.querySelector('.fab.show')), 5000, 'fab');
  await page.evaluate(() => document.querySelector('ioss-ui').shadowRoot.querySelector('.fab.show').click());
  await until(() => opened.length, 2000, 'opened');
  assert(opened[0].includes(encodeURIComponent('https://www.instagram.com/reel/BBB/')), 'visible reel chosen: ' + opened[0]);
});

await test('updater: hot-swaps a single module and rejects bad checksums', {
  routes: { 'https://www.reddit.com/': html('<p>reddit</p>') },
  store: { 'ioss:state': JSON.stringify({ core: { welcomed: true, lastCheck: 0, intervalHours: 12, autoUpdate: true, notifyUpdates: true } }) },
  xhr: (() => {
    const good = `({ id: 'reddit', name: 'Reddit (hot)', version: '9.0.0', api: 1, match: () => true, defaults: {}, options: [], run() { document.documentElement.setAttribute('data-hot', '9'); } })\n`;
    const bad = `({ id: 'yt-player', name: 'x', version: '9.0.0', api: 1, match: () => true, run() { document.documentElement.setAttribute('data-evil', '1'); } })\n`;
    const sha = (s) => createHash('sha256').update(s).digest('hex');
    return {
      [`${RAW}modules/manifest.json`]: { status: 200, text: JSON.stringify({ suite: '99.0.0', api: 1, modules: {
        reddit: { version: '9.0.0', api: 1, file: 'reddit.js', sha256: sha(good) },
        'yt-player': { version: '9.0.0', api: 1, file: 'yt-player.js', sha256: '0'.repeat(64) },
        downloader: { version: '9.0.0', api: 99, file: 'downloader.js', sha256: 'x' }
      } }) },
      [`${RAW}modules/reddit.js`]: { status: 200, text: good },
      [`${RAW}modules/yt-player.js`]: { status: 200, text: bad }
    };
  })()
}, async ({ page, store, ui, xhrLog }) => {
  await page.goto('https://www.reddit.com/r/x/');
  await until(() => store.has('ioss:code:reddit'), 9000, 'module downloaded');
  const toasts = await until(async () => {
    const t = await ui('.toast .msg');
    return t.some((x) => /Updated: Reddit \(hot\) 9\.0\.0/.test(x.text)) && t;
  }, 3000, 'update toast');
  assert(toasts.some((t) => /99\.0\.0 is available/.test(t.text)), 'suite update notice');
  assert(!store.has('ioss:code:yt-player'), 'bad checksum rejected');
  assert(!xhrLog.some((x) => x.url.includes('downloader.js')), 'incompatible api skipped');
  await page.reload();
  await until(() => page.evaluate(() => document.documentElement.getAttribute('data-hot') === '9'), 4000, 'hot module running');
});

await test('frames: ad iframes on random sites stay untouched', {
  routes: {
    'https://news.example/': html('<iframe src="https://ads.example/frame"></iframe>'),
    'https://ads.example/': html('<p>ad</p>')
  }
}, async ({ page, store }) => {
  await page.goto('https://news.example/');
  await sleep(800);
  const frame = page.frames().find((f) => f.url().startsWith('https://ads.example/'));
  assert(frame, 'frame loaded');
  assert(!(await frame.evaluate(() => !!document.querySelector('ioss-ui'))), 'no UI in frame');
  assert(store.size <= 1, 'no storage traffic from frames');
});

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
