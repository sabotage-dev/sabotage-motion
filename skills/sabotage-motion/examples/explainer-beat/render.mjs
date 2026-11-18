// Driver: serves this folder, runs the page in headless Chrome, pipes raw RGBA frames to ffmpeg.
//
//   node render.mjs stills 0.5,1.2,2.4 [--scale 0.5] [--dir stills]   PNG style frames
//   node render.mjs contact [--n 12] [--cols 4] [--scale 0.25]         one PNG grid of the whole timeline
//   node render.mjs video [--from 0 --to DUR] [--out out/<scene>.mp4]  silent video (+ <out>.render.json)
//   node render.mjs audio [--out out/<scene>.wav]                      synthesized effects and bed stems only (+ records)
//   node render.mjs full  [--out out/<scene>.mp4]                      video + audio, muxed (+ <out>.render.json)
//   node render.mjs board [--slates] [--safe] [--cols N] [--out board.png]   storyboard sheet (+ board.md)
//   node render.mjs hash 0.5,1.2 [--scale 0.25]                        SHA-256 of each frame's raw pixels
//   node render.mjs doctor                                             check Chrome, WebGL2, ffmpeg, fonts, the look and brand.json
//   node render.mjs brand [--out brand.png]                            brand sheet: swatches, type specimen, logo on each ground
//   node render.mjs palette [--brand brand.json] [--json]              colour match of the piece against its brand kit
//   node render.mjs check [--file out/<name>-final.mp4] [--target tiktok] [--lufs -14 --tp -1.0]
//                         [--json] [--strict] [--plain] [--only id,id]  measured checks (check.mjs)
//
// Paths in --out / --dir resolve against THIS folder (the piece), not your shell's cwd; absolute paths work.
// video, audio and full write to a temporary sibling (out/x.partial.mp4) and rename it onto the output once it is
// complete, so a failed render leaves an earlier output untouched (its old .render.json is deleted at the start).
// The bed stem (plan 23.9): full and audio also write out/<name>.bed.wav when the piece's audio.js has a renderBed (the
// energy preset's beat pattern on its grid, the picture's full length), recorded like the effects stem: full in its
// own record (bed, bedSha256), audio in out/<name>.bed.wav.render.json. tools/mix.mjs mixes it as the bed.
// board: one panel per board.js beat at its key time, captions under each (default --scale 1/3);
//         --slates draws them with slate.js, --safe shades what is outside the target's safe area (the
//         --target, else BOARD.target). Timing comes from cues.js once it exists, else the estimate.
// contact --safe: the same safe-area shading on every panel. Both say "(estimate)" while the target's
//         numbers in safezones.json are not measured.
// check: the piece's source checks (fonts, board, hook, copy, sound notes, motion, first frame, text in the
//         safe area, overlapping text, audio spikes) and flash on its current render in out/ (not checked when
//         there is none, or its source changed), plus with --file the artifact checks on a master (provenance,
//         flash on the file itself, file spec, faststart, loudness, voice delay). One line per result; exit 1 on any
//         FAIL (with --strict, on any WARN too); --json prints the results as JSON instead. With --file,
//         the source checks replay the scene, params, fps, subframes and alpha mode of the render the
//         master came from (its render.json). --plain checks a file from elsewhere as a plain file
//         (file spec against the piece's settings at --scale, faststart, loudness with --lufs). --only
//         runs just the named checks (provenance always runs with --file). --dump <file> also writes the
//         raw measurements (per frame pair, the probe pixels changed by 1, 2, 3, 4, 8 and 16 levels or more;
//         the first frame's luma; the audio windows; each result's level and numbers), with no on-screen
//         text or params, for tuning the thresholds on real pieces (with --plain, each result's level and
//         numbers alone). Exit 2 on a usage error.
// brand: the colour tokens, the font roles and the logo of the piece's style (brand.json, else the look, else the
//         template's own) on one sheet, to approve before anything is animated. Swatch and ground positions print below it.
// palette: every pixel of check's probe frames (1/2 size, 1 subframe, grain off), every frame, goes to the nearest colour
//         (CIEDE2000) among the kit's tokens, the template's and every look's default tokens, or to none when it is more
//         than 10 from all of them. The kit's bgA and bgB must take at least 15% of the pixels and its accent at least
//         0.5%, and no look's defaults (or the template's) more than either. Prints the coverage per token, the fonts the
//         scene drew with, and the rules; exit 1 when a rule fails, 2 on a usage error (no kit, a kit without bgA, bgB
//         or accent). --brand names another kit file than the piece's brand.json (it is only read, not rendered with).
// Looks and kits (looks.js): --param look=<name> (or CFG.LOOK in the scene, or brand.json's look) picks a look;
//         brand.json in the piece overrides it; --param bgA=#hex (any token) and --param bg=<shader id> override both.
//         video and full record the resolved tokens, the look and the font families drawn (fonts_used).
// Common: --scene file.js (default scene.js)  --target name (size, fps and safe area from safezones.json)
//         --fps N  --sub N (motion-blur subframes, default 8)  --scale S  --crf 17  --preset slow
//         --param key=value (repeatable; arrives in scene.init as params.key)
//         --alpha [prores|webm]  transparent background -> ProRes 4444 .mov (default) or VP9 .webm
// Environment: CHROME_PATH (a Chrome or Chromium binary instead of the installed Google Chrome),
//         SM_GPU_ARGS (replaces the GPU flags below, space-separated).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import * as C from './check.mjs';
import * as LK from './looks.js';

const root = path.dirname(fileURLToPath(import.meta.url));   // not URL.pathname: that keeps %20 for spaces
const argv = process.argv.slice(2);
const mode = argv[0];
if (!['stills', 'contact', 'board', 'video', 'audio', 'full', 'hash', 'doctor', 'check', 'brand', 'palette'].includes(mode)) {
  console.error('usage: node render.mjs <stills t1,t2,..|contact|board|video|audio|full|hash t1,..|doctor|check|brand|palette> [options]  (see header)');
  process.exit(2);
}
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const params = []; argv.forEach((a, i) => { if (a === '--param' && argv[i + 1]) params.push(argv[i + 1]); });
const paramObj = (list) => Object.fromEntries(list.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
// check --json keeps stdout for the JSON; everything else goes to stderr
const jsonOut = (mode === 'check' || mode === 'palette') && flag('json');
const say = (...a) => (jsonOut ? console.error : console.log)(...a);
const alphaKind = flag('alpha') ? opt('alpha', 'prores') : null;
if (alphaKind && !['prores', 'webm'].includes(alphaKind)) { console.error('--alpha must be prores or webm'); process.exit(2); }
const defScale = mode === 'stills' ? 0.5 : mode === 'contact' || mode === 'doctor' || mode === 'brand' ? 0.25 : mode === 'board' ? 1 / 3 : mode === 'palette' ? C.T.probeScale : 1;
const scale = +opt('scale', defScale), sub = +opt('sub', mode === 'contact' || mode === 'doctor' || mode === 'board' ? 4 : 8);
const resolveOut = (p) => path.resolve(root, p);
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', rej);
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

// ---------------------------------------------------------------- scene and target
const sceneFile = mode === 'board' && flag('slates') ? 'slate.js' : opt('scene', 'scene.js');
// Why a scene file cannot be used, or null. A scene must sit inside the source hash (sourceHash below): one under
// the top-level out/ or stills/, or any node_modules/ or .git/, could change without marking a master stale. The
// folder names are compared ignoring case: on a case-insensitive disk (macOS's default) OUT/x.js is out/x.js.
function sceneProblem(f) {
  if (!/^[\w][\w./-]*\.m?js$/.test(f) || f.includes('..')) return `${f}: not a scene file name (give a path relative to the piece, e.g. slate.js)`;
  const parts = f.split('/'), low = parts.map((x) => x.toLowerCase());
  const at = ['out', 'stills'].includes(low[0]) ? 0 : low.findIndex((x) => x === 'node_modules' || x === '.git');
  const skipped = at >= 0 ? parts[at] : null;
  if (skipped) return `${f}: a scene under ${skipped}/ is outside the source hash that render.json records, so an edit to it would not mark a master stale; keep scenes beside render.mjs or in a folder of their own`;
  if (!fs.existsSync(path.join(root, f))) return `${f}: no such scene file in this piece (give a path relative to the piece, e.g. slate.js)`;
  return null;
}
// check --file takes its scene from the render record, so the command line's does not have to exist
if (!(mode === 'check' && opt('file')) && sceneProblem(sceneFile)) {
  console.error(`--scene ${sceneProblem(sceneFile)}`);
  process.exit(2);
}
const sceneBase = path.basename(sceneFile).replace(/\.m?js$/, '');
const target = opt('target', null);
if (target) {
  let zones = null;
  try { zones = JSON.parse(fs.readFileSync(path.join(root, 'safezones.json'), 'utf8')); } catch (e) {
    console.error(`--target needs a readable safezones.json in the piece (${e.message})`); process.exit(2);
  }
  if (!zones.targets || !zones.targets[target]) {
    console.error(`--target ${target}: unknown target (safezones.json has: ${Object.keys(zones.targets || {}).join(', ')})`); process.exit(2);
  }
}

// ---------------------------------------------------------------- tiny static server + frame sink
let INFO = null, ff = null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.woff': 'font/woff', '.woff2': 'font/woff2' };
let audioOut = null, bedOut = null;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (url.pathname === '/frame') {
        if (!ff || body.length !== INFO.RW * INFO.RH * 4) { res.writeHead(400); return res.end('bad frame'); }
        const done = () => { res.writeHead(200); res.end('ok'); };
        ff.stdin.write(body) ? done() : ff.stdin.once('drain', done);
      } else if (url.pathname === '/audio') {
        fs.writeFileSync(audioOut, body);
        res.writeHead(200); res.end('ok');
      } else if (url.pathname === '/bed') {
        fs.writeFileSync(bedOut, body);
        res.writeHead(200); res.end('ok');
      } else { res.writeHead(404); res.end(); }
    });
    return;
  }
  if (url.pathname === '/__exists') {   // lib.js asks whether the optional cues.js exists, so a piece without one logs no 404
    const f = path.join(root, url.searchParams.get('path') || '');
    const exists = f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ exists }));
  }
  if (url.pathname === '/__doctor') {   // a blank page carrying index.html's styles (its @font-face rules)
    const style = (fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><style>${style}</style></head><body></body></html>`);
  }
  const f = path.join(root, decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// ---------------------------------------------------------------- browser
// macOS: ANGLE on Metal. Linux: ANGLE on SwiftShader (software WebGL2; Chrome only allows it with
// --enable-unsafe-swiftshader). SM_GPU_ARGS replaces these, e.g. to try a GPU on Linux.
const gpuArgs = process.env.SM_GPU_ARGS != null ? process.env.SM_GPU_ARGS.split(/\s+/).filter(Boolean)
  : os.platform() === 'darwin' ? ['--use-angle=metal'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const chromeArgs = [...gpuArgs, '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const launch = () => chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: chromeArgs,
});
// The page's settings: this command line's, or (check --file) the ones a render record names.
function pieceQuery(o = {}) {
  const s = { scale, sub, scene: sceneFile, target, fps: opt('fps'), alpha: !!alphaKind, params: paramObj(params), check: false, ...o };
  const qs = new URLSearchParams({ scale: String(s.scale), sub: String(s.sub), scene: s.scene });
  if (s.target) qs.set('target', s.target);
  if (s.fps) qs.set('fps', String(s.fps));
  if (s.alpha) qs.set('alpha', '1');
  if (s.check) qs.set('check', '1');
  for (const [k, v] of Object.entries(s.params || {})) qs.set('p.' + k, v);
  return qs;
}
async function openPiece(browser, o, onError) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.setDefaultTimeout(0);
  page.on('console', (m) => say('[page]', m.text()));
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); if (onError) onError(e); else process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${port}/index.html?${pieceQuery(o)}`);
  await page.evaluate(() => window.ready);
  return page;
}

