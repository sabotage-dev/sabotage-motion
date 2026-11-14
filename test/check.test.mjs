// check, source side (plan sections 6.5, 11.1 and 16): fixture-check, voiced by a synthetic take, has one of
// each planted defect and the clean cases that must not be flagged. One full run of `render.mjs check` against
// a measured copy of the tiktok zone is shared by the tests below; each asserts its own result. The full
// list of what the run reports is asserted too, so nothing unplanned fires.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { render, fixturesDir } from './helpers.mjs';
import { C, checkPiece, runCheck, byId, one, WINDOWS } from './check-helpers.mjs';

const dir = checkPiece('check-source');
const P = (f) => path.join(dir, f);
let full;
before(() => { full = runCheck(dir, ['--target', 'fixture']); });
const nonOk = () => full.results.filter((x) => x.level !== 'OK' && x.level !== 'SKIP');
const at = (x, t, eps = 0.02) => Math.abs(x.t - t) <= eps;
const inBeat = (x, id) => x.t >= WINDOWS[id][0] - 1e-6 && x.t < WINDOWS[id][1];

test('the full run: exits 1 (two FAILs), JSON results in the planned shape, every check ran', () => {
  assert.equal(full.status, 1, full.out);
  assert.ok(Array.isArray(full.results), full.out);
  for (const x of full.results) {
    assert.deepEqual(Object.keys(x).filter((k) => k !== 't'), ['id', 'scope', 'level', 'detail', 'measured', 'threshold']);
    assert.ok(['FAIL', 'WARN', 'OK', 'SKIP'].includes(x.level));
  }
  assert.deepEqual([...new Set(full.results.map((x) => x.id))].sort(), [...C.SOURCE_IDS].sort());
  assert.deepEqual(full.results.filter((x) => x.level === 'SKIP'), []);
  assert.match(full.stderr, /check: scene scene\.js, 1080x1920 @ 30 fps, 19\.2 s, sub 8, safe zones fixture,? ?/);
});
test('the full run reports exactly the planted defects and the deliberate slam WARN, nothing else', () => {
  const got = nonOk().map((x) => `${x.level} ${x.id} ${x.t}`).sort();
  assert.equal(got.length, 10, got.join('\n'));
  assert.deepEqual(byId(full.results, 'fonts').map((x) => x.level), ['OK']);
  assert.deepEqual(byId(full.results, 'board_order').map((x) => x.level), ['OK']);
  assert.deepEqual(byId(full.results, 'hook_long').map((x) => x.level), ['OK']);
  assert.deepEqual(byId(full.results, 'audio_spike').map((x) => x.level), ['OK']);
});

