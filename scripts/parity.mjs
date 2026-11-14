// scripts/parity.mjs: does a mixer match another one? (plan section 17, the P2 acceptance)
//
//   node scripts/parity.mjs <premixA.wav> <premixB.wav> <masterA> <masterB> [--json]
//
// premixA, premixB  each mixer's mix before loudness normalization (tools/mix.mjs --keep-premix writes it as
//                   out/<name>.premix.wav), any audio file ffmpeg reads
// masterA, masterB  each mixer's finished file (its first audio stream is measured)
//
// The premixes are decoded to 48 kHz stereo and aligned on their first sample (sample 0 of each is the
// picture's first frame), then cut into 100 ms windows. A window's level is the RMS of both channels in dBFS,
// floored at -70 dBFS so that two silences match. The windows compared are the ones both premixes fill. The
// masters are measured with ffmpeg's loudnorm (EBU R128 integrated loudness and true peak, 0.01 resolution).
//
// It passes when at least 95% of the windows are within 0.5 dB of each other, and the masters are within
// 0.5 LU integrated and 0.5 dB true peak. Exit 0 on a pass, 1 on a miss, 2 when a file cannot be read.
// The script only reads; nothing it is given is copied or written anywhere.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SR = 48000;
export const THRESHOLDS = { windowSec: 0.1, withinDb: 0.5, share: 0.95, lufs: 0.5, tp: 0.5, floorDb: -70 };

export class ParityError extends Error {}

export function decodeStereo(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.error) throw new ParityError(`could not run ffmpeg: ${r.error.message}`);
  if (r.status !== 0) throw new ParityError(`ffmpeg could not read ${path.basename(file)}: ${String(r.stderr).trim().split('\n').pop()}`);
  const b = r.stdout;
  return b.byteOffset % 4 === 0 ? new Float32Array(b.buffer, b.byteOffset, b.length >> 2) : new Float32Array(new Uint8Array(b).buffer, 0, b.length >> 2);
}

// The level of each full window, in dBFS (interleaved stereo in).
export function envelope(samples, { windowSec = THRESHOLDS.windowSec, floorDb = THRESHOLDS.floorDb, sr = SR } = {}) {
  const win = Math.round(windowSec * sr), n = Math.floor(samples.length / 2 / win), out = new Float64Array(n);
  for (let w = 0; w < n; w++) {
    let e = 0;
    for (let i = w * win * 2; i < (w + 1) * win * 2; i++) e += samples[i] * samples[i];
    const ms = e / (win * 2);
    out[w] = Math.max(floorDb, ms > 0 ? 10 * Math.log10(ms) : -Infinity);
  }
  return out;
}

export function compareEnvelopes(a, b, { withinDb = THRESHOLDS.withinDb, windowSec = THRESHOLDS.windowSec } = {}) {
  const n = Math.min(a.length, b.length), diffs = [];
  let within = 0;
  for (let w = 0; w < n; w++) {
    const d = b[w] - a[w];
    if (Math.abs(d) <= withinDb + 1e-9) within++;
    diffs.push({ t: w * windowSec, a: a[w], b: b[w], d });
  }
  const worst = diffs.filter((x) => Math.abs(x.d) > withinDb + 1e-9).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 5);
  return { windows: n, within, share: n ? within / n : 0, worst };
}

// Integrated loudness and true peak, from loudnorm's measuring pass.
export function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'loudnorm=print_format=json', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.error) throw new ParityError(`could not run ffmpeg: ${r.error.message}`);
  if (r.status !== 0) throw new ParityError(`ffmpeg could not measure ${path.basename(file)}: ${String(r.stderr).trim().split('\n').pop()}`);
  const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/);
  if (!m) throw new ParityError(`ffmpeg printed no loudness for ${path.basename(file)}`);
  const j = JSON.parse(m[0]), lufs = +j.input_i, tp = +j.input_tp;
  if (!Number.isFinite(lufs) || !Number.isFinite(tp)) throw new ParityError(`${path.basename(file)} is silent (${j.input_i} LUFS)`);
  return { lufs, tp };
}

export function parity([premixA, premixB, masterA, masterB], th = THRESHOLDS) {
  const a = decodeStereo(premixA), b = decodeStereo(premixB);
  const ea = envelope(a, th), eb = envelope(b, th);
  const env = compareEnvelopes(ea, eb, th);
  const MA = measure(masterA), MB = measure(masterB);
  const dI = MB.lufs - MA.lufs, dTp = MB.tp - MA.tp;
  const checks = {
    envelope: env.windows > 0 && env.share >= th.share - 1e-9,
    loudness: Math.abs(dI) <= th.lufs + 1e-9,
    truePeak: Math.abs(dTp) <= th.tp + 1e-9,
  };
  return {
    pass: checks.envelope && checks.loudness && checks.truePeak, checks, thresholds: th,
    premix: { a: { file: premixA, sec: a.length / 2 / SR }, b: { file: premixB, sec: b.length / 2 / SR }, ...env },
    master: { a: { file: masterA, ...MA }, b: { file: masterB, ...MB }, dLufs: dI, dTp },
  };
}

export function report(r) {
  const ok = (x) => (x ? 'ok' : 'MISS');
  const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  const p = r.premix, m = r.master, th = r.thresholds;
  const lines = [
    `parity: premixes A ${p.a.sec.toFixed(3)} s, B ${p.b.sec.toFixed(3)} s, aligned on the first sample: ${p.windows} windows of ${th.windowSec * 1000} ms compared`,
    `  envelope   ${(p.share * 100).toFixed(1)}% of windows within ${th.withinDb} dB (needs at least ${th.share * 100}%)  ${ok(r.checks.envelope)}`,
  ];
  for (const w of p.worst) lines.push(`             ${w.t.toFixed(1)}-${(w.t + th.windowSec).toFixed(1)} s: A ${w.a.toFixed(1)} dBFS, B ${w.b.toFixed(1)} dBFS (${f2(w.d)} dB)`);
  if (Math.abs(p.a.sec - p.b.sec) > th.windowSec) lines.push(`  note: the premixes differ in length by ${Math.abs(p.a.sec - p.b.sec).toFixed(3)} s; only the windows both fill are compared`);
  lines.push(`  loudness   A ${m.a.lufs.toFixed(2)} LUFS, B ${m.b.lufs.toFixed(2)} LUFS: ${f2(m.dLufs)} LU (needs at most ${th.lufs})  ${ok(r.checks.loudness)}`);
  lines.push(`  true peak  A ${m.a.tp.toFixed(2)} dBTP, B ${m.b.tp.toFixed(2)} dBTP: ${f2(m.dTp)} dB (needs at most ${th.tp})  ${ok(r.checks.truePeak)}`);
  const missed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  lines.push(r.pass ? 'parity: PASS' : `parity: MISS (${missed.join(', ')})`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json'), files = args.filter((a) => a !== '--json');
  if (files.length !== 4 || files.some((f) => f.startsWith('--'))) {
    console.error('usage: node scripts/parity.mjs <premixA.wav> <premixB.wav> <masterA> <masterB> [--json]');
    process.exit(2);
  }
  try {
    const r = parity(files);
    console.log(json ? JSON.stringify(r, null, 2) : report(r));
    process.exitCode = r.pass ? 0 : 1;
  } catch (e) {
    if (!(e instanceof ParityError)) throw e;
    console.error(`parity: ${e.message}`);
    process.exitCode = 2;
  }
}
