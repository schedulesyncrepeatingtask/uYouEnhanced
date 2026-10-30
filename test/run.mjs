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
  // Download button
  await until(async () => (await ui('.fab.show')).length > 0, 4000, 'download button');
  await page.evaluate(() => document.querySelector('ioss-ui').shadowRoot.querySelector('.fab.show').click());
  await until(() => opened.length > 0, 2000, 'download opened');
  assert(opened[0].startsWith('https://www.tool77.com/') && opened[0].includes(encodeURIComponent(`https://www.youtube.com/watch?v=${VIDEO_ID}`)), 'download url: ' + opened[0]);
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
  assert(names.length === 12, 'all modules listed: ' + names.join(', '));
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
