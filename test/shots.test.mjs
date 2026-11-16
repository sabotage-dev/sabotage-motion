// tools/shots.mjs (plan 23.4): pictures of a local page for a launch video. The page is test/fixtures/fixture-shots/
// tall.html: 3000 CSS px tall, fourteen landmarks at known heights (each a width of its own, so a frame says which
// one it is), a CSS animation, a requestAnimationFrame loop and a scroll-driven bar. The full-page screenshot is the
// page's full height with every landmark at its height; a sequence is in the layout frames.mjs writes, each landmark at
// its expected row in every frame within 1 px, the page's own motion on the piece's clock, the same bytes on a second
// run, and it plays through loadSeq and seqAt at the piece's fps. A sequence over 1 GB decoded is refused before
// anything is captured, and so is a page that is not local.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makePiece, templateDir } from './helpers.mjs';

const SH = await import(pathToFileURL(path.join(templateDir, 'tools', 'shots.mjs')).href);
const lib = await import(pathToFileURL(path.join(templateDir, 'lib.js')).href);
const P = (dir, f) => path.join(dir, f);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const shots = (dir, args) => { const r = spawnSync(process.execPath, ['tools/shots.mjs', ...args], { cwd: dir, encoding: 'utf8', timeout: 180000 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const VP = ['--viewport', '135x240', '--dpr', '2'];
const PAGE_H = 3000, VIEW_H = 240, DPR = 2, LANDMARKS = Array.from({ length: 14 }, (_, k) => ({ k, top: 200 * (k + 1), w: 8 + 6 * k }));

// An image's pixels as RGB bytes, with its size.
function rgb(file) {
  const b = fs.readFileSync(file), w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  return { w, h, px: execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }) };
}
const white = (im, x, y) => { const o = (y * im.w + x) * 3; return im.px[o] > 200 && im.px[o + 1] > 200 && im.px[o + 2] > 200; };
// The landmarks in an image: [{ k, row }], read from column x = 2 (above `below`), each named by its width.
function landmarks(im, below = im.h) {
  const out = [];
  for (let y = 0; y < below; y++) {
    if (!white(im, 2, y) || (y > 0 && white(im, 2, y - 1))) continue;
    let x = 0; while (x < im.w && white(im, x, y)) x++;
    out.push({ k: Math.round((x / DPR - 8) / 6), row: y });
  }
  return out;
}
// The first column from the left in a band of rows where a colour test holds, or -1.
function firstX(im, y, test) { for (let x = 0; x < im.w; x++) { const o = (y * im.w + x) * 3; if (test(im.px[o], im.px[o + 1], im.px[o + 2])) return x; } return -1; }
const red = (r, g, b) => r > 200 && g < 60 && b < 60, green = (r, g, b) => g > 200 && r < 60 && b < 60, blue = (r, g, b) => b > 200 && r < 60 && g < 60;
// Where the scroll should be at frame i of n (worked out here, not read from shots.mjs)
const wantScroll = (i, n, from, to, ease) => Math.round(from + (to - from) * ease(n > 1 ? i / (n - 1) : 1));
const piece = (name) => makePiece(name, 'fixture-shots');

test('page: one full-page screenshot, the page\'s full height (x dpr) tall, every landmark at its height', () => {
  const dir = piece('shots-page');
  for (const dpr of [1, 2]) {
    const r = shots(dir, ['page', `full${dpr}`, 'tall.html', '--viewport', '135x240', '--dpr', String(dpr)]);
    assert.equal(r.status, 0, r.out);
    const im = rgb(P(dir, `assets/shots/full${dpr}.png`));
    assert.deepEqual([im.w, im.h], [135 * dpr, PAGE_H * dpr], `dpr ${dpr}: the full page, not the viewport`);
    const found = [];
    for (let y = 0; y < im.h; y++) if (white(im, 2, y) && !white(im, 2, y - 1)) found.push(y);
    assert.deepEqual(found.map((y, i) => Math.abs(y - LANDMARKS[i].top * dpr) <= 1), LANDMARKS.map(() => true), `dpr ${dpr}: rows ${found.join(', ')}`);
    assert.match(r.out, new RegExp(`the full page: ${135 * dpr}x${PAGE_H * dpr} px \\(${PAGE_H} CSS px tall\\)`));
  }
  assert.deepEqual(fs.readdirSync(P(dir, 'assets/shots')).sort(), ['full1.png', 'full2.png'], 'no temporary file left behind');
});

let seqDir;
test('seq: the layout frames.mjs writes (manifest frames, fps, w, h, ext; files from 000), round(dur x fps) frames at the scene\'s CFG.FPS', () => {
  seqDir = piece('shots-seq');
  const r = shots(seqDir, ['seq', 'tall', 'tall.html', ...VP, '--dur', '0.9', '--scroll', '100:2700']);
  assert.equal(r.status, 0, r.out);
  const m = readJson(P(seqDir, 'assets/seq/manifest.json')).tall;
  assert.deepEqual({ frames: m.frames, fps: m.fps, w: m.w, h: m.h, ext: m.ext, src: m.src, scroll: m.scroll, ease: m.ease, viewport: m.viewport, dpr: m.dpr },
    { frames: 22, fps: 24, w: 270, h: 480, ext: 'png', src: 'tall.html', scroll: [100, 2700], ease: 'swift', viewport: [135, 240], dpr: 2 });
  const files = fs.readdirSync(P(seqDir, 'assets/seq/tall')).sort();
  assert.deepEqual(files, Array.from({ length: 22 }, (_, i) => `${String(i).padStart(3, '0')}.png`));
  assert.ok(!fs.readdirSync(P(seqDir, 'assets/seq')).some((f) => f.includes('.tmp-')), 'no temporary folder left behind');
  assert.match(r.out, /22 frames at 24 fps \(scene\.js CFG\.FPS\), 270x480/);
});

test('seq: every landmark at its expected row in every frame, within 1 px (swift, and linear), and the scroll-driven bar at its width', () => {
  for (const [ease, fn] of [['swift', lib.swift], ['linear', (x) => x]]) {
    const name = ease === 'swift' ? 'tall' : 'lin';
    if (ease === 'linear') { const r = shots(seqDir, ['seq', 'lin', 'tall.html', ...VP, '--dur', '0.9', '--scroll', '2700:100', '--ease', 'linear']); assert.equal(r.status, 0, r.out); }
    const n = readJson(P(seqDir, 'assets/seq/manifest.json'))[name].frames, [from, to] = ease === 'swift' ? [100, 2700] : [2700, 100];
    const scrolls = [];
    for (let i = 0; i < n; i++) {
      const im = rgb(P(seqDir, `assets/seq/${name}/${String(i).padStart(3, '0')}.png`)), y = wantScroll(i, n, from, to, fn);
      scrolls.push(y);
      const barRow = 232 * DPR;   // the fixed bar covers the landmarks under it
      const want = LANDMARKS.map((l) => ({ k: l.k, row: (l.top - y) * DPR })).filter((l) => l.row >= 0 && l.row + 4 * DPR <= barRow);
      const got = landmarks(im, barRow).filter((l) => l.row + 4 * DPR <= barRow);
      assert.deepEqual(got.map((l) => l.k), want.map((l) => l.k), `${ease} frame ${i} (scroll ${y}): landmarks ${JSON.stringify(got)}`);
      got.forEach((l, j) => assert.ok(Math.abs(l.row - want[j].row) <= 1, `${ease} frame ${i}: landmark ${l.k} at row ${l.row}, expected ${want[j].row}`));
      let bar = im.w; while (bar > 0 && !blue(...im.px.subarray(((barRow + 2) * im.w + bar - 1) * 3, ((barRow + 2) * im.w + bar) * 3))) bar--;
      assert.ok(Math.abs(bar - (im.w * y) / (PAGE_H - VIEW_H)) <= 2, `${ease} frame ${i}: the scroll-driven bar is ${bar} px wide at scroll ${y}`);
    }
    assert.ok(scrolls.filter((s, i) => i && s !== scrolls[i - 1]).length >= n - 3, `${ease}: the scroll moves from frame to frame (${scrolls.join(', ')})`);
    if (ease === 'swift') assert.ok(scrolls[1] - scrolls[0] < (to - from) / n / 2, 'swift starts slow');
  }
});

test('seq: the page moves on the piece\'s clock (a CSS animation at its time, a requestAnimationFrame loop within its 16 ms tick), the same bytes on a second run', () => {
  const n = readJson(P(seqDir, 'assets/seq/manifest.json')).tall.frames;
  const hashes = (name) => Array.from({ length: n }, (_, i) => crypto.createHash('sha256').update(fs.readFileSync(P(seqDir, `assets/seq/${name}/${String(i).padStart(3, '0')}.png`))).digest('hex'));
  const before = hashes('tall');
  for (let i = 0; i < n; i++) {
    const im = rgb(P(seqDir, `assets/seq/tall/${String(i).padStart(3, '0')}.png`)), t = i / 24;
    const cssX = firstX(im, 8 * DPR, red), jsX = firstX(im, 20 * DPR, green);   // #css spans rows 4 to 12 CSS px, #js 16 to 24
    assert.ok(Math.abs(cssX - DPR * (96 + 30 * (t % 1))) <= 1, `frame ${i}: the CSS animation at x ${cssX}, expected ${DPR * (96 + 30 * (t % 1))}`);
    // the page's clock reads 1 ms more than the frame's time when the capture starts; requestAnimationFrame ticks every 16 ms
    const ms = 1 + SH.clockAt(i, 24), lo = DPR * (96 + 30 * (((ms - 17) / 1000) % 1)), hi = DPR * (96 + 30 * ((ms / 1000) % 1));
    assert.ok(jsX >= Math.floor(lo) - 1 && jsX <= Math.ceil(hi) + 1, `frame ${i}: the requestAnimationFrame loop at x ${jsX}, expected ${lo.toFixed(1)} to ${hi.toFixed(1)}`);
  }
  const r = shots(seqDir, ['seq', 'tall', 'tall.html', ...VP, '--dur', '0.9', '--scroll', '100:2700']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(hashes('tall'), before, 'a second capture of the same page is the same, frame by frame');
});

// Which sequence frame each frame of a render shows, read from the landmarks: the scroll it implies.
function renderedScrolls(file) {
  const W = 270, H = 480, raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 28 });
  const out = [];
  for (let f = 0; f < raw.length / (W * H); f++) {
    const lum = (x, y) => raw[f * W * H + y * W + x], est = [];
    for (let y = 1; y < 232 * DPR - 8; y++) {
      if (!(lum(2, y) > 128) || lum(2, y - 1) > 128) continue;
      let x = 0; while (x < W && lum(x, y) > 128) x++;
      est.push(200 * (Math.round((x / DPR - 8) / 6) + 1) - y / DPR);
    }
    est.sort((a, b) => a - b);
    out.push(est.length ? est[est.length >> 1] : null);
  }
  return out;
}

