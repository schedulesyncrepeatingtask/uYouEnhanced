#!/usr/bin/env node
// Runs the suite the way Safari userscript managers do: as an extension
// content script in an ISOLATED world (no access to the page's JS objects),
// at document_start, against pages with strict CSP. This is what exposes
// bugs such as relying on unsafeWindow/jQuery or patching fetch from the
// sandbox.
//
// Usage: node test/isolated.mjs
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch (_) { playwright = require('/usr/lib/node_modules/playwright'); }
const { chromium } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const suite = JSON.parse(readFileSync(join(root, 'src/suite.json'), 'utf8'));
const BUNDLE = readFileSync(join(root, `dist/${suite.file}.user.js`), 'utf8');

// GM API for a content script: storage in memory + sessionStorage of the
// extension origin is not available, so keep it per page (enough here).
const GM_SHIM = `
var GM = (() => {
  const mem = new Map();
  return {
    getValue: async (k, d) => (mem.has(k) ? mem.get(k) : d),
    setValue: async (k, v) => { mem.set(k, v); },
    deleteValue: async (k) => { mem.delete(k); },
    openInTab: (u) => { document.documentElement.setAttribute('data-opened', u); },
    xmlHttpRequest: (d) => {
      fetch(d.url, { method: d.method || 'GET', body: d.data }).then(async (r) => d.onload && d.onload({ status: r.status, responseText: await r.text(), finalUrl: r.url }))
        .catch(() => d.onerror && d.onerror({}));
    }
  };
})();
`;

const ext = mkdtempSync(join(tmpdir(), 'ioss-ext-'));
mkdirSync(ext, { recursive: true });
writeFileSync(join(ext, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'ioss-test', version: '1.0',
  host_permissions: ['<all_urls>'],
  content_scripts: [{ matches: ['<all_urls>'], js: ['suite.js'], run_at: 'document_start', all_frames: true, world: 'ISOLATED' }]
}));
writeFileSync(join(ext, 'suite.js'), GM_SHIM + '\n' + BUNDLE);

const CSP = "script-src 'nonce-n0nce' 'strict-dynamic'; object-src 'none'";
const page = (body, headers = {}) => ({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': CSP, ...headers }, body: `<!doctype html><html><head><script nonce="n0nce">window.__pageReady=1</script></head><body>${body}</body></html>` });
const cors = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });

const routes = {
  'https://www.google.com/search': page(`<a id="r1" href="/url?q=https%3A%2F%2Fexample.com%2F" ping="/x">r</a>`),
  'https://www.reddit.com/': page(`<script nonce="n0nce">document.body ? 0 : document.addEventListener('DOMContentLoaded', () => document.body.setAttribute('style', 'pointer-events: none; overflow: hidden;'));</script><xpromo-nsfw-blocking-modal-desktop id="m"></xpromo-nsfw-blocking-modal-desktop><shreddit-blurred-container id="b"></shreddit-blurred-container>
    <script nonce="n0nce">customElements.define('shreddit-blurred-container', class extends HTMLElement { handleClick() { this.setAttribute('revealed', ''); } });</script>`),
  'https://short.example/': page(`<form id="go-link" action="/links/go"></form><a class="get-link disabled" href="#">wait</a>
    <script nonce="n0nce">setTimeout(() => { const a = document.querySelector('a.get-link'); a.href = 'https://dest.example/ok'; a.classList.remove('disabled'); }, 300);</script>`),
  'https://dest.example/': page('<h1>ok</h1>'),
  'https://m.youtube.com/watch': page(`<div id="player"><div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video><div class="player-controls-bottom-left"></div></div></div>
    <div class="slim-video-action-bar-actions"><div class="segmented-buttons">
      <like-button-view-model><button aria-pressed="false"><span role="text">1K</span></button></like-button-view-model>
      <dislike-button-view-model><button aria-pressed="false"><span role="text"></span></button></dislike-button-view-model></div></div>
    <ytm-promoted-sparkles-web-renderer id="ad1">Ad</ytm-promoted-sparkles-web-renderer>`),
  'https://www.instagram.com/': page(`<a id="reel" href="/reel/R1/">reel</a>
    <script nonce="n0nce">document.addEventListener('click', (e) => { if (e.target.closest('a')) { e.preventDefault(); window.__spa = 1; } });
      setTimeout(() => { document.body.style.overflow = 'hidden'; const w = document.createElement('div'); w.id = 'wall'; w.style.cssText = 'position:fixed;inset:0';
        w.innerHTML = '<div role="dialog"><input name="username"><a href="/accounts/emailsignup/">Sign up</a></div>'; document.body.appendChild(w); }, 200);</script>`),
  'https://returnyoutubedislikeapi.com/votes': cors(JSON.stringify({ likes: 1000, dislikes: 4321 }))
};

