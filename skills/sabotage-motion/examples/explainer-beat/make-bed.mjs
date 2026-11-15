// Writes bed.mp3, the explainer-beat example's music bed: synthesized here from code (no samples, no recordings), so
// it is this repo's own work under its MIT licence, free to redistribute. A calm 18 s loop in A minor at 100 BPM: a
// soft pad, a sub bass and a plucked arpeggio. Deterministic (seeded); the committed bed.mp3 came from this script.
//   node make-bed.mjs            -> bed.mp3 (needs ffmpeg with libmp3lame)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const SR = 48000, DUR = 18, N = SR * DUR, BPM = 100, BEAT = 60 / BPM;
const L = new Float64Array(N), R = new Float64Array(N);
let seed = 7;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// one voice: additive partials (a soft saw, harmonics falling off fast), an attack-release envelope, panned
function voice(t0, len, midi, amp, { harm = 6, att = 0.6, rel = 1.2, pan = 0, detune = 0 } = {}) {
  const f = mtof(midi) * Math.pow(2, detune / 1200), a = Math.floor(t0 * SR), n = Math.floor((len + rel) * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4), ph = rnd() * 6.283;
  for (let i = 0; i < n && a + i < N; i++) {
    const t = i / SR;
    const e = t < att ? t / att : t < len ? 1 : Math.max(0, 1 - (t - len) / rel);
    let s = 0;
    for (let h = 1; h <= harm; h++) s += Math.sin(6.283185307 * f * h * t + ph * h) / (h * h);
    const v = s * e * e * amp;
    L[a + i] += v * gl; R[a + i] += v * gr;
  }
}
// a pluck: a sine with a fast exponential decay and a touch of the octave
function pluck(t0, midi, amp, pan) {
  const f = mtof(midi), a = Math.floor(t0 * SR), n = Math.floor(1.2 * SR);
  const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && a + i < N; i++) {
    const t = i / SR, e = Math.exp(-t * 5.5) * Math.min(1, t / 0.004);
    const v = (Math.sin(6.283185307 * f * t) + 0.25 * Math.sin(6.283185307 * 2 * f * t)) * e * amp;
    L[a + i] += v * gl; R[a + i] += v * gr;
  }
}

const bar = 4 * BEAT;
const chords = [[57, 60, 64], [53, 57, 60], [48, 55, 60], [55, 59, 62]];   // Am, F, C, G
for (let b = 0; b * bar < DUR; b++) {
  const t0 = b * bar, ch = chords[b % 4];
  ch.forEach((m, i) => {
    voice(t0, bar, m, 0.05, { pan: (i - 1) * 0.5, detune: -6 });
    voice(t0, bar, m, 0.05, { pan: (1 - i) * 0.5, detune: 6 });
  });
  voice(t0, bar, ch[0] - 24, 0.16, { harm: 2, att: 0.08, rel: 0.4 });   // sub bass on the root
  for (let k = 0; k < 8; k++) {                                          // eighth-note arpeggio
    const m = ch[[0, 1, 2, 1, 2, 0, 1, 2][k]] + 12;
    pluck(t0 + k * BEAT / 2, m, k % 2 ? 0.06 : 0.09, k % 2 ? 0.35 : -0.35);
  }
}
// fade in 0.5 s, out over the last 1.5 s, then normalize the peak to -6 dBFS
let peak = 0;
for (let i = 0; i < N; i++) {
  const t = i / SR, g = Math.min(1, t / 0.5) * Math.min(1, (DUR - t) / 1.5);
  L[i] *= g; R[i] *= g; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const k = 0.5 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * k)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * k)) * 32767), 46 + i * 4);
}
const wav = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bed-')), 'bed.wav');
fs.writeFileSync(wav, buf);
const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-c:a', 'libmp3lame', '-q:a', '4', '-map_metadata', '-1', '-fflags', '+bitexact', path.join(root, 'bed.mp3')], { stdio: 'inherit' });
fs.rmSync(path.dirname(wav), { recursive: true, force: true });
if (r.status !== 0) process.exit(1);
console.log('wrote bed.mp3');
