#!/usr/bin/env node
// End-to-end tests for the ClearTube web app (app/) in an emulated iPhone
// 13 mini. YouTube's Data API, embedded player, oEmbed, Return YouTube
// Dislike and SponsorBlock are replaced by fakes, so the tests run offline.
//
// Usage: node test/app.mjs [filter] [--shots]
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (_) { playwright = require('/usr/lib/node_modules/playwright'); }
const { chromium, devices } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'https://app.test/cleartube/';
const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const shotsDir = process.argv.includes('--shots') ? process.env.SHOTS_DIR || '/tmp' : null;
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error('Assertion failed: ' + m); };
async function until(fn, ms = 5000, what = 'condition') {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(80); }
  throw new Error(`Timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}

const VID = 'dQw4w9WgXcQ';
const VID2 = 'aaaaaaaaaaa';
const CHAN = 'UCuAXFkgsw1L7xaCfnd5JJOw';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// Fake YouTube IFrame Player API: records what the app asks of the player.
const FAKE_IFRAME_API = `
window.YT = { Player: class {
  constructor(el, opts) {
    this.t = (opts.playerVars && opts.playerVars.start) || 0; this.state = -1; this.dur = 300; this.opts = opts;
    const node = typeof el === 'string' ? document.getElementById(el) : el;
    const f = document.createElement('iframe'); f.id = 'fake-yt'; f.dataset.video = opts.videoId; f.dataset.start = this.t; f.dataset.host = opts.host;
    node.replaceWith(f); window.__player = this;
    setTimeout(() => opts.events && opts.events.onReady && opts.events.onReady({ target: this }), 10);
  }
  playVideo() { this.state = 1; }
  getCurrentTime() { return this.t; } getPlayerState() { return this.state; } getDuration() { return this.dur; }
  seekTo(s) { this.t = s; (window.__seeks = window.__seeks || []).push(s); }
  destroy() { window.__destroyed = (window.__destroyed || 0) + 1; }
} };
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 0);`;

function video(id, title, extra = {}) {
  return { id, snippet: { title, channelTitle: 'Test Channel', channelId: CHAN, publishedAt: extra.published || '2026-11-01T10:00:00Z',
    description: extra.description || 'Intro at 1:05 and https://example.com/link', liveBroadcastContent: 'none' },
    contentDetails: { duration: extra.duration || 'PT5M' }, statistics: { viewCount: '123456', likeCount: '4321', commentCount: '12' } };
}
const VIDEOS = { [VID]: video(VID, 'Never Gonna Give You Up'), [VID2]: video(VID2, 'Second video', { published: '2026-11-04T10:00:00Z', duration: 'PT10M' }),
  shortsss123: video('shortsss123', 'A Short', { duration: 'PT45S', published: '2026-11-05T10:00:00Z' }) };

function googleApi(url, calls) {
  const u = new URL(url);
  const ep = u.pathname.split('/').pop();
  calls.push(ep);
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  if (u.searchParams.get('key') === 'BADKEY') return json({ error: { errors: [{ reason: 'keyInvalid' }], message: 'API key not valid' } }, 400);
  if (u.searchParams.get('key') === 'NOQUOTA') return json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } }, 403);
  if (ep === 'search') return json({ items: [
    { id: { kind: 'youtube#channel', channelId: CHAN }, snippet: { channelTitle: 'Test Channel', thumbnails: { default: { url: 'https://i.example/c.jpg' } } } },
    { id: { kind: 'youtube#video', videoId: VID } }, { id: { kind: 'youtube#video', videoId: VID2 } }] });
  if (ep === 'videos') return json({ items: (u.searchParams.get('id') || '').split(',').map((id) => VIDEOS[id]).filter(Boolean) });
  if (ep === 'channels') return json({ items: [{ id: CHAN, snippet: { title: 'Test Channel', customUrl: '@testchannel', description: '', thumbnails: { default: { url: 'https://i.example/c.jpg' } } },
    statistics: { subscriberCount: '1500000', videoCount: '42' }, contentDetails: { relatedPlaylists: { uploads: 'UU' + CHAN.slice(2) } } }] });
  if (ep === 'playlistItems') return json({ items: [VID, VID2, 'shortsss123'].map((v) => ({ contentDetails: { videoId: v } })) });
  return json({}, 404);
}

async function test(name, opts, fn) {
  if (filter && !name.includes(filter)) return;
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13 Mini'], serviceWorkers: 'block', colorScheme: opts.dark ? 'dark' : 'light' });
  const calls = [];
  const errors = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(APP)) {
      const rel = url.slice(APP.length).split(/[?#]/)[0] || 'index.html';
      const file = join(root, 'app', rel);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[extname(file)] || 'application/octet-stream', body: readFileSync(file) });
    }
    if (url.startsWith('https://www.youtube.com/iframe_api')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_IFRAME_API });
    if (url.startsWith('https://www.googleapis.com/youtube/v3/')) return route.fulfill(googleApi(url, calls));
    if (url.startsWith('https://www.youtube.com/oembed')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ title: 'Title via oEmbed', author_name: 'Test Channel' }) });
    if (url.startsWith('https://returnyoutubedislikeapi.com/votes')) return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ likes: 4321, dislikes: 87 }) });
    if (url.startsWith('https://sponsor.ajay.app/api/skipSegments/')) {
      const hash = createHash('sha256').update(VID).digest('hex');
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(
        url.includes('/' + hash.slice(0, 4)) ? [{ videoID: VID, segments: [{ category: 'sponsor', segment: [10, 20], actionType: 'skip' }, { category: 'selfpromo', segment: [18, 25], actionType: 'skip' }] }] : []) });
    }
    return route.fulfill({ status: 204, body: '' });
  });
  if (opts.storage) {
    await context.addInitScript((s) => { if (!sessionStorage.getItem('seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('seeded', '1'); } }, opts.storage);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const t0 = Date.now();
  try {
    await fn({ page, calls });
    if (errors.length) throw new Error('Page errors: ' + errors.join(' | '));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert(!overflow, 'no horizontal scrolling at 375pt');
    results.push(true);
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push(false);
    console.log(`  ✗ ${name}\n      ${String(e.stack || e).split('\n').slice(0, 3).join('\n      ')}`);
  } finally {
    await browser.close();
  }
}

const text = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent : null; }, sel);
const toastText = (page) => text(page, '.toast span');
const KEY = { 'ct:settings': { apiKey: 'GOODKEY' } };

console.log('ClearTube web app as iPhone 13 mini\n');

await test('installs as a full-screen home-screen app', {}, async ({ page }) => {
  await page.goto(APP);
  const r = await page.evaluate(async () => ({
    capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]').content,
    icon: document.querySelector('link[rel="apple-touch-icon"]').href,
    fit: document.querySelector('meta[name=viewport]').content.includes('viewport-fit=cover'),
    manifest: await fetch(document.querySelector('link[rel=manifest]').href).then((x) => x.json())
  }));
  assert(r.capable === 'yes' && r.fit, 'standalone + safe-area meta');
  assert(r.manifest.display === 'standalone' && r.manifest.start_url === './' && r.manifest.icons.length >= 2, 'manifest');
  const tabH = await page.evaluate(() => document.querySelector('nav.tabs').getBoundingClientRect().height);
  assert(tabH >= 52, 'tab bar is tall enough to tap: ' + tabH);
  const shown = (sel) => page.evaluate((x) => getComputedStyle(document.querySelector(x)).display !== 'none', sel);
  await page.goto(APP + '#/search');
  await sleep(100);
  assert(!(await shown('#back')) && !(await shown('#refresh')), 'no back/refresh button on top-level tabs');
  await page.goto(APP + '#/watch/' + VID);
  await sleep(100);
  assert(await shown('#back') && !(await shown('#refresh')), 'back button on the watch page');
});

await test('without an API key: pasted link plays with SponsorBlock, dislikes, resume and history', {}, async ({ page, calls }) => {
  await page.goto(APP);
  assert(/Paste a YouTube link/.test(await text(page, 'main')), 'onboarding explains keyless use');
  await page.tap('a[data-tab="search"]');
  await page.fill('input[type=search]', `https://youtu.be/${VID}?si=x`);
  await page.press('input[type=search]', 'Enter');
  await until(() => page.evaluate(() => location.hash === '#/watch/dQw4w9WgXcQ'), 3000, 'watch route');
  await until(() => page.$('#fake-yt'), 3000, 'player');
  const frame = await page.evaluate(() => { const f = document.getElementById('fake-yt'); return { v: f.dataset.video, host: f.dataset.host }; });
  assert(frame.v === VID && frame.host === 'https://www.youtube-nocookie.com', 'privacy-enhanced embed: ' + JSON.stringify(frame));
  await until(async () => (await text(page, '.wtitle')) === 'Title via oEmbed', 3000, 'oEmbed title');
  await until(async () => /87/.test(await text(page, '.acts')), 3000, 'dislike count');
  assert(calls.length === 0, 'no API calls without key');
  // SponsorBlock: 10–20 and 18–25 merge into one skip to 25.
  await sleep(500);
  await page.evaluate(() => { window.__player.state = 1; window.__player.t = 12; });
  await until(() => page.evaluate(() => (window.__seeks || []).includes(25)), 2000, 'skip to 25');
  assert(/Skipped sponsor/.test(await toastText(page)), 'skip toast');
  await page.tap('.toast button');
  await until(() => page.evaluate(() => window.__player.t === 10), 1000, 'undo');
  await sleep(600);
  assert(await page.evaluate(() => window.__player.t === 10), 'undone segment is not skipped again');
  // History & resume
  await page.evaluate(() => { window.__player.t = 120; });
  await page.tap('a[data-tab="home"]');
  // hashchange is dispatched asynchronously: wait for the player to be torn down.
  await until(() => page.evaluate(() => window.__destroyed === 1), 2000, 'player destroyed on leave');
  const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('ct:history')));
  assert(hist[0].id === VID && Math.round(hist[0].pos) === 120 && hist[0].dur === 300, 'history saved on leave: ' + JSON.stringify(hist[0]));
  await page.evaluate(() => { location.hash = '#/watch/dQw4w9WgXcQ'; });
  await until(() => page.$('#fake-yt'), 3000, 'player again');
  assert(await page.evaluate(() => document.getElementById('fake-yt').dataset.start) === '120', 'resumes at 2:00');
});

