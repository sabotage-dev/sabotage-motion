// check --file, the artifact side (plan sections 11.2 and 16): masters mixed by tools/mix.mjs from renders of
// fixture-check. Planted: a master whose source changed after render, a master whose voice delay differs from
// VO_OFFSET, a master at the wrong loudness, a master with the wrong frame count, a second mix with the voice
// 2 s later substituted under the first mix's master.json, a --file with no master.json, and a render made
// with a non-default param that puts text outside the safe area. Clean: a --master-only master, and a render
// of an alternate --scene checked through its render.json.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { render, sha256File } from './helpers.mjs';
import { readMonoWav } from './voice-helpers.mjs';
import { runMix, monoWav } from './mix-helpers.mjs';
import { checkPiece, runCheck, byId, one } from './check-helpers.mjs';

const dir = checkPiece('check-file');
const P = (f) => path.join(dir, f);
const R = ['--scale', '0.25', '--sub', '1'];
const mix = (d, args) => { const r = runMix(d, args); assert.equal(r.status, 0, r.out); return r; };
const levelsOf = (rs) => Object.fromEntries(rs.map((x) => [x.id, x.level]));
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

before(() => {
  render(dir, ['full', ...R, '--out', 'out/piece.mp4']);
  mix(dir, ['piece']);
});

test('a voiced master: provenance binds it; file spec, faststart, loudness and voice delay pass; the source checks replay its render', () => {
  const mj = readJson(P('out/piece.master.json')), rec = readJson(P('out/piece.mp4.render.json'));
  // measured (plan section 21): the mixer's stream copy keeps the decoded picture's hash
  assert.equal(mj.master.video.hash, rec.video.hash);
  const r = runCheck(dir, ['--file', 'out/piece-final.mp4', '--target', 'fixture']);
  const L = levelsOf(r.results.filter((x) => x.scope === 'file'));
  assert.deepEqual(L, { provenance: 'OK', file_spec: 'OK', faststart: 'OK', loudness: 'OK', vo_delay: 'OK' }, r.out);
  assert.match(one(r.results, 'provenance').detail, /mixed from out\/piece\.mp4\.render\.json \(scene\.js\)/);
  assert.equal(one(r.results, 'hook_long').level, 'OK');
  assert.match(one(r.results, 'hook_long').detail, /ends at 2\.700 s/);
  // render.json's sub (1) replays, not the command line's default 8: the subframe-edge text is not seen at the
  // shutter's centre, the 0.5 s excursion is
  const safe = byId(r.results, 'text_safe');
  assert.ok(safe.some((x) => /"LEFT"/.test(x.detail) && x.level === 'FAIL'), JSON.stringify(safe));
  assert.ok(!safe.some((x) => /"EDGE"/.test(x.detail)), JSON.stringify(safe));
  assert.match(r.stderr, /check: scene scene\.js, 1080x1920 @ 30 fps, 19\.2 s, sub 1/);
  assert.equal(byId(r.results, 'motion_dead').length, 1);
  assert.equal(r.status, 1, 'the planted source FAIL still counts');
});

test('planted: a --file with no master.json fails provenance, and the source checks are not run', () => {
  fs.copyFileSync(P('out/piece-final.mp4'), P('out/elsewhere.mp4'));
  const r = runCheck(dir, ['--file', 'out/elsewhere.mp4', '--scale', '0.25']);
  assert.equal(r.status, 1);
  const pv = one(r.results, 'provenance');
  assert.equal(pv.level, 'FAIL'); assert.match(pv.detail, /no master\.json for out\/elsewhere\.mp4/);
  for (const id of ['motion_dead', 'text_safe', 'fonts']) assert.match(one(r.results, id).detail, /not checked: provenance failed/);
  assert.equal(one(r.results, 'file_spec').level, 'OK', 'compared with the piece\'s settings at --scale 0.25');
  assert.match(one(r.results, 'file_spec').detail, /the piece's current settings at scale 0\.25/);
  assert.equal(one(r.results, 'vo_delay').level, 'SKIP');
  assert.match(one(r.results, 'loudness').detail, /no loudness target/);
});

test('planted: a second mix with the voice 2 s later, substituted under the first mix\'s master.json, fails provenance', () => {
  const keep = { master: fs.readFileSync(P('out/piece-final.mp4')), json: fs.readFileSync(P('out/piece.master.json')) };
  try {
    const vo = readMonoWav(P('vo.wav')).samples, late = new Float32Array(vo.length + 2 * 48000);
    late.set(vo, 2 * 48000);
    fs.writeFileSync(P('out/vo-late.wav'), monoWav(late));
    mix(dir, ['piece', '--vo', 'out/vo-late.wav']);
    assert.notEqual(sha256File(P('out/piece-final.mp4')), JSON.parse(keep.json).master.sha256, 'the second mix is a different file');
    fs.writeFileSync(P('out/piece.master.json'), keep.json);                    // the first mix's record, under the second mix
    const r = runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'vo_delay']);
    assert.equal(r.status, 1);
    const pv = one(r.results, 'provenance');
    assert.equal(pv.level, 'FAIL'); assert.match(pv.detail, /is not the file out\/piece\.master\.json describes \(its SHA-256 differs\)/);
    assert.match(one(r.results, 'vo_delay').detail, /provenance failed/);
  } finally {
    fs.writeFileSync(P('out/piece-final.mp4'), keep.master); fs.writeFileSync(P('out/piece.master.json'), keep.json);
  }
});