// ---------------------------------------------------------------- hashes (render.json)
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
// A hash over the piece's source: every file except out/, stills/, node_modules/, the review sheets,
// render records and this render's own outputs. Paths and contents both count.
function sourceHash(skip) {
  const files = [];
  const walk = (dir, rel) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name), r = rel ? `${rel}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git' || (!rel && (name === 'out' || name === 'stills'))) continue;
        walk(abs, r);
      } else {
        if (skip.has(abs) || name === '.DS_Store' || name.endsWith('.render.json')) continue;
        if (!rel && ['board.png', 'contact.png', 'board.md', 'brand.png'].includes(name)) continue;
        files.push(`${r}\0${sha256(fs.readFileSync(abs))}\n`);
      }
    }
  };
  walk(root, '');
  return { hash: 'sha256:' + sha256(files.join('')), files: files.length };
}
// SHA-256 of the decoded video stream (ffmpeg's hash muxer over raw frames). VP9 is decoded with
// libvpx-vp9 so the alpha plane counts.
function decodedVideoHash(file) {
  const pre = file.toLowerCase().endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
  const r = spawnSync('ffmpeg', ['-v', 'error', ...pre, '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' });
  const m = r.status === 0 && r.stdout.match(/SHA256=([0-9a-f]{64})/);
  if (!m) throw new Error(`could not hash the decoded video of ${file}: ${r.stderr || r.error}`);
  return 'sha256:' + m[1];
}
// The record is named after the whole output file (out/scene.mp4.render.json), so an .mp4 and an alpha
// .mov of the same name keep separate records. A render deletes its old record before it starts, so a
// failed or interrupted render never leaves a record that describes a different file.
const recordOf = (file) => file + '.render.json';
function writeRenderJson(file, src, extra) {
  const rec = {
    format: 'sabotage-motion/render@1',
    created: new Date().toISOString(),
    mode, file: path.relative(root, file) || file,
    scene: sceneFile, target, silent: INFO.SILENT,
    params: paramObj(params),
    size: [INFO.W, INFO.H], render: [INFO.RW, INFO.RH], scale, fps: INFO.FPS, dur: INFO.DUR, sub,
    alpha: alphaKind, look: INFO.STYLE.look, brand: INFO.STYLE.brand, tokens: INFO.STYLE.tokens, energy: INFO.ENERGY, ...extra,
    source: src,
    video: { hash: decodedVideoHash(file) },
    sha256: sha256(fs.readFileSync(file)),
  };
  const out = recordOf(file);
  fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log('wrote', out);
}

// audio writes a record for its WAV (out/scene.wav.render.json): the source it came from and the WAV's SHA-256, so a
// master's effects stem can be tied to a render of the current source (check's provenance). full records the same
// in its own record (audio, audioSha256).
function writeAudioRecord(file, src, extra = {}) {
  const sha = sha256(fs.readFileSync(file));
  const rec = { format: 'sabotage-motion/render@1', created: new Date().toISOString(), mode, file: path.relative(root, file) || file,
    scene: sceneFile, target, silent: INFO.SILENT, params: paramObj(params), fps: INFO.FPS, dur: INFO.DUR, energy: INFO.ENERGY,
    audio: path.relative(root, file) || file, audioSha256: sha, source: src, sha256: sha, ...extra };
  fs.writeFileSync(recordOf(file), JSON.stringify(rec, null, 2) + '\n');
  console.log('wrote', recordOf(file));
}

// ---------------------------------------------------------------- encoders
function videoArgs(out) {
  const { RW, RH, FPS } = INFO;
  const input = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${RW}x${RH}`, '-r', String(FPS), '-i', '-', '-vf', 'vflip'];
  if (alphaKind === 'prores') return [...input, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', out];
  if (alphaKind === 'webm') return [...input, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', opt('crf', '20'), '-row-mt', '1', out];
  return [...input, '-c:v', 'libx264', '-preset', opt('preset', 'slow'), '-crf', opt('crf', '17'),
    '-maxrate', opt('maxrate', '45M'), '-bufsize', '90M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
}
let ffOut = null, ffAborting = false;
// A render writes each output to a temporary sibling with the same extension (out/x.mp4 -> out/x.partial.mp4) and
// renames it onto the output only once it is complete. A failed render removes only its temporary files, so an
// earlier good output survives untouched (its old record is still deleted first: it described the file this render
// set out to replace, and a record never outlives a doubt about which file it describes).
const partialOf = (f) => { const ext = path.extname(f); return (ext ? f.slice(0, -ext.length) : f) + '.partial' + ext; };
// The temporary files this render is writing (the .partial outputs; for full also the .video temp), removed on any
// failure. Cleared once the record is written.
const partials = new Set();
// Moves a finished temporary file onto its output.
function promote(part, out) {
  fs.renameSync(part, out);
  partials.delete(part);
}
function removePartials() {
  for (const f of partials) { try { if (fs.statSync(f).isFile()) fs.rmSync(f, { force: true }); } catch { /* not there */ } }
  partials.clear();
}
async function renderVideo(page, out, from, to) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...videoArgs(out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  ffOut = out; partials.add(out);
  const proc = ff;
  proc.stdin.on('error', () => {});   // EPIPE once ffmpeg has died; the close handler below reports why
  const done = new Promise((r, j) => { proc.on('error', j); proc.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))); });
  done.catch((e) => { if (ffAborting) return; console.error(`render failed: ${e.message} (ffmpeg's own error is printed above)`); removePartials(); process.exit(1); });
  const t0 = Date.now();
  await page.evaluate(([a, b]) => window.renderRange(a, b), [from, to]);
  const frames = Math.round(to * INFO.FPS) - Math.round(from * INFO.FPS);
  const ms = (Date.now() - t0) / Math.max(1, frames);
  console.log(`video: ${frames} frames at ${INFO.RW}x${INFO.RH}, sub ${sub}: ${ms.toFixed(0)} ms/frame`);
  ff.stdin.end();
  await done;
  ff = null; ffOut = null;
  return frames;
}
// The error path: when the scene throws mid-render, ffmpeg is still waiting on its stdin and would keep this
// process alive (and itself orphaned) forever. Kill it, wait for it, and remove the partial file it wrote.
async function abortVideo() {
  if (!ff) return;
  const p = ff, out = ffOut;
  ff = null; ffOut = null; ffAborting = true;
  if (p.exitCode === null && p.signalCode === null) {
    const closed = new Promise((r) => p.once('close', r));
    p.stdin.destroy();
    p.kill('SIGKILL');
    await closed;
  }
  if (out) fs.rmSync(out, { force: true });
}
async function renderAudioTo(page, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  audioOut = out; await page.evaluate(() => window.renderSound());
  if (INFO.SILENT) console.log(`audio: ${sceneFile} exports silent = true, so the soundtrack is silence`);
  else audioReport(out);
}
// The bed stem (plan 23.9) into `out`: null when the scene is silent or its audio.js has no renderBed, else
// { silent } (the board's bed: false at subtle).
async function renderBedTo(page, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  bedOut = out;
  const r = await page.evaluate(() => window.renderBedSound());
  if (!r) return null;
  const wav = C.readWav(fs.readFileSync(out)), s = C.spikeStats(wav), db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  console.log(r.silent ? `bed: silent (${INFO.ENERGY.name}, the board's bed: false)` : `bed: ${INFO.ENERGY.name} at ${INFO.ENERGY.bpm} BPM, peak ${db(s.peak).toFixed(1)} dBFS, RMS ${db(s.rms).toFixed(1)} dBFS`);
  return r;
}
// The bed stem beside an effects stem or a picture: out/x.wav and out/x.mp4 -> out/x.bed.wav.
const bedOf = (file) => { const ext = path.extname(file); return (ext ? file.slice(0, -ext.length) : file) + '.bed.wav'; };
// Peak, RMS and spike check on the 16-bit WAV from wav.js. A plain "peak under -1 dBFS" test misses
// an envelope bug that fires one full-scale blip, so also flag any 50 ms window far above the loud ones
// (check.mjs spikeStats: the same analysis as check's audio_spike).
function audioReport(file) {
  const wav = C.readWav(fs.readFileSync(file));
  if (!wav.n) { console.log('audio check: no samples'); return; }
  const s = C.spikeStats(wav), db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  console.log(`audio check: peak ${db(s.peak).toFixed(1)} dBFS at ${s.at.toFixed(2)}s, RMS ${db(s.rms).toFixed(1)} dBFS`);
  if (s.peak > 0.89) console.log('  WARN peak above -1 dBFS: lower `level` in audio.js');
  if (s.loud && s.over > C.T.spike.db) console.log(`  WARN the ${s.at.toFixed(2)}s peak is ${s.over.toFixed(0)} dB above the loud windows: likely a click or a gain envelope starting after its source`);
  if (db(s.rms) < -36) console.log('  WARN very quiet overall: raise `level` in audio.js');
}
const videoExt = alphaKind === 'prores' ? '.mov' : alphaKind === 'webm' ? '.webm' : '.mp4';
// The container must match the codec (ProRes can't go in .mp4, x264 shouldn't go in .webm), so the
// extension follows the mode; a mismatched --out extension is replaced, with a note.
const withExt = (p, ext) => {
  const cur = path.extname(p);
  if (!cur) return p + ext;
  if (cur.toLowerCase() !== ext) { console.log(`note: ${cur} doesn't fit this codec; writing ${ext} instead`); return p.slice(0, -cur.length) + ext; }
  return p;
};
// board.md: the board sheet as a table, beside board.png.
function boardMarkdown(r) {
  const cell = (x) => String(x == null ? '' : x).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
  const out = [`# ${cell(r.title || 'Board')}`, '',
    r.estimated ? 'Timing: estimated timing (no cues.js yet: words / wps + 0.25 s per voiced beat).'
      : r.take ? `Timing: from cues.js. VO_OFFSET ${r.voOffset} s (picture time where vo.wav starts); take ${r.take.duration} s.`
      : r.grid ? `Timing: the beats' durations snapped to whole beats of ${r.grid.energy}'s grid, ${r.grid.bpm} BPM (no voice).`
      : 'Timing: the beats\' own durations (no voice).',
    `Scene: ${r.scene}. ${r.rows.length} beats, ${r.dur} s.${r.safe ? ` Safe zones: ${r.safe.target}${r.safe.estimate ? ' (estimate)' : ''}.` : ''}`,
    '', '| # | Beat | Window (s) | Voice | On screen | Look | Sound |', '|---|---|---|---|---|---|---|'];
  r.rows.forEach((b, i) => {
    const flags = [b.hook ? 'hook' : '', b.hold ? 'hold' : ''].filter(Boolean).join(', ');
    const sound = b.sfx === null ? 'silence (on purpose)' : b.sfx === undefined ? '' : `${b.sfx}${b.sfxHit ? ' (hit)' : ''}`;
    out.push(`| ${i + 1} | ${cell(b.id)}${flags ? ` (${flags})` : ''} | ${b.start.toFixed(2)}-${b.end.toFixed(2)} | ${b.vo == null ? `(silent, ${b.dur} s)` : cell(b.vo)} | ${cell(b.on.join(' / '))} | ${cell(b.look)} | ${cell(sound)} |`);
  });
  return out.join('\n') + '\n';
}
const timesArg = () => {
  if (!argv[1] || argv[1].startsWith('--')) throw new Error(`${mode} needs times, e.g. ${mode} 0.5,1.2`);
  return argv[1].split(',').map(Number);
};