await test('with an API key: search, watch, subscribe, home feed, library', { storage: KEY }, async ({ page, calls }) => {
  await page.goto(APP + '#/search?q=rick');
  await until(() => page.$$eval('.vcard', (n) => n.length === 2), 4000, 'two results');
  const first = await page.evaluate(() => ({ title: document.querySelector('.vcard .vtitle').textContent, dur: document.querySelector('.vcard .dur').textContent,
    sub: document.querySelector('.vcard .vsub').textContent, chan: document.querySelector('.chan .vtitle').textContent }));
  assert(first.title === 'Never Gonna Give You Up' && first.dur === '5:00' && /123\.5K views/.test(first.sub) && first.chan === 'Test Channel', JSON.stringify(first));
  await page.tap('.vcard');
  await until(async () => (await text(page, '.wtitle')) === 'Never Gonna Give You Up', 3000, 'title');
  await until(async () => /4\.3K/.test(await text(page, '.acts')) && /87/.test(await text(page, '.acts')), 3000, 'likes + dislikes');
  await until(() => page.$('.chan button'), 3000, 'channel row');
  // Description: timestamp seeks the player
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.desc .ts')).find((x) => x.textContent === '1:05'); b.click(); });
  assert(await page.evaluate(() => window.__seeks && window.__seeks.includes(65)), 'timestamp seek');
  await until(() => page.$$eval('.compact', (n) => n.length >= 1), 3000, 'more from channel');
  await page.tap('.chan button');
  assert(/Subscribed to Test Channel/.test(await toastText(page)), 'subscribed');
  await page.tap('.acts button:nth-of-type(1)'); // Later
  await page.tap('a[data-tab="home"]');
  await until(() => page.$$eval('.vcard', (n) => n.length === 3), 4000, 'feed with 3 uploads');
  const order = await page.$$eval('.vcard .vtitle', (n) => n.map((x) => x.textContent));
  assert(order[0] === 'A Short' && order[1] === 'Second video', 'feed newest first: ' + order);
  await page.tap('a[data-tab="library"]');
  const lib = await until(async () => { const t = await text(page, 'main'); return /Subscriptions \(/.test(t || '') && t; }, 2000, 'library');
  assert(/Subscriptions \(1\)/.test(lib) && /Test Channel/.test(lib) && /Never Gonna Give You Up/.test(lib), 'library lists subscription, watch later and history: ' + lib.slice(0, 400));
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('ct:quota')));
  assert(q.used >= 100 && q.used < 120, 'quota tracked: ' + q.used);
  assert(calls.filter((c) => c === 'search').length === 1, 'one search call');
});