test('planted: a master whose source changed after the render is stale', () => {
  const f = P('board.js'), orig = fs.readFileSync(f, 'utf8');
  try {
    fs.writeFileSync(f, orig + '// edited after the render\n');
    const r = runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'provenance']);
    assert.equal(r.status, 1);
    assert.match(one(r.results, 'provenance').detail, /the piece's source changed since the render .* the master is stale/);
  } finally { fs.writeFileSync(f, orig); }
  assert.equal(runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'provenance']).status, 0, 'restored, it is bound again');
});

test('planted: a master at the wrong loudness fails loudness (--lufs and --tp override master.json)', () => {
  const ok = one(runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'loudness']).results, 'loudness');
  assert.equal(ok.level, 'OK'); assert.ok(Math.abs(ok.measured.lufs + 14) <= 0.5); assert.ok(ok.measured.tp <= -1);
  const r = runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'loudness', '--lufs', '-20']);
  assert.equal(r.status, 1);
  const x = one(r.results, 'loudness');
  assert.equal(x.level, 'FAIL'); assert.match(x.detail, /more than 1 LU from the -20 LUFS target \(--lufs\)/);
  const ceiling = (Math.floor(ok.measured.tp * 10) / 10 - 0.5).toFixed(1);      // half a dB under the master's true peak
  const tp = one(runCheck(dir, ['--file', 'out/piece-final.mp4', '--only', 'loudness', '--tp', ceiling]).results, 'loudness');
  assert.equal(tp.level, 'FAIL'); assert.match(tp.detail, new RegExp(`over the ${ceiling} dBTP ceiling`));
});

test('planted: a master with the wrong frame count fails file_spec', () => {
  render(dir, ['video', ...R, '--to', '5', '--out', 'out/short.mp4']);
  mix(dir, ['short', '--no-sfx']);
  const r = runCheck(dir, ['--file', 'out/short-final.mp4', '--only', 'file_spec']);
  assert.equal(r.status, 1);
  assert.equal(one(r.results, 'provenance').level, 'OK');
  const x = one(r.results, 'file_spec');
  assert.equal(x.level, 'FAIL'); assert.match(x.detail, /150 frames, expected round\(19\.2 s x 30\) = 576/); assert.match(x.detail, /duration/);
});

test('planted: a master whose voice delay differs from VO_OFFSET fails vo_delay and hook_long', () => {
  const d = checkPiece('check-file-vo');
  const f = path.join(d, 'cues.json'), cues = readJson(f);
  cues.VO_OFFSET = 1.6;                                    // cues.json and cues.js disagree; the mixer reads cues.json
  fs.writeFileSync(f, JSON.stringify(cues));
  render(d, ['video', ...R, '--to', '3', '--out', 'out/vo.mp4']);
  mix(d, ['vo', '--no-sfx']);
  const r = runCheck(d, ['--file', 'out/vo-final.mp4', '--only', 'vo_delay,hook_long']);
  assert.equal(r.status, 1, r.out);
  assert.equal(one(r.results, 'provenance').level, 'OK');
  const v = one(r.results, 'vo_delay');
  assert.equal(v.level, 'FAIL'); assert.match(v.detail, /voice starts at 1\.6 s \(master\.json\), but cues\.js puts VO_OFFSET at 1\.1 s/);
  const h = one(r.results, 'hook_long');
  assert.equal(h.level, 'FAIL'); assert.match(h.detail, /voice starts at 1\.600 s, not at VO_OFFSET 1\.100 s/);
});

