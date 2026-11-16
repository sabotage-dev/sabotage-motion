// The terminal-demo example's wires to code.js (plan 23.3), on a throwaway copy of the example: its sound carries a key
// tick at each key press its scene kept (the sound rendered with and without TL.keys, and the difference read at each
// press), the presses are thinned to KEY_MAX a second, and its code is drawn in its look's colours (neon), not the
// template's. examples-check.test.mjs runs `check` on the example itself.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { examplesDir, render, readWav, templateDir, repoRoot } from './helpers.mjs';

const C = await import(pathToFileURL(path.join(templateDir, 'check.mjs')).href);
const K = await import(pathToFileURL(path.join(templateDir, 'code.js')).href);
const LK = await import(pathToFileURL(path.join(templateDir, 'looks.js')).href);
const dir = path.join(repoRoot, 'test', '.work', 'terminal-demo-wires');

let keys, a, b;
before(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(path.join(examplesDir, 'terminal-demo'), dir, { recursive: true, filter: (s) => !path.relative(examplesDir, s).split(path.sep).includes('out') });
  // two wrapper scenes over the example's own: one prints the TL.keys its init made, one empties them
  fs.writeFileSync(path.join(dir, 'probe.js'), "export * from './scene.js';\nimport * as S from './scene.js';\nexport async function init(o) { await S.init(o); console.log('KEYS ' + JSON.stringify(S.TL.keys)); }\n");
  fs.writeFileSync(path.join(dir, 'nokeys.js'), "export * from './scene.js';\nimport * as S from './scene.js';\nexport async function init(o) { await S.init(o); S.TL.keys = []; }\n");
  const r = render(dir, ['audio', '--scene', 'probe.js', '--out', 'out/a.wav']);
  keys = JSON.parse(r.stdout.match(/^\[page\] KEYS (.*)$/m)[1]);
  render(dir, ['audio', '--scene', 'nokeys.js', '--out', 'out/b.wav']);
  a = readWav(path.join(dir, 'out', 'a.wav')); b = readWav(path.join(dir, 'out', 'b.wav'));
});

test('terminal-demo: its TL.keys are its typed presses thinned to 12 a second, in the two commands\' typing', () => {
  assert.ok(keys.length >= 12, `${keys.length} kept presses`);
  assert.deepEqual(K.keyTicks(keys), keys, 'already thinned');
  const ts = keys.map((k) => k.t);
  assert.ok(Math.max(...ts.map((t) => ts.filter((u) => u > t - 1 && u <= t).length)) <= K.KEY_MAX);
  assert.equal(keys.filter((k) => k.key === 'enter').length, 2, 'two commands, two Enters');
  for (const t of ts) assert.ok((t >= 0.3 && t < 1.3) || (t >= 2.6 && t < 4.0), `a key press at ${t} s, outside the commands' typing`);
});
test('terminal-demo: its sound has a key tick at every kept press (with the ticks and without them, the difference)', () => {
  const d = a.samples.map((x, i) => x - b.samples[i]);
  const pk = (t0, t1) => { let p = 0; for (let i = Math.max(0, Math.floor(t0 * a.sr)) * a.ch; i < Math.floor(t1 * a.sr) * a.ch; i++) p = Math.max(p, Math.abs(d[i])); return p; };
  assert.ok(pk(0, keys[0].t - 0.002) < 1e-3, 'nothing before the first press');
  for (const k of keys) {
    const at = pk(k.t, k.t + 0.012), pre = pk(k.t - 0.012, k.t - 0.002);
    assert.ok(at > 0.03 && at > 20 * pre, `the press at ${k.t.toFixed(3)} s: ${at.toExponential(2)} after it, ${pre.toExponential(2)} before`);
  }
});
test('terminal-demo: its code is drawn in its look\'s colours (neon\'s accent2 in the terminal and the diff), not the template\'s', () => {
  render(dir, ['stills', '7.5', '--scale', '0.5', '--dir', 'stills']);
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', path.join(dir, 'stills', 't07.500.png'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 << 20 });
  const count = (hex, r) => {
    const L = C.hexToLab(hex);
    let n = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { const o = (y * 540 + x) * 3; if (C.ciede2000(C.rgbToLab(px[o], px[o + 1], px[o + 2]), L) <= 12) n++; }
    return n;
  };
  // the two windows' content areas at 7.5 s (after the lift), at half size
  const term = { x: 36, y: 224, w: 432, h: 212 }, diff = { x: 36, y: 482, w: 432, h: 197 };
  const neon = LK.LOOKS.neon.tokens, tpl = LK.TEMPLATE.tokens;
  for (const [name, r] of [['terminal', term], ['diff', diff]]) {
    assert.ok(count(neon.accent2, r) > 200, `${name}: ${count(neon.accent2, r)} pixels in neon's accent2`);
    assert.ok(count(neon.accent, r) > 200, `${name}: ${count(neon.accent, r)} pixels in neon's accent`);
    assert.equal(count(tpl.accent2, r) + count(tpl.accent, r), 0, `${name}: the template's accents`);
  }
});
test('terminal-demo: the line its terminal names is the diff\'s removed line, and the hunk header counts the lines it has', () => {
  const src = fs.readFileSync(path.join(examplesDir, 'terminal-demo', 'scene.js'), 'utf8');
  const diff = src.match(/const DIFF = `([\s\S]*?)`;/)[1], named = +src.match(/src\/clock\.ts:(\d+)/)[1];
  const h = diff.match(/^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
  assert.ok(h, 'a hunk header with both counts');
  const rows = K.diffBlock({ src: diff, x: 0, y: 0, w: 900, h: 900 }).rows.filter((r) => r.kind !== 'hunk');
  const old = rows.filter((r) => r.kind !== 'add'), neu = rows.filter((r) => r.kind !== 'del');
  assert.deepEqual([+h[2], +h[4]], [old.length, neu.length], 'the header counts the old and the new lines');
  assert.equal(named, +h[1] + old.findIndex((r) => r.kind === 'del'), 'the line the terminal reports');
  assert.equal(K.tokenize(diff, 'diff').filter((t) => t.k === 'meta').length, 0);
});
