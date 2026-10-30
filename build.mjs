#!/usr/bin/env node
// Builds dist/ from src/:
//   dist/<file>.user.js         – the single userscript to install
//   dist/<file>.meta.js         – metadata only (used by managers to check for updates)
//   dist/modules/<id>.js        – each module on its own (used by the in-script hot updater)
//   dist/modules/manifest.json  – versions + SHA-256 of every module
//
// Usage: node build.mjs [--check]   (--check fails if dist/ is out of date)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const suite = JSON.parse(read('src/suite.json'));

// Load order = run order on a page.
const ORDER = [
  'google-consent', 'google-privacy', 'google-lite', 'reddit', 'instagram',
  'yt-adblock', 'yt-sponsorblock', 'yt-dislike', 'yt-player',
  'downloader', 'shortlinks', 'dark-mode', 'web-limits'
];

const raw = `https://raw.githubusercontent.com/${suite.repo}/${suite.branch}/dist/`;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const modules = ORDER.map((id) => {
  const code = read(`src/modules/${id}.js`).trim() + '\n';
  // eslint-disable-next-line no-new-func
  const def = new Function(`"use strict";\nreturn (\n${code}\n);`)();
  if (def.id !== id) throw new Error(`${id}.js declares id "${def.id}"`);
  if (!/^\d+(\.\d+)*$/.test(def.version)) throw new Error(`${id}: bad version ${def.version}`);
  if ((def.api || 1) > suite.api) throw new Error(`${id}: needs core api ${def.api}`);
  for (const k of Object.keys(def.defaults || {})) {
    if (!(def.options || []).some((o) => o.key === k)) throw new Error(`${id}: default "${k}" has no option`);
  }
  return { id, code, def };
});

const header = read('src/header.js')
  .replaceAll('{{NAME}}', suite.name)
  .replaceAll('{{VERSION}}', suite.version)
  .replaceAll('{{REPO}}', suite.repo)
  .replaceAll('{{RAW}}', raw)
  .replaceAll('{{FILE}}', suite.file);

const core = read('src/core.js')
  // Function replacements: a plain string would treat "$&", "$'" etc. in
  // module code as replacement patterns and corrupt it.
  .replace('/*@@SUITE@@*/', () => JSON.stringify({ name: suite.name, version: suite.version, api: suite.api, repo: suite.repo, branch: suite.branch, file: suite.file }))
  .replace('  /*@@MODULES@@*/', () => modules.map((m) => `  /* ---- module: ${m.id} v${m.def.version} ---- */\n  register(${m.code.trim()});\n`).join('\n'));

if (core.includes('@@MODULES@@')) throw new Error('module placeholder leaked into the bundle');
for (const m of modules) {
  if (!core.includes(m.code.trim())) throw new Error(`${m.id}: bundled code differs from src/modules/${m.id}.js`);
}

const bundle = `${header}\n${core}`;
// Parse check (throws on syntax errors).
// eslint-disable-next-line no-new-func
new Function(bundle);

const manifest = {
  suite: suite.version,
  api: suite.api,
  modules: Object.fromEntries(modules.map((m) => [m.id, {
    name: m.def.name,
    version: m.def.version,
    api: m.def.api || 1,
    file: `${m.id}.js`,
    sha256: sha256(m.code)
  }]))
};

const outputs = {
  [`dist/${suite.file}.user.js`]: bundle,
  [`dist/${suite.file}.meta.js`]: header,
  'dist/modules/manifest.json': JSON.stringify(manifest, null, 2) + '\n',
  ...Object.fromEntries(modules.map((m) => [`dist/modules/${m.id}.js`, m.code]))
};

if (process.argv.includes('--check')) {
  const stale = Object.entries(outputs).filter(([p, c]) => !existsSync(join(root, p)) || read(p) !== c).map(([p]) => p);
  if (stale.length) { console.error('dist/ is out of date, run `node build.mjs`:\n  ' + stale.join('\n  ')); process.exit(1); }
  console.log('dist/ is up to date');
} else {
  for (const [p, c] of Object.entries(outputs)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
  console.log(`Built ${suite.name} v${suite.version} (${(bundle.length / 1024).toFixed(0)} KB) with ${modules.length} modules:`);
  for (const m of modules) console.log(`  ${m.id.padEnd(16)} v${m.def.version}`);
}