test('planted: a render made with a non-default param is checked with that param, not the command line\'s', () => {
  render(dir, ['full', ...R, '--param', 'stray=1', '--out', 'out/stray.mp4']);
  mix(dir, ['stray']);
  const r = runCheck(dir, ['--file', 'out/stray-final.mp4', '--target', 'fixture', '--only', 'text_safe']);
  assert.equal(one(r.results, 'provenance').level, 'OK');
  assert.match(r.stderr, /params \{"stray":"1"\}/);
  const x = byId(r.results, 'text_safe').find((y) => /"STRAY"/.test(y.detail));
  assert.ok(x, r.out); assert.equal(x.level, 'FAIL'); assert.ok(Math.abs(x.measured - 0.6) < 0.02, String(x.measured)); assert.match(x.detail, /in beat "open"/);
  // the same command without --file, at the default params, has no STRAY
  assert.ok(!runCheck(dir, ['--target', 'fixture', '--only', 'text_safe']).results.some((y) => /"STRAY"/.test(y.detail)));
});

test('clean: a --master-only master passes the artifact checks and skips vo_delay', () => {
  for (const [a, b] of [['piece.mp4', 'fx.mp4'], ['piece.mp4.render.json', 'fx.mp4.render.json'], ['piece.wav', 'fx.wav']]) fs.copyFileSync(P(`out/${a}`), P(`out/${b}`));
  mix(dir, ['fx', '--master-only']);
  const r = runCheck(dir, ['--file', 'out/fx-final.mp4', '--only', 'provenance,file_spec,faststart,loudness,vo_delay']);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(levelsOf(r.results), { provenance: 'OK', file_spec: 'OK', faststart: 'OK', loudness: 'OK', vo_delay: 'SKIP' });
  assert.match(one(r.results, 'vo_delay').detail, /a --master-only master has no voice/);
});

test('clean: a render of the alternate --scene, checked through its render.json, passes everything (and --strict)', () => {
  render(dir, ['full', ...R, '--scene', 'alt.js', '--out', 'out/alt.mp4']);
  mix(dir, ['alt']);
  const r = runCheck(dir, ['--file', 'out/alt-final.mp4', '--target', 'fixture', '--strict']);
  assert.equal(r.status, 0, r.out);
  assert.match(r.stderr, /check: scene alt\.js/);
  assert.deepEqual(r.results.filter((x) => x.level === 'FAIL' || x.level === 'WARN'), []);
  assert.deepEqual(r.results.filter((x) => x.level === 'SKIP').map((x) => x.id).sort(), ['audio_spike', 'board_sfx_missing'], 'alt.js is silent');
  for (const id of ['provenance', 'file_spec', 'faststart', 'loudness', 'vo_delay', 'motion_dead', 'first_frame_empty', 'text_safe', 'text_overlap', 'board_copy_missing', 'board_copy_unread', 'hook_long', 'board_order', 'fonts']) {
    assert.equal(one(r.results, id).level, 'OK', id);
  }
});

test('--plain checks a file from elsewhere as a plain file: file spec at --scale, faststart, and loudness with --lufs', () => {
  const r = runCheck(dir, ['--file', 'out/piece-final.mp4', '--plain', '--lufs', '-14', '--scale', '0.25']);
  assert.equal(r.status, 0, r.out);
  const L = levelsOf(r.results.filter((x) => x.scope === 'file'));
  assert.deepEqual(L, { provenance: 'SKIP', file_spec: 'OK', faststart: 'OK', loudness: 'OK', vo_delay: 'SKIP' });
  assert.ok(r.results.filter((x) => x.scope === 'source').every((x) => x.level === 'SKIP' && /--plain/.test(x.detail)));
  assert.match(one(runCheck(dir, ['--file', 'out/piece-final.mp4', '--plain', '--scale', '0.25']).results, 'loudness').detail, /--plain needs --lufs/);
  // --dump under --plain writes the file results (it used to write nothing and say nothing; owner check, P5)
  fs.rmSync(path.join(dir, 'out/plain-dump.json'), { force: true });
  const d = runCheck(dir, ['--file', 'out/piece-final.mp4', '--plain', '--lufs', '-14', '--scale', '0.25', '--dump', 'out/plain-dump.json']);
  assert.equal(d.status, 0, d.out);
  const dj = JSON.parse(fs.readFileSync(path.join(dir, 'out/plain-dump.json'), 'utf8'));
  assert.equal(dj.format, 'sabotage-motion/check-dump@1');
  const fsr = dj.results.find((x) => x.id === 'file_spec'), lr = dj.results.find((x) => x.id === 'loudness');
  assert.equal(fsr.level, 'OK');
  assert.equal(lr.level, 'OK');
  assert.ok(lr.measured != null, 'the loudness numbers are in the dump');
});

