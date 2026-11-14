// Helpers for the mix and parity suites: synthetic stems (tone bursts for a voice, seeded noise for a bed,
// the fixture's clicks for the effects), one rendered picture that every mix copies, and readers that measure
// the output audio. Nothing here is a real recording.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makePiece, render, templateDir, repoRoot, sha256File } from './helpers.mjs';

export const SR = 48000;
export const mixTool = await import(pathToFileURL(path.join(templateDir, 'tools', 'mix.mjs')).href);
const workRoot = path.join(repoRoot, 'test', '.work');
export const frameOf = (t) => Math.round(t * SR);

// fixture-mix rendered once (8 s, 30 fps, scale 0.25, one subframe): out/mix.mp4, its render.json, and
// out/mix.wav, the click-train effects stem.
let base = null;
export function basePiece() {
  if (!base) {
    base = makePiece('mix-base', 'fixture-mix');
    render(base, ['full', '--scale', '0.25', '--sub', '1', '--out', 'out/mix.mp4']);
  }
  return base;
}
// A fresh copy of the base piece for one test, with vo.wav and cues.json when given.
export function mixDir(name, { voice, cues, bed } = {}) {
  const dir = path.join(workRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.cpSync(basePiece(), dir, { recursive: true });
  if (voice) fs.writeFileSync(path.join(dir, 'vo.wav'), monoWav(voice));
  if (cues) writeCues(dir, cues);
  if (bed) fs.writeFileSync(path.join(dir, 'bed.wav'), mixTool.wavStereo(bed));
  return dir;
}
export function writeCues(dir, { VO_OFFSET, CUE = {} }) {
  fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify({ VO_OFFSET, CUE, TAKE: { duration: 0, lastWordEnd: 0 }, GAPS: [], HOOK_END: 0, WORDS: [] }));
}
export function runMix(dir, args) {
  const r = spawnSync(process.execPath, ['tools/mix.mjs', ...args], { cwd: dir, encoding: 'utf8', maxBuffer: 64 << 20 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
export const masterJson = (dir, name = 'mix') => JSON.parse(fs.readFileSync(path.join(dir, 'out', `${name}.master.json`), 'utf8'));
export const fileHash = (dir, f) => sha256File(path.join(dir, f));

// ---- stems

// A mono 32-bit float WAV.
export function monoWav(samples) {
  const n = samples.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32);
  b.writeUInt16LE(32, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) b.writeFloatLE(samples[i], 44 + i * 4);
  return b;
}
// Mono tone bursts [[start, end], ...] in seconds: a cosine, so each burst is at full amplitude on its first
// sample (its onset is one exact sample), and exact zeros everywhere else.
export function toneBursts(duration, bursts, { amp = 0.25, freq = 300 } = {}) {
  const out = new Float32Array(frameOf(duration));
  for (const [a, b] of bursts) {
    const i0 = frameOf(a), i1 = Math.min(out.length, frameOf(b));
    for (let i = i0; i < i1; i++) out[i] = amp * Math.cos((2 * Math.PI * freq * (i - i0)) / SR);
  }
  return out;
}
// Seeded white noise, interleaved stereo, with exact zeros over each gap [a, b) (seconds): a marker the tests
// find to the sample after the mixer has moved the bed.
export function noiseBed(duration, { amp = 0.3, seed = 11, gaps = [[2.0, 2.1]] } = {}) {
  const out = new Float32Array(frameOf(duration) * 2);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  for (let i = 0; i < out.length; i++) out[i] = amp * (rnd() || 1e-7);
  for (const [a, b] of gaps) out.fill(0, frameOf(a) * 2, frameOf(b) * 2);
  return out;
}
// The bed as the mixer should have placed it, before any gain: ref[j] = bed[skip + j - start].
export function placed(bed, { skip = 0, start = 0, frames }) {
  const out = new Float32Array(frames * 2);
  for (let j = Math.max(0, start); j < frames; j++) {
    const k = skip + j - start;
    if (k < 0 || k >= bed.length / 2) continue;
    out[2 * j] = bed[2 * k]; out[2 * j + 1] = bed[2 * k + 1];
  }
  return out;
}

// ---- reading

// Any audio file as interleaved 48 kHz stereo float (the master's AAC decoded by ffmpeg).
export const decode = (file) => mixTool.decode(file);
// The first frame at or after `from` whose sample (either channel) is above thr in size, or -1.
export function firstAbove(x, thr, from = 0) {
  for (let j = from; j < x.length / 2; j++) if (Math.abs(x[2 * j]) > thr || Math.abs(x[2 * j + 1]) > thr) return j;
  return -1;
}
export function lastAbove(x, thr) {
  for (let j = x.length / 2 - 1; j >= 0; j--) if (Math.abs(x[2 * j]) > thr || Math.abs(x[2 * j + 1]) > thr) return j;
  return -1;
}
export function peak(x) { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); return p; }
// Every sample of frames [a, b) exactly zero?
export function allZero(x, a, b) {
  for (let i = 2 * a; i < 2 * b; i++) if (x[i] !== 0) return false;
  return true;
}
// The gain that best maps ref onto out over frames [a, b) (least squares, both channels).
export function gainOf(out, ref, a, b) {
  let num = 0, den = 0;
  for (let i = 2 * a; i < 2 * b; i++) { num += out[i] * ref[i]; den += ref[i] * ref[i]; }
  return den > 0 ? num / den : NaN;
}
// The largest |out - g x ref| over frames [a, b).
export function maxResidual(out, ref, g, a, b) {
  let m = 0;
  for (let i = 2 * a; i < 2 * b; i++) m = Math.max(m, Math.abs(out[i] - g * ref[i]));
  return m;
}
export const db = (x) => 20 * Math.log10(x);