test('seq plays through loadSeq and seqAt at the piece\'s fps: each rendered frame shows the sequence frame for its time', () => {
  const r = shots(seqDir, ['seq', 'run', 'tall.html', ...VP, '--dur', '1', '--scroll', '0:1200', '--ease', 'linear']);
  assert.equal(r.status, 0, r.out);
  fs.writeFileSync(P(seqDir, 'run.js'), fs.readFileSync(P(seqDir, 'scene.js'), 'utf8').replace(/'tall'/g, "'run'"));
  const v = spawnSync(process.execPath, ['render.mjs', 'video', '--scene', 'run.js', '--scale', '0.25', '--sub', '1', '--crf', '0', '--out', 'out/run.mp4'],
    { cwd: seqDir, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL' });
  assert.equal(v.status, 0, v.stdout + v.stderr);
  const got = renderedScrolls(P(seqDir, 'out/run.mp4'));
  assert.equal(got.length, 30, '1.25 s at 24 fps');
  const n = 24, want = got.map((_, f) => wantScroll(lib.seqIndex(n, 24, f / 24), n, 0, 1200, (x) => x));
  got.forEach((s, f) => assert.ok(s != null && Math.abs(s - want[f]) <= 1, `rendered frame ${f}: the scroll ${s}, expected ${want[f]} (sequence frame ${lib.seqIndex(n, 24, f / 24)})`));
  assert.equal(want[23], 1200, 'the last sequence frame is at the end of the scroll');
  assert.equal(want[29], 1200, 'and it holds');
});

test('the decoded-size refusal: over 1 GB (frames x w x h x 4 bytes, in device pixels) is refused before anything is captured', () => {
  assert.equal(SH.SEQ_MAX_BYTES, 1024 ** 3);
  assert.equal(SH.seqBytes({ frames: 2, w: 3, h: 5 }), 120);
  assert.equal(SH.seqTooBig({ frames: 256, w: 1024, h: 1024 }), null, 'exactly 1 GB is allowed');
  assert.match(SH.seqTooBig({ frames: 257, w: 1024, h: 1024 }), /257 frames of 1024x1024 hold 1\.00 GB decoded .* lower the size \(--viewport, --dpr\) or the length \(--dur\)/);
  assert.equal(SH.seqTooBig({ frames: 1, w: 16384, h: 16384 }), null, '16384 x 16384 x 4 is 1 GB');
  assert.ok(SH.seqTooBig({ frames: 1, w: 16384, h: 16385 }));
  const dir = piece('shots-big');
  const old = shots(dir, ['seq', 'big', 'tall.html', '--viewport', '135x240', '--dur', '0.1', '--scroll', '0:10']);
  assert.equal(old.status, 0, old.out);
  const before = fs.readFileSync(P(dir, 'assets/seq/manifest.json'), 'utf8');
  // 257 frames of 512x512 CSS px at dpr 2 (1024x1024 device px): one frame over 1 GB, refused at once
  const t0 = Date.now(), r = shots(dir, ['seq', 'big', 'tall.html', '--viewport', '512x512', '--dpr', '2', '--fps', '32', '--dur', '8.03125', '--scroll', '0:10']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /refused: 257 frames of 1024x1024 hold 1\.00 GB decoded .*over loadSeq's 1 GB: lower the size \(--viewport, --dpr\) or the length \(--dur\)/);
  assert.ok(Date.now() - t0 < 5000, 'refused before a browser opened');
  assert.equal(fs.readFileSync(P(dir, 'assets/seq/manifest.json'), 'utf8'), before, 'the manifest is untouched');
  assert.equal(fs.readdirSync(P(dir, 'assets/seq/big')).length, 2, 'the older sequence (0.1 s at 24 fps) stays');
  // the same length at dpr 1 is a quarter of that, and is not refused
  assert.equal(SH.seqTooBig({ frames: 257, w: 512, h: 512 }), null);
});

test('refusals: a page that is not local, a scroll past the page\'s end, a viewport not stated; a running local app works', async () => {
  const dir = piece('shots-refuse');
  for (const url of ['https://example.invalid/', 'http://192.0.2.1:8080/']) {
    const r = shots(dir, ['page', 'x', url, '--viewport', '135x240']);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /a local HTML file or an app running on this machine/);
  }
  assert.equal(shots(dir, ['page', 'x', 'tall.html']).status, 2, 'no --viewport');
  assert.equal(shots(dir, ['page', 'x', 'scene.js', '--viewport', '135x240']).status, 2, 'not an HTML file');
  assert.equal(shots(dir, ['seq', 'x', 'tall.html', '--viewport', '135x240', '--dur', '1']).status, 2, 'no --scroll');
  assert.equal(shots(dir, ['seq', '../x', 'tall.html', '--viewport', '135x240', '--dur', '1', '--scroll', '0:1']).status, 2, 'a name that is a path');
  assert.equal(shots(dir, ['seq', 's', 'tall.html', '--viewport', '135x240', '--dur', '0.1', '--scroll', '0:10']).status, 0);
  const r = shots(dir, ['seq', 's', 'tall.html', '--viewport', '135x240', '--dur', '0.2', '--scroll', '0:2761']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /tall\.html scrolls to at most 2760 px at a 135x240 viewport/);
  assert.equal(readJson(P(dir, 'assets/seq/manifest.json')).s.frames, 2, 'the older sequence (0.1 s at 24 fps) stays');
  assert.equal(fs.readdirSync(P(dir, 'assets/seq/s')).length, 2);
  assert.ok(!fs.readdirSync(P(dir, 'assets/seq')).some((f) => f.includes('.tmp-')), 'no temporary folder left behind');
  // a running local app: the same page served on 127.0.0.1
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(P(dir, 'tall.html'))); });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const out = await new Promise((ok) => { const p = spawn(process.execPath, ['tools/shots.mjs', 'page', 'app', url, '--viewport', '135x240'], { cwd: dir }); let s = ''; p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d)); p.on('close', (c) => ok({ c, s })); });
    assert.equal(out.c, 0, out.s);
    assert.deepEqual([rgb(P(dir, 'assets/shots/app.png')).w, rgb(P(dir, 'assets/shots/app.png')).h], [135, PAGE_H]);
  } finally { server.close(); }
});
