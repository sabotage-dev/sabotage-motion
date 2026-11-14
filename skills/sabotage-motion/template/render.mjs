// Driver: serves this folder, runs the page in headless Chrome, pipes raw RGBA frames to ffmpeg.
//
//   node render.mjs stills 0.5,1.2,2.4 [--scale 0.5] [--dir stills]   PNG style frames
//   node render.mjs contact [--n 12] [--cols 4] [--scale 0.25]         one PNG grid of the whole timeline
//   node render.mjs video [--from 0 --to DUR] [--out out/<scene>.mp4]  silent video (+ <out>.render.json)
//   node render.mjs audio [--out out/<scene>.wav]                      synthesized soundtrack only
//   node render.mjs full  [--out out/<scene>.mp4]                      video + audio, muxed (+ <out>.render.json)
//   node render.mjs board [--slates] [--safe] [--cols N] [--out board.png]   storyboard sheet (+ board.md)
//   node render.mjs hash 0.5,1.2 [--scale 0.25]                        SHA-256 of each frame's raw pixels
//   node render.mjs doctor                                             check Chrome, WebGL2, ffmpeg, fonts
//   node render.mjs check [--file out/<name>-final.mp4] [--target tiktok] [--lufs -14 --tp -1.0]
//                         [--json] [--strict] [--plain] [--only id,id]  measured checks (check.mjs)
//
// Paths in --out / --dir resolve against THIS folder (the piece), not your shell's cwd; absolute paths work.
// board: one panel per board.js beat at its key time, captions under each (default --scale 1/3);
//         --slates draws them with slate.js, --safe shades what is outside the target's safe area (the
//         --target, else BOARD.target). Timing comes from cues.js once it exists, else the estimate.
// contact --safe: the same safe-area shading on every panel. Both say "(estimate)" while the target's
//         numbers in safezones.json are not measured.
// check: the piece's source checks (fonts, board, hook, copy, sound notes, motion, first frame, text in the
//         safe area, overlapping text, audio spikes), plus with --file the artifact checks on a master
//         (provenance, file spec, faststart, loudness, voice delay). One line per result; exit 1 on any
//         FAIL (with --strict, on any WARN too); --json prints the results as JSON instead. With --file,
//         the source checks replay the scene, params, fps, subframes and alpha mode of the render the
//         master came from (its render.json). --plain checks a file from elsewhere as a plain file
//         (file spec against the piece's settings at --scale, faststart, loudness with --lufs). --only
//         runs just the named checks (provenance always runs with --file). --dump <file> also writes the
//         raw measurements (per frame pair, the probe pixels changed by 1, 2, 3, 4, 8 and 16 levels or more;
//         the first frame's luma; the audio windows), numbers only, for tuning the thresholds on real
//         pieces. Exit 2 on a usage error.
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

