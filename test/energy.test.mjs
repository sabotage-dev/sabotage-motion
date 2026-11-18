// energy_match (plan 23.9, P11b-2) on the calibration fixtures (test/fixtures/fixture-energy/energy.js), each with its
// ground truth built in, through `render.mjs check --only energy_match`: the cuts counted exactly (a hard cut, a wipe,
// a whip, an A-B-A-B run at extreme's half-beat shot), a shake and a flash counted as no cut whether or not they are
// declared, a declared cut with no change reported, ink measured as built (a multi-line block of small type, a box
// that claims more than its ink, a punch-in on large type, outlined type, and type drawn from an image, which has no
// ink), motion (a static card, a slow drift and a slow push read as calm), the acceptance cases (a static card with one
// full-frame flash declared extreme WARNs; a normal board rendered calm and an extreme board at normal pace WARN), and
// when it is not checked. The fixtures are 720x1280, so the probe is 360x640 and one probe row is 1/640 of the height.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makePiece } from './helpers.mjs';
import { C, runCheck, byId } from './check-helpers.mjs';

const dir = makePiece('energy', 'fixture-energy');
fs.rmSync(path.join(dir, 'board.js'));            // the template's board describes the template's scene
const ROW = 1 / 640;

// energy_match's results for a fixture: { main (the verdict line), extra (the other lines), status, out }
function run(kind, params = {}, args = [], at = dir) {
  const p = Object.entries({ kind, ...params }).flatMap(([k, v]) => ['--param', `${k}=${v}`]);
  const r = runCheck(at, ['--scene', 'energy.js', ...p, '--only', 'energy_match', ...args]);
  assert.ok(Array.isArray(r.results), r.out);
  const xs = byId(r.results, 'energy_match');
  return { main: xs[0], extra: xs.slice(1), all: r.results, status: r.status, out: r.out };
}
const typeNear = (x, truth) => assert.ok(Math.abs(x.main.measured.type - truth) <= 1.5 * ROW, `type ${x.main.measured.type}, built ${truth}`);

