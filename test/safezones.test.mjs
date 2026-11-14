// Safe zones (plan section 12): safezones.json keeps a source, a measured date and an estimate flag for every
// edge, and its rectangles agree with those edges; the platforms' published ad zones ship as measured targets,
// with TikTok's button column as an exclude rectangle that check and the overlays honour; contact --safe
// shades what is outside the safe area and labels the zone; the grid scene renders at a target's size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePiece, render, templateDir } from './helpers.mjs';
import { runCheck } from './check-helpers.mjs';

const zones = JSON.parse(fs.readFileSync(path.join(templateDir, 'safezones.json'), 'utf8'));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

test('safezones.json: every target with a safe area records each edge with its source, date and estimate flag', () => {
  assert.match(zones.method, /screenshots of videos already posted/);
  assert.match(zones.about, /`exclude`/);
  for (const [name, t] of Object.entries(zones.targets)) {
    assert.equal(typeof t.estimate, 'boolean', name);
    assert.ok(t.source, `${name}: no source`);
    if (!t.safe) { assert.equal(t.edges, undefined, name); continue; }
    const e = t.edges;
    assert.deepEqual(Object.keys(e).sort(), ['bottom', 'left', 'right', 'top'], name);
    assert.deepEqual([t.safe.x, t.safe.y, t.safe.x + t.safe.w, t.safe.y + t.safe.h], [e.left.at, e.top.at, e.right.at, e.bottom.at], `${name}: safe and edges disagree`);
    assert.ok(t.safe.x >= 0 && t.safe.y >= 0 && t.safe.x + t.safe.w <= t.w && t.safe.y + t.safe.h <= t.h, `${name}: outside the canvas`);
    for (const [k, v] of Object.entries(e)) {
      assert.equal(typeof v.estimate, 'boolean', `${name}.${k}`);
      assert.ok(v.source, `${name}.${k}: no source`);
      if (v.estimate) assert.equal(v.measured, null, `${name}.${k}: an estimate has no measured date`);
      else assert.match(String(v.measured), DATE, `${name}.${k}: a measured edge needs its date`);
    }
    assert.equal(t.estimate, Object.values(e).some((v) => v.estimate), `${name}: the target is an estimate exactly while an edge is`);
    if (!t.estimate) assert.match(String(t.measured), DATE, `${name}: a measured target needs its date`);
    for (const x of t.exclude || []) {
      assert.ok(x.w > 0 && x.h > 0 && x.source, `${name}: an exclude rectangle needs a size and a source`);
      assert.ok(x.x >= t.safe.x && x.y >= t.safe.y && x.x + x.w <= t.safe.x + t.safe.w && x.y + x.h <= t.safe.y + t.safe.h, `${name}: an exclude rectangle sits inside safe`);
    }
  }
  // the organic targets stay estimates until they are measured from screenshots of posted videos (plan Q3)
  for (const name of ['tiktok', 'reels', 'shorts']) assert.equal(zones.targets[name].estimate, true, name);
});

test('the published ad zones ship as measured 1080x1920 targets, exact, with their sources', () => {
  const want = {
    'tiktok-ad': { safe: { x: 120, y: 240, w: 840, h: 1020 }, exclude: [{ x: 780, y: 840, w: 180, h: 420 }], src: /In-Feed-Standard Version LTR\.zip.*720x1280 grid: 80 sides, 160 top, 440 bottom/ },
    'reels-ad': { safe: { x: 65, y: 269, w: 950, h: 979 }, exclude: [], src: /instagram-reels.*14% of the top, 35% of the bottom, and 6% on each side/ },
    'shorts-ad': { safe: { x: 48, y: 288, w: 840, h: 960 }, exclude: [], src: /answer\/16041697.*288 top, 672 bottom, 48 left, 192 right/ },
  };
  for (const [name, w] of Object.entries(want)) {
    const t = zones.targets[name];
    assert.deepEqual([t.w, t.h, t.fps, t.estimate, t.measured], [1080, 1920, 30, false, '2026-11-14'], name);
    assert.deepEqual(t.safe, w.safe, name);
    assert.deepEqual((t.exclude || []).map(({ x, y, w: ww, h }) => ({ x, y, w: ww, h })), w.exclude, name);
    assert.match(t.source, w.src, name);
    for (const e of Object.values(t.edges)) { assert.equal(e.estimate, false); assert.equal(e.measured, '2026-11-14'); assert.match(e.source, w.src); }
  }
});

