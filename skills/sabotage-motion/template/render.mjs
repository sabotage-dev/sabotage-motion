// Driver: serves this folder, runs the page in headless Chrome, pipes raw RGBA frames to ffmpeg.
//
//   node render.mjs stills 0.5,1.2,2.4 [--scale 0.5] [--dir stills]   PNG style frames
//   node render.mjs contact [--n 12] [--cols 4] [--scale 0.25]         one PNG grid of the whole timeline
//   node render.mjs video [--from 0 --to DUR] [--out out/<scene>.mp4]  silent video (+ <out>.render.json)
//   node render.mjs audio [--out out/<scene>.wav]                      synthesized soundtrack only
//   node render.mjs full  [--out out/<scene>.mp4]                      video + audio, muxed (+ <out>.render.json)
//   node render.mjs hash 0.5,1.2 [--scale 0.25]                        SHA-256 of each frame's raw pixels
//   node render.mjs doctor                                             check Chrome, WebGL2, ffmpeg, fonts
//
// Paths in --out / --dir resolve against THIS folder (the piece), not your shell's cwd; absolute paths work.
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
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.dirname(fileURLToPath(import.meta.url));   // not URL.pathname: that keeps %20 for spaces
const argv = process.argv.slice(2);
const mode = argv[0];
if (!['stills', 'contact', 'video', 'audio', 'full', 'hash', 'doctor'].includes(mode)) {
  console.error('usage: node render.mjs <stills t1,t2,..|contact|video|audio|full|hash t1,..|doctor> [options]  (see header)');
  process.exit(2);
}
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);
const params = []; argv.forEach((a, i) => { if (a === '--param' && argv[i + 1]) params.push(argv[i + 1]); });
const alphaKind = flag('alpha') ? opt('alpha', 'prores') : null;
if (alphaKind && !['prores', 'webm'].includes(alphaKind)) { console.error('--alpha must be prores or webm'); process.exit(2); }
const defScale = mode === 'stills' ? 0.5 : mode === 'contact' || mode === 'doctor' ? 0.25 : 1;
const scale = +opt('scale', defScale), sub = +opt('sub', mode === 'contact' || mode === 'doctor' ? 4 : 8);
const resolveOut = (p) => path.resolve(root, p);
const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  p.on('error', rej);
  p.on('close', (c) => (c === 0 ? res() : rej(new Error(`${cmd} exited ${c}`))));
});