// ---------------------------------------------------------------- cuts
test('a hard cut, a wipe (0.3 s) and a whip (0.25 s) between two cards are one confirmed cut each', () => {
  for (const k of ['hardcut', 'wipe', 'whip']) {
    const x = run(k);
    assert.deepEqual(x.extra, [], `${k}: ${JSON.stringify(x.extra)}`);
    assert.equal(x.main.measured.cuts, 1, k); assert.equal(x.main.measured.shot, 1, k);
    assert.ok(x.main.measured.shares[0] > 0.9, `${k}: ${x.main.measured.shares}`);
    assert.equal(x.main.measured.motion, 0, `${k}: the cards are still and the transition's pairs are left out`);
  }
});
test('an A-B-A-B run at extreme\'s half-beat shot (0.22 s at 136 BPM): fourteen cuts, every one confirmed', () => {
  const x = run('abab', { energy: 'extreme' });
  assert.deepEqual(x.extra, []);
  assert.equal(x.main.measured.cuts, 14); assert.equal(x.main.measured.shot, +(60 / 136 / 2).toFixed(4));
  assert.match(x.main.detail, /mean shot 0\.22 s \(14 confirmed cuts in 3\.31 s; range 0\.22-0\.44 s, 0\.5-1 beats at the preset's 136 BPM\)/);
});
test('a shake and a full-frame flash are no cut: undeclared they count nothing, declared they are reported and do not count', () => {
  for (const k of ['shake', 'flash']) {
    const x = run(k);
    assert.equal(x.main.measured.cuts, 0, k); assert.deepEqual(x.extra, [], k);
    const d = run(k, { declare: 1 });
    assert.equal(d.main.measured.cuts, 0, k);
    assert.equal(d.extra.length, 1, `${k}: ${JSON.stringify(d.extra)}`);
    assert.equal(d.extra[0].level, 'WARN'); assert.equal(d.extra[0].t, 1);
    assert.match(d.extra[0].detail, /^the declared cut at 1\.00 s is not in the frames: the middles of the shots either side \(0\.50 and 1\.50 s\) differ in 0\.0% of their pixels, under the 20% a cut needs$/);
  }
  // the flash declared as two cuts (in and out, one frame apart): one transition, still no cut
  const two = run('flash', { declare: 2 });
  assert.equal(two.main.measured.cuts, 0); assert.equal(two.extra.length, 1);
  assert.match(two.extra[0].detail, /^the declared cuts at 1\.00, 1\.03 s are not in the frames/);
});
test('a declared cut on a card that does not change is reported', () => {
  const x = run('static', { declare: 1 });
  assert.equal(x.main.measured.cuts, 0); assert.equal(x.main.measured.shot, 2);
  assert.deepEqual(x.extra.map((e) => [e.level, e.t, e.measured]), [['WARN', 1, 0]]);
});
test('calibration: a new angle and a swapped layer over a quarter of the frame are cuts; a word swapped and a 12/255 shift are not', () => {
  const angle = run('angle'), layer = run('layer', { area: 0.25 }), swap = run('swap'), dim12 = run('dim', { step: 12 }), dim24 = run('dim', { step: 24 });
  assert.equal(angle.main.measured.cuts, 1); assert.ok(angle.main.measured.shares[0] > 0.3 && angle.main.measured.shares[0] < 0.35, String(angle.main.measured.shares));
  assert.equal(layer.main.measured.cuts, 1); assert.ok(Math.abs(layer.main.measured.shares[0] - 0.25) < 0.005, String(layer.main.measured.shares));
  assert.equal(swap.main.measured.cuts, 0); assert.ok(swap.extra[0].measured < 0.1, String(swap.extra[0].measured));
  assert.equal(dim12.main.measured.cuts, 0); assert.ok(dim12.extra[0].measured < 0.02, String(dim12.extra[0].measured));
  assert.equal(dim24.main.measured.cuts, 1);
});

// ---------------------------------------------------------------- type, from ink
test('a three-line block of small type reads as small type: one line\'s ink (3% built), not the block\'s box', () => {
  const x = run('small');
  typeNear(x, 0.03);
  assert.match(x.main.detail, /largest line 3\.0% of the frame height \("Small type set in three lines reads as small"/);
  assert.deepEqual(x.extra, []);
});
test('a box that claims 30% of the height around type whose ink is 5% is measured by its ink', () => {
  typeNear(run('bigbox'), 0.05);
});
test('a punch-in to 1.5x on type whose ink is 12% measures 18%, after the camera', () => {
  const x = run('punch');
  typeNear(x, 0.18);
  assert.ok(x.main.measured.type > 0.12 + 20 * ROW, 'the camera scales the ink');
});
test('outlined type (strokeText alone) is ink too; type drawn from an image has none and its box is reported', () => {
  const s = run('bigbox', { stroke: 1 });
  assert.deepEqual(s.extra, []);
  assert.ok(s.main.measured.type >= 0.05 - ROW && s.main.measured.type <= 0.05 + 4 / 1280 + 2 * ROW, String(s.main.measured.type));
  const c = run('cached');
  assert.equal(c.main.measured.type, null);
  assert.match(c.main.detail, /type not measured \(no text on screen\)/);
  assert.deepEqual(c.extra.map((e) => e.level), ['WARN']);
  assert.match(c.extra[0].detail, /^box "Big claim" \(claim\) has no ink in any probe frame/);
});
test('a glow (bloom 0.6 at a threshold of 0.4) does not join three lines of small type: ink is half the box\'s strongest difference or more', () => {
  const x = run('small', { bloom: 0.6, thr: 0.4 });
  assert.ok(x.main.measured.type < 0.03 + 3 * ROW, `type ${x.main.measured.type}: the glow between the lines is not ink`);
});
test('a scene with no text: type not measured, and not judged', () => {
  const x = run('hardcut');
  assert.equal(x.main.measured.type, null); assert.match(x.main.detail, /type not measured \(no text on screen\)/);
  assert.doesNotMatch(x.main.detail, /type is smaller/);
});

// ---------------------------------------------------------------- motion
test('motion: a static card is 0; a slow drift (12 px a second) and a slow push (6% over 2 s) are calm for normal and fine for subtle', () => {
  assert.equal(run('static').main.measured.motion, 0);
  for (const k of ['drift', 'push']) {
    const n = run(k), s = run(k, { energy: 'subtle' });
    assert.ok(n.main.measured.motion > 0 && n.main.measured.motion < 0.02, `${k}: ${n.main.measured.motion}`);
    assert.match(n.main.detail, /it moves less than normal allows/, k);
    assert.equal(s.main.level, 'OK', `${k} at subtle: ${s.main.detail}`);
  }
  // the band of stripes: about half of its pixels change each frame, outside the cut pairs
  const b = run('pace', { shot: 1, dur: 3, band: 0.2, size: 0.1 });
  assert.ok(Math.abs(b.main.measured.motion - 0.1) < 0.01, String(b.main.measured.motion));
});

test('motion leaves out holds: still until 1.5 s then a moving band reads 0 (the median is still), and with HOLDS over the still part reads the band', () => {
  assert.equal(run('late').main.measured.motion, 0);
  const h = run('late', { hold: 1 });
  assert.ok(h.main.measured.motion > 0.1, String(h.main.measured.motion));
  assert.match(h.main.detail, /median of 14 pairs/, "pairs 45-58, whose middles (k + 0.75) / 30 s are at 1.5 s or later");
});
test('a cut too close to the start has no shot before it and is reported; the real cut after it is still confirmed', () => {
  const x = run('hardcut', { declare: 'lead' });
  assert.equal(x.main.measured.cuts, 1); assert.deepEqual(x.main.measured.shares, [1]);
  assert.deepEqual(x.extra.map((e) => e.detail), ['the declared cut at 0.10 s cannot be confirmed: it has no shot before it (a shot lasts 0.15 s or more)']);
});

// ---------------------------------------------------------------- the acceptance cases
test('acceptance: a static card with one full-frame flash, declared extreme (and the flash declared as a cut), WARNs', () => {
  const x = run('flash', { energy: 'extreme', declare: 1 });
  assert.equal(x.main.level, 'WARN');
  assert.match(x.main.detail, /^energy extreme \(--param energy\) is calmer than its floor: the shots are longer, it moves less than extreme allows\./);
  assert.equal(x.status, 0, 'a WARN, not a FAIL');
  assert.equal(runCheck(dir, ['--scene', 'energy.js', '--param', 'kind=flash', '--param', 'energy=extreme', '--only', 'energy_match', '--strict']).status, 1, '--strict fails on it');
});

const board = makePiece('energy-board', 'fixture-energy');   // board.js written by each case
const onBoard = (energy, params, extra = '') => {
  fs.writeFileSync(path.join(board, 'board.js'), `export const BOARD = { title: 'energy', energy: '${energy}',${extra} beats: [{ id: 'a', dur: ${params.dur} }] };\n`);
  return run('pace', params, [], board);
};
test('acceptance: a normal board rendered calm (2 s shots, 5% type, nothing moving) WARNs on all three', () => {
  const x = onBoard('normal', { shot: 2, dur: 4, size: 0.05, band: 0 });
  assert.equal(x.main.level, 'WARN');
  assert.match(x.main.detail, /^energy normal \(the board\) is calmer than its floor: the shots are longer, the type is smaller, it moves less than normal allows\./);
  typeNear(x, 0.05);
});
test('acceptance: an extreme board at normal pace (2.5 beats at 116 BPM, 12% type, 3% motion) WARNs; at extreme pace it is OK', () => {
  const s = 2.5 * 60 / 116;
  const n = onBoard('extreme', { shot: s, dur: 4 * s, size: 0.12, band: 0.06 });
  assert.equal(n.main.level, 'WARN');
  assert.match(n.main.detail, /^energy extreme \(the board\) is calmer than its floor: the shots are longer, the type is smaller, it moves less than extreme allows\./);
  assert.equal(n.main.measured.cuts, 3);
  const e = 0.75 * 60 / 136;
  const x = onBoard('extreme', { shot: e, dur: 12 * e, size: 0.22, band: 0.3 });
  assert.equal(x.main.level, 'OK', x.main.detail); assert.deepEqual(x.extra, []);
  assert.equal(x.main.measured.cuts, 11); typeNear(x, 0.22);
  // the same at a board tempo 10% under the preset's: three quarters of a beat is now 0.37 s against a range up to 0.49 s
  const t = onBoard('extreme', { shot: e, dur: 12 * e, size: 0.22, band: 0.3 }, ' tempo: 122.4,');
  assert.match(t.main.detail, /range 0\.25-0\.49 s, 0\.5-1 beats at 122\.4 BPM/);
});
test('a subtle board: busy (1 s shots, 12% type, a wide moving band) WARNs; calm (3 s shots, 6% type, a thin band) is OK', () => {
  const b = onBoard('subtle', { shot: 1, dur: 3, size: 0.12, band: 0.3 });
  assert.equal(b.main.level, 'WARN');
  assert.match(b.main.detail, /^energy subtle \(the board\) is busier than its ceiling: the shots are shorter, the type is larger, it moves more than subtle allows\./);
  const c = onBoard('subtle', { shot: 3, dur: 6, size: 0.06, band: 0.02 });
  assert.equal(c.main.level, 'OK', c.main.detail);
});

// ---------------------------------------------------------------- not checked
test('not checked: a scene without cuts(), an energy that is not a preset, an overlay; a bad cuts() list is a scene FAIL', () => {
  const nc = runCheck(dir, ['--scene', 'nocuts.js', '--only', 'energy_match']);
  assert.deepEqual(nc.results.map((x) => `${x.level} ${x.id}: ${x.detail}`),
    ['SKIP energy_match: not checked: nocuts.js has no cuts(), so no cut can be confirmed: export cuts(), its visual cuts and transitions as [{ t, d }]']);
  const wild = run('hardcut', { energy: 'wild' });
  assert.equal(wild.main.level, 'SKIP');
  assert.equal(wild.main.detail, 'not checked: no energy to judge it by: --param energy is "wild", not one of subtle, normal, extreme');
  const alpha = run('hardcut', {}, ['--alpha']);
  assert.match(alpha.main.detail, /^not checked: an alpha render is an overlay/);
  const bad = run('badcuts');
  assert.equal(bad.main.level, 'SKIP'); assert.equal(bad.status, 1);
  assert.ok(bad.all.some((x) => x.id === 'scene' && x.level === 'FAIL' && /cuts\(\) item 0: d 0\.5 s is not 0-0\.3 s/.test(x.detail)), bad.out);
});
test('the full check runs energy_match among the source checks, and says how long it took', () => {
  const r = runCheck(dir, ['--scene', 'energy.js', '--param', 'kind=hardcut']);
  const ids = r.results.map((x) => x.id);
  assert.ok(ids.indexOf('energy_match') > ids.indexOf('audio_spike') && ids.indexOf('energy_match') < ids.indexOf('flash'), ids.join(' '));
  assert.match(r.stderr, /^check: energy_match measured 60 frames, 0 of them twice \(text off\) in \d+\.\d s$/m);
});
