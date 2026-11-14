// scripts/parity.mjs: does a mixer match another one? (plan section 17, the P2 acceptance)
//
//   node scripts/parity.mjs <premixA.wav> <premixB.wav> <masterA> <masterB> [--lag <ms>] [--json]
//
// premixA, premixB  each mixer's mix before loudness normalization (tools/mix.mjs --keep-premix writes it as
//                   out/<name>.premix.wav), any audio file ffmpeg reads
// masterA, masterB  each mixer's finished file (its first audio stream is measured)
// --lag <ms>        a latency you know B has against A, in milliseconds: positive when B runs behind A, negative
//                   when it runs ahead, inside +-20 ms (default 0). A limiter whose lookahead is not compensated
//                   delays its mixer's whole output by the lookahead (5 ms in the private mixer this replaces).
//
// The premixes are decoded to 48 kHz stereo; sample 0 of each is the picture's first frame. The lag between them is
// measured by cross-correlating their mono sums over A's loudest 4 s within +-20 ms, and it must be the one --lag
// states, within 0.1 ms. A lag found at the edge of that search, or a correlation too weak to name one (under 0.5),
// is no clear lag, which matches only --lag 0. The lag is a check, never a correction: B is moved by the lag
// --lag states, not by the one measured, so a timing fault in one part of the mix (the voice a few milliseconds
// late over a bed that is not) shows up as a lag nobody stated, instead of being lined up and passed.
// Then the premixes are cut into 100 ms windows. A window's level is the RMS of both channels in dBFS, floored at
// -70 dBFS so that two silences match. The masters are measured with ffmpeg's loudnorm (EBU R128 integrated
// loudness and true peak, 0.01 resolution).
//
// It passes when the premixes' lengths are within one window (100 ms) of each other, the measured lag is the stated
// one, at least 95% of the windows are within 0.5 dB of each other, and the masters are within 0.5 LU integrated
// and 0.5 dB true peak. Exit 0 on a pass, 1 on a miss, 2 on a bad argument or a file that cannot be read.
// The script only reads; nothing it is given is copied or written anywhere.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SR = 48000;
export const THRESHOLDS = { windowSec: 0.1, withinDb: 0.5, share: 0.95, lufs: 0.5, tp: 0.5, floorDb: -70, maxLagMs: 20, lagTolMs: 0.1 };

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

