// Code and terminal motion in a render (plan 23.3), on test/fixtures/fixture-code (4 s on tiktok-ad, whose safe area is
// measured): the layout calls in the page at stated times (the typed prefix, the terminal's rows, both scroll offsets)
// against values worked out by hand, with the frame hash stable at those times; text_safe FAILs the code block moved
// outside the safe area for more than 0.25 s and passes it inside; the phone frame over the code is no text_overlap;
// the key ticks in the rendered sound are thinned to KEY_MAX a second, land on the kept key presses and are silent
// while nothing types. test/code-units.test.mjs has the same helpers without a browser.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makePiece, render, readWav } from './helpers.mjs';
import { runCheck, byId } from './check-helpers.mjs';

const dir = makePiece('code', 'fixture-code');
const K = await import(pathToFileURL(path.join(dir, 'code.js')).href);
const { blocks } = await import(pathToFileURL(path.join(dir, 'blocks.js')).href);
const TIMES = [0.51, 1.12, 2.4, 3.15, 3.6, 3.9];
let logged, hashes;
const hashOf = (out) => Object.fromEntries([...out.matchAll(/^hash t=([\d.]+) ([0-9a-f]{64})$/gm)].map((m) => [+m[1], m[2]]));
before(() => {
  const r = render(dir, ['hash', TIMES.join(','), '--scale', '0.25', '--param', `log=${TIMES.join(',')}`]);
  logged = [...r.stdout.matchAll(/CODESTATE (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
  hashes = hashOf(r.stdout);
});

// The code types from 0.3 s, one character every 1/30 s and 0.1 s more after each newline: a line every 0.533 s
// (const a = 1; from 0.3, const b = 2; from 0.833, const c = 3; from 1.367, const d = 4; from 1.9, its last key at 2.267).
// Two rows fit and one row stays under the cursor: the view moves to top row 1 at 0.7 s and 2 at 1.233 s (0.35 s each).
// The terminal types 'run it' from 3.0 s (Enter 3.35), prints 'ok' at 3.35 and 'done' at 3.55, and opens a prompt at
// 3.75; three rows fit, so that prompt scrolls it one row.
const WANT = {
  0.51: { code: [7, ['const a'], 0], term: [['$ '], 0] },
  1.12: { code: [22, ['const a = 1;', 'const b ='], 1], term: [['$ '], 0] },
  2.4: { code: [51, ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'], 2], term: [['$ '], 0] },
  3.15: { code: [51, ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'], 2], term: [['$ run i'], 0] },
  3.6: { code: [51, ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'], 2], term: [['$ run it', 'ok', 'done'], 0] },
  3.9: { code: [51, ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;'], 2], term: [['$ run it', 'ok', 'done', '$ '], 1] },
};
test('in the page, at stated times: the typed prefix, the terminal\'s rows and both scroll offsets, read from the layout calls', () => {
  assert.deepEqual(logged.map((x) => x.t), TIMES, 'one CODESTATE line per time');
  for (const x of logged) {
    const w = WANT[x.t];
    assert.deepEqual([x.code.typed, x.code.lines, x.code.scroll], w.code, `code at ${x.t}`);
    assert.deepEqual([x.term.rows, x.term.scroll], w.term, `terminal at ${x.t}`);
  }
  // scrolled out and left out: at 2.4 s line 1 is gone and line 2 is in the top padding
  assert.deepEqual(logged.find((x) => x.t === 2.4).boxes.filter((b) => b.startsWith('code:')), ['code:2', 'code:3', 'code:4', 'code:cursor']);
  assert.deepEqual(logged.find((x) => x.t === 3.9).boxes.filter((b) => b.startsWith('term:')), ['term:1', 'term:2', 'term:3', 'term:4', 'term:cursor']);
});
test('the page and Node agree: the same blocks give the same states (no canvas needed for them)', () => {
  const B = blocks(K.codeTheme(null));
  for (const x of logged) {
    const c = K.codeAt(B.CODE, x.t), tm = K.termAt(B.TERM, x.t);
    assert.deepEqual([c.typed, c.lines, c.scroll], [x.code.typed, x.code.lines, x.code.scroll], `code at ${x.t}`);
    assert.deepEqual([tm.rows, tm.scroll], [x.term.rows, x.term.scroll], `terminal at ${x.t}`);
  }
});
test('the frame hash at each stated time is stable: rendered alone, in another order, it is the same; the times differ', () => {
  assert.deepEqual(Object.keys(hashes).map(Number), TIMES);
  const again = hashOf(render(dir, ['hash', [...TIMES].reverse().join(','), '--scale', '0.25']).stdout);
  assert.deepEqual(again, hashes);
  const one = hashOf(render(dir, ['hash', '3.15', '--scale', '0.25']).stdout);
  assert.equal(one[3.15], hashes[3.15]);
  assert.equal(new Set(Object.values(hashes)).size, TIMES.length, 'every stated time draws a different frame');
});

test('text_safe and text_overlap: the code inside tiktok-ad\'s safe area passes, and a phone frame over it is no overlap', () => {
  const r = runCheck(dir, ['--only', 'text_safe,text_overlap']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(r.results.map((x) => [x.id, x.level]), [['text_safe', 'OK'], ['text_overlap', 'OK']], r.out);
  assert.match(r.out, /tiktok-ad/);
});
test('text_safe: the same code block outside the safe area for 0.5 s FAILs; for 0.2 s it is a brief excursion (WARN)', () => {
  const long = runCheck(dir, ['--only', 'text_safe,text_overlap', '--param', 'outFor=0.5']);
  assert.equal(long.status, 1, long.out);
  // every code line out there is reported: line 2 for the whole 0.5 s (FAIL), line 1 until it scrolls away (0.375 s,
  // FAIL), line 3 for the 0.13 s it was typed in before the block came back (WARN)
  const xs = byId(long.results, 'text_safe');
  assert.deepEqual(xs.map((x) => [x.level, x.detail.match(/\((code:\d)\)/)[1]]), [['FAIL', 'code:1'], ['FAIL', 'code:2'], ['WARN', 'code:3']], JSON.stringify(xs));
  assert.ok(Math.abs(xs[1].measured - 0.5) < 1e-3, String(xs[1].measured));
  assert.deepEqual(byId(long.results, 'text_overlap').map((x) => x.level), ['OK']);
  const brief = runCheck(dir, ['--only', 'text_safe', '--param', 'outFor=0.2']);
  assert.equal(brief.status, 0, brief.out);
  assert.ok(brief.results.length && brief.results.every((x) => x.level === 'WARN' && /brief excursion/.test(x.detail)), JSON.stringify(brief.results));
});

// ---------------------------------------------------------------- key ticks in the rendered sound
// Onsets: the first sample above 1e-3 after at least 10 ms at or under 1e-4 (a tick lasts 60 ms; kept ticks are at
// least 1/12 s apart, so the silence between them is longer than that).
function onsets(wav) {
  const n = wav.samples.length / wav.ch, out = [];
  let quiet = Infinity;
  for (let i = 0; i < n; i++) {
    let a = 0;
    for (let c = 0; c < wav.ch; c++) a = Math.max(a, Math.abs(wav.samples[i * wav.ch + c]));
    if (a > 1e-3 && quiet >= 0.01 * wav.sr) out.push(i / wav.sr);
    quiet = a <= 1e-4 ? quiet + 1 : 0;
  }
  return out;
}
const peak = (wav, t0, t1) => {
  let p = 0;
  for (let i = Math.floor(t0 * wav.sr) * wav.ch; i < Math.floor(t1 * wav.sr) * wav.ch; i++) p = Math.max(p, Math.abs(wav.samples[i]));
  return p;
};
test('key ticks: one per kept key press, at most 12 in any second, silent while nothing types', () => {
  render(dir, ['audio', '--out', 'out/keys.wav']);
  const wav = readWav(path.join(dir, 'out', 'keys.wav'));
  const B = blocks(K.codeTheme(null));
  const presses = [...K.typedTimes(B.CODE), ...K.typedTimes(B.TERM)];
  const kept = K.keyTicks(presses).map((k) => k.t);
  assert.deepEqual(logged[0].keys, kept, 'the scene\'s TL.keys are the thinned presses');
  assert.ok(kept.length < presses.length, `thinned: ${kept.length} of ${presses.length}`);
  const on = onsets(wav);
  assert.equal(on.length, kept.length, `${on.length} onsets for ${kept.length} ticks`);
  on.forEach((t, i) => assert.ok(Math.abs(t - kept[i]) < 0.002, `onset ${t} vs tick ${kept[i]}`));
  const most = Math.max(...on.map((t) => on.filter((u) => u > t - 1 + 1e-6 && u <= t).length));
  assert.ok(most <= 12, `${most} onsets in one second`);
  // the code's last key is at 2.267 s and the command's first at 3.0; its Enter at 3.35, then nothing types
  assert.ok(peak(wav, 2.267 + 0.08, 2.99) < 1e-4, `between the code and the command: ${peak(wav, 2.347, 2.99)}`);
  assert.ok(peak(wav, 3.35 + 0.08, 4.0) < 1e-4, `after the last Enter: ${peak(wav, 3.43, 4.0)}`);
  assert.ok(peak(wav, 0, 0.29) < 1e-4, 'before the first key');
});
