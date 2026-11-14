// Safe zones (plan section 12): safezones.json keeps a source, a measured date and an estimate flag for every
// edge, and its rectangles agree with those edges; contact --safe shades what is outside the safe area and
// labels the zone; the grid scene for measuring a zone renders at a target's size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makePiece, render, templateDir } from './helpers.mjs';

const zones = JSON.parse(fs.readFileSync(path.join(templateDir, 'safezones.json'), 'utf8'));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

test('safezones.json: every target with a safe area records each edge with its source, date and estimate flag', () => {
  assert.match(zones.method, /grid\.js/);
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
  }
  // nothing has been measured from app screenshots yet (plan Q3: the owner measures, then flips these)
  assert.ok(Object.values(zones.targets).every((t) => t.estimate));
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
