// Mix (plan section 16): tools/mix.mjs on synthetic stems, every control measured from the output audio:
// the premix (--keep-premix, the mix before loudness normalization, sample 0 = the first frame) for sample
// positions and gains, the master's decoded AAC for loudness and true peak. Voice: tone bursts. Bed: seeded
// noise with an exact-zero marker. Effects: fixture-mix's tick train, rendered by render.mjs full.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ffprobe, audioStream, videoStream, countFrames, sha256File, decodedVideoHash, render, fixturesDir } from './helpers.mjs';
import { voicePiece, runCues, synthAudio, takeFixture } from './voice-helpers.mjs';
import {
  SR, frameOf, mixTool, basePiece, mixDir, writeCues, runMix, masterJson, monoWav, toneBursts, noiseBed, placed,
  decode, firstAbove, lastAbove, peak, allZero, gainOf, maxResidual, db,
} from './mix-helpers.mjs';

const N = 8 * SR;                                   // the picture: 8 s, 240 frames at 30 fps
const P = (dir, f) => path.join(dir, f);
const premix = (dir) => decode(P(dir, 'out/mix.premix.wav'));
const ok = (r) => assert.equal(r.status, 0, r.out);
const near = (a, b, eps, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (allowed ${eps})`);
// One voice burst at 0.05-0.35 s into vo.wav: with VO_OFFSET 0.1 it plays at 0.15-0.45 s, so every later
// second of the bed is clear of it (the ducking has long recovered).
const TINY = () => toneBursts(1.0, [[0.05, 0.35]]);
const TINY_CUES = { VO_OFFSET: 0.1, CUE: { a: 0.05 } };
// Syllable-like bursts at three pitches across most of the picture, for loudness.
function speech() {
  const v = new Float32Array(frameOf(7.2));
  const syl = Array.from({ length: 30 }, (_, i) => [0.3 + i * 0.22, 0.46 + i * 0.22]);
  [300, 340, 280].forEach((f, k) => { const b = toneBursts(7.2, syl.filter((_, i) => i % 3 === k), { freq: f }); for (let i = 0; i < b.length; i++) v[i] += b[i]; });
  return v;
}

before(() => basePiece());

test('the picture for the mix suite: 8 s at 30 fps, its render record and its effects stem', () => {
  const dir = basePiece();
  assert.equal(countFrames(P(dir, 'out/mix.mp4')), 240);
  assert.ok(fs.existsSync(P(dir, 'out/mix.mp4.render.json')));
  assert.ok(peak(decode(P(dir, 'out/mix.wav'))) > 0.2, 'the effects stem has its ticks');
});

test('voice delay: a 0.35 s and a 2.10 s VO_OFFSET put the voice\'s first burst on the right sample', () => {
  const onset = {};
  for (const off of [0.35, 2.10]) {
    const dir = mixDir(`mix-delay-${off}`, { voice: toneBursts(2.0, [[0.1, 0.6]]), cues: { VO_OFFSET: off, CUE: { a: 0.1 } } });
    ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--keep-premix']));
    const want = frameOf(off + 0.1), pre = premix(dir);
    assert.equal(firstAbove(pre, 1e-6), want, `premix onset for VO_OFFSET ${off}`);
    assert.ok(allZero(pre, 0, want), 'nothing before the voice');
    const m = decode(P(dir, 'out/mix-final.mp4'));
    const got = firstAbove(m, 0.01 * peak(m));
    assert.ok(Math.abs(got - want) <= SR / 1000, `master onset ${got} vs ${want}: more than 1 ms off through AAC`);
    assert.equal(masterJson(dir).voiceDelay, off);
    onset[off] = firstAbove(pre, 1e-6);
  }
  assert.equal(onset[2.10] - onset[0.35], frameOf(1.75), 'the two delays differ by exactly 1.75 s');
});

test('the voice is levelled to -24 LUFS, then multiplied by --vo-gain (2.0 here: -24 + 6.0 dB)', () => {
  for (const amp of [0.25, 0.03]) {
    const dir = mixDir(`mix-level-${amp}`, { voice: toneBursts(4.5, [[0.2, 1.2], [1.6, 2.6], [3.0, 4.0]], { amp }), cues: { VO_OFFSET: 0.1, CUE: { a: 0.2 } } });
    ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--vo-gain', '2', '--keep-premix']));
    const L = mixTool.loudness(P(dir, 'out/mix.premix.wav'));
    near(L.lufs, -24 + db(2), 0.3, `premix loudness for a voice at amplitude ${amp}`);
    const v = masterJson(dir).stems.find((s) => s.role === 'voice');
    assert.equal(v.gain, 2);
    near(v.levelDb, -24 - v.measuredLufs, 1e-9, 'the levelling gain recorded');
  }
});

test('a voice quieter than -50 LUFS stops the mix and leaves the last master and master.json as they were', () => {
  const dir = mixDir('mix-quiet', { voice: TINY(), cues: TINY_CUES });
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx']));
  const before = [sha256File(P(dir, 'out/mix-final.mp4')), sha256File(P(dir, 'out/mix.master.json'))];
  fs.writeFileSync(P(dir, 'vo.wav'), monoWav(toneBursts(1.0, [[0.05, 0.35]], { amp: 0.25 * Math.pow(10, -40 / 20) })));
  const r = runMix(dir, ['mix', '--no-bed', '--no-sfx']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /quieter than -50 LUFS/);
  assert.deepEqual([sha256File(P(dir, 'out/mix-final.mp4')), sha256File(P(dir, 'out/mix.master.json'))], before);
  // and a quiet voice just above the floor (-45 LUFS) still mixes
  fs.writeFileSync(P(dir, 'vo.wav'), monoWav(toneBursts(1.0, [[0.05, 0.35]], { amp: 0.25 * Math.pow(10, -28 / 20) })));
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx']));
});

test('--bed-skip, and the default start: the bed\'s end lands on the last frame', () => {
  const bed = noiseBed(6.0);                    // a zero marker at 2.0-2.1 s of the bed
  const dir = mixDir('mix-skip', { voice: TINY(), cues: TINY_CUES, bed });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--bed-skip', '1.25', '--keep-premix']));
  const pre = premix(dir), start = N - frameOf(6.0 - 1.25);          // 3.25 s
  assert.equal(start, frameOf(3.25));
  assert.ok(allZero(pre, frameOf(1.0), start), 'nothing before the bed starts');
  assert.equal(firstAbove(pre, 0, frameOf(1.0)), start, 'the bed starts at 3.25 s');
  assert.ok(allZero(pre, frameOf(4.0), frameOf(4.1)), 'the marker moved by the skip: 2.0 - 1.25 + 3.25 = 4.0 s');
  assert.ok(Math.abs(pre[2 * frameOf(4.0) - 2]) + Math.abs(pre[2 * frameOf(4.0) - 1]) > 0 && Math.abs(pre[2 * frameOf(4.1)]) > 0, 'the marker is exactly 0.1 s long');
  assert.ok(lastAbove(pre, 0) >= N - 2, 'the bed plays to the last frame');
  const ref = placed(bed, { skip: frameOf(1.25), start, frames: N });
  near(gainOf(pre, ref, frameOf(5.0), frameOf(7.0)), 0.22, 1e-4, 'the bed at --bed-gain 0.22');
  const b = masterJson(dir).stems.find((s) => s.role === 'bed');
  assert.equal(b.skip, 1.25);
  assert.equal(b.endOnLastFrame, true);
});

test('--bed-gain: the bed comes in at the gain asked for (0.5 here)', () => {
  const bed = noiseBed(8.0);
  const dir = mixDir('mix-bedgain', { voice: TINY(), cues: TINY_CUES, bed });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--bed-gain', '0.5', '--keep-premix']));
  near(gainOf(premix(dir), placed(bed, { frames: N }), frameOf(2.5), frameOf(7.0)), 0.5, 1e-4, 'bed gain');
});

test('--bed-at in seconds: the bed starts there and stops at its own end', () => {
  const bed = noiseBed(4.0);
  const dir = mixDir('mix-bedat', { voice: TINY(), cues: TINY_CUES, bed });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--bed-at', '1.6', '--keep-premix']));
  const pre = premix(dir);
  assert.equal(firstAbove(pre, 0, frameOf(1.0)), frameOf(1.6), 'the bed starts at 1.6 s');
  assert.ok(allZero(pre, frameOf(3.6), frameOf(3.7)), 'the marker at 1.6 + 2.0 s');
  assert.equal(lastAbove(pre, 0), frameOf(5.6) - 1, 'the bed ends at 1.6 + 4.0 s');
  assert.ok(allZero(pre, frameOf(5.6), N), 'silence after the bed ends');
});

test('--bed-at cue:<id> starts the bed at VO_OFFSET + that cue (a 0.10 s and a 0.60 s VO_OFFSET)', () => {
  for (const off of [0.1, 0.6]) {
    const bed = noiseBed(4.0);
    const dir = mixDir(`mix-bedcue-${off}`, { voice: TINY(), cues: { VO_OFFSET: off, CUE: { a: 0.05, b: 1.9 } }, bed });
    ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--bed-at', 'cue:b', '--keep-premix']));
    const pre = premix(dir), start = frameOf(off + 1.9);
    assert.equal(firstAbove(pre, 0, frameOf(off + 0.6)), start, `the bed starts at ${off} + 1.9 s`);
    assert.ok(allZero(pre, start + frameOf(2.0), start + frameOf(2.1)), 'its marker 2.0 s later');
    near(masterJson(dir).stems.find((s) => s.role === 'bed').start, off + 1.9, 1e-9, 'master.json');
  }
  const dir = mixDir('mix-bedcue-missing', { voice: TINY(), cues: { VO_OFFSET: 0.1, CUE: { a: 0.05 } }, bed: noiseBed(4.0) });
  const r = runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--bed-at', 'cue:nope']);
  assert.equal(r.status, 1);
  assert.match(r.out, /no cue "nope"/);
});

// The bed's gain at each 10 ms window, divided by --bed-gain, against the expected fade shape.
function fadeShape(pre, ref, from, to, want) {
  let worst = 0;
  for (let t = from; t < to - 1e-9; t += 0.01) {
    const g = gainOf(pre, ref, frameOf(t), frameOf(t + 0.01)) / 0.22, w = want(t + 0.005);
    worst = Math.max(worst, Math.abs(g - w));
  }
  return worst;
}

test('fades: 0.35 s for a bed shorter than the picture, 2.6 s for a longer one, ending where the bed stops', () => {
  const short = noiseBed(6.0, { gaps: [] });
  const a = mixDir('mix-fade-short', { voice: TINY(), cues: TINY_CUES, bed: short });
  ok(runMix(a, ['mix', '--bed', 'bed.wav', '--no-sfx', '--keep-premix']));
  const refA = placed(short, { start: frameOf(2.0), frames: N });
  assert.ok(fadeShape(premix(a), refA, 7.0, 8.0, (t) => Math.min(1, (8 - t) / 0.35)) < 0.02, 'a 0.35 s linear fade ending on the last frame');
  near(gainOf(premix(a), refA, frameOf(7.0), frameOf(7.6)), 0.22, 1e-4, 'full level before the fade');

  const long = noiseBed(12.0, { gaps: [] });
  const b = mixDir('mix-fade-long', { voice: TINY(), cues: TINY_CUES, bed: long });
  ok(runMix(b, ['mix', '--bed', 'bed.wav', '--no-sfx', '--keep-premix']));
  const refB = placed(long, { start: 0, frames: N });
  assert.ok(fadeShape(premix(b), refB, 4.5, 8.0, (t) => Math.min(1, (8 - t) / 2.6)) < 0.02, 'a 2.6 s linear fade, cut at the last frame');
  near(gainOf(premix(b), refB, frameOf(3.0), frameOf(5.3)), 0.22, 1e-4, 'full level before the fade');
  assert.deepEqual([masterJson(a).stems[1].fade, masterJson(b).stems[1].fade], [0.35, 2.6]);
});

test('a mute window: silent inside, unchanged outside, ramped just outside its edges', () => {
  const bed = noiseBed(8.0);
  const dir = mixDir('mix-mute', { voice: TINY(), cues: TINY_CUES, bed });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--mute', '3.0-4.5:0.2,6.0-6.3', '--keep-premix']));
  const pre = premix(dir), ref = placed(bed, { frames: N });
  assert.ok(allZero(pre, frameOf(3.0), frameOf(4.5) + 1), 'silent over 3.0-4.5 s');
  assert.ok(allZero(pre, frameOf(6.0), frameOf(6.3) + 1), 'silent over 6.0-6.3 s');
  for (const [a, b] of [[1.5, 2.8], [4.7, 5.95], [6.35, 7.6]]) {
    near(gainOf(pre, ref, frameOf(a), frameOf(b)), 0.22, 1e-6, `unchanged over ${a}-${b} s`);
    assert.ok(maxResidual(pre, ref, 0.22, frameOf(a), frameOf(b)) < 1e-6, `sample for sample over ${a}-${b} s`);
  }
  const g = gainOf(pre, ref, frameOf(2.85), frameOf(2.86)) / 0.22;
  near(g, (3.0 - 2.855) / 0.2, 0.02, 'the 0.2 s ramp down before the window');
  const g2 = gainOf(pre, ref, frameOf(6.32), frameOf(6.33)) / 0.22;
  near(g2, (6.325 - 6.3) / 0.05, 0.02, 'the default 0.05 s ramp up after the window');
  assert.deepEqual(masterJson(dir).stems[1].mutes, [{ a: 3, b: 4.5, ramp: 0.2 }, { a: 6, b: 6.3, ramp: 0.05 }]);
});

test('ducking: the bed is at least 10 dB lower inside the voice\'s bursts than between them', () => {
  const bed = noiseBed(8.0, { gaps: [] });
  const dir = mixDir('mix-duck', { voice: toneBursts(6.0, [[1.0, 2.0], [4.0, 5.0]]), cues: { VO_OFFSET: 0.5, CUE: { a: 1.0 } }, bed });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--no-sfx', '--keep-premix']));
  const pre = premix(dir), ref = placed(bed, { frames: N });
  const g = (a, b) => gainOf(pre, ref, frameOf(a), frameOf(b));
  const between = g(3.3, 4.3), inside = [g(1.9, 2.4), g(4.9, 5.4)];
  near(between, 0.22, 0.22 * 0.06, 'the bed is back to full level between the bursts');
  for (const x of inside) assert.ok(db(between / x) >= 10, `the bed is only ${db(between / x).toFixed(1)} dB lower under the voice`);
});

test('an extra stem with a gain and a delay (--stem fx.wav:0.5:1.25)', () => {
  const fx = toneBursts(1.0, [[0.2, 0.5]], { freq: 2000, amp: 0.3 });
  const dir = mixDir('mix-stem', { voice: TINY(), cues: TINY_CUES });
  fs.writeFileSync(P(dir, 'fx.wav'), monoWav(fx));
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--stem', 'fx.wav:0.5:1.25', '--keep-premix']));
  const pre = premix(dir);
  assert.equal(firstAbove(pre, 0, frameOf(0.6)), frameOf(1.45), 'the stem\'s burst at 1.25 + 0.2 s');
  const ref = new Float32Array(N * 2), f = decode(P(dir, 'fx.wav'));
  ref.set(f.subarray(0, Math.min(f.length, (N - frameOf(1.25)) * 2)), frameOf(1.25) * 2);
  near(gainOf(pre, ref, frameOf(1.45), frameOf(1.75)), 0.5, 1e-4, 'the stem at gain 0.5');
  const s = masterJson(dir).stems.find((x) => x.role === 'stem');
  assert.deepEqual([s.file, s.gain, s.delay, s.sha256], ['fx.wav', 0.5, 1.25, sha256File(P(dir, 'fx.wav'))]);
});

test('the effects come in at --sfx-gain: 0.9 by default, 0.5 when asked', () => {
  const sfx = decode(P(basePiece(), 'out/mix.wav'));
  for (const [args, want] of [[[], 0.9], [['--sfx-gain', '0.5'], 0.5]]) {
    const dir = mixDir(`mix-sfx-${want}`, { voice: TINY(), cues: TINY_CUES });
    ok(runMix(dir, ['mix', '--no-bed', '--keep-premix', ...args]));
    near(gainOf(premix(dir), sfx, frameOf(1.0), frameOf(7.9)), want, 1e-4, `effects at ${want}`);
  }
});

test('--no-sfx mixes with no effects stem on disk; without it, the missing stem is refused', () => {
  const dir = mixDir('mix-nosfx', { voice: TINY(), cues: TINY_CUES });
  fs.rmSync(P(dir, 'out/mix.wav'));
  const r = runMix(dir, ['mix', '--no-bed']);
  assert.equal(r.status, 1);
  assert.match(r.out, /no effects stem out\/mix\.wav/);
  assert.ok(!fs.existsSync(P(dir, 'out/mix-final.mp4')), 'a refusal writes nothing');
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--keep-premix']));
  const pre = premix(dir);
  assert.equal(firstAbove(pre, 1e-6), frameOf(0.15), 'the voice alone');
  assert.ok(allZero(pre, frameOf(0.5), N), 'and nothing else');
  assert.ok(audioStream(ffprobe(P(dir, 'out/mix-final.mp4'))), 'the master has its audio');
  assert.deepEqual(masterJson(dir).stems.map((s) => s.role), ['voice']);
});

// Loudness is measured on the master file with ebur128 (what check --file uses): within 0.5 LU of the target,
// true peak at or under -1.0 dBTP.
const modes = [
  ['default', [], -14],
  ['--master-only', ['--master-only'], -14],
  ['--sting', ['--sting'], -20],
  ['a custom target (-18 LUFS, -4 dBTP)', ['--target-lufs', '-18', '--tp', '-4'], -18],
];
for (const [label, args, lufs] of modes) {
  test(`loudness, ${label}: the master is within 0.5 LU of ${lufs} LUFS with a true peak at or under -1.0 dBTP`, () => {
    const voiced = !args.includes('--master-only') && !args.includes('--sting');
    const dir = mixDir(`mix-mode-${lufs}-${args.join('')}`, { voice: speech(), cues: { VO_OFFSET: 0.5, CUE: { a: 0.3 } }, bed: noiseBed(10.0, { gaps: [] }) });
    ok(runMix(dir, ['mix', ...(voiced ? ['--bed', 'bed.wav'] : []), ...args]));
    const M = mixTool.loudness(P(dir, 'out/mix-final.mp4'), { peak: true });
    near(M.lufs, lufs, 0.5, 'integrated loudness');
    assert.ok(M.tp <= -1.0, `true peak ${M.tp} dBTP`);
    const j = masterJson(dir);
    assert.equal(j.mode, voiced ? 'default' : args[0].slice(2));
    assert.equal(j.target.lufs, lufs);
    assert.equal(j.voiceDelay, voiced ? 0.5 : null, 'a voice delay only when there is a voice');
    assert.deepEqual(j.stems.map((s) => s.role), voiced ? ['voice', 'bed', 'effects'] : ['effects']);
    if (!voiced) assert.equal(j.stems[0].gain, 1, 'the effects at 1.0 when they are mastered alone');
  });
}

test('master.json records the inputs, the render it read and the master it wrote; the picture is copied untouched', () => {
  const dir = mixDir('mix-record', { voice: speech(), cues: { VO_OFFSET: 0.5, CUE: { a: 0.3 } }, bed: noiseBed(10.0) });
  ok(runMix(dir, ['mix', '--bed', 'bed.wav', '--bed-skip', '0.5', '--mute', '6.0-6.5']));
  const j = masterJson(dir), rec = JSON.parse(fs.readFileSync(P(dir, 'out/mix.mp4.render.json'), 'utf8'));
  assert.equal(j.format, 'sabotage-motion/master@1');
  assert.deepEqual(j.target, { lufs: -14, tp: -2, lra: 11 });
  assert.equal(j.master.file, 'out/mix-final.mp4');
  assert.equal(j.master.sha256, sha256File(P(dir, 'out/mix-final.mp4')), 'the whole master file');
  assert.deepEqual(j.render, { file: 'out/mix.mp4.render.json', sha256: sha256File(P(dir, 'out/mix.mp4.render.json')) });
  assert.equal(j.master.video.hash, decodedVideoHash(P(dir, 'out/mix-final.mp4')));
  assert.equal(j.master.video.hash, rec.video.hash, 'the master\'s decoded video hashes the same as its render\'s');
  assert.deepEqual(j.cues, { file: 'cues.json', sha256: sha256File(P(dir, 'cues.json')), VO_OFFSET: 0.5 });
  const want = { voice: 'vo.wav', bed: 'bed.wav', effects: 'out/mix.wav' };
  for (const s of j.stems) assert.equal(s.sha256, sha256File(P(dir, want[s.role])), `${s.role} hash`);
  assert.deepEqual(j.stems.map((s) => [s.role, s.gain]), [['voice', 3.2], ['bed', 0.22], ['effects', 0.9]]);
  assert.equal(j.chain.limit, -6);
  assert.deepEqual(j.chain.duck, { threshold: 0.02, ratio: 5, attack: 25, release: 350 });
  assert.equal(j.premix, null);
  const v = videoStream(ffprobe(P(dir, 'out/mix-final.mp4'))), a = audioStream(ffprobe(P(dir, 'out/mix-final.mp4')));
  assert.deepEqual([v.codec_name, a.codec_name, +a.sample_rate, a.channels], ['h264', 'aac', 48000, 2]);
  assert.equal(countFrames(P(dir, 'out/mix-final.mp4')), 240);
  const head = fs.readFileSync(P(dir, 'out/mix-final.mp4')).subarray(0, 4096).toString('latin1');
  assert.ok(head.indexOf('moov') >= 0 && (head.indexOf('mdat') < 0 || head.indexOf('moov') < head.indexOf('mdat')), 'faststart: moov before mdat');
});

test('--keep-premix writes the mix before loudness normalization; without it, no premix is left', () => {
  const dir = mixDir('mix-premix', { voice: toneBursts(4.5, [[0.2, 1.2], [1.6, 2.6], [3.0, 4.0]]), cues: { VO_OFFSET: 0.1, CUE: { a: 0.2 } } });
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--vo-gain', '2', '--keep-premix']));
  const f = P(dir, 'out/mix.premix.wav'), s = audioStream(ffprobe(f)), j = masterJson(dir);
  assert.deepEqual([s.codec_name, +s.sample_rate, s.channels], ['pcm_f32le', 48000, 2]);
  assert.equal(decode(f).length, N * 2, 'one sample per picture sample, from the first frame');
  const L = mixTool.loudness(f);
  near(L.lufs, -18, 0.3, 'the premix is the levelled voice (-24 LUFS x 2.0)');
  near(L.lufs, j.measured.premix.lufs, 0.3, 'and is what loudnorm measured');
  assert.ok(Math.abs(L.lufs - mixTool.loudness(P(dir, 'out/mix-final.mp4')).lufs) > 3, 'not the normalized master');
  assert.deepEqual(j.premix, { file: 'out/mix.premix.wav', sha256: sha256File(f) });
  ok(runMix(dir, ['mix', '--no-bed', '--no-sfx', '--vo-gain', '2']));
  assert.ok(!fs.existsSync(f), 'a mix without --keep-premix removes the old premix');
  assert.equal(masterJson(dir).premix, null);
});

test('refusals: a picture changed after its render, no render record, options that do not fit the mode', () => {
  const dir = mixDir('mix-refuse', { voice: TINY(), cues: TINY_CUES });
  fs.appendFileSync(P(dir, 'out/mix.mp4'), Buffer.from([0]));
  let r = runMix(dir, ['mix', '--no-bed']);
  assert.equal(r.status, 1);
  assert.match(r.out, /changed after the render/);
  fs.rmSync(P(dir, 'out/mix.mp4.render.json'));
  r = runMix(dir, ['mix', '--no-bed']);
  assert.match(r.out, /no render record/);
  assert.equal(runMix(dir, ['mix', '--master-only', '--bed', 'bed.wav']).status, 2);
  assert.equal(runMix(dir, ['mix', '--master-only', '--sting']).status, 2);
  assert.equal(runMix(dir, ['mix', '--mute', '5-4']).status, 2);
  assert.equal(runMix(dir, ['../mix']).status, 2);
  assert.ok(!fs.existsSync(P(dir, 'out/mix-final.mp4')));
});

test('the animatic (plan 6.4): cues.mjs, a silent slate render, then the voice alone (--no-bed --no-sfx)', () => {
  const take = takeFixture('words.json');
  const dir = voicePiece('mix-animatic', { audio: synthAudio({ duration: take.duration, words: take.words, tags: take.tags.map((t) => ({ ...t, long: t.end - t.start > 0.2 })) }) });
  fs.copyFileSync(path.join(fixturesDir, 'takes', 'words.json'), P(dir, 'take.json'));
  const c = runCues(dir);
  assert.equal(c.status, 0, c.out);
  const cues = JSON.parse(fs.readFileSync(P(dir, 'cues.json'), 'utf8'));
  render(dir, ['video', '--scene', 'slate.js', '--scale', '0.25', '--sub', '1', '--out', 'out/animatic.mp4']);
  assert.ok(!fs.existsSync(P(dir, 'out/animatic.wav')), 'video writes no effects stem');
  const r = runMix(dir, ['animatic', '--no-bed', '--no-sfx']);
  assert.equal(r.status, 0, r.out);
  const j = masterJson(dir, 'animatic');
  assert.deepEqual(j.stems.map((s) => s.role), ['voice']);
  assert.equal(j.voiceDelay, cues.VO_OFFSET);
  const m = decode(P(dir, 'out/animatic-final.mp4'));
  const got = firstAbove(m, 0.1 * peak(m)), want = frameOf(cues.VO_OFFSET + cues.WORDS[0].start);
  assert.ok(Math.abs(got - want) <= frameOf(0.005), `the first word at ${got / SR} s, not ${want / SR} s`);
});