const results = [];
const check = (ok, name, extra = '') => { results.push(ok); console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); };

const ctx = await chromium.launchPersistentContext('', {
  // Extensions only load in Chromium's "new" headless mode.
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  viewport: { width: 375, height: 629 }, deviceScaleFactor: 3, isMobile: false, hasTouch: true
});
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  for (const [p, r] of Object.entries(routes)) if (url.startsWith(p)) return route.fulfill(r);
  if (url.includes('/gen_204')) return route.fulfill(cors(''));
  return route.fulfill({ status: 204, body: '' });
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('Isolated-world (Safari-like) tests\n');
try {
  await p.goto('https://www.google.com/search?q=a&safe=off');
  await sleep(800);
  const g = await p.evaluate(() => ({ href: document.getElementById('r1').getAttribute('href'), ping: document.getElementById('r1').hasAttribute('ping'), guarded: !!window.__iossDtmg }));
  check(g.href === 'https://example.com/' && !g.ping, 'google: links cleaned from the isolated world', JSON.stringify(g));
  // Note: Chromium MV3 applies the *extension's* CSP to scripts a content
  // script inserts, so page-world injection cannot succeed in this harness
  // (Safari applies the page's CSP instead; see test/run.mjs for the nonce
  // path). Here we only verify graceful degradation.
  check(!g.guarded, 'google: page-world guards degrade gracefully when injection is impossible');

  await p.goto('https://www.reddit.com/r/x/');
  await sleep(800);
  const r = await p.evaluate(() => ({ modal: !!document.getElementById('m'), revealed: document.getElementById('b').hasAttribute('revealed') }));
  check(!r.modal, 'reddit: modal removed');
  check(await p.evaluate(() => !/pointer-events/.test(document.body.getAttribute('style') || '')), 'reddit: scrolling unlocked from the sandbox');

  await p.goto('https://m.youtube.com/watch?v=dQw4w9WgXcQ');
  await sleep(2500);
  const y = await p.evaluate(() => ({
    dislikes: document.querySelector('dislike-button-view-model span[role=text]').textContent,
    pip: !!document.querySelector('.player-controls-bottom-left .ioss-pip-btn'),
    ad: getComputedStyle(document.getElementById('ad1')).display
  }));
  check(/4\.3K/.test(y.dislikes), 'youtube: dislikes fetched via GM.xmlHttpRequest and shown', y.dislikes);
  check(y.pip, 'youtube: PiP button inserted');
  check(y.ad === 'none', 'youtube: promoted ad hidden');

  await p.goto('https://www.instagram.com/someone/');
  await sleep(1000);
  const ig = await p.evaluate(() => ({ wall: getComputedStyle(document.getElementById('wall')).display, overflow: document.body.style.overflow }));
  check(ig.wall === 'none' && ig.overflow === '', 'instagram: login wall hidden from the sandbox', JSON.stringify(ig));
  await p.click('#reel');
  await p.waitForURL('https://www.instagram.com/reel/R1/', { timeout: 4000 }).then(() => check(true, 'instagram: reel opened as a full page before the site handler'), () => check(false, 'instagram: reel opened', p.url()));

  await p.goto('https://short.example/abc');
  await p.waitForURL('https://dest.example/ok', { timeout: 5000 }).then(() => check(true, 'shortlinks: go-link followed without page jQuery'), () => check(false, 'shortlinks: go-link followed', p.url()));
} finally {
  await ctx.close();
}
check(errors.length === 0, 'no page errors', errors.join(' | '));
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