// ---- round 1, F6: when the source checks do not run, a broken scene fails nothing
test('--plain with a broken scene: faststart alone exits 0, and file_spec says not checked, with no scene FAIL (round 1, F6)', () => {
  const broken = P('broken.js');
  fs.writeFileSync(broken, "export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: 1, FONTS: [] };\nexport async function init() { throw new Error('planted: broken scene'); }\nexport function frame(t, jit) { return { t, jit }; }\nexport function post(t) { return { t }; }\n");
  try {
    const fast = runCheck(dir, ['--file', 'out/piece-final.mp4', '--plain', '--scene', 'broken.js', '--only', 'faststart']);
    assert.equal(fast.status, 0, fast.out);
    assert.deepEqual(fast.results.map((x) => [x.id, x.level]), [['faststart', 'OK']]);
    const all = runCheck(dir, ['--file', 'out/piece-final.mp4', '--plain', '--scene', 'broken.js', '--scale', '0.25']);
    assert.equal(all.status, 0, all.out);
    assert.ok(!all.results.some((x) => x.id === 'scene'), JSON.stringify(all.results.filter((x) => x.id === 'scene')));
    const fsr = one(all.results, 'file_spec');
    assert.equal(fsr.level, 'SKIP'); assert.match(fsr.detail, /the scene did not load .*planted: broken scene/);
  } finally { fs.rmSync(broken, { force: true }); }
});

// ---- round 1, F8: the effects stem a master was mixed with is tied to a render of the current source
test('the effects stem is tied to a render record of this source: audio writes one, and a stem from other source fails provenance (round 1, F8)', () => {
  const d = checkPiece('check-file-fx');
  const Q = (f) => path.join(d, f);
  const prov = (name) => one(runCheck(d, ['--file', `out/${name}-final.mp4`, '--only', 'provenance']).results, 'provenance');
  const editAudio = () => { const f = Q('audio.js'), o = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, o.replace('tone(t, 1000, 0.3', 'tone(t, 1250, 0.3')); return () => fs.writeFileSync(f, o); };
  // a video, then its effects from `audio`: the stem's own record binds it
  render(d, ['video', ...R, '--to', '2', '--out', 'out/fx.mp4']);
  render(d, ['audio', '--out', 'out/fx.wav']);
  const ar = readJson(Q('out/fx.wav.render.json'));
  assert.equal(ar.mode, 'audio'); assert.equal(ar.audioSha256, sha256File(Q('out/fx.wav'))); assert.match(ar.source.hash, /^sha256:/);
  mix(d, ['fx']);
  const bound = prov('fx');
  assert.equal(bound.level, 'OK', bound.detail); assert.match(bound.detail, /its effects stem came from a render of this source/);
  // the gap: the effects rendered from an edited audio.js, the edit then undone, so the picture's record binds again
  const undo = editAudio();
  render(d, ['audio', '--out', 'out/fx.wav']);
  undo();
  mix(d, ['fx']);
  const other = prov('fx');
  assert.equal(other.level, 'FAIL'); assert.match(other.detail, /the effects stem out\/fx\.wav was rendered from another source/);
  assert.doesNotMatch(other.detail, /stale/, 'the picture itself is bound');
  // a stem no render made
  fs.rmSync(Q('out/fx.wav.render.json'));
  mix(d, ['fx']);
  assert.match(prov('fx').detail, /the effects stem out\/fx\.wav is not one a render recorded/);
  // a --no-sfx master of the same picture has no stem to tie, and binds
  mix(d, ['fx', '--no-sfx']);
  assert.equal(prov('fx').level, 'OK');
  // council round 2: effects rendered from the same source but with other params than the picture do not bind
  render(d, ['video', ...R, '--to', '2', '--param', 'stray=1', '--out', 'out/pm.mp4']);
  render(d, ['audio', '--out', 'out/pm.wav']);
  mix(d, ['pm']);
  const pm = prov('pm');
  assert.equal(pm.level, 'FAIL'); assert.match(pm.detail, /the effects stem out\/pm\.wav was rendered with other settings than the picture \(params \{\} vs \{"stray":"1"\}\)/);
  render(d, ['audio', '--param', 'stray=1', '--out', 'out/pm.wav']);
  mix(d, ['pm']);
  assert.equal(prov('pm').level, 'OK', 'the same params bind');
  // the sequence the review names: full, an audio.js edit, audio, a mix (also stale, since the edit stays)
  render(d, ['full', ...R, '--out', 'out/fl.mp4']);
  assert.equal(readJson(Q('out/fl.mp4.render.json')).audioSha256, sha256File(Q('out/fl.wav')), 'full records the stem it wrote');
  mix(d, ['fl']);
  assert.equal(prov('fl').level, 'OK');
  const undo2 = editAudio();
  try {
    render(d, ['audio', '--out', 'out/fl.wav']);
    mix(d, ['fl']);
    assert.equal(prov('fl').level, 'FAIL');
  } finally { undo2(); }
});
