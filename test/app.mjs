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
  // Errors are expected while the page is away at the (fake) Google sign-in.
  while (Date.now() < end) { try { last = await fn(); } catch (e) { last = String(e.message).slice(0, 80); } if (last && typeof last !== 'string' || (last && !/^(page\.|.*Execution context|.*SecurityError)/.test(last))) return last; await sleep(80); }
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

function googleApi(req, calls) {
  const url = req.url();
  const u = new URL(url);
  const ep = u.pathname.replace('/youtube/v3/', '');
  const bearer = (req.headers().authorization || '').replace('Bearer ', '');
  calls.push(ep + (req.method() !== 'GET' ? ':' + req.method() : '') + (bearer ? '@' + bearer : '') + (u.searchParams.get('key') ? '#key' : '') +
    (u.searchParams.get('rating') ? '=' + u.searchParams.get('rating') : ''));
  const json = (b, status = 200) => ({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(b) });
  if (u.searchParams.get('key') === 'BADKEY') return json({ error: { errors: [{ reason: 'keyInvalid' }], message: 'API key not valid' } }, 400);
  if (u.searchParams.get('key') === 'NOQUOTA') return json({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'quota' } }, 403);
  if (bearer === 'EXPIRED') return json({ error: { errors: [{ reason: 'authError' }], message: 'Invalid Credentials' } }, 401);
  if (bearer) {
    // Signed-in endpoints
    if (ep === 'channels' && u.searchParams.get('mine')) return json({ items: [{ id: 'UCme', snippet: { title: 'Me Myself', thumbnails: { default: { url: 'https://i.example/me.jpg' } } } }] });
    if (ep === 'subscriptions' && req.method() === 'GET') return json({ items: [
      { id: 'sub1', snippet: { title: 'Test Channel', resourceId: { channelId: CHAN }, thumbnails: { default: { url: 'https://i.example/c.jpg' } } } },
      { id: 'sub2', snippet: { title: 'Other Channel', resourceId: { channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz' }, thumbnails: { default: { url: 'https://i.example/o.jpg' } } } }] });
    if (ep === 'subscriptions' && req.method() === 'POST') return json({ id: 'subNEW', snippet: JSON.parse(req.postData()).snippet });
    if (ep === 'subscriptions' && req.method() === 'DELETE') return { status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' };
    if (ep === 'videos/getRating') return json({ items: [{ videoId: u.searchParams.get('id'), rating: 'none' }] });
    if (ep === 'videos/rate') return { status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' };
    if (ep === 'videos' && u.searchParams.get('myRating') === 'like') return json({ items: [VIDEOS[VID2]] });
    if (ep === 'playlists') return json({ items: [{ id: 'PLmine', snippet: { title: 'My Mix', thumbnails: { medium: { url: 'https://i.example/p.jpg' } } }, contentDetails: { itemCount: 2 }, status: { privacyStatus: 'private' } }] });
  }
  if (ep === 'commentThreads') return json({ items: [{ snippet: { totalReplyCount: 3, topLevelComment: { snippet: { authorDisplayName: '@fan', authorProfileImageUrl: 'https://i.example/a.jpg', textDisplay: 'Great video!', likeCount: 42, publishedAt: '2026-11-02T10:00:00Z' } } } }] });
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
    if (url.startsWith('https://www.googleapis.com/youtube/v3/')) return route.fulfill(googleApi(route.request(), calls));
    if (url.startsWith('https://accounts.google.com/o/oauth2/v2/auth')) {
      // Fake Google sign-in: answers straight away like an already-signed-in user.
      const q = new URL(url).searchParams;
      calls.push('oauth:' + q.get('prompt') + ':' + q.get('client_id') + ':' + q.get('response_type'));
      const answer = opts.oauth ? opts.oauth(q) : `access_token=TOKEN1&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(q.get('scope'))}&state=${q.get('state')}`;
      // (Playwright cannot fulfil navigations with a 302, so the fake page redirects by script.)
      return route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(q.get('redirect_uri') + '#' + answer)})</script>` });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) { calls.push('revoke'); return route.fulfill({ status: 200, body: '' }); }
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

const SIGNED_IN = (token = 'TOKEN1', expMs = 3600e3) => ({ 'ct:settings': { clientId: 'CLIENT.apps.googleusercontent.com' }, 'ct:auth': { token, exp: Date.now() + expMs } });
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
  await page.goto(APP + '#/later');
  await sleep(100);
  assert(!(await shown('#back')) && !(await shown('#refresh')), 'no back/refresh button on top-level tabs');
  assert(await shown('#search-btn') && await shown('#me-btn'), 'search and account buttons in the top bar');
  await page.goto(APP + '#/');
  await sleep(100);
  assert(await shown('#logo') && await shown('#refresh') && !(await shown('#back')), 'logo + refresh on Home');
  await page.goto(APP + '#/search');
  await sleep(100);
  assert(await shown('#back'), 'back button on Search');
  await page.goto(APP + '#/watch/' + VID);
  await sleep(100);
  assert(await shown('#back') && !(await shown('#refresh')), 'back button on the watch page');
});

await test('without an API key: pasted link plays with SponsorBlock, dislikes, resume and history', {}, async ({ page, calls }) => {
  await page.goto(APP);
  assert(/paste a YouTube link/i.test(await text(page, 'main')), 'onboarding explains keyless use');
  await page.tap('#search-btn');
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
  // Description: "more" opens it in a sheet; a timestamp seeks the player and closes the sheet
  await until(() => page.$('.wmeta .moreb'), 3000, 'more button');
  await page.tap('.wmeta .moreb');
  await until(() => page.$('.sheet.show .desc .ts'), 2000, 'description sheet');
  await page.evaluate(() => { const b = Array.from(document.querySelectorAll('.desc .ts')).find((x) => x.textContent === '1:05'); b.click(); });
  assert(await page.evaluate(() => window.__seeks && window.__seeks.includes(65)), 'timestamp seek');
  await until(() => page.evaluate(() => !document.querySelector('.sheet')), 2000, 'sheet closed');
  await until(() => page.$$eval('.upnext .vcard', (n) => n.length >= 1), 3000, 'more from channel');
  await page.tap('.chan button');
  assert(/Subscribed to Test Channel/.test(await toastText(page)), 'subscribed');
  await page.tap('button[aria-label="Save to Watch later"]');
  assert(/Saved to Watch later/.test(await toastText(page)), 'saved for later');
  await page.tap('a[data-tab="home"]');
  await until(() => page.$$eval('.vcard', (n) => n.length === 3), 4000, 'feed with 3 uploads');
  const order = await page.$$eval('.vcard .vtitle', (n) => n.map((x) => x.textContent));
  assert(order[0] === 'A Short' && order[1] === 'Second video', 'feed newest first: ' + order);
  await page.tap('a[data-tab="library"]');
  const lib = await until(async () => { const t = await text(page, 'main'); return /Subscriptions \(/.test(t || '') && t; }, 2000, 'library');
  assert(/Subscriptions \(1\)/.test(lib) && /Test Channel/.test(lib) && /Never Gonna Give You Up/.test(lib), 'library lists subscription, watch later and history: ' + lib.slice(0, 400));
  const q = await page.evaluate(() => JSON.parse(localStorage.getItem('ct:quota')));
  assert(q.used >= 100 && q.used < 120, 'quota tracked: ' + q.used);
  assert(calls.filter((c) => c.startsWith('search')).length === 1, 'one search call');
});

await test('hide Shorts setting, channel page and subscription import', { storage: { 'ct:settings': { apiKey: 'GOODKEY', hideShorts: true } } }, async ({ page }) => {
  await page.goto(APP + '#/channel/' + CHAN);
  await until(() => page.$$eval('.vcard', (n) => n.length === 2), 4000, 'channel uploads without the Short');
  assert(/1\.5M subscribers/.test(await text(page, '.chan')), 'channel header');
  await page.tap('a[data-tab="library"]');
  await page.fill('textarea', 'https://www.youtube.com/@testchannel\nnot a channel');
  await page.getByRole('button', { name: 'Import', exact: true }).tap();
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
  await page.fill('input[placeholder="AIza…"]', 'GOODKEY');
  await page.tap('text=Save key');
  await until(async () => /Key works/.test(await toastText(page) || ''), 3000, 'key verified');
  const labels = await page.$$eval('.switch > span', (n) => n.map((x) => x.childNodes[0].textContent));
  assert(labels.includes('Skip sponsors') && labels.includes('Skip non-music parts in music videos'), 'readable labels: ' + labels.slice(0, 3));
  const fontSize = await page.evaluate(() => getComputedStyle(document.querySelector('input[placeholder="AIza…"]')).fontSize);
  assert(fontSize === '16px', 'inputs do not trigger iOS zoom');
});

await test('Google sign-in: settings → Google → back to Library with the account', {}, async ({ page, calls }) => {
  await page.goto(APP + '#/settings');
  await page.tap('summary');
  await page.fill('details input[type=text]', 'CLIENT.apps.googleusercontent.com');
  assert(/https:\/\/app\.test\/cleartube\//.test(await text(page, 'details')), 'setup shows the exact redirect URI');
  await page.tap('text=Sign in with Google');
  await until(() => page.evaluate(() => location.hash === '#/library'), 5000, 'returned to Library');
  assert(calls.includes('oauth:select_account:CLIENT.apps.googleusercontent.com:token'), 'OAuth request: ' + calls.filter((c) => c.startsWith('oauth')));
  await until(async () => /Signed in with Google/.test(await toastText(page) || ''), 3000, 'signed-in toast');
  const lib = await until(async () => { const t = await text(page, 'main'); return /Me Myself/.test(t) && /Subscriptions \(2\)/.test(t) && /My Mix/.test(t) && /Second video/.test(t) && t; }, 4000, 'account library');
  await page.tap('a[data-tab="subs"]');
  await until(async () => /Other Channel/.test(await text(page, 'main')), 3000, 'account subscriptions listed');
  await page.goto(APP + '#/library');
  assert(!calls.some((c) => c.includes('#key')) && calls.some((c) => c.startsWith('subscriptions@TOKEN1')), 'requests use the account token, not a key');
  assert(await page.evaluate(() => !/access_token/.test(location.href)), 'token removed from the address');
  // Liked videos & playlist pages
  await page.tap('a[href="#/liked"]');
  await until(() => page.$$eval('.vcard', (n) => n.length === 1), 3000, 'liked list');
  await page.goto(APP + '#/playlist/PLmine');
  await until(() => page.$$eval('.vcard', (n) => n.length === 3), 3000, 'playlist items');
});

await test('signed in: home feed from YouTube subscriptions; like, dislike, comments', { storage: SIGNED_IN() }, async ({ page, calls }) => {
  await page.goto(APP);
  await until(() => page.$$eval('.vcard', (n) => n.length === 3), 4000, 'feed from account subscriptions');
  assert(calls.some((c) => c.startsWith('playlistItems@TOKEN1')), 'uploads fetched with the account');
  await page.goto(APP + '#/watch/' + VID);
  await until(async () => /4\.3K/.test(await text(page, '.acts') || '') && /87/.test(await text(page, '.acts')), 4000, 'counts');
  await page.tap('button[aria-label="Like"]');
  await until(async () => /4\.3K/.test(await text(page, 'button[aria-label="Like"]')) && await page.evaluate(() => document.querySelector('button[aria-label="Like"]').classList.contains('on')), 2000, 'liked');
  assert(calls.includes('videos/rate:POST@TOKEN1=like'), 'rated like: ' + calls.filter((c) => c.includes('rate')));
  await page.tap('button[aria-label="Dislike"]');
  await until(() => page.evaluate(() => document.querySelector('button[aria-label="Dislike"]').classList.contains('on') && !document.querySelector('button[aria-label="Like"]').classList.contains('on')), 2000, 'switched to dislike');
  assert(/88/.test(await text(page, 'button[aria-label="Dislike"]')), 'dislike count +1');
  assert(calls.includes('videos/rate:POST@TOKEN1=dislike'), 'rated dislike');
  await until(async () => /Great video!/.test(await text(page, '.ccard') || ''), 3000, 'comments card');
  await page.tap('.ccard');
  await until(() => page.$('.sheet.show .comment'), 2000, 'comments sheet');
  assert(/3 replies/.test(await text(page, '.comment')), 'reply count');
});

await test('signed in: subscribe & unsubscribe change the YouTube account', { storage: SIGNED_IN() }, async ({ page, calls }) => {
  await page.goto(APP + '#/channel/' + CHAN);
  await until(async () => (await text(page, '.chan .btn')) === 'Subscribed', 4000, 'already subscribed (from account)');
  await page.tap('.chan .btn');
  await until(async () => (await text(page, '.chan .btn')) === 'Subscribe', 3000, 'unsubscribed');
  assert(calls.includes('subscriptions:DELETE@TOKEN1'), 'DELETE sent');
  await page.tap('.chan .btn');
  await until(async () => (await text(page, '.chan .btn')) === 'Subscribed', 3000, 'subscribed again');
  assert(calls.includes('subscriptions:POST@TOKEN1'), 'POST sent');
});

await test('expired sign-in renews silently and returns to the same page', { storage: SIGNED_IN('OLD', -1000) }, async ({ page, calls }) => {
  await page.goto(APP + '#/library');
  await until(() => page.evaluate(() => JSON.parse(localStorage.getItem('ct:auth')).token === 'TOKEN1'), 5000, 'new token');
  assert(calls.some((c) => c.startsWith('oauth:none:')), 'silent renewal (prompt=none)');
  await until(() => page.evaluate(() => location.hash === '#/library'), 2000, 'back on Library');
  await until(async () => /Me Myself/.test(await text(page, 'main')), 4000, 'library loads with the new token');
});

await test('when Google needs the user, renewal asks to sign in again (no loop)', { storage: SIGNED_IN('OLD', -1000), oauth: (q) => `error=interaction_required&state=${q.get('state')}` }, async ({ page, calls }) => {
  await page.goto(APP + '#/library');
  await until(async () => /sign-in expired/.test(await toastText(page) || ''), 5000, 'expired message');
  await sleep(1500);
  assert(calls.filter((c) => c.startsWith('oauth:')).length === 1, 'tried only once');
  assert(/Sign in with Google/.test(await text(page, 'main')), 'offers sign-in again');
});

await test('a sign-in answer with the wrong state is rejected', {}, async ({ page }) => {
  await page.goto(APP + '#access_token=EVIL&expires_in=3600&state=forged');
  await until(async () => /could not be verified/.test(await toastText(page) || ''), 3000, 'rejected');
  assert(await page.evaluate(() => !localStorage.getItem('ct:auth') || !JSON.parse(localStorage.getItem('ct:auth'))), 'no token stored');
});

if (shotsDir) {
  await test('screenshots (signed in)', { storage: SIGNED_IN(), dark: true }, async ({ page }) => {
    await page.goto(APP);
    await until(() => page.$$eval('.vcard', (n) => n.length === 3), 4000, 'feed');
    await sleep(400);
    await page.screenshot({ path: `${shotsDir}/ct-home.png` });
    await page.goto(APP + '#/watch/' + VID);
    await until(async () => /Great video!/.test(await text(page, '.ccard') || ''), 4000, 'watch');
    await sleep(400);
    await page.screenshot({ path: `${shotsDir}/ct-watch-signed-in.png` });
    await page.tap('.wmeta .moreb');
    await sleep(400);
    await page.screenshot({ path: `${shotsDir}/ct-description.png` });
    await page.goto(APP + '#/subs');
    await until(async () => /Other Channel/.test(await text(page, 'main') || ''), 4000, 'subs');
    await sleep(300);
    await page.screenshot({ path: `${shotsDir}/ct-subs.png` });
    await page.goto(APP + '#/library');
    await until(async () => /My Mix/.test(await text(page, 'main') || ''), 4000, 'library');
    await sleep(300);
    await page.screenshot({ path: `${shotsDir}/ct-library.png` });
    await page.goto(APP + '#/settings');
    await page.tap('summary');
    await sleep(300);
    await page.screenshot({ path: `${shotsDir}/ct-settings.png` });
  });
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