const root = path.dirname(fileURLToPath(import.meta.url));   // not URL.pathname: that keeps %20 for spaces
const argv = process.argv.slice(2);
const mode = argv[0];
if (!['stills', 'contact', 'board', 'video', 'audio', 'full', 'hash', 'doctor', 'check'].includes(mode)) {
  console.error('usage: node render.mjs <stills t1,t2,..|contact|board|video|audio|full|hash t1,..|doctor|check> [options]  (see header)');
  process.exit(2);
}
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const params = []; argv.forEach((a, i) => { if (a === '--param' && argv[i + 1]) params.push(argv[i + 1]); });
const paramObj = (list) => Object.fromEntries(list.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
// check --json keeps stdout for the JSON; everything else goes to stderr
const jsonOut = mode === 'check' && flag('json');
const say = (...a) => (jsonOut ? console.error : console.log)(...a);
const alphaKind = flag('alpha') ? opt('alpha', 'prores') : null;
if (alphaKind && !['prores', 'webm'].includes(alphaKind)) { console.error('--alpha must be prores or webm'); process.exit(2); }
const defScale = mode === 'stills' ? 0.5 : mode === 'contact' || mode === 'doctor' ? 0.25 : mode === 'board' ? 1 / 3 : 1;
const scale = +opt('scale', defScale), sub = +opt('sub', mode === 'contact' || mode === 'doctor' || mode === 'board' ? 4 : 8);
const resolveOut = (p) => path.resolve(root, p);
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', rej);
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

// ---------------------------------------------------------------- scene and target
const sceneFile = mode === 'board' && flag('slates') ? 'slate.js' : opt('scene', 'scene.js');
const validScene = (f) => /^[\w][\w./-]*\.m?js$/.test(f) && !f.includes('..') && fs.existsSync(path.join(root, f));
// check --file takes its scene from the render record, so the command line's does not have to exist
if (!(mode === 'check' && opt('file')) && !validScene(sceneFile)) {
  console.error(`--scene ${sceneFile}: no such scene file in this piece (give a path relative to the piece, e.g. slate.js)`);
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
let audioOut = null;
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
        if (!rel && ['board.png', 'contact.png', 'board.md'].includes(name)) continue;
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
    alpha: alphaKind, ...extra,
    source: src,
    video: { hash: decodedVideoHash(file) },
    sha256: sha256(fs.readFileSync(file)),
  };
  const out = recordOf(file);
  fs.writeFileSync(out, JSON.stringify(rec, null, 2) + '\n');
  console.log('wrote', out);
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
async function renderVideo(page, out, from, to) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...videoArgs(out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  ffOut = out;
  const proc = ff;
  proc.stdin.on('error', () => {});   // EPIPE once ffmpeg has died; the close handler below reports why
  const done = new Promise((r, j) => { proc.on('error', j); proc.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))); });
  done.catch((e) => { if (ffAborting) return; console.error(`render failed: ${e.message} (ffmpeg's own error is printed above)`); process.exit(1); });
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
    for (const f of ['loudnorm', 'ebur128', 'sidechaincompress', 'alimiter', 'amix', 'asplit', 'atrim', 'aformat', 'aresample',
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
  const out = path.resolve(root, rec.file), skip = new Set([out]);
  if (rec.mode === 'full') {
    const ext = path.extname(out);
    skip.add(out.slice(0, -ext.length) + '.video' + ext);
    if (rec.audio) skip.add(path.resolve(root, rec.audio));
  }
  return skip;
}
async function importPiece(name) {
  const f = path.join(root, name);
  if (!fs.existsSync(f)) return { mod: null };
  try { return { mod: await import(pathToFileURL(f).href) }; } catch (e) { return { mod: null, error: `${name} failed to load: ${e.message}` }; }
}
async function check() {
  const usage = (m) => { console.error(`check: ${m}`); return 2; };
  const strict = flag('strict'), plain = flag('plain'), fileArg = opt('file', null);
  if (flag('file') && !fileArg) return usage('--file needs a path (e.g. --file out/piece-final.mp4)');
  if (plain && !fileArg) return usage('--plain needs --file <file>');
  const only = opt('only') ? new Set(opt('only').split(',').map((x) => x.trim()).filter(Boolean)) : null;
  if (flag('only') && !only) return usage('--only needs check ids, e.g. --only loudness,file_spec');
  for (const id of only || []) if (!C.ALL_IDS.includes(id)) return usage(`--only ${id}: no such check (${C.ALL_IDS.join(', ')})`);
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
      }
      prov = C.provenance(facts);
      push(prov.result);
      if (prov.rec) {
        const r = prov.rec;
        settings = { scene: r.scene, params: r.params || {}, fps: r.fps, sub: r.sub, alpha: r.alpha || null, target: r.target || null };
      }
    }
  }
  const runSource = !plain && (!fileArg || prov.bound);

  // ---- the board and the take, in Node
  const lib = await import(pathToFileURL(path.join(root, 'lib.js')).href);
  const B = await importPiece('board.js'), Q = await importPiece('cues.js');
  const BOARD = B.mod ? B.mod.BOARD || null : null;
  const boardError = B.error || (B.mod && !BOARD ? 'board.js does not export BOARD' : null);
  const cues = Q.mod ? { VO_OFFSET: Q.mod.VO_OFFSET, CUE: Q.mod.CUE, TAKE: Q.mod.TAKE, GAPS: Q.mod.GAPS || [], HOOK_END: Q.mod.HOOK_END, WORDS: Q.mod.WORDS || [], BOARD_KEY: Q.mod.BOARD_KEY } : null;
  const timing = BOARD ? lib.boardTiming(BOARD, cues) : null;

  // ---- the page, at the probe's scale, with the render's settings
  let INFOc = null, page = null;
  const sceneFail = (msg) => results.push({ id: 'scene', scope: 'source', level: 'FAIL', detail: msg });
  const pageErrors = [];
  if (!validScene(settings.scene)) sceneFail(`the scene ${settings.scene} is not a scene file in this piece`);
  else {
    browser = await launch();
    try {
      page = await openPiece(browser, { ...settings, scale: C.T.probeScale, check: true }, (e) => pageErrors.push(e.message));
      INFOc = await page.evaluate(() => window.INFO);
    } catch (e) { sceneFail(`${settings.scene} did not load: ${e.message.split('\n')[0]}`); }
  }
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
    else if (INFOc && ((z.w && z.w !== INFOc.W) || (z.h && z.h !== INFOc.H))) zoneWhy = `target ${zoneName} is ${z.w}x${z.h}, but the piece is ${INFOc.W}x${INFOc.H}`;
    else zone = { name: zoneName, safe: z.safe, estimate: !!z.estimate };
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
      const needProbe = want('motion_dead') || want('first_frame_empty');
      const needBoxes = INFOc.BOXES && boxIds.some(want);
      let scan = null;
      if (opt('dump')) dump = { format: 'sabotage-motion/check-dump@1', scene: settings.scene, params: settings.params, fps, dur, sub: settings.sub, holds: INFOc.HOLDS, windows: windows.map((w) => [w.id, w.start, w.end]) };
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
      if (!INFOc.BOXES) skipIds(boxIds, 'source', `${settings.scene} has no boxes(t), so its text cannot be seen without OCR`);
      else if (scan && needBoxes) {
        const samples = C.prepareSamples(scan.samples, INFOc.W, INFOc.H);
        if (zone) push(C.textSafe(samples, { fps, safe: zone.safe, windows, estimate: zone.estimate, target: zone.name }));
        else skipIds(['text_safe'], 'source', zoneWhy);
        push(C.textOverlap(samples, { fps }));
        if (BOARD && timing.ok) push(C.boardCopy(samples, { fps, windows }));
        else skipIds(['board_copy_missing', 'board_copy_unread'], 'source', BOARD ? 'the board cannot be timed (board_order)' : 'no board.js');
      }
      // the effects stem, rendered afresh (the source is the render's, so it is the stem that was mixed)
      if (INFOc.SILENT) skipIds(['board_sfx_missing', 'audio_spike'], 'source', `${settings.scene} exports silent = true, so it has no effects stem`);
      else if (want('board_sfx_missing') || want('audio_spike')) {
        audioOut = path.join(os.tmpdir(), `sm-check-${process.pid}.wav`);
        try {
          await page.evaluate(() => window.renderSound());
          const wav = C.readWav(fs.readFileSync(audioOut));
          if (dump) { const st = C.spikeStats(wav); dump.audio = { peak: st.peak, p90: st.p90, over: st.over, rms: st.rms, loudWindows: st.loud }; }
          if (BOARD && timing.ok) push(C.boardSfx(wav, { windows }));
          else skipIds(['board_sfx_missing'], 'source', BOARD ? 'the board cannot be timed (board_order)' : 'no board.js');
          push(C.audioSpike(wav));
        } catch (e) {
          push({ id: 'audio_spike', scope: 'source', level: 'FAIL', detail: `the effects did not render: ${e.message.split('\n')[0]}` });
          skipIds(['board_sfx_missing'], 'source', 'the effects did not render');
        } finally { fs.rmSync(audioOut, { force: true }); }
      }
    }
  }
  for (const m of pageErrors) sceneFail(`page error: ${m}`);

  // ---- artifact checks (11.2)
  if (file) {
    const rec = prov && prov.rec, mj = prov && prov.mj;
    if (rec && rec.render && rec.fps) {
      push(C.fileSpec(C.probeFile(file), { w: rec.render[0], h: rec.render[1], fps: rec.fps, dur: rec.dur, alpha: rec.alpha, silent: rec.silent }, `its render record ${mj.render.file}`));
    } else if (INFOc) {
      const k = +opt('scale', 1);
      push(C.fileSpec(C.probeFile(file), { w: Math.round(INFOc.W * k), h: Math.round(INFOc.H * k), fps, dur, alpha: alphaKind, silent: INFOc.SILENT },
        `the piece's current settings at scale ${k}${alphaKind ? ', alpha ' + alphaKind : ''}`));
    } else skipIds(['file_spec'], 'file', 'no render record and the scene did not load, so there is nothing to compare it with');
    if (want('faststart')) push(C.faststartResult(file, C.atomOrderFile(file)));
    const lufs = lufsOpt != null ? lufsOpt : !plain && mj && mj.target ? mj.target.lufs : null;
    if (lufs == null) skipIds(['loudness'], 'file', plain ? '--plain needs --lufs for a loudness target' : 'no loudness target: no master.json, and no --lufs');
    else if (want('loudness')) push(C.loudnessResult(C.measureLoudness(file), { target: lufs, tp: tpOpt != null ? tpOpt : C.T.loudness.tp, from: lufsOpt != null ? '--lufs' : 'master.json' }));
    if (plain) skipIds(['provenance', 'vo_delay'], 'file', '--plain checks the file alone');
    else if (!prov.bound) skipIds(['vo_delay'], 'file', 'provenance failed, so master.json is not bound to this file');
    else push(C.voDelayResult(mj, cues ? cues.VO_OFFSET : NaN));
  }

  // ---- report
  if (dump) {
    dump.results = C.toJson(results);
    const df = path.resolve(root, opt('dump'));
    fs.mkdirSync(path.dirname(df), { recursive: true });
    fs.writeFileSync(df, JSON.stringify(dump) + '\n');
    say(`check: wrote the measurements to ${opt('dump')}`);
  }
  const order = ['scene', 'provenance', ...C.SOURCE_IDS, 'file_spec', 'faststart', 'loudness', 'vo_delay'];
  results.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id) || (a.t ?? -1) - (b.t ?? -1));
  const { n, exit } = C.summarize(results, { strict });
  if (jsonOut) console.log(JSON.stringify(C.toJson(results), null, 2));
  else for (const x of results) console.log(C.formatLine(x));
  say(`check: ${n.FAIL} FAIL, ${n.WARN} WARN, ${n.OK} ok, ${n.SKIP} not checked${strict ? ' (--strict: a WARN fails too)' : ''}`);
  return exit;
}