// ---------------------------------------------------------------- doctor
// Checks what a render needs and says what to install when something is missing. Exit 1 on any FAIL.
async function doctor() {
  let fails = 0;
  const line = (ok, what, detail, fix) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}: ${detail}`);
    if (!ok) { fails++; if (fix) console.log(`      fix: ${fix}`); }
  };
  const mac = os.platform() === 'darwin';
  line(+process.versions.node.split('.')[0] >= 22, 'node', process.version, 'install Node 22 or 24');
  line(true, 'platform', `${os.platform()} ${os.arch()}`);

  // ffmpeg: every encoder, decoder, filter and muxer the engine and its tools use
  const ffInstall = mac ? 'brew install ffmpeg' : 'sudo apt-get install ffmpeg (or a static build with libx264 and libvpx)';
  const ffv = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' });
  if (ffv.status !== 0) {
    line(false, 'ffmpeg', 'not found on PATH', ffInstall);
  } else {
    line(true, 'ffmpeg', ffv.stdout.split('\n')[0].replace(/^ffmpeg version /, '').split(' Copyright')[0]);
    const list = (what) => spawnSync('ffmpeg', ['-hide_banner', '-' + what], { encoding: 'utf8' }).stdout || '';
    const has = (text, name) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(text);
    const enc = list('encoders'), dec = list('decoders'), fil = list('filters'), mux = list('muxers');
    for (const e of ['libx264', 'libvpx-vp9', 'prores_ks', 'aac', 'mjpeg']) line(has(enc, e), 'ffmpeg encoder', e, `an ffmpeg built with ${e} (${ffInstall})`);
    line(has(dec, 'libvpx-vp9'), 'ffmpeg decoder', 'libvpx-vp9 (reads VP9 alpha)', `an ffmpeg built with libvpx (${ffInstall})`);
    // the engine (vflip, tile, alphaextract), tools/mix.mjs (the audio filters) and tools/frames.mjs (fps)
    for (const f of ['loudnorm', 'ebur128', 'sidechaincompress', 'alimiter', 'amix', 'asplit', 'pan', 'atrim', 'aformat', 'aresample',
      'vflip', 'tile', 'alphaextract', 'fps']) line(has(fil, f), 'ffmpeg filter', f, `an ffmpeg with the ${f} filter (${ffInstall})`);
    // mix.mjs limits with alimiter latency=1 (lookahead compensated) and level=0 (no auto level); without the
    // option, ffmpeg before 5.1, the limiter would shift the mix about 5 ms late
    const lim = spawnSync('ffmpeg', ['-hide_banner', '-h', 'filter=alimiter'], { encoding: 'utf8' }).stdout || '';
    line(/^\s*latency\s/m.test(lim) && /^\s*level\s/m.test(lim), 'ffmpeg filter option', 'alimiter latency and level (tools/mix.mjs keeps the mix sample-aligned)', `ffmpeg 5.1 or newer (${ffInstall})`);
    const amix = spawnSync('ffmpeg', ['-hide_banner', '-h', 'filter=amix'], { encoding: 'utf8' }).stdout || '';
    line(/^\s*normalize\s/m.test(amix), 'ffmpeg filter option', 'amix normalize (tools/mix.mjs sums the stems without rescaling them)', `ffmpeg 5.0 or newer (${ffInstall})`);
    line(has(mux, 'hash'), 'ffmpeg muxer', 'hash (decoded-video hash in render.json)', ffInstall);
    const fp = spawnSync('ffprobe', ['-hide_banner', '-version'], { encoding: 'utf8' });
    line(fp.status === 0, 'ffprobe', fp.status === 0 ? 'found' : 'not found on PATH', ffInstall);
  }
  doctorWhisper(line);   // P10

  // Chrome and WebGL2
  let browser = null;
  try {
    browser = await launch();
    line(true, 'chrome', `${browser.version()} (${process.env.CHROME_PATH ? 'CHROME_PATH=' + process.env.CHROME_PATH : 'Google Chrome, Playwright channel "chrome"'})`);
  } catch (e) {
    line(false, 'chrome', e.message.split('\n')[0], 'install Google Chrome (https://www.google.com/chrome/), or set CHROME_PATH to a Chrome or Chromium binary');
  }
  console.log(`      flags: ${chromeArgs.join(' ')}`);
  if (browser) {
    const page = await browser.newPage();
    page.setDefaultTimeout(120000);
    await page.goto(`http://127.0.0.1:${port}/__doctor`);
    const gl = await page.evaluate(() => {
      const g = document.createElement('canvas').getContext('webgl2');
      if (!g) return null;
      const dbg = g.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: dbg ? g.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER),
        vendor: dbg ? g.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : g.getParameter(g.VENDOR),
        version: g.getParameter(g.VERSION), floatRT: !!g.getExtension('EXT_color_buffer_float'),
        maxTex: g.getParameter(g.MAX_TEXTURE_SIZE),
      };
    });
    const gpuFix = mac ? 'Chrome on macOS should give ANGLE on Metal (--use-angle=metal)'
      : 'Linux needs --use-angle=swiftshader --enable-unsafe-swiftshader (the default here); set SM_GPU_ARGS to try other flags';
    if (!gl) line(false, 'webgl2', 'no WebGL2 context', gpuFix);
    else {
      const kind = /swiftshader/i.test(gl.renderer) ? 'software, SwiftShader: works, slow at full size' : /metal/i.test(gl.renderer) ? 'GPU, Metal' : 'GPU';
      line(true, 'webgl2', `${gl.renderer} [${kind}]`);
      console.log(`      vendor: ${gl.vendor}; ${gl.version}; max texture ${gl.maxTex}`);
      line(gl.floatRT, 'webgl2 EXT_color_buffer_float', gl.floatRT ? 'available' : 'missing (the post chain renders to float targets)', gpuFix);
    }
    // fonts: every family index.html declares
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const families = [...html.matchAll(/@font-face\s*\{([^}]*)\}/g)]
      .map((m) => (m[1].match(/font-family\s*:\s*['"]?([^;'"}]+?)['"]?\s*(;|$)/) || [])[1]).filter(Boolean);
    if (!families.length) line(true, 'fonts', 'index.html declares no @font-face');
    for (const fam of [...new Set(families)]) {
      const r = await page.evaluate(async (f) => {
        try { const faces = await document.fonts.load(`64px "${f}"`); return { n: faces.length, ok: faces.length > 0 && document.fonts.check(`64px "${f}"`) }; } catch (e) { return { n: 0, ok: false, err: e.message }; }
      }, fam);
      line(r.ok, 'font', `${fam}${r.ok ? ' loads' : ' did not load' + (r.err ? ` (${r.err})` : '')}`, 'check the @font-face url() in index.html and the file in fonts/');
    }
    await page.close();
    // the brand kit and the look (plan 23.2): brand.json's fields, that every file it names exists and every colour
    // parses; then the piece opened as check opens it, for the look in effect and each face the look and the kit name
    const kitPath = path.join(root, 'brand.json');
    if (!fs.existsSync(kitPath)) line(true, 'brand kit', 'no brand.json (optional: the project\'s colour tokens, fonts and logo files)');
    else {
      let kit = null, parsed = false;
      try { kit = JSON.parse(fs.readFileSync(kitPath, 'utf8')); parsed = true; } catch (e) { line(false, 'brand kit', `brand.json does not parse: ${e.message}`, 'fix the JSON'); }
      if (parsed) {   // null or false parse too, and brandProblems reports them
        const probs = LK.brandProblems(kit, (f) => { const a = path.join(root, f); return fs.existsSync(a) && fs.statSync(a).isFile(); });
        if (!probs.length) line(true, 'brand kit', `brand.json "${kit.name}": ${Object.keys(kit.colors || {}).length} colours parse, every file it names exists`);
        for (const pr of probs) line(false, 'brand kit', pr, 'the fields are in looks.js\'s header; copy brand.json and every file it names into the piece');
      }
    }
    try {
      const p = await openPiece(browser, { check: true }, () => {});
      const I = await p.evaluate(() => window.INFO);
      await p.close();
      const st = I.STYLE;
      line(true, 'look', st.look ? `${st.look} (${LK.LOOKS[st.look].about}), from ${st.lookFrom}` : 'none: the template\'s own style');
      for (const f of I.FACES) line(f.ok, 'font', `${f.family} (${f.from === 'brand' ? 'brand.json' : `look ${st.look}`}, ${f.roles.join(' and ')}) ${f.ok ? 'loads' : 'did not load'} from ${f.url}`,
        f.from === 'brand' ? 'copy the font file brand.json names into the piece' : `copy ${path.basename(f.url)} from the skill's looks/fonts/ into fonts/ (with its OFL text)`);
    } catch (e) {
      line(false, 'look and kit', `the piece did not open: ${e.message.split('\n')[0]}`, 'an unknown look, a brand.json with bad fields, or a scene error; fix it and run doctor again');
    }
    // probe: one frame of the piece's scene, rendered twice with another frame between
    if (gl) {
      try {
        const p = await openPiece(browser);
        INFO = await p.evaluate(() => window.INFO);
        const t = +(INFO.DUR * 0.5).toFixed(3);
        const s0 = Date.now();
        const h1 = await p.evaluate((x) => window.frameHash(x), t);
        const ms = Date.now() - s0;
        await p.evaluate(() => window.frameHash(0));
        const h2 = await p.evaluate((x) => window.frameHash(x), t);
        line(h1 === h2, 'probe frame', `${sceneFile} t=${t}s at ${INFO.RW}x${INFO.RH}, sub ${sub}: rendered twice, hashes ${h1 === h2 ? 'match' : 'DIFFER'} (${ms} ms/frame)`,
          'a frame depends on state carried between frame() calls, or on Math.random(); draw everything from t');
      } catch (e) {
        line(false, 'probe frame', `${sceneFile} did not render: ${e.message.split('\n')[0]}`, 'fix the scene error above, then run doctor again');
      }
    }
    await browser.close();
  }
  console.log(fails ? `doctor: ${fails} problem${fails > 1 ? 's' : ''}` : 'doctor: all checks passed');
  return fails ? 1 : 0;
}

