#!/usr/bin/env node
// Checks the downloader's MP4 joiner against real files made by ffmpeg:
// YouTube-style fragmented (DASH) picture-only and sound-only files, and
// ordinary (non-fragmented) ones. The joined file must have both tracks,
// the right length, decode without errors and keep picture and sound in
// sync. Skipped when ffmpeg is not installed.
//
// Usage: node test/mp4.mjs
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch (_) { console.log('ffmpeg not installed: skipped'); process.exit(0); }

// eslint-disable-next-line no-eval
const def = (0, eval)(readFileSync(join(root, 'src/modules/downloader.js'), 'utf8'));
const dir = mkdtempSync(join(tmpdir(), 'ioss-mp4-'));
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());

const FRAG = ['-movflags', '+frag_keyframe+empty_moov+default_base_moof'];
const DASH = ['-movflags', '+dash+global_sidx'];
const SECONDS = 6;
function make(name, kind, flags) {
  const out = join(dir, name);
  if (kind === 'video') ff('-f', 'lavfi', '-i', `testsrc=size=640x360:rate=30:duration=${SECONDS}`, '-c:v', 'libx264', '-bf', '2', '-g', '30', '-pix_fmt', 'yuv420p', '-an', ...flags, '-f', 'mp4', out);
  else ff('-f', 'lavfi', '-i', `sine=frequency=440:duration=${SECONDS}`, '-c:a', 'aac', '-b:a', '128k', '-vn', ...flags, '-f', 'mp4', out);
  return new Uint8Array(readFileSync(out));
}

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log('  ✓ ' + name); } catch (e) { results.push(false); console.log('  ✗ ' + name + '\n      ' + (e && e.stack || e)); }
}
const assert = (c, m) => { if (!c) throw new Error('Assertion failed: ' + m); };
function write(name, r) {
  const file = join(dir, name);
  writeFileSync(file, Buffer.concat(r.parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))));
  return file;
}
function check(file, wantStreams) {
  const p = probe(file);
  const types = p.streams.map((s) => s.codec_type).sort();
  assert(JSON.stringify(types) === JSON.stringify(wantStreams), 'streams: ' + types);
  const dur = Number(p.format.duration);
  assert(Math.abs(dur - SECONDS) < 0.2, 'duration ' + dur);
  // Decodes completely without errors.
  const errors = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert(!errors.trim(), 'decode errors: ' + errors);
  // moov before mdat ("fast start"), like a camera recording.
  const head = readFileSync(file).subarray(0, 64).toString('latin1');
  assert(head.indexOf('moov') !== -1 && head.indexOf('moov') < 40, 'moov at the front');
  return p;
}

console.log('MP4 joiner\n');
const vFrag = make('v-frag.mp4', 'video', FRAG);
const aFrag = make('a-frag.mp4', 'audio', FRAG);
const vDash = make('v-dash.mp4', 'video', DASH);
const aDash = make('a-dash.mp4', 'audio', DASH);
const vPlain = make('v-plain.mp4', 'video', []);
const aPlain = make('a-plain.mp4', 'audio', []);

test('fragmented picture + fragmented sound → one ordinary MP4', () => {
  const r = def.mp4.join([vFrag, aFrag]);
  const p = check(write('j1.mp4', r), ['audio', 'video']);
  const v = p.streams.find((s) => s.codec_type === 'video');
  assert(v.codec_name === 'h264' && v.width === 640 && v.height === 360, 'video stream: ' + JSON.stringify([v.codec_name, v.width, v.height]));
  assert(Number(v.nb_frames) === SECONDS * 30, 'all frames kept: ' + v.nb_frames);
  assert(r.size === readFileSync(join(dir, 'j1.mp4')).length, 'reported size');
});

test('YouTube-style DASH files (with sidx), sound given first', () => {
  const r = def.mp4.join([aDash, vDash]);
  check(write('j2.mp4', r), ['audio', 'video']);
});

test('ordinary (non-fragmented) files', () => {
  check(write('j3.mp4', def.mp4.join([vPlain, aPlain])), ['audio', 'video']);
});

test('picture and sound start together (B-frame delay handled)', () => {
  const file = join(dir, 'j1.mp4');
  const first = (sel) => Number(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', file]).toString()).packets[0].pts_time);
  const ref = (sel) => Number(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'packet=pts_time', '-read_intervals', '%+#1', '-of', 'json', join(dir, 'v-plain.mp4')]).toString()).packets[0].pts_time);
  assert(Math.abs(first('v:0') - ref('v:0')) < 0.001, `video starts like the original (${first('v:0')} vs ${ref('v:0')})`);
  assert(Math.abs(first('a:0')) < 0.05, 'audio starts at 0: ' + first('a:0'));
});

test('sound only → an .m4a', () => {
  const r = def.mp4.join([aDash]);
  const file = write('j4.m4a', r);
  check(file, ['audio']);
  assert(readFileSync(file).subarray(8, 12).toString('latin1') === 'M4A ', 'M4A brand');
});

test('a cut-off download keeps every complete sample instead of failing', () => {
  const cut = vFrag.subarray(0, Math.floor(vFrag.length * 0.6));
  const t = def.mp4.readTrack(cut);
  assert(t.samples.length > 30 && t.samples.length < SECONDS * 30, 'partial samples: ' + t.samples.length);
});

test('rejects files that are not MP4', () => {
  let err = null;
  try { def.mp4.join([new Uint8Array(1000)]); } catch (e) { err = e; }
  assert(err && /not an MP4/.test(err.message), 'error: ' + err);
});

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