// ---------------------------------------------------------------- modes
const t0 = Date.now();
let browser = null;
try {
  if (mode === 'doctor') {
    process.exitCode = await doctor();
  } else if (mode === 'check') {
    process.exitCode = await check();
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
      console.log(r.estimated ? 'timing: estimated (no cues.js yet)' : r.take ? `timing: from cues.js (VO_OFFSET ${r.voOffset} s)` : 'timing: the beats\' durations (no voice)');
      for (const p of r.order) console.log(`note: board_order would fail: ${p}`);
    } else if (mode === 'video') {
      const out = resolveOut(withExt(opt('out', `out/${sceneBase}`), videoExt));
      fs.rmSync(recordOf(out), { force: true });
      const src = sourceHash(new Set([out]));
      const from = +opt('from', 0), to = +opt('to', DUR);
      const frames = await renderVideo(page, out, from, to);
      console.log('wrote', out);
      writeRenderJson(out, src, { from, to, frames });
    } else if (mode === 'audio') {
      const out = resolveOut(opt('out', `out/${sceneBase}.wav`));
      await renderAudioTo(page, out);
      console.log('wrote', out);
    } else if (mode === 'full') {
      const out = resolveOut(withExt(opt('out', `out/${sceneBase}`), videoExt));
      const base = out.slice(0, -path.extname(out).length);
      const vtmp = base + '.video' + videoExt, atmp = base + '.wav';
      fs.rmSync(recordOf(out), { force: true });
      const src = sourceHash(new Set([out, vtmp, atmp]));
      await renderAudioTo(page, atmp);          // audio first: it takes 0.1 s, so a broken audio.js fails fast
      const frames = await renderVideo(page, vtmp, 0, DUR);
      const acodec = alphaKind === 'prores' ? ['-c:a', 'pcm_s16le'] : alphaKind === 'webm' ? ['-c:a', 'libopus', '-b:a', '192k'] : ['-c:a', 'aac', '-b:a', '256k'];
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', vtmp, '-i', atmp, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', ...acodec,
        '-t', String(DUR), ...(videoExt === '.mp4' ? ['-movflags', '+faststart'] : []), out]);
      fs.rmSync(vtmp, { force: true });
      console.log('wrote', out, '(audio kept at', atmp + ')');
      writeRenderJson(out, src, { from: 0, to: DUR, frames, audio: path.relative(root, atmp) });
    }
    console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
  await abortVideo();
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