// ---------------------------------------------------------------- planted defects
test('planted: a flat first frame is first_frame_empty WARN at 0 s (grain on in the scene, off in the probe)', () => {
  const x = one(full.results, 'first_frame_empty');
  assert.equal(x.level, 'WARN'); assert.equal(x.t, 0); assert.ok(x.measured < 4, String(x.measured));
});
test('planted: a 4 s freeze outside any hold is motion_dead WARN, 6.6-10.6 s', () => {
  const xs = byId(full.results, 'motion_dead');
  assert.deepEqual(xs.map((x) => x.level), ['WARN'], JSON.stringify(xs));
  assert.ok(at(xs[0], 6.6), String(xs[0].t)); assert.ok(Math.abs(xs[0].measured - 4.0) < 1e-3, String(xs[0].measured));
  assert.equal(xs[0].threshold, 3);
});
test('planted: a text box outside the safe area for 0.5 s is text_safe FAIL in its beat', () => {
  const x = byId(full.results, 'text_safe').find((r) => /"LEFT"/.test(r.detail));
  assert.ok(x, JSON.stringify(byId(full.results, 'text_safe')));
  assert.equal(x.level, 'FAIL'); assert.ok(Math.abs(x.measured - 0.5) < 0.005, String(x.measured));
  assert.match(x.detail, /in beat "save"/); assert.ok(at(x, 14.3));
});
test('planted: text outside the safe area only at the first and last subframes is still found (2 of 8 subframes for 1.5 s = 0.375 s, FAIL)', () => {
  const x = byId(full.results, 'text_safe').find((r) => /"EDGE"/.test(r.detail));
  assert.ok(x, JSON.stringify(byId(full.results, 'text_safe')));
  assert.equal(x.level, 'FAIL'); assert.ok(Math.abs(x.measured - 0.375) < 0.005, String(x.measured));
  assert.ok(at(x, 14.0, 0.02));
});
test('planted: two overlapping labels are text_overlap WARN for the 4 s they are up', () => {
  const x = one(full.results, 'text_overlap');
  assert.equal(x.level, 'WARN'); assert.match(x.detail, /"LAP" \(lap\) and "OVER" \(over\)/);
  assert.ok(at(x, 6.6)); assert.ok(x.measured > 0.02);
});
test('planted: a word on screen for 0.2 s is board_copy_unread WARN', () => {
  const x = one(full.results, 'board_copy_unread');
  assert.equal(x.level, 'WARN'); assert.match(x.detail, /beat "save": "FLASH" is on screen for 0\.20 s/);
  assert.ok(Math.abs(x.measured - 0.2) < 0.005); assert.equal(x.threshold, 1);
});
test('planted: a beat whose copy never appears is board_copy_missing WARN', () => {
  const x = one(full.results, 'board_copy_missing');
  assert.equal(x.level, 'WARN'); assert.match(x.detail, /beat "dot": "NEVER SHOWN" never appears/); assert.ok(at(x, 10.6));
});
test('planted: a beat with a sound note and no sound in its window is board_sfx_missing WARN', () => {
  const x = byId(full.results, 'board_sfx_missing').find((r) => inBeat(r, 'freeze'));
  assert.ok(x); assert.equal(x.level, 'WARN'); assert.match(x.detail, /beat "freeze" has a sound note/); assert.equal(x.measured, null);
});
test('planted: a beat with sfxHit and only a sustained sound is board_sfx_missing WARN (no transient)', () => {
  const x = byId(full.results, 'board_sfx_missing').find((r) => inBeat(r, 'save'));
  assert.ok(x); assert.equal(x.level, 'WARN'); assert.match(x.detail, /asks for a hit .* no transient/);
  assert.ok(x.measured < 12, String(x.measured));
  assert.equal(byId(full.results, 'board_sfx_missing').length, 2, 'only the two planted beats');
});

// ---------------------------------------------------------------- clean cases
test('clean: the end card inside HOLDS is not motion_dead (it is still for 3.1 s)', () => {
  assert.ok(!byId(full.results, 'motion_dead').some((x) => x.t >= WINDOWS.end[0] - 0.2));
});
test('clean: grain on does not hide the freeze or flag anything: frames of the freeze differ only by grain', () => {
  const h = render(dir, ['hash', '7.0,8.0', '--scale', '0.25']).stdout.match(/[0-9a-f]{64}/g);
  assert.notEqual(h[0], h[1], 'the scene has no grain: this clean case would prove nothing');
  assert.deepEqual(byId(full.results, 'motion_dead').map((x) => [x.t, x.measured]), [[6.6, 4]]);
});
test('clean: a single 10 px dot moving 1 px a frame on a held card counts as motion (3.2 s)', () => {
  assert.ok(!byId(full.results, 'motion_dead').some((x) => x.t >= WINDOWS.dot[0] - 0.2 && x.t < WINDOWS.dot[1]));
});
test('clean: a slow drift (9 px a second) counts as motion (3.2 s)', () => {
  assert.ok(!byId(full.results, 'motion_dead').some((x) => x.t >= WINDOWS.hook[1] - 0.5 && x.t < WINDOWS.drift[1]));
});
test('clean: word-by-word captions match their beats\' copy, stay inside the safe area, and do not overlap', () => {
  assert.ok(!byId(full.results, 'board_copy_missing').some((x) => /Stop pasting|"skill"/.test(x.detail)));
  assert.ok(!byId(full.results, 'board_copy_unread').some((x) => /Stop pasting|"skill"/.test(x.detail)));
  assert.ok(!byId(full.results, 'text_safe').some((x) => /\(cap\d+\)/.test(x.detail)));
  assert.ok(!byId(full.results, 'text_overlap').some((x) => /\(cap\d+\)/.test(x.detail)));
});
test('clean: a slam entrance that leaves the safe area for a moment is a WARN, never a FAIL (the deliberate WARN)', () => {
  const x = byId(full.results, 'text_safe').find((r) => /"STOP"/.test(r.detail));
  assert.ok(x); assert.equal(x.level, 'WARN'); assert.ok(x.measured > 0 && x.measured <= 0.25, String(x.measured));
  assert.match(x.detail, /brief excursion/); assert.ok(at(x, 1.0));
});