// ---------------------------------------------------------------- check (plan sections 6.5, 11, 12)
// Gathers the measurements and hands them to check.mjs, which holds every detector and threshold.
const relRoot = (f) => { const x = path.relative(root, f); return x && !x.startsWith('..') && !path.isAbsolute(x) ? x : f; };
// The files a render leaves out of its source hash besides out/ and the review sheets: its own outputs.
function recordSkips(rec) {
  const out = path.resolve(root, rec.file), skip = new Set([out, partialOf(out)]);
  if (rec.mode === 'full') {
    const ext = path.extname(out);
    skip.add(out.slice(0, -ext.length) + '.video' + ext);
    if (rec.audio) { skip.add(path.resolve(root, rec.audio)); skip.add(partialOf(path.resolve(root, rec.audio))); }
    skip.add(bedOf(out)); skip.add(partialOf(bedOf(out)));
  }
  if (rec.mode === 'audio') {   // an audio render writes the effects stem and its bed together; either record skips both
    const fx = rec.role === 'bed' ? out.replace(/\.bed\.wav$/, '.wav') : out;
    for (const f of [fx, bedOf(fx)]) { skip.add(f); skip.add(partialOf(f)); }
  }
  return skip;
}
// flash on the piece's current render (plan 23.9): the newest `video` or `full` render in out/ of the whole piece, with
// this scene, params, fps and length, whose record still describes its file and the source as it is now. Without one,
// flash is not checked and the line says to render.
async function flashOnRender(settings, INFOc) {
  const skip = (why) => ({ id: 'flash', scope: 'source', level: 'SKIP', detail: `not checked: ${why}` });
  if (settings.alpha) return skip('an alpha render is an overlay, and what it flashes depends on the picture under it: check the video it is laid over');
  if (!INFOc) return skip('the scene did not load');
  const dir = path.join(root, 'out'), found = [];
  for (const n of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith('.render.json')) : []) {
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { continue; }
    if (!rec || !['video', 'full'].includes(rec.mode) || rec.alpha || !rec.file) continue;
    if (C.soundDiff(rec, { scene: settings.scene, params: settings.params, fps: INFOc.FPS, dur: INFOc.DUR }).length) continue;
    if (!(rec.from === 0 && Math.abs(rec.to - INFOc.DUR) < 1e-6)) continue;   // a render of part of the piece speaks for that part only
    found.push({ rec, file: path.resolve(root, rec.file) });
  }
  const render = `render it (node render.mjs full), then check again`;
  if (!found.length) return skip(`no render of the whole piece with these settings in out/ to look for flashes in: ${render}`);
  found.sort((a, b) => String(b.rec.created).localeCompare(String(a.rec.created)));
  const why = (x) => (!fs.existsSync(x.file) ? 'is missing' : C.sha256File(x.file) !== x.rec.sha256 ? 'is not the file its render record describes'
    : !x.rec.source || x.rec.source.hash !== sourceHash(recordSkips(x.rec)).hash ? 'was rendered from an older source' : null);
  const cur = found.find((x) => !why(x));
  if (!cur) return skip(`${relRoot(found[0].file)} ${why(found[0])}: ${render}`);
  return C.flashResult(await C.measureFlash(cur.file), { scope: 'source', what: relRoot(cur.file) });
}
// flash on a --file: the file itself, as delivered, whatever its provenance. An overlay is not checked: --alpha, a render
// record of an alpha render, or a file whose stream has alpha (its pixel format, or VP9's alpha_mode=1 tag).
async function flashOnFile(file, rec) {
  if (alphaKind || (rec && rec.alpha) || C.flashProbe(file).alpha) {
    return { id: 'flash', scope: 'file', level: 'SKIP', detail: 'not checked: an overlay with alpha, and what it flashes depends on the picture under it: check the video it is laid over' };
  }
  return C.flashResult(await C.measureFlash(file), { scope: 'file', what: relRoot(file) });
}
// The gains the mixer puts on the effects and the bed stem (plan 23.9: audio_spike hears what is mixed). With a master,
// each stem at the gain its master.json records for it, the bed with the --mute windows it records, and a stem the mix
// left out (--no-sfx, --no-bed, --sting) at zero. A bed from a file (--bed) also counts as zero: the master does contain
// it, but it is not a stem this check can render again. Without a master (a source check), tools/mix.mjs's defaults: a
// voiced board's (effects 0.9, bed 0.22) or the effects alone (1.0, bed 0.5).
async function heardGains(mj, board) {
  if (mj && Array.isArray(mj.stems)) {
    const fx = mj.stems.find((x) => x.role === 'effects'), bd = mj.stems.find((x) => x.role === 'bed' && x.generated);
    return { sfx: fx ? fx.gain : 0, bed: bd ? bd.gain : 0, mutes: bd && Array.isArray(bd.mutes) ? bd.mutes : [], from: `as ${mj.name}.master.json mixed ${fx && bd ? 'them' : 'it'}`, master: true };
  }
  const MX = await import(pathToFileURL(path.join(root, 'tools', 'mix.mjs')).href);
  const voiced = !!(board && (board.beats || []).some((b) => b && b.vo != null));
  return { sfx: voiced ? MX.DEFAULTS.sfxGain : MX.DEFAULTS.sfxGainSolo, bed: voiced ? MX.DEFAULTS.bedGain : MX.DEFAULTS.bedGainSolo, mutes: [], from: `tools/mix.mjs's ${voiced ? 'voiced' : '--master-only'} gains`, master: false };
}
// The bed stem as the mix played it (P11b round 2, H2): its gain and mutes through tools/mix.mjs's own bedPlan, which
// places the bed stem at 0 with no fade, as the mix did. n: the length heard, in samples. A part for C.mixWavs.
async function heardBed(bed, g, n) {
  const MX = await import(pathToFileURL(path.join(root, 'tools', 'mix.mjs')).href);
  const plan = MX.bedPlan({ frames: n, bedFrames: bed.n, gain: g.bed, mutes: g.mutes, sr: bed.sr, generated: true });
  return { wav: bed, gain: g.bed, gainAt: plan.gainAt };
}
async function importPiece(name) {
  const f = path.join(root, name);
  if (!fs.existsSync(f)) return { mod: null };
  try { return { mod: await import(pathToFileURL(f).href) }; } catch (e) { return { mod: null, error: `${name} failed to load: ${e.message}` }; }
}
// ---- P10: a captioned clip (plan 23.5). A composite's record (tools/clip.mjs composite) names the alpha overlay it was
// made from; the master is bound to the overlay as well as to the composite, the text checks replay the overlay's
// settings (alpha included), and the picture checks run on the composite's own frames, decoded with ffmpeg.
// Adds the overlay's provenance result to `push` and returns prov with the overlay record (overlayRec) and the binding.
function compositeBind(prov, push) {
  const rec = prov.rec, f = { overlayFile: rec.overlayFile || null, overlaySha: rec.overlay || null, clipFile: rec.clipFile || null, clipSha: rec.clip || null };
  if (f.overlayFile) {
    const op = path.resolve(root, f.overlayFile);
    f.overlayExists = fs.existsSync(op);
    if (f.overlayExists) {
      f.overlayShaNow = C.sha256File(op);
      try { f.overlayRec = JSON.parse(fs.readFileSync(op, 'utf8')); } catch (e) { f.overlayRecError = e.message; }
      if (f.overlayRec) f.sourceNow = sourceHash(recordSkips(f.overlayRec));
    }
  }
  if (f.clipFile) {
    const cp = path.resolve(root, f.clipFile);
    f.clipExists = fs.existsSync(cp);
    if (f.clipExists) f.clipShaNow = C.sha256File(cp);
  }
  const cb = C.compositeProvenance(f);
  push(cb.result);
  return { ...prov, bound: prov.bound && cb.bound, overlayRec: cb.overlayRec };
}
// The composite's frames at the probe size (check's probe: 1/2 of the design size), decoded by ffmpeg and measured as
// the page measures its probe (C.lumaScan): { frames, pairs, first }. firstOnly reads the first frame alone.
function decodeScan(file, W, H, firstOnly) {
  const w = Math.round(W * C.T.probeScale), h = Math.round(H * C.T.probeScale), size = w * h * 3;
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', ...(firstOnly ? ['-frames:v', '1'] : []),
      '-vf', `scale=${w}:${h}:flags=area`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const scan = C.lumaScan({ firstOnly }), frame = Buffer.alloc(size);
    let fill = 0, err = '';
    p.stdout.on('data', (d) => {
      for (let o = 0; o < d.length;) {
        const n = Math.min(size - fill, d.length - o);
        d.copy(frame, fill, o, o + n); fill += n; o += n;
        if (fill === size) { scan.add(frame, w, h); fill = 0; }
      }
    });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (c) => (c === 0 ? resolve(scan.done()) : reject(new Error(`ffmpeg could not decode ${relRoot(file)}: ${err.trim().split('\n').pop()}`))));
  });
}
// whisper.cpp's whisper-cli (plan 23.5, Q18): optional; tools/clip.mjs reads a transcript either way.
function doctorWhisper(line) {
  const w = spawnSync('whisper-cli', ['--help'], { encoding: 'utf8' });
  line(true, 'whisper-cli', !w.error ? 'found (optional: transcribes a clip for its captions, tools/clip.mjs)'
    : 'not installed (optional: to caption a clip, bring a transcript, or install whisper.cpp: brew install whisper-cpp, or build it from github.com/ggml-org/whisper.cpp)');
}

