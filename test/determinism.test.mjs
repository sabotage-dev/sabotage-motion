// Determinism (plan section 16): the same frame rendered twice is byte-identical, and frame t
// rendered after a different frame equals frame t rendered first (no state carried between calls).
// Compared on one machine only: GPU and SwiftShader output differ (Q9).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePiece, render, templateDir, fixturesDir, repoFiles, repoRoot } from './helpers.mjs';

const dir = makePiece('determinism');
const hashes = (args) => [...render(dir, ['hash', ...args, '--scale', '0.25']).stdout.matchAll(/^hash t=(\S+) ([0-9a-f]{64})$/gm)]
  .map((m) => ({ t: +m[1], h: m[2] }));

test('the same frame rendered twice in one page is byte-identical, before and after another frame', () => {
  const a = hashes(['1.3,1.3,0.4,1.3']);
  assert.equal(a.length, 4);
  assert.equal(a[1].h, a[0].h, 'second render of t=1.3 differs from the first');
  assert.equal(a[3].h, a[0].h, 't=1.3 rendered after t=0.4 differs');
  assert.notEqual(a[2].h, a[0].h, 'different frames hash the same: the hash is not seeing the picture');
});

test('frame t rendered after other frames equals frame t rendered first in a fresh page', () => {
  const first = hashes(['1.3'])[0].h;
  const after = hashes(['0.4,1.7,1.3']);
  assert.equal(after[2].h, first);
  const fresh04 = hashes(['0.4'])[0].h;
  assert.equal(after[0].h, fresh04, 't=0.4 differs between two fresh pages');
});

test('alpha mode frames are deterministic too', () => {
  const a = [...render(dir, ['hash', '0.9,0.2,0.9', '--scale', '0.25', '--alpha']).stdout.matchAll(/^hash t=\S+ ([0-9a-f]{64})$/gm)].map((m) => m[1]);
  assert.equal(a.length, 3);
  assert.equal(a[2], a[0]);
});

test('PNG stills of the same frame are byte-identical across runs', () => {
  render(dir, ['stills', '0.9', '--scale', '0.25', '--dir', 'stills/a']);
  render(dir, ['stills', '1.5,0.9', '--scale', '0.25', '--dir', 'stills/b']);
  const a = fs.readFileSync(path.join(dir, 'stills/a/t00.900.png')), b = fs.readFileSync(path.join(dir, 'stills/b/t00.900.png'));
  assert.ok(a.length > 1000);
  assert.ok(a.equals(b));
});

// Browser modules only (.js): render.mjs runs in Node and never draws a frame.
test('no Math.random() in the template\'s or the fixtures\' browser modules (code only, comments ignored)', () => {
  const files = repoFiles().filter((f) => /\.js$/.test(f) && (f.startsWith(path.relative(repoRoot, templateDir)) || f.startsWith(path.relative(repoRoot, fixturesDir))));
  assert.ok(files.length >= 9, `only ${files.length} engine files found`);
  const bad = files.filter((f) => {
    const code = fs.readFileSync(path.join(repoRoot, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    return /Math\.random\s*\(/.test(code);
  });
  assert.deepEqual(bad, []);
});