// ---------------------------------------------------------------- the zones, holds, exit codes, output
test('while the zone is an estimate (the board\'s tiktok), the same text_safe excursions are WARNs that say so', () => {
  const r = runCheck(dir, ['--only', 'text_safe']);
  assert.equal(r.status, 0, r.out);
  const xs = byId(r.results, 'text_safe');
  assert.deepEqual(xs.map((x) => x.level), ['WARN', 'WARN', 'WARN']);
  for (const x of xs) assert.match(x.detail, /tiktok safe area \(estimate\)/);
  assert.equal(xs.filter((x) => /a FAIL once the zones are measured/.test(x.detail)).length, 2);
  assert.deepEqual(r.results.map((x) => x.id), ['text_safe', 'text_safe', 'text_safe'], '--only runs just that check');
});
test('hold: true on the frozen beat takes it out of motion_dead', () => {
  const b = P('board.js'), orig = fs.readFileSync(b, 'utf8');
  try {
    fs.writeFileSync(b, orig.replace("{ id: 'freeze', dur: 4.0,", "{ id: 'freeze', dur: 4.0, hold: true,"));
    const r = runCheck(dir, ['--only', 'motion_dead']);
    assert.deepEqual(r.results.map((x) => x.level), ['OK'], r.out);
  } finally { fs.writeFileSync(b, orig); }
});
test('--strict fails on a WARN; the text output is one line per result and a summary', () => {
  assert.equal(runCheck(dir, ['--only', 'motion_dead']).status, 0);
  assert.equal(runCheck(dir, ['--only', 'motion_dead', '--strict']).status, 1);
  const t = runCheck(dir, ['--only', 'motion_dead,first_frame_empty'], { json: false });
  assert.match(t.out, /^WARN  motion_dead +6\.60s  nothing moves for 4\.00 s \(6\.60-10\.60 s\)/m);
  assert.match(t.out, /^WARN  first_frame_empty +0\.00s  the first frame is flat/m);
  assert.match(t.out, /^check: 0 FAIL, 2 WARN, 0 ok, 0 not checked$/m);
});
test('--dump writes the raw measurements without on-screen text: changed probe pixels per frame pair, the first frame, the audio', () => {
  const r = runCheck(dir, ['--only', 'motion_dead,audio_spike', '--dump', 'out/dump.json']);
  assert.equal(r.status, 0, r.out);
  const d = JSON.parse(fs.readFileSync(P('out/dump.json'), 'utf8'));
  assert.deepEqual([d.probe.w, d.probe.h, d.probe.changed.atLeast], [540, 960, [1, 2, 3, 4, 8, 16]]);
  assert.equal(d.probe.changed.pairs.length, 575);
  const pairs = (a, b) => d.probe.changed.pairs.slice(Math.round(a * 30), Math.round(b * 30) - 1);
  assert.ok(pairs(6.65, 10.55).every((p) => p.every((n) => n === 0)), 'the freeze repeats exactly');
  // the clean small mover: every pair of the dot's beat changes at least 4 probe pixels by 2 levels or more
  const dot = pairs(10.65, 13.75).map((p) => p[1]);
  assert.ok(Math.min(...dot) >= 4, `dot pairs: ${Math.min(...dot)}-${Math.max(...dot)}`);
  assert.ok(d.audio.over < 18 && d.audio.loudWindows > 0);
  assert.deepEqual(d.results.map((x) => x.id), ['motion_dead', 'audio_spike']);
  assert.deepEqual(Object.keys(d.results[0]), ['id', 'level', 't', 'measured', 'threshold'], 'no detail text in a dump');
  assert.equal(d.params, undefined);
});
test('usage errors exit 2 and say why', () => {
  for (const [args, re] of [[['--only', 'nope'], /--only nope: no such check/], [['--file', 'out/missing.mp4'], /no such file/],
    [['--plain'], /--plain needs --file/], [['--lufs', 'x'], /need numbers/]]) {
    const r = runCheck(dir, args, { json: false });
    assert.equal(r.status, 2, r.out); assert.match(r.out, re);
  }
});