// ---------------------------------------------------------------- energy_match (plan 23.9, P11b-2)
// Measures the piece's energy in the page (window.energyInfo, energyBoxes, energyScan in main.js) and judges it with
// check.mjs (energyMatch). Not checked: an overlay, a scene without cuts(), or an energy that is not a preset.
async function energyCheck(page, { INFOc, settings, BOARD, windows, sceneFail }) {
  const SK = (why) => [{ id: 'energy_match', scope: 'source', level: 'SKIP', detail: `not checked: ${why}` }];
  if (!INFOc || !page) return SK('the scene did not load');
  if (settings.alpha) return SK('an alpha render is an overlay, and its energy depends on the picture under it');
  const t0 = Date.now();
  try {
    const info = await page.evaluate(() => window.energyInfo());
    if (!info.has) return SK(`${settings.scene} has no cuts(), so no cut can be confirmed: export cuts(), its visual cuts and transitions as [{ t, d }]`);
    const bad = C.validCuts(info.cuts, INFOc.DUR);
    if (bad) { sceneFail(`${settings.scene}: ${bad}`); return SK(bad); }
    const params = settings.params || {};
    const en = C.energySetting({ param: params.energy, board: BOARD && BOARD.energy, cfg: info.energy });
    if (en.error) return SK(`no energy to judge it by: ${en.error}`);
    const tempo = C.energyTempo(en.energy, BOARD && BOARD.bpm);   // the board's own tempo (Q22; council round 1, I1)
    const holdsOk = !C.validHolds(INFOc.HOLDS);
    const holds = C.holdIntervals(holdsOk ? INFOc.HOLDS : null, windows);
    const N = Math.round(INFOc.DUR * INFOc.FPS), reg = C.energyRegions(info.cuts, INFOc.DUR), pairs = C.energyPairs(reg, INFOc.FPS, N);
    const rects = INFOc.BOXES ? C.energyRects(await page.evaluate(() => window.energyBoxes()), INFOc.W, INFOc.H, INFOc.RW, INFOc.RH) : null;
    const asked = pairs.filter(Boolean);
    const scan = await page.evaluate((o) => window.energyScan(o), {
      pairs: asked, rects: rects ? Object.fromEntries(Object.entries(rects).map(([f, l]) => [f, l.map((b) => b.r)])) : {}, inkDelta: C.T.energy.ink.delta, inkRel: C.T.energy.ink.rel });
    let k = 0;
    const pairHists = pairs.map((p) => (p ? scan.pairs[k++] : null));
    const out = C.energyMatch({ energy: en.energy, from: en.from, tempo, dur: INFOc.DUR, fps: INFOc.FPS, cuts: info.cuts.map((c) => ({ t: c.t, d: c.d || 0 })), reg,
      pairHists, motionHists: scan.motion, npx: scan.w * scan.h, holds, rects, ink: scan.ink, RH: scan.h, why: `${settings.scene} has no boxes(t)` });
    say(`check: energy_match measured ${scan.frames} frames${rects ? `, ${Object.keys(rects).length} of them twice (text off)` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return out;
  } catch (e) {
    sceneFail(`${settings.scene} threw while energy_match measured it: ${e.message.split('\n')[0]}`);
    return SK('the scene threw');
  }
}

async function check() {
  const usage = (m) => { console.error(`check: ${m}`); return 2; };
  const strict = flag('strict'), plain = flag('plain'), fileArg = opt('file', null);
  if (flag('file') && !fileArg) return usage('--file needs a path (e.g. --file out/piece-final.mp4)');
  if (plain && !fileArg) return usage('--plain needs --file <file>');
  const only = opt('only') ? new Set(opt('only').split(',').map((x) => x.trim()).filter(Boolean)) : null;
  if (flag('only') && !only) return usage('--only needs check ids, e.g. --only loudness,file_spec');
  for (const id of only || []) if (!C.ALL_IDS.includes(id)) return usage(`--only ${id}: no such check (${C.ALL_IDS.join(', ')})`);
  const fileOnly = only && !fileArg ? [...only].filter((id) => C.FILE_IDS.includes(id)) : [];
  if (fileOnly.length) return usage(`--only ${fileOnly.join(',')}: ${fileOnly.length > 1 ? 'those are checks' : 'that is a check'} of a file: give it with --file <master>`);
  const want = (id) => !only || only.has(id) || (id === 'provenance' && fileArg && !plain);
  const num = (k) => { if (opt(k) == null) return null; const x = Number(opt(k)); return Number.isFinite(x) ? x : NaN; };
  const lufsOpt = num('lufs'), tpOpt = num('tp');
  if (Number.isNaN(lufsOpt) || Number.isNaN(tpOpt)) return usage('--lufs and --tp need numbers (e.g. --lufs -14 --tp -1.0)');
  const results = [];
  let dump = null;
  const push = (...xs) => { for (const x of xs.flat()) if (x && want(x.id)) results.push(x); };
  const skipIds = (ids, scope, why) => push(ids.map((id) => ({ id, scope, level: 'SKIP', detail: `not checked: ${why}` })));

  // ---- the file and the records that tie it to its source
  let file = null, prov = null;
  let settings = { scene: sceneFile, params: paramObj(params), fps: opt('fps') || null, sub, alpha: alphaKind, target };
  if (fileArg) {
    file = path.resolve(root, fileArg);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return usage(`--file ${fileArg}: no such file`);
    if (!plain) {
      const mjPath = C.findMasterJson(file, root);
      const facts = { fileRel: relRoot(file), fileSha: C.sha256File(file), mjPath, mjRel: mjPath && relRoot(mjPath) };
      if (mjPath) { try { facts.mj = JSON.parse(fs.readFileSync(mjPath, 'utf8')); } catch (e) { facts.mjError = e.message; } }
      if (facts.mj && facts.mj.render && facts.mj.render.file) {
        const rp = path.resolve(root, facts.mj.render.file);
        facts.recExists = fs.existsSync(rp);
        if (facts.recExists) {
          facts.recSha = C.sha256File(rp);
          try { facts.rec = JSON.parse(fs.readFileSync(rp, 'utf8')); } catch (e) { facts.recError = e.message; }
          if (facts.rec) facts.sourceNow = sourceHash(recordSkips(facts.rec));
        }
        // the effects stem it was mixed with (none for --no-sfx): the picture's own record, or the stem's audio record
        const fx = (facts.mj.stems || []).find((x) => x.role === 'effects');
        if (fx) {
          const cands = [];
          if (facts.rec) cands.push({ file: facts.mj.render.file, rec: facts.rec, sourceNow: facts.sourceNow });
          const ar = path.resolve(root, fx.file) + '.render.json';
          if (fs.existsSync(ar)) {
            try { const rec = JSON.parse(fs.readFileSync(ar, 'utf8')); cands.push({ file: relRoot(ar), rec, sourceNow: sourceHash(recordSkips(rec)) }); } catch { /* not a record */ }
          }
          facts.effectsProblem = C.effectsLink({ file: fx.file, sha256: fx.sha256 }, cands, facts.rec || null);
        }
        // the generated bed stem it was mixed with (plan 23.9): the picture's own record, or the bed's audio record
        const bs = (facts.mj.stems || []).find((x) => x.role === 'bed' && x.generated);
        if (bs) {
          const cands = [];
          if (facts.rec) cands.push({ file: facts.mj.render.file, rec: facts.rec, sourceNow: facts.sourceNow });
          const ar = path.resolve(root, bs.file) + '.render.json';
          if (fs.existsSync(ar)) {
            try { const rec = JSON.parse(fs.readFileSync(ar, 'utf8')); cands.push({ file: relRoot(ar), rec, sourceNow: sourceHash(recordSkips(rec)) }); } catch { /* not a record */ }
          }
          facts.bedProblem = C.bedLink({ file: bs.file, sha256: bs.sha256 }, cands, facts.rec || null);
        }
      }
      prov = C.provenance(facts);
      push(prov.result);
      if (prov.rec && prov.rec.kind === 'composite') prov = compositeBind(prov, push);   // P10: a captioned clip
      if (prov.rec) {
        const r = prov.rec;
        settings = { scene: r.scene, params: r.params || {}, fps: r.fps, sub: r.sub, alpha: r.alpha || null, target: r.target || null };
      }
      if (prov.overlayRec) settings = { ...settings, alpha: prov.overlayRec.alpha || null, sub: prov.overlayRec.sub };   // P10: the overlay's settings
    }
  }
  const runSource = !plain && (!fileArg || prov.bound);

  // ---- the board and the take, in Node
  const lib = await import(pathToFileURL(path.join(root, 'lib.js')).href);
  const B = await importPiece('board.js'), Q = await importPiece('cues.js');
  const BOARD = B.mod ? B.mod.BOARD || null : null;
  const boardError = B.error || (B.mod && !BOARD ? 'board.js does not export BOARD' : null);
  const cues = Q.mod ? { VO_OFFSET: Q.mod.VO_OFFSET, CUE: Q.mod.CUE, TAKE: Q.mod.TAKE, GAPS: Q.mod.GAPS || [], HOOK_END: Q.mod.HOOK_END, WORDS: Q.mod.WORDS || [], BOARD_KEY: Q.mod.BOARD_KEY } : null;
  let timing = BOARD ? lib.boardTiming(BOARD, cues, { energy: (settings.params || {}).energy || null, clip: !!lib.CLIP }) : null;

  // ---- the page, at the probe's scale, with the render's settings. When the source checks do not run (--plain, or
  // provenance failed), the scene is loaded only for file_spec, and only when no render record gives the settings;
  // a scene that fails then makes file_spec "not checked", never a scene FAIL in a run that does not check the scene.
  let INFOc = null, page = null, sceneWhy = null;
  const quiet = !runSource;
  const sceneFail = (msg) => { if (quiet) sceneWhy = sceneWhy || msg; else results.push({ id: 'scene', scope: 'source', level: 'FAIL', detail: msg }); };
  const pageErrors = [];
  const recSettings = prov && prov.rec && prov.rec.render && prov.rec.fps;
  const needPage = runSource || (file && want('file_spec') && !recSettings);
  if (!needPage) { /* nothing here needs the scene */ } else if (sceneProblem(settings.scene)) sceneFail(sceneProblem(settings.scene));
  else {
    browser = await launch();
    try {
      page = await openPiece(browser, { ...settings, scale: C.T.probeScale, check: true }, (e) => pageErrors.push(e.message));
      INFOc = await page.evaluate(() => window.INFO);
    } catch (e) { sceneFail(`${settings.scene} did not load: ${e.message.split('\n')[0]}`); }
  }
  // a scene's CFG.ENERGY times the board too (lib.js retimeFor): time it here as the page did
  if (BOARD && INFOc && INFOc.ENERGY && INFOc.ENERGY.from === 'CFG.ENERGY') timing = lib.boardTiming(BOARD, cues, { energy: INFOc.ENERGY.name, clip: !!lib.CLIP });
  const fps = INFOc && INFOc.FPS, dur = INFOc && INFOc.DUR;
  const windows = timing && timing.ok ? timing.windows : dur ? [{ id: '(piece)', index: 0, start: 0, end: dur, beat: {} }] : [];
  const zoneName = target || settings.target || (BOARD && BOARD.target) || null;
  let zone = null, zoneWhy = null;
  if (!zoneName) zoneWhy = 'no target: pass --target <name> or set BOARD.target';
  else {
    const all = JSON.parse(fs.readFileSync(path.join(root, 'safezones.json'), 'utf8')).targets || {};
    const z = all[zoneName];
    if (!z) zoneWhy = `unknown target ${zoneName} (safezones.json has: ${Object.keys(all).join(', ')})`;
    else if (!z.safe) zoneWhy = `target ${zoneName} has no safe area`;
    else if (INFOc && lib.CLIP && (z.w !== INFOc.W || z.h !== INFOc.H) && lib.scaleTarget(z, INFOc.W, INFOc.H)) {   // P10: a clip of the target's shape
      const s = lib.scaleTarget(z, INFOc.W, INFOc.H);
      zone = { name: `${zoneName} scaled x${+s.scaled.toFixed(4)} to ${INFOc.W}x${INFOc.H}`, safe: s.safe, exclude: s.exclude, estimate: !!z.estimate };
    } else if (INFOc && ((z.w && z.w !== INFOc.W) || (z.h && z.h !== INFOc.H))) zoneWhy = `target ${zoneName} is ${z.w}x${z.h}, but the piece is ${INFOc.W}x${INFOc.H}`;
    else zone = { name: zoneName, safe: z.safe, exclude: z.exclude || [], estimate: !!z.estimate };
  }
  say(`check: scene ${settings.scene}${INFOc ? `, ${INFOc.W}x${INFOc.H} @ ${fps} fps, ${dur} s, sub ${settings.sub}` : ''}` +
    `${Object.keys(settings.params || {}).length ? ', params ' + JSON.stringify(settings.params) : ''}${settings.alpha ? ', alpha ' + settings.alpha : ''}` +
    `${zone ? `, safe zones ${zone.name}${zone.estimate ? ' (estimate)' : ''}` : ''}${file ? `, file ${relRoot(file)}` : ''}`);

  // ---- source checks (11.1, 6.5)
  if (!runSource) {
    skipIds(C.SOURCE_IDS, 'source', plain ? '--plain checks the file alone' : 'provenance failed, so the source results would not describe this file');
  } else {
    // fonts
    if (!INFOc) skipIds(['fonts'], 'source', 'the scene did not load');
    else if (INFOc.FONT_PROBLEMS.length) push(INFOc.FONT_PROBLEMS.map((p) => ({ id: 'fonts', scope: 'source', level: 'FAIL', detail: p })));
    else push({ id: 'fonts', scope: 'source', level: 'OK', detail: INFOc.FONTS.length ? `${INFOc.FONTS.join(', ')} load` : 'CFG.FONTS lists no fonts' });
    // the board
    if (boardError) push({ id: 'board_order', scope: 'source', level: 'FAIL', detail: boardError });
    else if (!BOARD) skipIds(['board_order'], 'source', 'no board.js');
    else push(C.boardOrderResult(lib.boardOrder(timing, dur ?? null, fps ?? null)));
    if (!BOARD || !timing.ok) skipIds(['hook_long'], 'source', !BOARD ? 'no board.js' : 'the board cannot be timed (board_order)');
    else if (BOARD.hookMax == null) skipIds(['hook_long'], 'source', 'the board sets no hookMax');
    else if (!cues) skipIds(['hook_long'], 'source', 'no take yet (no cues.js)');
    else {
      const voiced = prov && prov.mj && prov.mj.mode === 'default';
      push(C.hookLongResult(lib.hookLong(BOARD, cues), voiced
        ? { voiceDelay: prov.mj.voiceDelay, voOffset: cues.VO_OFFSET, hookEnd: cues.HOOK_END, hookMax: BOARD.hookMax } : { hookMax: BOARD.hookMax }));
    }
    // the page's measurements
    const boxIds = ['text_safe', 'text_overlap', 'board_copy_missing', 'board_copy_unread'];
    const pageIds = ['motion_dead', 'first_frame_empty', ...boxIds, 'board_sfx_missing', 'audio_spike'];
    if (!INFOc) skipIds(pageIds, 'source', 'the scene did not load');
    else {
      const holdsErr = C.validHolds(INFOc.HOLDS);
      if (holdsErr) sceneFail(`${settings.scene}: ${holdsErr}`);
      const compositeFile = prov && prov.overlayRec ? file : null;   // P10: its picture checks run on its decoded frames
      const needProbe = !compositeFile && (want('motion_dead') || want('first_frame_empty'));
      const needBoxes = INFOc.BOXES && boxIds.some(want);
      let scan = null;
      // numbers, check ids and beat ids only: no on-screen text and no params, so a dump of a private piece can be shared
      if (opt('dump')) dump = { format: 'sabotage-motion/check-dump@1', fps, dur, sub: settings.sub, holds: INFOc.HOLDS, windows: windows.map((w) => [w.id, w.start, w.end]) };
      if (needProbe || needBoxes) {
        const t0 = Date.now();
        try {
          scan = await page.evaluate((o) => window.checkScan(o), { probe: needProbe, samples: needBoxes, firstOnly: !want('motion_dead') });
          say(`check: measured ${scan.frames} frames${needProbe ? ' (probe at 1/2 size, 1 subframe, grain off)' : ''}${needBoxes ? `, ${scan.samples.length} box samples` : ''} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
        } catch (e) { sceneFail(`${settings.scene} threw while it was checked: ${e.message.split('\n')[0]}`); }
      }
      if (!scan && (needProbe || needBoxes)) skipIds(pageIds.filter((id) => id !== 'board_sfx_missing' && id !== 'audio_spike'), 'source', 'the scene threw');
      if (scan && dump && scan.pairs) {
        const ks = [1, 2, 3, 4, 8, 16];
        dump.probe = { scale: C.T.probeScale, w: scan.first.w, h: scan.first.h, first: { mean: scan.first.mean, std: scan.first.std },
          changed: { atLeast: ks, pairs: scan.pairs.map((h) => ks.map((k) => Object.entries(h).reduce((n, [d, c]) => n + (+d >= k ? c : 0), 0))) } };
      }
      if (scan && needProbe) {
        if (want('motion_dead')) push(C.motionDead(scan.pairs, { fps, holds: C.holdIntervals(holdsErr ? null : INFOc.HOLDS, timing && timing.ok ? windows : []) }));
        if (settings.alpha) skipIds(['first_frame_empty'], 'source', 'an alpha render: an overlay\'s first frame is meant to be clear');
        else push(C.firstFrameEmpty(scan.first));
      }
      if (compositeFile && (want('motion_dead') || want('first_frame_empty'))) {   // P10: the composite's own frames
        const t0 = Date.now();
        try {
          const pic = await decodeScan(compositeFile, INFOc.W, INFOc.H, !want('motion_dead'));
          say(`check: decoded ${pic.frames} frames of ${relRoot(compositeFile)} with ffmpeg (the composite's picture, at 1/2 size) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
          const picHolds = C.holdIntervals(holdsErr ? [] : INFOc.HOLDS || [], timing && timing.ok ? windows : []);
          if (want('motion_dead')) { push(C.motionDead(pic.pairs, { fps, holds: picHolds })); }
          push(C.firstFrameEmpty(pic.first));
        } catch (e) { for (const id of ['motion_dead', 'first_frame_empty']) push({ id, scope: 'source', level: 'FAIL', detail: e.message }); }
      }
      if (!INFOc.BOXES) skipIds(boxIds, 'source', `${settings.scene} has no boxes(t), so its text cannot be seen without OCR`);
      else if (scan && needBoxes) {
        const samples = C.prepareSamples(scan.samples, INFOc.W, INFOc.H);
        if (zone) push(C.textSafe(samples, { fps, safe: zone.safe, exclude: zone.exclude, windows, estimate: zone.estimate, target: zone.name }));
        else skipIds(['text_safe'], 'source', zoneWhy);
        push(C.textOverlap(samples, { fps }));
        if (BOARD && timing.ok) push(C.boardCopy(samples, { fps, windows }));
        else skipIds(['board_copy_missing', 'board_copy_unread'], 'source', BOARD ? 'the board cannot be timed (board_order)' : 'no board.js');
      }
      // the effects stem and the bed stem, rendered afresh (the source is the render's, so they are the stems that were
      // mixed); audio_spike hears them summed at the mixer's gains (plan 23.9): the master's own when it records them,
      // else tools/mix.mjs's defaults for the board (voiced, or the effects alone)
      if (INFOc.SILENT) skipIds(['board_sfx_missing', 'audio_spike'], 'source', `${settings.scene} exports silent = true, so it has no effects stem`);
      else if (want('board_sfx_missing') || want('audio_spike')) {
        audioOut = path.join(os.tmpdir(), `sm-check-${process.pid}.wav`);
        bedOut = path.join(os.tmpdir(), `sm-check-${process.pid}.bed.wav`);
        try {
          await page.evaluate(() => window.renderSound());
          const wav = C.readWav(fs.readFileSync(audioOut));
          const bedR = await page.evaluate(() => window.renderBedSound());
          if (dump) { const st = C.spikeStats(wav); dump.audio = { peak: st.peak, p90: st.p90, over: st.over, rms: st.rms, loudWindows: st.loud }; }
          if (BOARD && timing.ok) push(C.boardSfx(wav, { windows }));
          else skipIds(['board_sfx_missing'], 'source', BOARD ? 'the board cannot be timed (board_order)' : 'no board.js');
          // what is heard: each stem the master mixes, at its gain (heardGains), alone too (P11b round 2, H1: the silence
          // floor is absolute, so a gain moves windows across it); the bed with its mutes; a stem it left out is not
          const g = await heardGains(prov && prov.mj, BOARD);
          const fxOn = g.sfx > 0, bedOn = !!bedR && g.bed > 0;
          const bedPart = bedOn ? await heardBed(C.readWav(fs.readFileSync(bedOut)), g, wav.n) : null;
          const bedName = `the bed stem (x${g.bed}${g.mutes.length ? `, muted ${g.mutes.map((m) => `${m.a}-${m.b}`).join(', ')}` : ''})`;
          if (!fxOn && !bedOn) push({ id: 'audio_spike', scope: 'source', level: 'OK', detail: `nothing to hear: the master mixes neither the effects nor the bed stem (${g.from})`, threshold: C.T.spike.db });
          else if (!bedOn) push(C.audioSpike(C.mixWavs([{ wav, gain: g.sfx }]), g.master || g.sfx !== 1 ? { what: `the effects stem (x${g.sfx}, ${g.from})` } : {}));
          else if (!fxOn) push(C.audioSpike(C.mixWavs([bedPart]), { what: `${bedName} alone (${g.from})` }));
          else push(C.audioSpike(C.mixWavs([{ wav, gain: g.sfx }, bedPart]), { what: `the effects (x${g.sfx}) and ${bedName} summed (${g.from})` }));
        } catch (e) {
          // under every effects check asked for, so --only cannot hide it
          for (const id of ['board_sfx_missing', 'audio_spike']) push({ id, scope: 'source', level: 'FAIL', detail: `the effects did not render: ${e.message.split('\n')[0]}` });
        } finally { fs.rmSync(audioOut, { force: true }); fs.rmSync(bedOut, { force: true }); }
      }
    }
  }
  if (runSource && want('energy_match')) push(await energyCheck(page, { INFOc, settings, BOARD, windows: timing && timing.ok ? windows : [], sceneFail }));   // P11b-2
  for (const m of pageErrors) sceneFail(`page error: ${m}`);

  // ---- flash (plan 23.9), on the picture: without --file, the piece's current render; with it, the file (below)
  if (!file && want('flash')) push(await flashOnRender(settings, INFOc));

  // ---- artifact checks (11.2)
  if (file) {
    const rec = prov && prov.rec, mj = prov && prov.mj;
    if (want('flash')) push(await flashOnFile(file, rec));
    if (rec && rec.render && rec.fps) {
      push(C.fileSpec(C.probeFile(file), { w: rec.render[0], h: rec.render[1], fps: rec.fps, dur: rec.dur, alpha: rec.alpha, silent: rec.silent }, `its render record ${mj.render.file}`));
    } else if (INFOc) {
      const k = +opt('scale', 1);
      push(C.fileSpec(C.probeFile(file), { w: Math.round(INFOc.W * k), h: Math.round(INFOc.H * k), fps, dur, alpha: alphaKind, silent: INFOc.SILENT },
        `the piece's current settings at scale ${k}${alphaKind ? ', alpha ' + alphaKind : ''}`));
    } else skipIds(['file_spec'], 'file', `no render record${sceneWhy ? `, and the scene did not load (${sceneWhy})` : ' and no scene'}, so there is nothing to compare it with`);
    if (want('faststart')) push(C.faststartResult(file, C.atomOrderFile(file)));
    const lufs = lufsOpt != null ? lufsOpt : !plain && mj && mj.target ? mj.target.lufs : null;
    if (lufs == null) skipIds(['loudness'], 'file', plain ? '--plain needs --lufs for a loudness target' : 'no loudness target: no master.json, and no --lufs');
    else if (want('loudness')) push(C.loudnessResult(C.measureLoudness(file), { target: lufs, tp: tpOpt != null ? tpOpt : C.T.loudness.tp, from: lufsOpt != null ? '--lufs' : 'master.json' }));
    if (plain) skipIds(['provenance', 'vo_delay'], 'file', '--plain checks the file alone');
    else if (!prov.bound) skipIds(['vo_delay'], 'file', 'provenance failed, so master.json is not bound to this file');
    else push(C.voDelayResult(mj, cues ? cues.VO_OFFSET : NaN));
  }

  // ---- report
  // with --plain, or when the page never ran, the dump holds the results alone
  if (!dump && opt('dump')) dump = { format: 'sabotage-motion/check-dump@1' };
  if (dump) {
    dump.results = results.map((x) => ({ id: x.id, level: x.level, t: x.t ?? null, measured: x.measured ?? null, threshold: x.threshold ?? null }));
    const df = path.resolve(root, opt('dump'));
    fs.mkdirSync(path.dirname(df), { recursive: true });
    fs.writeFileSync(df, JSON.stringify(dump) + '\n');
    say(`check: wrote the measurements to ${opt('dump')}`);
  }
  const order = ['scene', 'provenance', ...C.SOURCE_IDS, ...C.PICTURE_IDS, 'file_spec', 'faststart', 'loudness', 'vo_delay'];
  results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || (a.t ?? -1) - (b.t ?? -1));
  const { n, exit } = C.summarize(results, { strict });
  if (jsonOut) console.log(JSON.stringify(C.toJson(results), null, 2));
  else for (const x of results) console.log(C.formatLine(x));
  say(`check: ${n.FAIL} FAIL, ${n.WARN} WARN, ${n.OK} ok, ${n.SKIP} not checked${strict ? ' (--strict: a WARN fails too)' : ''}`);
  return exit;
}

