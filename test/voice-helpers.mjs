// Helpers for the board and voice suites: synthetic takes (tone bursts for words, a short burst or a
// noise burst under each delivery tag, a quiet noise floor between), pieces with a given board and take,
// and readers for the files tools/cues.mjs writes. Nothing here is a real recording.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { makePiece, templateDir, fixturesDir } from './helpers.mjs';

export const SR = 48000;
export const cuesTool = await import(pathToFileURL(path.join(templateDir, 'tools', 'cues.mjs')).href);
export const lib = await import(pathToFileURL(path.join(templateDir, 'lib.js')).href);
export const takeFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixturesDir, 'takes', name), 'utf8'));

// Mono float samples. words: [{ start, end }] as tone bursts at -13 dBFS RMS; tags: [{ start, end, long }]
// as a 1.2 kHz burst (short) or a noise burst at -26 dBFS (long); extra: [{ start, end, kind: 'noise' |
// 'zero', amp }] for breaths and dips. Everything else is uniform noise at floorDb peak (about 4.8 dB
// lower RMS), so the zeros cues.mjs splices in (exactly 0.0) can be told apart from the take's own pauses.
export function synthAudio({ duration, words = [], tags = [], extra = [], floorDb = -60, seed = 7 }) {
  const n = Math.round(duration * SR), out = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  const floor = Math.pow(10, floorDb / 20);
  for (let i = 0; i < n; i++) out[i] = floor * (rnd() || 1e-7);
  const span = (t0, t1, f) => {
    const a = Math.max(0, Math.round(t0 * SR)), b = Math.min(n, Math.round(t1 * SR)), ramp = Math.round(0.003 * SR);
    for (let i = a; i < b; i++) out[i] = f(i, Math.min(1, (i - a + 1) / ramp, (b - i) / ramp));
  };
  words.forEach((w, k) => span(w.start, w.end, (i, g) => 0.3 * g * Math.sin((2 * Math.PI * (260 + 37 * (k % 9)) * i) / SR)));
  for (const t of tags) {
    if (t.long) span(t.start, t.end, (i, g) => 0.07 * g * rnd());
    else span(t.start, t.end, (i, g) => 0.2 * g * Math.sin((2 * Math.PI * 1200 * i) / SR));
  }
  for (const x of extra) {
    if (x.kind === 'zero') span(x.start, x.end, () => 0);
    else span(x.start, x.end, (i, g) => (x.amp || 0.02) * g * rnd());
  }
  return out;
}

// A take from a list of [text, start, end] tokens (tags as '[...]'), in the generic words format, plus
// matching audio. Tags longer than 0.2 s get the noise burst.
export function synthTake(tokens, duration, { extra = [], floorDb } = {}) {
  const words = tokens.filter(([t]) => !t.startsWith('[')).map(([text, start, end]) => ({ text, start, end }));
  const tags = tokens.filter(([t]) => t.startsWith('[')).map(([text, start, end]) => ({ text, start, end }));
  const audio = synthAudio({ duration, words, tags: tags.map((t) => ({ ...t, long: t.end - t.start > 0.2 })), extra, floorDb });
  return { json: { source: 'words', duration, sampleRate: SR, words, tags }, audio };
}

// A throwaway piece (template + fixture-board) with this board, take.json and take-raw.wav.
export function voicePiece(name, { board, take, audio, fixture = 'fixture-board' }) {
  const dir = makePiece(name, fixture);
  if (board) fs.writeFileSync(path.join(dir, 'board.js'), `export const BOARD = ${JSON.stringify(board, null, 1)};\n`);
  if (take) fs.writeFileSync(path.join(dir, 'take.json'), JSON.stringify(take, null, 1));
  if (audio) fs.writeFileSync(path.join(dir, 'take-raw.wav'), cuesTool.wavFloat(audio, SR));
  return dir;
}

// node tools/cues.mjs <args> in a piece.
export function runCues(dir, args = []) {
  const r = spawnSync(process.execPath, ['tools/cues.mjs', ...args], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
export const readCues = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'cues.json'), 'utf8'));

// A mono WAV (16-bit PCM or 32-bit float) as Float32 samples.
export function readMonoWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, fmt = 1, bits = 16, ch = 1, sr = SR, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4), sz = b.readUInt32LE(off + 4);
    if (id === 'fmt ') { fmt = b.readUInt16LE(off + 8); ch = b.readUInt16LE(off + 10); sr = b.readUInt32LE(off + 12); bits = b.readUInt16LE(off + 22); }
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + sz); break; }
    off += 8 + sz + (sz & 1);
  }
  const step = (bits / 8) * ch, n = Math.floor(data.length / step), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fmt === 3 ? data.readFloatLE(i * step) : data.readInt16LE(i * step) / 32768;
  return { sr, samples: out, dur: n / sr };
}

// Runs of exact zeros at least minSec long, as [start, end) in seconds.
export function zeroRuns(samples, minSec, sr = SR) {
  const out = [], min = Math.round(minSec * sr);
  let i = 0;
  while (i < samples.length) {
    if (samples[i] !== 0) { i++; continue; }
    let j = i;
    while (j < samples.length && samples[j] === 0) j++;
    if (j - i >= min) out.push([i / sr, j / sr]);
    i = j;
  }
  return out;
}

// RMS level in dBFS of [t0, t1).
export function levelDb(samples, t0, t1, sr = SR) {
  const a = Math.max(0, Math.round(t0 * sr)), b = Math.min(samples.length, Math.round(t1 * sr));
  let e = 0;
  for (let i = a; i < b; i++) e += samples[i] * samples[i];
  return 10 * Math.log10(Math.max(1e-30, e / Math.max(1, b - a)));
}

// A 2D context stand-in for captions() in Node: measureText is 30 px per character, drawing is recorded.
export function fakeCtx() {
  const calls = [];
  const ctx = {
    font: '', fillStyle: '', strokeStyle: '', textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, lineWidth: 1, lineJoin: 'miter',
    measureText: (s) => ({ width: 30 * String(s).length }),
    save() {}, restore() {}, translate() {}, scale() {},
    fillText: (text, x, y) => calls.push({ text, x, y, color: ctx.fillStyle }),
    strokeText() {},
  };
  return { ctx, calls };
}

// The board fixture as a plain object (the tests vary it).
export const boardFixture = async () => structuredClone((await import(pathToFileURL(path.join(fixturesDir, 'fixture-board', 'board.js')).href)).BOARD);

// The same tokens as an ElevenLabs with-timestamps alignment: one entry per character, spaces included,
// a token's characters sharing its span and a space running from one token to the next.
export function elevenlabsFrom(tokens) {
  const characters = [], s = [], e = [];
  tokens.forEach(([text, a, b], i) => {
    if (i) { characters.push(' '); s.push(tokens[i - 1][2]); e.push(a); }
    for (let k = 0; k < text.length; k++) { characters.push(text[k]); s.push(a + ((b - a) * k) / text.length); e.push(a + ((b - a) * (k + 1)) / text.length); }
  });
  return { alignment: { characters, character_start_times_seconds: s, character_end_times_seconds: e } };
}
