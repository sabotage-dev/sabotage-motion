// The energy presets (plan 23.9, P11b-1) without a browser: the table, how a piece's energy resolves, the beat grid and
// the snapping of a silent board, grounds that never flash between shots, the camera rig and its clamp, transitions,
// cuts, kinetic type, the bed stem in the mixer, audio_spike over the bed, and the bed stem's provenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { templateDir } from './helpers.mjs';

const imp = (f) => import(pathToFileURL(path.join(templateDir, f)).href);
const EN = await imp('energy.js'), MV = await imp('moves.js'), lib = await imp('lib.js'), C = await imp('check.mjs'), MX = await imp('tools/mix.mjs');
const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ? msg + ': ' : ''}${a} is not ${b} (within ${eps})`);

test('P11b the table: tempo, cut interval in beats, ink height, motion floors and ceiling (23.9, Q19, Q22, Q23)', () => {
  assert.deepEqual([...EN.ENERGY_NAMES], ['subtle', 'normal', 'extreme']);
  assert.equal(EN.DEFAULT_ENERGY, 'normal');
  const want = {
    subtle: { bpm: 84, cutBeats: [4, 5], inkHeight: [0.04, 0.08], motion: { max: 0.10 } },
    normal: { bpm: 116, cutBeats: [2, 3], inkHeight: [0.09, 0.16], motion: { min: 0.02 } },
    extreme: { bpm: 136, cutBeats: [0.5, 1], inkHeight: [0.18, 0.35], motion: { min: 0.06 } },
  };
  for (const [n, w] of Object.entries(want)) {
    const P = EN.ENERGY[n];
    assert.deepEqual({ bpm: P.bpm, cutBeats: [...P.cutBeats], inkHeight: [...P.inkHeight], motion: { ...P.motion } }, w, n);
  }
  // the seconds the plan's table states, from the beats at each preset's tempo
  const sec = (n) => EN.ENERGY[n].cutBeats.map((b) => (b * 60) / EN.ENERGY[n].bpm);
  near(sec('subtle')[0], 2.857, 1e-3); near(sec('subtle')[1], 3.571, 1e-3);
  near(sec('normal')[0], 1.034, 1e-3); near(sec('normal')[1], 1.552, 1e-3);
  near(sec('extreme')[0], 0.221, 1e-3); near(sec('extreme')[1], 0.441, 1e-3);
  assert.ok(sec('subtle')[0] >= 2.8 && sec('subtle')[1] <= 3.6 && sec('extreme')[0] >= 0.2 && sec('extreme')[1] <= 0.45, 'inside the ranges 23.9 states');
  assert.ok(Object.isFrozen(EN.ENERGY) && Object.isFrozen(EN.ENERGY.extreme.cutBeats), 'the table cannot be changed by a scene');
  // the caption styles follow the preset (23.9 and P10's captionStyleFor), from this one table
  assert.deepEqual({ ...lib.ENERGY_CAPTION }, { subtle: 'minimal', normal: 'pop', extreme: 'karaoke' });
  for (const n of EN.ENERGY_NAMES) assert.equal(lib.captionStyleFor(n), EN.ENERGY[n].caption);
  assert.equal(lib.captionStyleFor(undefined), 'pop');
  // the look decides the kind: extreme's flash and glitch are transitions it may reach for, never forced
  assert.ok(EN.ENERGY.extreme.transitions.includes('glitchCut') && EN.ENERGY.extreme.transitions.includes('flash'));
  assert.ok(!EN.ENERGY.subtle.camera.whip && EN.ENERGY.extreme.camera.shake > 0 && EN.ENERGY.subtle.camera.punch === 0);
  // its copy rule and its flash thresholds are check's
  assert.deepEqual({ ...EN.COPY_READ }, { ...C.T.copyUnread });
  assert.equal(EN.FLASH_SWING, C.T.flash.swing); assert.equal(EN.FLASH_DARK, C.T.flash.dark);
});

test('P11b which energy: --param over CFG.ENERGY over the board over normal; an unknown name and a disagreement are refused', () => {
  const B = { energy: 'subtle', beats: [] };
  assert.deepEqual(EN.energyName({}), { name: 'normal', from: 'default' });
  assert.deepEqual(EN.energyName({ BOARD: B }), { name: 'subtle', from: 'board.js' });
  assert.deepEqual(EN.energyName({ CFG: { ENERGY: 'extreme' }, BOARD: { beats: [] } }), { name: 'extreme', from: 'CFG.ENERGY' });
  assert.deepEqual(EN.energyName({ params: { energy: 'extreme' }, CFG: { ENERGY: 'subtle' }, BOARD: B }), { name: 'extreme', from: '--param' });
  assert.deepEqual(EN.energyName({ params: { energy: '' }, BOARD: B }), { name: 'subtle', from: 'board.js' }, 'an empty param is no param');
  assert.throws(() => EN.energyName({ params: { energy: 'wild' } }), /--param energy "wild": one of subtle, normal, extreme/);
  assert.throws(() => EN.resolveEnergy({ CFG: { ENERGY: 'extreme' }, BOARD: B }), /CFG\.ENERGY "extreme" and board\.js's energy "subtle" disagree/);
  const r = EN.resolveEnergy({ params: { energy: 'extreme' }, CFG: { ENERGY: 'normal' }, BOARD: B });   // a param settles it
  assert.equal(r.name, 'extreme'); assert.equal(r.bpm, 136); near(r.spb, 60 / 136); near(r.cutSec[0], 0.5 * 60 / 136);
  assert.equal(EN.resolveEnergy({ BOARD: { energy: 'subtle', bed: false, beats: [] } }).silentBed, true);
  assert.equal(EN.resolveEnergy({ BOARD: { energy: 'normal', beats: [] } }).silentBed, false);
});

test('P11b a board sets its own tempo within 10% of its preset\'s (Q22), and bed: false only at subtle', () => {
  assert.deepEqual(EN.energyProblems({ energy: 'normal', bpm: 120 }), []);
  assert.deepEqual(EN.energyProblems({ energy: 'normal', bpm: 127.6 }), [], '116 x 1.1 is the edge');
  assert.match(EN.energyProblems({ energy: 'normal', bpm: 128 }).join(), /more than 10% from normal's 116 BPM/);
  assert.match(EN.energyProblems({ bpm: 100 }).join(), /normal's 116/, 'with no energy the board is normal');
  assert.match(EN.energyProblems({ energy: 'loud' }).join(), /BOARD\.energy "loud" is not a preset/);
  assert.match(EN.energyProblems({ energy: 'normal', bed: false }).join(), /only subtle may do/);
  assert.deepEqual(EN.energyProblems({ energy: 'subtle', bed: false }), []);
  assert.equal(EN.boardBpm({ bpm: 120 }, 'normal'), 120);
  assert.throws(() => EN.boardBpm({ bpm: 120 }, 'extreme'), /more than 10% from extreme's 136 BPM/, 'a param that moves the preset away from the board\'s tempo');
  // board.js problems include them, so check's board_order reports them
  assert.match(lib.boardProblems({ energy: 'normal', bpm: 200, beats: [{ id: 'a', dur: 1 }] }).join(), /BOARD\.bpm 200/);
});

test('P11b the beat grid: a silent board that names its energy snaps each beat to whole beats, never shorter than its copy; a voiced board never snaps', () => {
  const spb = (n) => 60 / EN.ENERGY[n].bpm;
  // the template's board: title 2.6 s, out 0.55 s
  const T = { energy: 'normal', beats: [{ id: 'title', dur: 2.6, on: ['Make it move', 'rendered from code, frame by frame'] }, { id: 'out', dur: 0.55, on: [] }] };
  for (const [n, beats] of [['subtle', [4, 1]], ['normal', [5, 1]], ['extreme', [6, 1]]]) {
    const t = lib.boardTiming(T, null, { energy: n });
    assert.ok(t.ok, t.problems.join()); assert.equal(t.snapped, true); assert.equal(t.bpm, EN.ENERGY[n].bpm);
    near(t.windows[0].end, beats[0] * spb(n), 1e-5, `${n} title`); near(t.dur, (beats[0] + beats[1]) * spb(n), 1e-5, `${n} length`);
  }
  // the board's own energy when no param names one
  near(lib.boardTiming({ ...T, energy: 'subtle' }).dur, 5 * spb('subtle'), 1e-5);
  // nearest whole beat, at least one, and never shorter than its copy needs (max(1.0, 0.25 s a word))
  near(EN.snapDur(0.1, 0.5), 0.5); near(EN.snapDur(1.24, 0.5), 1.0); near(EN.snapDur(1.26, 0.5), 1.5);
  const copy = { energy: 'extreme', beats: [{ id: 'a', dur: 0.5, on: ['one two three four five six seven'] }] };
  const ct = lib.boardTiming(copy);
  near(ct.dur, 4 * spb('extreme'), 1e-5, 'seven words need 1.75 s: four beats at 136');
  assert.ok(ct.dur >= EN.readTime(copy.beats[0].on[0]));
  // a board's own tempo
  near(lib.boardTiming({ energy: 'normal', bpm: 120, beats: [{ id: 'a', dur: 2 }] }).dur, 2, 1e-9, 'four beats at 120');
  // no snapping: a board that names no energy or bpm (a clip's board, a piece from before the presets), and any voiced board
  near(lib.boardTiming({ beats: [{ id: 'a', dur: 2.45 }, { id: 'b', dur: 0.55 }] }).dur, 3, 1e-9);
  const voiced = { energy: 'extreme', beats: [{ id: 'a', vo: 'Say this line now please.' }, { id: 'b', dur: 0.7 }] };
  const vt = lib.boardTiming(voiced);
  assert.equal(vt.snapped, false); near(vt.windows[1].end - vt.windows[1].start, 0.7, 1e-9, 'a voiced board keeps its silent beat\'s dur');
  assert.equal(EN.boardSnaps(voiced), false); assert.equal(EN.boardSnaps({ beats: [{ id: 'a', dur: 1 }] }), false);
  // a param that names a preset the board's tempo does not fit is a board problem, not a silent mis-time
  const bad = lib.boardTiming({ energy: 'normal', bpm: 120, beats: [{ id: 'a', dur: 2 }] }, null, { energy: 'extreme' });
  assert.equal(bad.ok, false); assert.match(bad.problems.join(), /extreme's 136 BPM/);
  // the grid itself starts at picture time 0, so cuts placed anywhere land on the bed's beats
  assert.deepEqual(EN.gridTimes(0.4, 2.1, 0.5), [0.5, 1, 1.5, 2]);
  assert.deepEqual(EN.gridTimes(0, 1, 0.5, 0.5), [0, 0.25, 0.5, 0.75]);
});

test('P11b grounds close in luminance: consecutive shots never swing 0.1 (or stay at 0.8 and above), and still differ', async () => {
  const LK = await imp('looks.js');
  const grounds = [LK.TEMPLATE.tokens.bgA, ...LK.LOOK_NAMES.map((n) => LK.LOOKS[n].tokens.bgA), '#000000', '#FFFFFF', '#808080', '#FF0000'];
  const luma = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
  for (const g of grounds) {
    const b = EN.groundTone(g, 0.08), l0 = EN.relLum(g), l1 = EN.relLum(b);
    const safe = Math.abs(l1 - l0) < EN.FLASH_SWING || Math.min(l0, l1) >= EN.FLASH_DARK;
    assert.ok(safe, `${g} -> ${b}: ${l0.toFixed(3)} and ${l1.toFixed(3)} would be a general transition`);
    assert.ok(Math.abs(luma(b) - luma(g)) >= 6, `${g} -> ${b}: the shots do not differ`);
  }
  // on the template's dark ground the two read as different shots on the probe (16/255 and more)
  assert.ok(luma(EN.groundTone('#101018', 0.08)) - luma('#101018') >= 16);
  assert.deepEqual(EN.shotTones('#101018', 3, 0.08), ['#101018', EN.groundTone('#101018', 0.08), '#101018']);
  near(EN.relLum('#FFFFFF'), 1); near(EN.relLum('#000000'), 0);
});

test('P11b moves.js maps a box through the camera exactly as check does', () => {
  const W = 1080, H = 1920;
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 400; i++) {
    const cam = [0.7 + rnd(), (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3], x = rnd() * W, y = rnd() * H;
    const a = MV.camPoint(x, y, cam, W, H), b = C.camPoint(x, y, cam, W, H);
    near(a[0], b[0], 1e-9); near(a[1], b[1], 1e-9);
  }
});

test('P11b the rig clamps every move so each text box stays inside the safe area (push, punch, bounce, shake, whip)', () => {
  const W = 1080, H = 1920, safe = { x: 44, y: 130, w: 896, h: 1306 };
  const box = { id: 'w', text: 'MOVE', x: 70, y: 600, w: 840, h: 300 };   // a wide word close to the safe edges
  const R = MV.rig({ W, H, safe, hits: [{ t: 0, kind: 'push', amp: 0.2, d: 0.5 }, { t: 0.2, kind: 'punch', amp: 0.3, d: 0.3 }, { t: 0.4, kind: 'bounce', amp: 0.2, d: 0.3 },
    { t: 0.6, kind: 'shake', amp: 40, d: 0.3 }, { t: 0.9, kind: 'whip', d: 0.3 }] });
  let clamped = 0;
  for (let t = 0; t < 1.4; t += 1 / 60) {
    const cam = R.at(t, [box]), v = C.visibleBox(box, cam, W, H);
    assert.ok(v && C.insideRect(v, safe), `t=${t.toFixed(3)}: the box leaves the safe area under the camera ${cam.map((x) => x.toFixed(4))}`);
    if (R.share(t, [box]) < 1) clamped++;
  }
  assert.ok(clamped > 20, 'the moves were big enough to need the clamp');
  // with no text on screen the camera is the move itself (a whip between beats carries no copy)
  assert.deepEqual(R.at(1.0, []), R.raw(1.0));
  const w = R.raw(1.0);
  assert.ok(Math.abs(w[2]) > 0.3, 'the whip crosses the frame');
  near(MV.clampShare(w, [box], { W, H, safe }), 0, 0.05, 'over copy, a whip is cut down to nothing');
  // decorative boxes and boxes already outside at rest do not hold the camera
  assert.equal(MV.clampShare([1.3, 0, 0, 0], [{ ...box, deco: true }], { W, H, safe }), 1);
  assert.equal(MV.clampShare([1.3, 0, 0, 0], [{ ...box, x: 0 }], { W, H, safe }), 1);
  // an exclude rectangle is kept clear too (tiktok-ad's button column)
  const ex = [{ x: 900, y: 500, w: 180, h: 700 }];
  const cam = MV.rig({ W, H, safe: { x: 0, y: 0, w: W, h: H }, exclude: ex, hits: [{ t: 0, kind: 'punch', amp: 0.4, d: 1 }] }).at(0.01, [{ ...box, x: 300, w: 500 }]);
  const v = C.visibleBox({ ...box, x: 300, w: 500 }, cam, W, H);
  assert.ok(v.x + v.w <= 900 + 1e-6 || v.y >= 1200 || v.y + v.h <= 500, 'the box stays out of the exclude rectangle');
  assert.throws(() => MV.rig({ W, H, hits: [{ t: 0, kind: 'spin' }] }).raw(1), /unknown hit kind "spin"/);
});

test('P11b rig hits: push holds, punch and shake die out, bounce oscillates, shake is seeded, the whip crosses at its middle', () => {
  const W = 1080, H = 1920, raw = (h, t) => MV.rig({ W, H, hits: [h] }).raw(t);
  near(raw({ t: 1, kind: 'push', amp: 0.1, d: 0.5 }, 0.9)[0], 1); near(raw({ t: 1, kind: 'push', amp: 0.1, d: 0.5 }, 3)[0], 1.1);
  near(raw({ t: 1, kind: 'punch', amp: 0.1, d: 0.5 }, 1)[0], 1.1); assert.ok(raw({ t: 1, kind: 'punch', amp: 0.1, d: 0.5 }, 1.5)[0] < 1.002);
  const b = [1.02, 1.05, 1.08, 1.11].map((t) => raw({ t: 1, kind: 'bounce', amp: 0.1, d: 0.5, f: 5 }, t)[0]);
  assert.ok(b.some((z) => z > 1) && raw({ t: 1, kind: 'bounce', amp: 0.1, d: 0.5, f: 5 }, 1.1)[0] < 1, 'over and under 1');
  const s1 = raw({ t: 1, kind: 'shake', amp: 10, d: 0.2, seed: 4 }, 1.05), s2 = raw({ t: 1, kind: 'shake', amp: 10, d: 0.2, seed: 4 }, 1.05);
  assert.deepEqual(s1, s2, 'a pure function of t');
  assert.ok(Math.abs(s1[2]) > 0 && Math.abs(s1[2]) <= 10 / H + 1e-9);
  assert.deepEqual(raw({ t: 1, kind: 'shake', amp: 10, d: 0.2, seed: 4 }, 2), [1, 0, 0, 0], 'gone after it dies out');
  const wh = (t) => raw({ t: 1, kind: 'whip', d: 0.4 }, t)[2];
  assert.ok(wh(1.19) < -0.5 && wh(1.21) > 0.5, 'out to one side before the middle, in from the other after it');
  near(wh(1.4), 0, 1e-9); near(wh(0.99), 0);
});

test('P11b transitions: progress, the cut at the middle, glitch and flash only where the look allows them, a continuous speed ramp', () => {
  const look = (glitch) => ({ motion: { glitch } });
  near(MV.crossfade(1.05, 1, 0.1).a, 0.5); assert.equal(MV.crossfade(0.9, 1, 0.1).active, false);
  assert.ok(MV.wipe(1.05, 1, 0.1).edge > 0 && MV.wipe(1.05, 1, 0.1).edge < 1); near(MV.wipe(1.2, 1, 0.1, { dir: -1 }).edge, 0);
  near(MV.slide(1.2, 1, 0.1).inn, 0); near(MV.mask(1.2, 1, 0.1).r, 1);
  near(MV.whip(1.05, 1, 0.2).cut, 1.1);
  assert.equal(MV.zoomPunch(1.1, 1, 0.2, { amp: 0.1 }).zoom, 1.1);
  assert.ok(MV.glitchCut(1.05, 1, 0.1, { style: look(true) }).glitch > 0);
  assert.equal(MV.glitchCut(1.05, 1, 0.1, { style: look(false) }).glitch, 0, 'a look with glitch: false never glitches');
  assert.ok(MV.flash(1.01, 1, 0.1, { style: look(true) }).flash > 0);
  assert.equal(MV.flash(1.01, 1, 0.1, { style: look(false) }).flash, 0, 'nor flash-frames');
  assert.equal(MV.speedRamp(0.9, 1, 1), 0.9); near(MV.speedRamp(2, 1, 1), 2);
  near(MV.speedRamp(1.0001, 1, 1), 1.0001, 1e-3); near(MV.speedRamp(1.9999, 1, 1), 1.9999, 1e-3);
  assert.ok(MV.speedRamp(1.25, 1, 1, { rate: 1.8 }) > 1.25 && MV.speedRamp(1.75, 1, 1, { rate: 1.8 }) > 1.6, 'runs ahead, then lands back on time');
  for (let t = 1; t < 2; t += 0.01) assert.ok(MV.speedRamp(t + 0.01, 1, 1, { rate: 2 }) >= MV.speedRamp(t, 1, 1, { rate: 2 }) - 1e-9, 'never runs backward');
  assert.equal(MV.flashBudget([0, 0.3, 0.6, 1.0]), true, 'three in any second, the fourth a second after the first');
  assert.throws(() => MV.flashBudget([0, 0.3, 0.6, 0.99]), /four flash frames within one second/);
});

test('P11b cuts: on the beat grid strictly inside a window, each { t, d } with d at most 0.3 s, and the shot a time falls in', () => {
  assert.deepEqual(MV.cutGrid(0, 2, 0.5, 1), [0.5, 1, 1.5]);
  assert.deepEqual(MV.cutGrid(0.25, 1.25, 0.5, 0.5), [0.5, 0.75, 1]);
  assert.deepEqual(MV.cutGrid(1, 1.5, 0.5, 1), [], 'none on the window\'s own edges');
  assert.deepEqual(MV.cutList([{ t: 2, d: 0.3 }, 1, { t: 0.5 }]), [{ t: 0.5, d: 0 }, { t: 1, d: 0 }, { t: 2, d: 0.3 }]);
  assert.throws(() => MV.cutList([{ t: 1, d: 0.31 }]), /a length d from 0 to 0\.3 s/);
  assert.throws(() => MV.cutList([{ d: 0.1 }]), /needs a time t/);
  const cs = [{ t: 1, d: 0 }, { t: 2, d: 0.2 }];
  assert.deepEqual([0.5, 1, 1.5, 2.05, 2.1, 2.5].map((t) => MV.shotAt(cs, t)), [0, 1, 1, 1, 2, 2], 'a transition switches shots at its middle');
});

test('P11b slamWords: one box per word on screen, all in the phrase\'s group, drawn from the same layout; slamFrom keeps the slam inside', () => {
  const calls = [];
  const ctx = { font: '100px X', globalAlpha: 1, save() {}, restore() {}, translate() {}, scale() {},
    measureText(s) { const px = +String(this.font).match(/(\d+(?:\.\d+)?)px/)[1]; return { width: s.length * px * 0.6, fontBoundingBoxAscent: px * 0.8, fontBoundingBoxDescent: px * 0.2, actualBoundingBoxAscent: px * 0.7, actualBoundingBoxDescent: 0 }; },
    fillText(s) { calls.push(s); } };
  const words = [{ text: 'MAKE', x: 100, base: 900, font: '200px X', at: 0, until: 1 }, { text: 'IT', x: 200, base: 900, font: '400px X', at: 1, until: 2 }];
  const b = MV.slamWords(ctx, words, 1.5, { group: 'Make it move', draw: false });
  assert.equal(calls.length, 0, 'draw: false draws nothing');
  assert.deepEqual(b.map((x) => [x.text, x.group]), [['IT', 'Make it move']]);
  near(b[0].w, 2 * 400 * 0.6, 1e-6, 'settled at scale 1'); near(b[0].h, 400, 1e-6);
  const d = MV.slamWords(ctx, words, 1.02, { group: 'Make it move' });
  assert.deepEqual(calls, ['IT']); assert.ok(d[0].w > 480, 'mid-slam the box is the slammed size');
  assert.deepEqual(MV.slamWords(ctx, words, 0.5, { group: 'g' }).map((x) => x.id), ['slam0']);
  // the slam grows only as far as the safe area lets the box grow about its centre
  const safe = { x: 0, y: 0, w: 1000, h: 2000 };
  near(MV.slamFrom({ x: 100, y: 900, w: 800, h: 200 }, safe), 1.225, 1e-3);
  assert.equal(MV.slamFrom({ x: 400, y: 900, w: 100, h: 100 }, safe), 1.75, 'capped at the slam\'s own size');
  assert.equal(MV.slamFrom({ x: 0, y: 900, w: 1000, h: 100 }, safe), 1, 'a box at the edge does not grow');
  // ink-sized type: the font size whose glyph ink is the share of the frame asked for
  near(MV.inkFont(ctx, 'MOVE', (px) => `${px}px X`, 0.25, 1920), (100 * 0.25 * 1920) / 70, 1e-6);
});

test('P11b the bed stem in the mixer: it starts at 0, is never end-aligned and has no fade; a file bed keeps its plan', () => {
  const sr = 48000, frames = 3 * sr;
  const g = MX.bedPlan({ frames, bedFrames: 3 * sr + 100, generated: true, gain: 0.5 });
  assert.equal(g.start, 0); assert.equal(g.fadeSec, 0);
  assert.equal(g.gainAt(0), 0.5); assert.equal(g.gainAt(frames - 1), 0.5, 'no fade at the end');
  const s = MX.bedPlan({ frames, bedFrames: 2 * sr, gain: 0.5 });
  assert.equal(s.start, sr, 'a shorter file bed ends on the last frame'); assert.ok(s.gainAt(frames - 1) < 0.01, 'and fades');
  const m = MX.bedPlan({ frames, bedFrames: frames, generated: true, mutes: [{ a: 1, b: 1.5, ramp: 0.05 }] });
  assert.equal(m.gainAt(1.2 * sr), 0, 'mute windows still apply');
  assert.equal(MX.DEFAULTS.bedGain, 0.22); assert.equal(MX.DEFAULTS.bedGainSolo, 0.5);
});

// A stereo WAV-like buffer: f(i) per sample at 48 kHz, as readWav returns it.
const wav = (sec, f) => { const sr = 48000, n = Math.round(sec * sr), L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = f(i, i / sr); return { sr, L, R: L, n }; };
test('P11b audio_spike hears the bed: a click over the bed still warns, and hits that stand out alone pass with the beat under them', () => {
  const beat = (i, t) => 0.6 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-((t % 0.441) * 18));   // a kick every beat at 136 BPM
  const bed = wav(3, beat);
  // hits: three sharp impacts over near-silence (a whoosh at -40 dBFS between them)
  const hits = wav(3, (i, t) => ([0.5, 1.4, 2.3].some((h) => t >= h && t < h + 0.04) ? 0.9 * Math.sin(2 * Math.PI * 90 * t) : 0.004 * Math.sin(2 * Math.PI * 900 * t)));
  assert.equal(C.audioSpike(hits).level, 'WARN', 'alone, the impacts stand out of the quiet stem');
  const summed = C.mixWavs([{ wav: hits, gain: 1 }, { wav: bed, gain: 0.5 }]);
  const r = C.audioSpike(summed, { what: 'the effects and the bed summed' });
  assert.equal(r.level, 'OK', r.detail); assert.match(r.detail, /the effects and the bed summed/);
  // a click: one full-scale sample run over the same bed still warns
  const click = wav(3, (i) => (i >= 72000 && i < 72048 ? 1 : 0));
  const withClick = C.mixWavs([{ wav: click, gain: 1 }, { wav: bed, gain: 0.22 }]);
  assert.equal(C.audioSpike(withClick).level, 'WARN', 'a click over the bed');
  // the sum is sample for sample, at the gains asked for, as long as the longest stem
  const a = wav(1, () => 0.5), b = wav(2, () => 0.25), m = C.mixWavs([{ wav: a, gain: 1 }, { wav: b, gain: 2 }]);
  assert.equal(m.n, 96000); near(m.L[10], 1); near(m.L[60000], 0.5);
  assert.throws(() => C.mixWavs([{ wav: a, gain: 1 }, { wav: { ...b, sr: 44100 }, gain: 1 }]), /different sample rates/);
});

test('P11b the bed stem\'s provenance: a render of this source recorded it, with the picture\'s settings; anything else is named', () => {
  const pic = { scene: 'scene.js', params: { energy: 'extreme' }, fps: 30, dur: 3, source: { hash: 'h1' }, bedSha256: 'B' };
  const now = { hash: 'h1' }, stem = { file: 'out/x.bed.wav', sha256: 'B' };
  assert.equal(C.bedLink(null, []), null, 'no bed stem in the mix');
  assert.equal(C.bedLink(stem, [{ file: 'out/x.mp4.render.json', rec: pic, sourceNow: now }], pic), null);
  assert.match(C.bedLink({ ...stem, sha256: 'C' }, [{ file: 'p', rec: pic, sourceNow: now }], pic), /is not one a render recorded/);
  assert.match(C.bedLink(stem, [{ file: 'p', rec: pic, sourceNow: { hash: 'h2' } }], pic), /rendered from another source/);
  // an audio render's own bed record (role bed) counts, when its settings are the picture's
  const own = { role: 'bed', audioSha256: 'C', scene: 'scene.js', params: { energy: 'extreme' }, fps: 30, dur: 3, source: { hash: 'h1' } };
  assert.equal(C.bedLink({ ...stem, sha256: 'C' }, [{ file: 'b', rec: own, sourceNow: now }], { ...pic, bedSha256: 'B' }), null);
  assert.match(C.bedLink({ ...stem, sha256: 'C' }, [{ file: 'b', rec: { ...own, params: {} }, sourceNow: now }], pic), /other settings than the picture \(params/);
  // an effects record with the same hash is not a bed record
  assert.match(C.bedLink({ ...stem, sha256: 'C' }, [{ file: 'e', rec: { ...own, role: undefined }, sourceNow: now }], pic), /not one a render recorded/);
  // provenance reports it
  const P = C.provenance({ fileRel: 'out/x-final.mp4', fileSha: 'M', mjPath: 'out/x.master.json', mjRel: 'out/x.master.json',
    mj: { master: { sha256: 'M', video: { hash: 'v' } }, render: { file: 'r', sha256: 'R' }, stems: [] }, recExists: true, recSha: 'R',
    rec: { source: { hash: 'h1' }, video: { hash: 'v' } }, sourceNow: { hash: 'h1' }, bedProblem: 'the bed stem out/x.bed.wav was rendered from another source' });
  assert.equal(P.result.level, 'FAIL'); assert.match(P.result.detail, /the bed stem out\/x\.bed\.wav/);
});