// The constant lag of B against A in frames, from the cross-correlation of their mono sums over A's loudest 4 s:
// B[j + lag] lines up with A[j], so a negative lag means B runs ahead of A. Searched within +-maxLagMs. `corr` is the
// normalized correlation at that lag (1 = the same waveform); `found` needs it at 0.5 or more and the lag inside the
// search, not on its edge.
export function measureLag(a, b, { maxLagMs = THRESHOLDS.maxLagMs, chunkSec = 4, sr = SR } = {}) {
  const n = Math.min(a.length, b.length) >> 1, max = Math.round((maxLagMs / 1000) * sr);
  const len = Math.min(Math.round(chunkSec * sr), n - 2 * max);
  if (len < sr / 10) return { lag: 0, edge: false, corr: 0, found: false, searched: false };
  const mono = (x) => { const m = new Float32Array(n); for (let j = 0; j < n; j++) m[j] = x[2 * j] + x[2 * j + 1]; return m; };
  const ma = mono(a), mb = mono(b);
  let from = max, loud = -1;
  for (let s0 = max; s0 + len + max <= n; s0 += sr / 2) {
    let e = 0; for (let j = s0; j < s0 + len; j += 8) e += ma[j] * ma[j];
    if (e > loud) { loud = e; from = s0; }
  }
  let lag = 0, best = -Infinity;
  for (let L = -max; L <= max; L++) {
    let c = 0; for (let j = from; j < from + len; j++) c += ma[j] * mb[j + L];
    if (c > best) { best = c; lag = L; }
  }
  let ea = 0, eb = 0;
  for (let j = from; j < from + len; j++) { ea += ma[j] * ma[j]; eb += mb[j + lag] * mb[j + lag]; }
  const corr = ea > 0 && eb > 0 ? best / Math.sqrt(ea * eb) : 0, edge = Math.abs(lag) === max;
  return { lag, edge, corr, found: !edge && corr >= 0.5, searched: true };
}
// B moved by `lag` frames so that its frame j + lag lands on frame j (what falls outside becomes silence).
export function shiftFrames(x, lag) {
  if (!lag) return x;
  const n = x.length >> 1, out = new Float32Array(x.length);
  for (let j = 0; j < n; j++) { const k = j + lag; if (k >= 0 && k < n) { out[2 * j] = x[2 * k]; out[2 * j + 1] = x[2 * k + 1]; } }
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

// lagMs: the latency B is stated to have against A (positive: B behind). It must lie strictly inside the search.
export function parity([premixA, premixB, masterA, masterB], th = THRESHOLDS, { lagMs = 0 } = {}) {
  if (!(Math.abs(lagMs) < th.maxLagMs)) throw new ParityError(`--lag ${lagMs}: a latency in milliseconds inside +-${th.maxLagMs}`);
  const a = decodeStereo(premixA), b = decodeStereo(premixB);
  const ea = envelope(a, th);
  const expected = Math.round((lagMs / 1000) * SR), tol = Math.round((th.lagTolMs / 1000) * SR);
  const L = measureLag(a, b, th);
  // no clear lag (or premixes too short to search) agrees only with no stated lag
  const lagOk = L.found ? Math.abs(L.lag - expected) <= tol : expected === 0;
  const env = compareEnvelopes(ea, envelope(shiftFrames(b, expected), th), th);
  const unaligned = expected ? compareEnvelopes(ea, envelope(b, th), th).share : env.share;
  const MA = measure(masterA), MB = measure(masterB);
  const dI = MB.lufs - MA.lufs, dTp = MB.tp - MA.tp;
  const secA = a.length / 2 / SR, secB = b.length / 2 / SR;
  const checks = {
    length: Math.abs(secA - secB) <= th.windowSec + 1e-9,
    lag: lagOk,
    envelope: env.windows > 0 && env.share >= th.share - 1e-9,
    loudness: Math.abs(dI) <= th.lufs + 1e-9,
    truePeak: Math.abs(dTp) <= th.tp + 1e-9,
  };
  return {
    pass: Object.values(checks).every(Boolean), checks, thresholds: th,
    premix: { a: { file: premixA, sec: secA }, b: { file: premixB, sec: secB }, ...env,
      align: { searched: L.searched, measured: L.lag, corr: L.corr, edge: L.edge, found: L.found, expected, applied: expected, ms: (expected / SR) * 1000, unalignedShare: unaligned } },
    master: { a: { file: masterA, ...MA }, b: { file: masterB, ...MB }, dLufs: dI, dTp },
  };
}

export function report(r) {
  const ok = (x) => (x ? 'ok' : 'MISS');
  const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  const p = r.premix, m = r.master, th = r.thresholds;
  const al = p.align, msOf = (f) => (f / SR) * 1000, ms = (f) => `${Math.abs(f)} frames (${Math.abs(msOf(f)).toFixed(2)} ms)`;
  const side = (f) => `${ms(f)} ${f < 0 ? 'ahead' : 'behind'}`;
  const seen = !al.searched ? 'the premixes are too short to measure a lag'
    : !al.found ? `no clear lag within ${th.maxLagMs} ms (best ${al.measured < 0 ? '-' : '+'}${ms(al.measured)}${al.edge ? ', at the search limit' : ''}, correlation ${al.corr.toFixed(2)})`
      : al.measured === 0 ? `no lag between them (correlation ${al.corr.toFixed(2)})`
        : `B runs ${al.measured < 0 ? 'ahead of' : 'behind'} A by ${ms(al.measured)} (correlation ${al.corr.toFixed(2)})`;
  const stated = r.checks.lag
    ? (al.expected ? `, the latency --lag ${f2(msOf(al.expected))} states; B is shifted by it before comparing` : ', and none was stated')
    : (al.expected ? `, not the ${side(al.expected)} --lag ${f2(msOf(al.expected))} states`
      : `, but no lag was stated: a timing fault, or a known latency (a limiter lookahead) to state with --lag ${f2(msOf(al.measured))}`);
  const lines = [
    `parity: premixes A ${p.a.sec.toFixed(3)} s, B ${p.b.sec.toFixed(3)} s: ${p.windows} windows of ${th.windowSec * 1000} ms compared`,
    `  length     ${Math.abs(p.a.sec - p.b.sec).toFixed(3)} s apart (needs at most ${th.windowSec} s)  ${ok(r.checks.length)}`,
    `  lag        ${seen}${stated}  ${ok(r.checks.lag)}`,
    `  envelope   ${(p.share * 100).toFixed(1)}% of windows within ${th.withinDb} dB (needs at least ${th.share * 100}%)${al.applied ? `, ${(al.unalignedShare * 100).toFixed(1)}% without that shift` : ''}  ${ok(r.checks.envelope)}`,
  ];
  for (const w of p.worst) lines.push(`             ${w.t.toFixed(1)}-${(w.t + th.windowSec).toFixed(1)} s: A ${w.a.toFixed(1)} dBFS, B ${w.b.toFixed(1)} dBFS (${f2(w.d)} dB)`);
  lines.push(`  loudness   A ${m.a.lufs.toFixed(2)} LUFS, B ${m.b.lufs.toFixed(2)} LUFS: ${f2(m.dLufs)} LU (needs at most ${th.lufs})  ${ok(r.checks.loudness)}`);
  lines.push(`  true peak  A ${m.a.tp.toFixed(2)} dBTP, B ${m.b.tp.toFixed(2)} dBTP: ${f2(m.dTp)} dB (needs at most ${th.tp})  ${ok(r.checks.truePeak)}`);
  const missed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
  lines.push(r.pass ? 'parity: PASS' : `parity: MISS (${missed.join(', ')})`);
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = 'usage: node scripts/parity.mjs <premixA.wav> <premixB.wav> <masterA> <masterB> [--lag <ms>] [--json]';
  const args = process.argv.slice(2), files = [];
  let json = false, lagMs = 0, bad = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') json = true;
    else if (args[i] === '--lag') {
      const v = args[++i];
      lagMs = v != null && v.trim() !== '' ? Number(v) : NaN;
      if (!(Math.abs(lagMs) < THRESHOLDS.maxLagMs)) { console.error(`parity: --lag ${v ?? ''}: a latency in milliseconds inside +-${THRESHOLDS.maxLagMs} (positive when B runs behind A)`); bad = true; }
    } else if (args[i].startsWith('--')) { console.error(`parity: unknown option ${args[i]}`); bad = true; }
    else files.push(args[i]);
  }
  if (bad || files.length !== 4) {
    console.error(usage);
    process.exit(2);
  }
  try {
    const r = parity(files, THRESHOLDS, { lagMs });
    console.log(json ? JSON.stringify(r, null, 2) : report(r));
    process.exitCode = r.pass ? 0 : 1;
  } catch (e) {
    if (!(e instanceof ParityError)) throw e;
    console.error(`parity: ${e.message}`);
    process.exitCode = 2;
  }
}