// ---------------------------------------------------------------- palette (plan 23.2)
// The colour match of the piece against a brand kit: check's probe frames, every pixel to its nearest colour.
async function palette() {
  const usage = (m) => { console.error(`palette: ${m}`); return 2; };
  const kitArg = opt('brand', 'brand.json'), kitFile = path.resolve(root, kitArg);
  if (flag('brand') && !opt('brand')) return usage('--brand needs a file (e.g. --brand ../brand.json)');
  if (flag('scale') && +opt('scale') !== C.T.probeScale) return usage(`--scale is fixed for the colour match: it measures check's probe frames at ${C.T.probeScale} of full size`);
  if (!fs.existsSync(kitFile)) return usage(`no kit: ${kitArg} does not exist (write brand.json, or name one with --brand <file>)`);
  let kit;
  try { kit = JSON.parse(fs.readFileSync(kitFile, 'utf8')); } catch (e) { return usage(`${kitArg} does not parse: ${e.message}`); }
  const probs = LK.brandProblems(kit);
  if (probs.length) return usage(probs.join('; '));
  const missing = ['bgA', 'bgB', 'accent'].filter((k) => !(kit.colors && kit.colors[k]));
  if (missing.length) return usage(`${kitArg} gives no ${missing.join(', ')}: the match needs the kit's bgA, bgB and accent`);
  const kitTokens = Object.fromEntries(LK.TOKENS.filter((k) => kit.colors[k]).map((k) => [k, LK.normHex(kit.colors[k])]));
  const palettes = [{ id: 'kit', tokens: kitTokens }, { id: 'template', tokens: LK.TEMPLATE.tokens },
    ...LK.LOOK_NAMES.map((n) => ({ id: `look ${n}`, tokens: LK.LOOKS[n].tokens }))];
  browser = await launch();
  const page = await openPiece(browser);
  INFO = await page.evaluate(() => window.INFO);
  const t1 = Date.now();
  const scan = await page.evaluate(() => window.colorScan());
  const fontsUsed = await page.evaluate(() => window.fontsUsed());
  const match = C.paletteMatch(scan, palettes), res = C.paletteResult(match);
  const pct = (n) => `${((100 * n) / match.total).toFixed(2)}%`;
  say(`palette: ${sceneFile}${Object.keys(paramObj(params)).length ? ' ' + JSON.stringify(paramObj(params)) : ''}, ${scan.frames} frames at ${scan.w}x${scan.h} (check's probe: 1/2 size, 1 subframe, grain off), measured in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  say(`palette: ${kitArg} "${kit.name}" against the template's and ${LK.LOOK_NAMES.length} looks' default tokens; a pixel more than ${C.T.palette.limit} (CIEDE2000) from every colour is no one's`);
  if (jsonOut) {
    console.log(JSON.stringify({ kit: { file: kitArg, name: kit.name, tokens: kitTokens }, scene: sceneFile, params: paramObj(params), frames: scan.frames, w: scan.w, h: scan.h,
      total: match.total, none: match.none / match.total, fonts_used: fontsUsed,
      palettes: match.palettes.map((p) => ({ id: p.id, share: p.total / match.total, tokens: Object.fromEntries(Object.entries(p.tokens).map(([k, n]) => [k, n / match.total])) })),
      rules: res.rules, ok: res.ok }, null, 2));
  } else {
    for (const [k, n] of Object.entries(match.palettes[0].tokens)) console.log(`  kit       ${k.padEnd(8)} ${kitTokens[k]}  ${pct(n).padStart(7)}`);
    console.log(`  none (more than ${C.T.palette.limit} from every colour)  ${pct(match.none)}`);
    for (const p of match.palettes.slice(1)) {
      const parts = Object.entries(p.tokens).filter(([, n]) => n).map(([k, n]) => `${k} ${pct(n)}`);
      console.log(`  ${p.id.padEnd(16)} ${pct(p.total).padStart(7)}${parts.length ? `  (${parts.join(', ')})` : ''}`);
    }
    console.log(`  fonts drawn: ${fontsUsed.length ? fontsUsed.join(', ') : 'none'}`);
    for (const x of res.rules) console.log(`${x.ok ? 'ok  ' : 'FAIL'}  ${x.rule}: ${(100 * x.measured).toFixed(2)}%`);
  }
  say(`palette: ${res.ok ? 'pass' : 'FAIL'}`);
  return res.ok ? 0 : 1;
}

// ---------------------------------------------------------------- modes
const t0 = Date.now();
let browser = null;
try {
  if (mode === 'doctor') {
    process.exitCode = await doctor();
  } else if (mode === 'check') {
    process.exitCode = await check();
  } else if (mode === 'palette') {
    process.exitCode = await palette();
  } else {
    browser = await launch();
    const page = await openPiece(browser);
    INFO = await page.evaluate(() => window.INFO);
    const { RW, RH, FPS, DUR } = INFO;
    console.log(`canvas ${RW}x${RH} @ ${FPS}fps, ${DUR}s, sub ${sub}, scene ${sceneFile}${target ? ', target ' + target : ''}${alphaKind ? ', alpha ' + alphaKind : ''}`);
    if (mode === 'stills') {
      const dir = resolveOut(opt('dir', 'stills'));
      fs.mkdirSync(dir, { recursive: true });
      for (const t of timesArg()) {
        const url = await page.evaluate((t) => window.renderStill(t), t);
        const file = path.join(dir, `t${t.toFixed(3).padStart(6, '0')}.png`);
        fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
        console.log('wrote', file);
      }
    } else if (mode === 'hash') {
      for (const t of timesArg()) console.log(`hash t=${t.toFixed(3)} ${await page.evaluate((t) => window.frameHash(t), t)}`);
    } else if (mode === 'contact') {
      // N evenly spaced frames tiled left-to-right, top-to-bottom: one image shows the whole timeline.
      const n = +opt('n', 12), cols = +opt('cols', 4);
      let zone = null;
      if (flag('safe')) {   // --safe: the --target's safe area, else the board's target
        const name = target || await page.evaluate(async () => { const l = await import('./lib.js'); return (l.BOARD && l.BOARD.target) || null; });
        if (!name) throw new Error('--safe needs a target: pass --target <name> or set BOARD.target');
        zone = await page.evaluate((x) => window.safeZone(x), name);
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-'));
      const times = [];
      for (let i = 0; i < n; i++) {
        const t = +((DUR * (i + 0.5)) / n).toFixed(3);
        times.push(t);
        const url = await page.evaluate(([t, z]) => window.renderStill(t, { safe: z }), [t, zone]);
        fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
      }
      const out = resolveOut(opt('out', 'contact.png'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const rows = Math.ceil(n / cols);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%03d.png'),
        '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=0x808080`, '-frames:v', '1', out]);
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log('wrote', out, '\ntimes (reading order):', times.join(', '));
      if (zone) console.log(`safe zones: ${zone.name}${zone.estimate ? ' (estimate: not measured yet, see safezones.json)' : ''}`);
    } else if (mode === 'board') {
      const out = resolveOut(opt('out', 'board.png'));
      const cols = +opt('cols', INFO.W > INFO.H ? 4 : 3);
      const r = await page.evaluate((o) => window.renderBoard(o), { cols, safe: flag('safe') });
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
      const md = out.replace(/\.png$/i, '') + '.md';
      fs.writeFileSync(md, boardMarkdown(r));
      console.log('wrote', out, `(${r.width}x${r.height}, ${r.rows.length} beats)`);
      console.log('wrote', md);
      console.log(r.estimated ? 'timing: estimated (no cues.js yet)' : r.take ? `timing: from cues.js (VO_OFFSET ${r.voOffset} s)`
        : r.grid ? `timing: the beats' durations on ${r.grid.energy}'s beat grid, ${r.grid.bpm} BPM (no voice)` : 'timing: the beats\' durations (no voice)');
      for (const p of r.order) console.log(`note: board_order would fail: ${p}`);
    } else if (mode === 'brand') {
      const out = resolveOut(opt('out', 'brand.png'));
      const r = await page.evaluate(() => window.renderBrandSheet());
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(r.png.split(',')[1], 'base64'));
      console.log('wrote', out, `(${r.width}x${r.height}): ${r.brand ? `brand.json "${r.brand}"` : 'no brand.json'}${r.look ? `, look ${r.look}` : ''}`);
      const box = (b) => `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}`;
      for (const x of r.swatches) console.log(`swatch ${x.name} ${x.hex} at ${box(x)}`);
      for (const g of r.grounds) console.log(`ground ${g.logo} ${g.hex} at ${box(g)}${r.logos.includes(g.logo) ? '' : ' (no logo)'}`);
    } else if (mode === 'video') {
      const out = resolveOut(withExt(opt('out', `out/${sceneBase}`), videoExt)), part = partialOf(out);
      fs.rmSync(recordOf(out), { force: true });
      const src = sourceHash(new Set([out, part]));
      const from = +opt('from', 0), to = +opt('to', DUR);
      const frames = await renderVideo(page, part, from, to);   // encodes to the .partial file
      promote(part, out);
      console.log('wrote', out);
      writeRenderJson(out, src, { from, to, frames, fonts_used: await page.evaluate(() => window.fontsUsed()) });
      partials.clear();
    } else if (mode === 'audio') {
      const out = resolveOut(opt('out', `out/${sceneBase}.wav`)), part = partialOf(out);
      const bed = bedOf(out), bpart = partialOf(bed);
      for (const f of [out, bed]) fs.rmSync(recordOf(f), { force: true });
      const src = sourceHash(new Set([out, part, bed, bpart]));
      partials.add(part); partials.add(bpart);
      await renderAudioTo(page, part);
      const b = await renderBedTo(page, bpart);
      promote(part, out);
      console.log('wrote', out);
      writeAudioRecord(out, src);
      if (b) {
        promote(bpart, bed);
        console.log('wrote', bed);
        writeAudioRecord(bed, src, { role: 'bed', bedSilent: b.silent });
      } else fs.rmSync(bed, { force: true });   // an old bed would not belong to this render
      partials.clear();
    } else if (mode === 'full') {
      const out = resolveOut(withExt(opt('out', `out/${sceneBase}`), videoExt));
      const base = out.slice(0, -path.extname(out).length);
      const vtmp = base + '.video' + videoExt, atmp = base + '.wav', part = partialOf(out), apart = partialOf(atmp);
      const btmp = bedOf(out), bpart = partialOf(btmp);
      fs.rmSync(recordOf(out), { force: true });
      const src = sourceHash(new Set([out, vtmp, atmp, part, apart, btmp, bpart]));
      partials.add(apart); partials.add(bpart);
      await renderAudioTo(page, apart);          // audio first: it takes 0.1 s, so a broken audio.js fails fast
      const bed = await renderBedTo(page, bpart);
      const frames = await renderVideo(page, vtmp, 0, DUR);
      const acodec = alphaKind === 'prores' ? ['-c:a', 'pcm_s16le'] : alphaKind === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '256k'];
      partials.add(part);                        // the mux writes the .partial file; a failed mux leaves no temp behind
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vtmp, '-i', apart, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...acodec,
        '-t', String(DUR), ...(videoExt === '.mp4' ? ['-movflags', '+faststart'] : []), part]);
      fs.rmSync(vtmp, { force: true }); partials.delete(vtmp);
      fs.rmSync(recordOf(atmp), { force: true });   // an `audio` record of the old effects stem no longer describes it
      fs.rmSync(recordOf(btmp), { force: true });   // nor one of the old bed stem
      promote(apart, atmp);
      if (bed) promote(bpart, btmp); else fs.rmSync(btmp, { force: true });   // no bed now: an old one would be mixed in
      promote(part, out);
      console.log('wrote', out, '(audio kept at', atmp + (bed ? `, the bed at ${btmp}` : '') + ')');
      writeRenderJson(out, src, { from: 0, to: DUR, frames, fonts_used: await page.evaluate(() => window.fontsUsed()), audio: path.relative(root, atmp), audioSha256: sha256(fs.readFileSync(atmp)),
        ...(bed ? { bed: path.relative(root, btmp), bedSha256: sha256(fs.readFileSync(btmp)), bedSilent: bed.silent } : {}) });
      partials.clear();
    }
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
  await abortVideo();
  removePartials();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