// A 1 s scene with one text box, placed by --param x (and y), for the zone tests through render.mjs check.
const COL = `export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 1.0, FONTS: [] };
export const TL = {};
export const silent = true;
let ctx, X = 800, Y = 1000;
export async function init({ ctx: c, params }) { ctx = c; if (params.x) X = +params.x; if (params.y) Y = +params.y; }
export function frame(t, jit) {
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(X, Y, 100, 60);
  return { t, jit, use2D: true, scene: 0, cam: [1, 0, 0, 0], clear: [0.1, 0.1, 0.12] };
}
export const boxes = () => [{ id: 'col', text: 'COL', x: X, y: Y, w: 100, h: 60 }];
export function post(t) { return { t, bloom: 0, thr: 1, ca: 0, glitch: 0, grain: 0, vig: 0, flash: 0, fade: 1, hud: 0 }; }
`;
test('check --target tiktok-ad: text in the button column FAILs, the same text moved left passes; an estimate target with an exclude WARNs', () => {
  const dir = makePiece('safe-exclude');
  fs.writeFileSync(path.join(dir, 'col.js'), COL);
  const at = (x, target = 'tiktok-ad') => runCheck(dir, ['--scene', 'col.js', '--target', target, '--only', 'text_safe', '--param', `x=${x}`]);
  const inCol = at(800);
  assert.equal(inCol.status, 1, inCol.out);
  assert.deepEqual(inCol.results.map((x) => [x.id, x.level]), [['text_safe', 'FAIL']]);
  assert.match(inCol.results[0].detail, /in an area it excludes/);
  const left = at(500);
  assert.equal(left.status, 0, left.out);
  assert.deepEqual(left.results.map((x) => [x.id, x.level]), [['text_safe', 'OK']]);
  // the same zone marked an estimate: a WARN, exit 0
  const f = path.join(dir, 'safezones.json'), z = JSON.parse(fs.readFileSync(f, 'utf8'));
  z.targets['tiktok-ad-est'] = { ...z.targets['tiktok-ad'], estimate: true, measured: null };
  fs.writeFileSync(f, JSON.stringify(z, null, 2));
  const est = at(800, 'tiktok-ad-est');
  assert.equal(est.status, 0, est.out);
  assert.deepEqual(est.results.map((x) => [x.id, x.level]), [['text_safe', 'WARN']]);
  assert.match(est.results[0].detail, /\(estimate\) \(in an area it excludes\)/);
});

test('contact --safe shades outside the safe area on every panel, leaves the inside alone, and labels the zone an estimate', () => {
  const dir = makePiece('safe-contact');
  const r = render(dir, ['contact', '--safe', '--target', 'tiktok', '--n', '1', '--cols', '1', '--scale', '0.25', '--out', 'safe.png']);
  assert.match(r.stdout, /safe zones: tiktok \(estimate/);
  render(dir, ['contact', '--target', 'tiktok', '--n', '1', '--cols', '1', '--scale', '0.25', '--out', 'plain.png']);
  // the sheet: a 6 px margin around one 270 x 480 panel
  const gray = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, f), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 << 20 });
  const a = gray('plain.png'), b = gray('safe.png'), W = 282;
  const mean = (g, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += g[(y + 6) * W + x + 6]; n++; } return s / n; };
  const z = { x: 84 / 4, y: 160 / 4, w: 852 / 4, h: 1320 / 4 };
  // below the zone (y 370-480 of the panel) is darker; inside it, away from the outline, nothing changes
  assert.ok(mean(b, 0, 375, 270, 480) < 0.7 * mean(a, 0, 375, 270, 480), `${mean(b, 0, 375, 270, 480)} vs ${mean(a, 0, 375, 270, 480)}`);
  assert.equal(mean(b, z.x + 4, z.y + 4, z.x + z.w - 4, z.y + z.h - 4), mean(a, z.x + 4, z.y + 4, z.x + z.w - 4, z.y + z.h - 4));
  // the label sits in the band above the zone, in the outline's yellow
  assert.ok(mean(b, 8, 26, 150, 38) > mean(a, 8, 26, 150, 38), 'no label above the zone');
});

test('contact --safe on tiktok-ad shades the button column too; the rest of the safe area is left alone', () => {
  const dir = makePiece('safe-contact-ad');
  render(dir, ['contact', '--safe', '--target', 'tiktok-ad', '--n', '1', '--cols', '1', '--scale', '0.25', '--out', 'safe.png']);
  render(dir, ['contact', '--target', 'tiktok-ad', '--n', '1', '--cols', '1', '--scale', '0.25', '--out', 'plain.png']);
  const gray = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, f), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 << 20 });
  const a = gray('plain.png'), b = gray('safe.png'), W = 282;
  const mean = (g, x0, y0, x1, y1) => { let s = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += g[(y + 6) * W + x + 6]; n++; } return s / n; };
  // the column at quarter scale: x 195-240, y 210-315; inside it, away from its outline
  const col = [199, 214, 236, 311], open = [40, 214, 190, 311];
  assert.ok(mean(b, ...col) < 0.7 * mean(a, ...col), `column: ${mean(b, ...col)} vs ${mean(a, ...col)}`);
  assert.equal(mean(b, ...open), mean(a, ...open), 'the safe area beside the column is unchanged');
});

test('contact --safe needs a target with a safe area that fits the piece', () => {
  const dir = makePiece('safe-contact-bad');
  for (const [args, re] of [[['--target', 'none'], /target none has no safe area/], [['--target', 'youtube'], /target youtube is 1920x1080, but the piece is 1080x1920/]]) {
    const r = render(dir, ['contact', '--safe', ...args, '--n', '1', '--scale', '0.25'], { allowFail: true });
    assert.notEqual(r.status, 0); assert.match(r.out, re);
  }
});

test('the grid scene renders at the target\'s size, and needs a target', () => {
  const dir = makePiece('safe-grid');
  render(dir, ['stills', '1.0', '--scene', 'grid.js', '--target', 'feed45', '--scale', '0.25', '--dir', 'g']);
  const png = fs.readFileSync(path.join(dir, 'g', 't01.000.png'));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [270, 338]);
  const r = render(dir, ['stills', '1.0', '--scene', 'grid.js', '--scale', '0.25'], { allowFail: true });
  assert.notEqual(r.status, 0); assert.match(r.out, /no canvas size|needs --target/);
});