// ---------------------------------------------------------------- one check at a time, on variants
test('the camera: text_safe maps boxes through frame(t)\'s cam the way the shader does, measured on the rendered pixels', async () => {
  const cam = await import(pathToFileURL(path.join(fixturesDir, 'fixture-check', 'cam.js')).href);
  render(dir, ['stills', '0.5', '--scene', 'cam.js', '--scale', '0.5', '--dir', 'stills/cam']);
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', P('stills/cam/t00.500.png'), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 16 << 20 });
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < 960; y++) for (let x = 0; x < 540; x++) if (g[y * 540 + x] > 128) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  const v = C.visibleBox(cam.RECT, cam.CAM, 1080, 1920);
  for (const [px, want] of [[x0, v.x / 2], [y0, v.y / 2], [x1, (v.x + v.w) / 2], [y1, (v.y + v.h) / 2]]) assert.ok(Math.abs(px - want) <= 1.5, `pixels ${[x0, y0, x1, y1]} vs mapped ${JSON.stringify(v)}`);
  // the box is inside the safe area before the camera and outside after it
  assert.ok(C.insideRect(cam.RECT, { x: 84, y: 160, w: 852, h: 1320 }));
  const r = runCheck(dir, ['--scene', 'cam.js', '--target', 'fixture', '--only', 'text_safe']);
  assert.deepEqual(r.results.map((x) => [x.id, x.level]), [['text_safe', 'FAIL']], r.out);
  assert.ok(Math.abs(r.results[0].measured - 1.0) < 1e-3);
});
test('fonts: a family that does not load is a FAIL, and the other checks still run', () => {
  fs.writeFileSync(P('nofont.js'), fs.readFileSync(P('cam.js'), 'utf8').replace("FONTS: []", "FONTS: ['DISPLAY', 'NOFONT']"));
  const r = runCheck(dir, ['--scene', 'nofont.js', '--target', 'fixture', '--only', 'fonts,text_safe']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.results.map((x) => [x.id, x.level]), [['fonts', 'FAIL'], ['text_safe', 'FAIL']], r.out);
  assert.match(r.results[0].detail, /font missing: NOFONT/);
});
test('board_order: a scene whose CFG.DUR is not boardDur() is a FAIL', () => {
  const r = runCheck(dir, ['--scene', 'cam.js', '--only', 'board_order']);
  assert.equal(r.status, 1);
  assert.deepEqual(r.results.map((x) => [x.id, x.level]), [['board_order', 'FAIL']]);
  assert.match(r.results[0].detail, /CFG\.DUR 1 differs from boardDur\(\) 19\.200 by more than one frame/);
});
test('hook_long: a cues.js whose hook ends after hookMax is a FAIL', () => {
  const copy = path.join(path.dirname(dir), 'check-source-hook');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(dir, copy, { recursive: true });
  const f = path.join(copy, 'cues.js');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/export const HOOK_END = [\d.]+;/, 'export const HOOK_END = 3;'));
  const r = runCheck(copy, ['--only', 'hook_long']);
  assert.equal(r.status, 1, r.out);
  assert.deepEqual(r.results.map((x) => [x.id, x.level]), [['hook_long', 'FAIL']]);
  assert.match(r.results[0].detail, /ends at 4\.100 s, 0\.100 s after hookMax 4/);
});
test('a scene that throws while it is checked is a FAIL that names the error; nothing hangs', () => {
  fs.copyFileSync(path.join(fixturesDir, 'fixture-clean', 'throws.js'), P('throws.js'));
  const r = runCheck(dir, ['--scene', 'throws.js', '--only', 'motion_dead,text_safe']);
  assert.equal(r.status, 1, r.out);
  const s = one(r.results, 'scene');
  assert.equal(s.level, 'FAIL'); assert.match(s.detail, /threw while it was checked: .*planted: the scene throws at t=0\.5/);
});