await test('hide Shorts setting, channel page and subscription import', { storage: { 'ct:settings': { apiKey: 'GOODKEY', hideShorts: true } } }, async ({ page }) => {
  await page.goto(APP + '#/channel/' + CHAN);
  await until(() => page.$$eval('.vcard', (n) => n.length === 2), 4000, 'channel uploads without the Short');
  assert(/1\.5M subscribers/.test(await text(page, '.chan')), 'channel header');
  await page.tap('a[data-tab="library"]');
  await page.fill('textarea', 'https://www.youtube.com/@testchannel\nnot a channel');
  await page.tap('.card .btn.primary');
  await until(async () => /Imported 1 new subscription/.test(await toastText(page) || ''), 4000, 'import toast');
  await until(async () => /Subscriptions \(1\)/.test(await text(page, 'main')), 2000, 'library refreshed');
});

await test('clear messages for a bad key and an exhausted quota', { storage: { 'ct:settings': { apiKey: 'BADKEY' } } }, async ({ page }) => {
  await page.goto(APP + '#/search?q=x');
  await until(async () => /API key was rejected/.test(await text(page, 'main')), 3000, 'bad key message');
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('ct:settings')); s.apiKey = 'NOQUOTA'; localStorage.setItem('ct:settings', JSON.stringify(s)); });
  await page.goto(APP + '#/search?q=y');
  await page.reload();
  await until(async () => /quota is used up/.test(await text(page, 'main')), 3000, 'quota message');
});