// ---------------------------------------------------------------- scene and target
const sceneFile = opt('scene', 'scene.js');
if (!/^[\w][\w./-]*\.m?js$/.test(sceneFile) || sceneFile.includes('..') || !fs.existsSync(path.join(root, sceneFile))) {
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
function pieceQuery() {
  const qs = new URLSearchParams({ scale: String(scale), sub: String(sub), scene: sceneFile });
  if (target) qs.set('target', target);
  if (opt('fps')) qs.set('fps', opt('fps'));
  if (alphaKind) qs.set('alpha', '1');
  for (const kv of params) { const i = kv.indexOf('='); qs.set('p.' + kv.slice(0, i), kv.slice(i + 1)); }
  return qs;
}
async function openPiece(browser) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
  page.setDefaultTimeout(0);
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => { console.error('[pageerror]', e.message); process.exitCode = 1; });
  await page.goto(`http://127.0.0.1:${port}/index.html?${pieceQuery()}`);
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
    params: Object.fromEntries(params.map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; })),
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
async function renderVideo(page, out, from, to) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', ...videoArgs(out)], { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', () => {});   // EPIPE once ffmpeg has died; the close handler below reports why
  const done = new Promise((r, j) => { ff.on('error', j); ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited ' + c)))); });
  done.catch((e) => { console.error(`render failed: ${e.message} (ffmpeg's own error is printed above)`); process.exit(1); });
  const t0 = Date.now();
  await page.evaluate(([a, b]) => window.renderRange(a, b), [from, to]);
  const frames = Math.round(to * INFO.FPS) - Math.round(from * INFO.FPS);
  const ms = (Date.now() - t0) / Math.max(1, frames);
  console.log(`video: ${frames} frames at ${INFO.RW}x${INFO.RH}, sub ${sub}: ${ms.toFixed(0)} ms/frame`);
  ff.stdin.end();
  await done;
  ff = null;
  return frames;
}
async function renderAudioTo(page, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  audioOut = out; await page.evaluate(() => window.renderSound());
  if (INFO.SILENT) console.log(`audio: ${sceneFile} exports silent = true, so the soundtrack is silence`);
  else audioReport(out);
}
// Peak, RMS and spike check on the 16-bit WAV from wav.js. A plain "peak under -1 dBFS" test misses
// an envelope bug that fires one full-scale blip, so also flag any 50 ms window far above the loud ones.
function audioReport(file) {
  const b = fs.readFileSync(file);
  let off = 12, ch = 2, sr = 48000, data = null;
  while (off < b.length - 8) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; }
    off += 8 + sz + (sz & 1);
  }
  if (!data || !data.length) { console.log('audio check: no samples'); return; }
  const n = Math.floor(data.length / 2 / ch), win = Math.round(sr * 0.05), wins = [];
  let sum = 0;
  for (let i = 0; i < n; i += win) {
    let wp = 0;
    for (let j = i; j < Math.min(n, i + win); j++) for (let c = 0; c < ch; c++) {
      const v = Math.abs(data.readInt16LE((j * ch + c) * 2)) / 32768; if (v > wp) wp = v; sum += v * v;
    }
    wins.push(wp);
  }
  const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));
  const sorted = [...wins].sort((a, b) => a - b), p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
  const peak = sorted[sorted.length - 1], at = wins.indexOf(peak) * 0.05, rms = Math.sqrt(sum / (n * ch));
  console.log(`audio check: peak ${db(peak).toFixed(1)} dBFS at ${at.toFixed(2)}s, RMS ${db(rms).toFixed(1)} dBFS`);
  if (peak > 0.89) console.log('  WARN peak above -1 dBFS: lower `level` in audio.js');
  if (peak > 0 && db(peak) - db(p90) > 18) console.log(`  WARN the ${at.toFixed(2)}s peak is ${(db(peak) - db(p90)).toFixed(0)} dB above the loud windows: likely a click or a gain envelope starting after its source`);
  if (db(rms) < -36) console.log('  WARN very quiet overall: raise `level` in audio.js');
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
    for (const e of ['libx264', 'libvpx-vp9', 'prores_ks', 'aac']) line(has(enc, e), 'ffmpeg encoder', e, `an ffmpeg built with ${e} (${ffInstall})`);
    line(has(dec, 'libvpx-vp9'), 'ffmpeg decoder', 'libvpx-vp9 (reads VP9 alpha)', `an ffmpeg built with libvpx (${ffInstall})`);
    for (const f of ['loudnorm', 'ebur128', 'sidechaincompress', 'alimiter', 'vflip', 'tile', 'alphaextract']) line(has(fil, f), 'ffmpeg filter', f, `an ffmpeg with the ${f} filter (${ffInstall})`);
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

// ---------------------------------------------------------------- modes
const t0 = Date.now();
let browser = null;
try {
  if (mode === 'doctor') {
    process.exitCode = await doctor();
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
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-'));
      const times = [];
      for (let i = 0; i < n; i++) {
        const t = +((DUR * (i + 0.5)) / n).toFixed(3);
        times.push(t);
        const url = await page.evaluate((t) => window.renderStill(t), t);
        fs.writeFileSync(path.join(tmp, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
      }
      const out = resolveOut(opt('out', 'contact.png'));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const rows = Math.ceil(n / cols);
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(tmp, 'f%03d.png'),
        '-vf', `tile=${cols}x${rows}:padding=6:margin=6:color=0x808080`, '-frames:v', '1', out]);
      fs.rmSync(tmp, { recursive: true, force: true });
      console.log('wrote', out, '\ntimes (reading order):', times.join(', '));
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
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