await test('settings: key check, SponsorBlock categories, export', {}, async ({ page }) => {
  await page.goto(APP + '#/settings');
  await page.fill('.card input[type=text]', 'GOODKEY');
  await page.tap('text=Save key');
  await until(async () => /Key works/.test(await toastText(page) || ''), 3000, 'key verified');
  const labels = await page.$$eval('.switch > span', (n) => n.map((x) => x.childNodes[0].textContent));
  assert(labels.includes('Skip sponsors') && labels.includes('Skip non-music parts in music videos'), 'readable labels: ' + labels.slice(0, 3));
  const fontSize = await page.evaluate(() => getComputedStyle(document.querySelector('.card input[type=text]')).fontSize);
  assert(fontSize === '16px', 'inputs do not trigger iOS zoom');
});

if (shotsDir) {
  for (const dark of [false, true]) {
    await test(`screenshots (${dark ? 'dark' : 'light'})`, { storage: KEY, dark }, async ({ page }) => {
      await page.goto(APP + '#/search?q=rick');
      await until(() => page.$$eval('.vcard', (n) => n.length === 2), 4000, 'results');
      await sleep(300);
      await page.screenshot({ path: `${shotsDir}/ct-search-${dark ? 'dark' : 'light'}.png` });
      await page.tap('.vcard');
      await until(() => page.$('.chan button'), 3000, 'watch');
      await sleep(400);
      await page.screenshot({ path: `${shotsDir}/ct-watch-${dark ? 'dark' : 'light'}.png` });
    });
  }
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
