// tools/mix.mjs: mix and master the piece's sound under its picture (plan section 9).
//
//   node tools/mix.mjs <name> [--vo vo.wav] [--bed bed.mp3] [--stem file[:gain[:delay_s]]]...
//                      [--bed-gain 0.22] [--sfx-gain 0.9] [--vo-gain 3.2] [--bed-skip s] [--bed-at s|cue:<id>]
//                      [--mute a-b[:ramp],...] [--no-bed] [--no-sfx] [--master-only | --sting]
//                      [--target-lufs -14] [--tp -2.0] [--keep-premix]
//
// Reads, in the piece (this tool's parent folder; relative paths resolve against it, like render.mjs):
//   out/<name>.mp4               the picture, from `node render.mjs video` or `full`
//   out/<name>.mp4.render.json   its render record (written by render.mjs; the mix refuses a picture without one)
//   out/<name>.wav               the synthesized effects, from `node render.mjs full` or `audio` (skip with --no-sfx)
//   vo.wav and cues.json         the voice and its VO_OFFSET, from tools/cues.mjs (default mode only)
//   bed.mp3                      a music bed, when there is one (--bed names another file, --no-bed leaves it out)
// and writes:
//   out/<name>-final.mp4         the master: the picture stream copied untouched, the mix as AAC 256 kb/s
//                                48 kHz, +faststart
//   out/<name>.master.json       what was mixed and how, with the hashes `check --file` uses to tie the master
//                                to its render (plan 11.2)
//   out/<name>.premix.wav        with --keep-premix: the mix before loudness normalization, 32-bit float
//                                48 kHz stereo, sample 0 = the first frame (for comparing two mixers)
//
// Modes and targets:
//   default        voice, an optional bed ducked under it, the effects, extra stems   -14 LUFS, -2.0 dBTP
//   --master-only  the synthesized effects alone (plus any --stem)                     -14 LUFS, -2.0 dBTP
//   --sting        the same, for an asset cut into someone else's video                -20 LUFS, -3.0 dBTP
//   --target-lufs and --tp override the mode's numbers. AAC adds about 0.5 dB of true peak, which is why
//   the targets sit under the -1.0 dBTP ceiling `check` enforces.
//
// The chain:
//   voice    measured (EBU R128 integrated) and levelled to -24 LUFS, then x --vo-gain (3.2), delayed by
//            VO_OFFSET from cues.json. A take quieter than -50 LUFS stops the mix (it would get ~+56 dB).
//   bed      x --bed-gain (0.22); skips --bed-skip seconds of its start; starts so its end lands on the last
//            frame (at 0 when it is longer than the picture), or at --bed-at (seconds of picture time, or
//            cue:<id> = VO_OFFSET + that beat's cue); fades out 0.35 s where it stops when it is shorter than
//            the picture, 2.6 s when it is longer; silent over each --mute window a-b (picture time), with a
//            linear ramp (default 0.05 s) down before a and up after b; ducked by the voice through a
//            sidechain compressor (threshold 0.02, ratio 5, attack 25 ms, release 350 ms).
//   effects  x --sfx-gain (0.9; 1.0 in --master-only and --sting, where there is nothing to balance against).
//   stems    --stem file:gain:delay, x gain (default 1), starting delay seconds into the picture (default 0).
//   Every stem is decoded to 48 kHz stereo (ffmpeg's own up/downmix), cut or padded to the picture's length,
//   summed without normalization, limited at -6 dBFS (alimiter, attack 5 ms and release 60 ms as in the mixer this
//   was ported from, its 5 ms lookahead compensated so the mix stays on the picture), then normalized in two
//   passes (loudnorm at the target, LRA 11, linear when the true peak allows it).
// It checks every input before it writes anything, and replaces the last master and its master.json only
// once the new master is encoded and measured, so a refusal or a failed run leaves them as they were. The defaults (bed 0.22, effects 0.9, voice 3.2 after levelling) are a starting point, not a rule.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SR = 48000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MODES = {
  default: { lufs: -14, tp: -2.0 },
  'master-only': { lufs: -14, tp: -2.0 },
  sting: { lufs: -20, tp: -3.0 },
};
export const DEFAULTS = {
  bedGain: 0.22, sfxGain: 0.9, sfxGainSolo: 1.0, voGain: 3.2,
  voLevel: -24, voFloor: -50,                 // LUFS: the voice is levelled to voLevel; quieter than voFloor stops the mix
  fadeShort: 0.35, fadeLong: 2.6, muteRamp: 0.05,
  duck: { threshold: 0.02, ratio: 5, attack: 25, release: 350 },
  limit: -6, limitAttack: 5, limitRelease: 60, lra: 11,
};

// A refusal: every reason at once, so they can all be fixed in one go.
export class MixError extends Error {
  constructor(problems) { const list = [].concat(problems); super(list.join('\n')); this.problems = list; }
}
class UsageError extends Error {}

const fmt = (x, d = 3) => (x == null || !Number.isFinite(x) ? String(x) : Number(x).toFixed(d));
const dbFmt = (x) => (x >= 0 ? '+' : '') + fmt(x, 1);
const lin = (db) => Math.pow(10, db / 20);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));
const rel = (f) => path.relative(ROOT, f) || f;

// ---------------------------------------------------------------- arguments

const VALUE_OPTS = new Set(['vo', 'bed', 'stem', 'bed-gain', 'sfx-gain', 'vo-gain', 'bed-skip', 'bed-at', 'mute', 'target-lufs', 'tp']);
const FLAG_OPTS = new Set(['no-bed', 'no-sfx', 'master-only', 'sting', 'keep-premix', 'help']);
export function parseArgs(argv) {
  const o = { _: [], stem: [], mute: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') { o.help = true; continue; }
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (FLAG_OPTS.has(k)) { o[k] = true; continue; }
    if (!VALUE_OPTS.has(k)) throw new UsageError(`unknown option ${a}`);
    const v = argv[i + 1];
    if (v == null || v.startsWith('--')) throw new UsageError(`${a} needs a value`);
    i++;
    if (k === 'stem' || k === 'mute') o[k].push(v);
    else if (k in o) throw new UsageError(`${a} given twice`);
    else o[k] = v;
  }
  return o;
}
function num(o, k, { min = -Infinity, max = Infinity, def } = {}) {
  if (o[k] == null) return def;
  const x = Number(o[k]);
  if (o[k] === '' || !Number.isFinite(x) || x < min || x > max) {
    throw new UsageError(`--${k} ${o[k]}: needs a number${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''}`);
  }
  return x;
}
// --mute 3.2-4.0,7.5-8.1:0.2 (repeatable): [{ a, b, ramp }] in seconds of picture time
export function parseMutes(list, defRamp = DEFAULTS.muteRamp) {
  const out = [];
  for (const spec of list) for (const part of spec.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/);
    if (!m) throw new UsageError(`--mute ${part}: expected a-b or a-b:ramp in seconds, e.g. 4.0-5.2 or 4.0-5.2:0.1`);
    const a = +m[1], b = +m[2], ramp = m[3] != null ? +m[3] : defRamp;
    if (!(b > a)) throw new UsageError(`--mute ${part}: the window must end after it starts`);
    out.push({ a, b, ramp });
  }
  return out.sort((x, y) => x.a - y.a);
}
// --stem file[:gain[:delay_s]]
export function parseStem(spec) {
  const parts = spec.split(':');
  if (parts.length > 3 || !parts[0]) throw new UsageError(`--stem ${spec}: expected file, file:gain or file:gain:delay_s`);
  const gain = parts[1] != null && parts[1] !== '' ? Number(parts[1]) : 1, delay = parts[2] != null && parts[2] !== '' ? Number(parts[2]) : 0;
  if (!Number.isFinite(gain) || gain < 0) throw new UsageError(`--stem ${spec}: the gain must be a number of 0 or more`);
  if (!Number.isFinite(delay) || delay < 0) throw new UsageError(`--stem ${spec}: the delay must be 0 or more seconds`);
  return { file: parts[0], gain, delay };
}

// ---------------------------------------------------------------- audio

// Any file ffmpeg reads, its first audio stream as interleaved 48 kHz stereo float. Mono is spread to both
// channels at -3 dB each (ffmpeg's own upmix), which keeps its EBU R128 loudness unchanged.
export function decode(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-vn', '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.error) throw new MixError(`could not run ffmpeg to read ${rel(file)}: ${r.error.message}`);
  if (r.status !== 0) throw new MixError(`ffmpeg could not read the audio of ${rel(file)}: ${String(r.stderr).trim().split('\n').pop()}`);
  const b = r.stdout;
  if (b.byteOffset % 4 === 0) return new Float32Array(b.buffer, b.byteOffset, b.length >> 2);
  return new Float32Array(new Uint8Array(b).buffer, 0, b.length >> 2);
}
// Interleaved stereo float -> a 32-bit float WAV (WAVE_FORMAT_IEEE_FLOAT, with its fact chunk).
export function wavStereo(samples, sr = SR) {
  const n = samples.length, head = Buffer.alloc(58);
  head.write('RIFF', 0); head.writeUInt32LE(50 + n * 4, 4); head.write('WAVE', 8);
  head.write('fmt ', 12); head.writeUInt32LE(18, 16); head.writeUInt16LE(3, 20); head.writeUInt16LE(2, 22);
  head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 8, 28); head.writeUInt16LE(8, 32); head.writeUInt16LE(32, 34); head.writeUInt16LE(0, 36);
  head.write('fact', 38); head.writeUInt32LE(4, 42); head.writeUInt32LE(n / 2, 46);
  head.write('data', 50); head.writeUInt32LE(n * 4, 54);
  return Buffer.concat([head, Buffer.from(samples.buffer, samples.byteOffset, n * 4)]);
}
// `src` (interleaved stereo) x gain, starting `at` frames into a stereo buffer of `frames` frames; whatever
// falls outside is cut. Returns how many of the source's frames ran past the end.
function placeInto(dst, src, gain, at, frames, from = 0) {
  let past = 0;
  for (let k = from; k < src.length >> 1; k++) {
    const j = at + k - from;
    if (j < 0) continue;
    if (j >= frames) { past = (src.length >> 1) - k; break; }
    dst[2 * j] += src[2 * k] * gain; dst[2 * j + 1] += src[2 * k + 1] * gain;
  }
  return past;
}

// EBU R128 (ffmpeg ebur128): integrated loudness, loudness range, and true peak when asked.
export function loudness(file, { peak = false } = {}) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', `ebur128=framelog=verbose${peak ? ':peak=true' : ''}`, '-f', 'null', '-'],
    { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.status !== 0) throw new MixError(`ffmpeg could not measure ${rel(file)}: ${String(r.stderr).trim().split('\n').pop()}`);
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const val = (re) => { const m = s.match(re); return !m ? NaN : m[1] === '-inf' ? -Infinity : +m[1]; };
  return {
    lufs: val(/I:\s+(-?[\d.]+|-inf)\s+LUFS/), lra: val(/LRA:\s+(-?[\d.]+|-inf)\s+LU/),
    ...(peak ? { tp: val(/True peak:\s+Peak:\s+(-?[\d.]+|-inf)\s+dBFS/) } : {}),
  };
}
const loudnormJson = (stderr) => { const m = String(stderr).match(/\{[^{}]*"input_i"[^{}]*\}/); return m ? JSON.parse(m[0]) : null; };
function run(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.error) throw new MixError(`could not run ffmpeg (${what}): ${r.error.message}`);
  if (r.status !== 0) throw new MixError(`ffmpeg failed (${what}): ${String(r.stderr).trim().split('\n').slice(-3).join(' | ')}`);
  return r.stderr;
}
function decodedVideoHash(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' });
  const m = r.status === 0 && r.stdout.match(/SHA256=([0-9a-f]{64})/);
  if (!m) throw new MixError(`could not hash the decoded video of ${rel(file)}: ${r.stderr || r.error}`);
  return 'sha256:' + m[1];
}

// ---------------------------------------------------------------- the bed

// Where the bed goes and how loud it is at each frame of the picture. frames: the picture's length; bedFrames:
// the bed's own length. Returns { start, skip, end, fade, longer, endOnLast, cut } in frames (start may be
// past 0 only, never negative) and gainAt(j), the bed's gain at picture frame j (bedGain x fade x mutes).
export function bedPlan({ frames, bedFrames, skip = 0, at = null, gain = DEFAULTS.bedGain, mutes = [], sr = SR }) {
  const len = bedFrames - skip;                         // the bed after the skip
  const longer = len > frames;
  const start = at != null ? Math.round(at * sr) : Math.max(0, frames - len);
  const end = Math.min(start + len, frames);            // where it stops in the picture
  const fadeSec = longer ? DEFAULTS.fadeLong : DEFAULTS.fadeShort, fade = Math.round(fadeSec * sr);
  const ms = mutes.map((m) => ({ a: Math.round(m.a * sr), b: Math.round(m.b * sr), r: Math.max(0, Math.round(m.ramp * sr)) }));
  const gainAt = (j) => {
    if (j < start || j >= end) return 0;
    let g = gain * Math.min(1, (end - j) / fade);        // linear fade out, reaching 0 at `end`
    for (const m of ms) {
      if (j >= m.a && j < m.b) return 0;
      if (m.r && j >= m.a - m.r && j < m.a) g *= (m.a - j) / m.r;       // ramp down into the window
      else if (m.r && j >= m.b && j < m.b + m.r) g *= (j - m.b) / m.r;  // ramp up out of it
    }
    return g;
  };
  return { start, skip, len, end, fade, fadeSec, longer, endOnLast: start + len === frames, cut: start + len > frames, gainAt };
}

// ---------------------------------------------------------------- the mix

export function mixPiece(argv, log = console.log) {
  const o = parseArgs(argv);
  if (o.help) { log('usage: node tools/mix.mjs <name> [options]  (see the header of tools/mix.mjs)'); return { help: true }; }
  if (o._.length !== 1) throw new UsageError('give one piece name: node tools/mix.mjs <name> (the picture is out/<name>.mp4)');
  const name = o._[0];
  if (!/^[\w][\w.-]*$/.test(name)) throw new UsageError(`${name}: a name, not a path (the picture is out/<name>.mp4)`);
  if (o['master-only'] && o.sting) throw new UsageError('--master-only and --sting are two different modes: pick one');
  const mode = o.sting ? 'sting' : o['master-only'] ? 'master-only' : 'default';
  const voiced = mode === 'default';
  if (!voiced) {
    const wrong = ['vo', 'bed', 'vo-gain', 'bed-gain', 'bed-skip', 'bed-at'].filter((k) => o[k] != null).map((k) => '--' + k).concat(o.mute.length ? ['--mute'] : []);
    if (wrong.length) throw new UsageError(`--${mode} masters the synthesized effects alone (plus any --stem): ${wrong.join(', ')} ${wrong.length > 1 ? 'do' : 'does'} not apply`);
  }
  const target = { lufs: num(o, 'target-lufs', { min: -70, max: -5, def: MODES[mode].lufs }), tp: num(o, 'tp', { min: -9, max: 0, def: MODES[mode].tp }), lra: DEFAULTS.lra };
  const voGain = num(o, 'vo-gain', { min: 0, def: DEFAULTS.voGain });
  const bedGain = num(o, 'bed-gain', { min: 0, def: DEFAULTS.bedGain });
  const sfxGain = num(o, 'sfx-gain', { min: 0, def: voiced ? DEFAULTS.sfxGain : DEFAULTS.sfxGainSolo });
  const bedSkip = num(o, 'bed-skip', { min: 0, def: 0 });
  const mutes = parseMutes(o.mute);
  const stems = o.stem.map(parseStem);
  const bedAtSpec = o['bed-at'] != null ? String(o['bed-at']) : null;
  if (bedAtSpec != null && !/^cue:./.test(bedAtSpec)) num(o, 'bed-at', { min: 0 });

  // ---- every input, checked before anything is written
  const problems = [], notes = [];
  const P = (f) => path.resolve(ROOT, f);
  const picture = P(`out/${name}.mp4`), recFile = picture + '.render.json';
  const master = P(`out/${name}-final.mp4`), masterJson = P(`out/${name}.master.json`), premixOut = P(`out/${name}.premix.wav`);
  let rec = null;
  if (!fs.existsSync(picture)) problems.push(`no picture out/${name}.mp4: render it first (node render.mjs full --out out/${name}.mp4)`);
  else if (!fs.existsSync(recFile)) problems.push(`no render record out/${name}.mp4.render.json beside the picture: render it with this piece's render.mjs (video or full)`);
  else {
    try { rec = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch (e) { problems.push(`out/${name}.mp4.render.json is not JSON: ${e.message}`); }
    if (rec) {
      if (rec.sha256 !== sha256File(picture)) problems.push(`out/${name}.mp4 changed after the render that out/${name}.mp4.render.json describes: render it again`);
      if (!(rec.frames > 0) || !(rec.fps > 0)) problems.push(`out/${name}.mp4.render.json has no frame count or fps`);
      if (rec.from && rec.from > 0) problems.push(`out/${name}.mp4 is a partial render (from ${rec.from} s): mix a render that starts at the first frame`);
    }
  }
  const sfxFile = P(`out/${name}.wav`);
  const useSfx = !o['no-sfx'];
  if (useSfx && !fs.existsSync(sfxFile)) problems.push(`no effects stem out/${name}.wav: render it (node render.mjs full, or audio --out out/${name}.wav), or mix without it (--no-sfx)`);
  let cues = null, cuesFile = P('cues.json');
  const needCues = voiced || (bedAtSpec && bedAtSpec.startsWith('cue:'));
  if (needCues) {
    if (!fs.existsSync(cuesFile)) problems.push('no cues.json: run tools/cues.mjs first (the voice delay is its VO_OFFSET)');
    else {
      try { cues = JSON.parse(fs.readFileSync(cuesFile, 'utf8')); } catch (e) { problems.push(`cues.json is not JSON: ${e.message}`); }
      if (cues && !(Number.isFinite(cues.VO_OFFSET) && cues.VO_OFFSET >= 0)) problems.push('cues.json has no VO_OFFSET (run tools/cues.mjs again)');
    }
  }
  const voFile = voiced ? P(o.vo || 'vo.wav') : null;
  if (voiced && !fs.existsSync(voFile)) problems.push(`no voice ${rel(voFile)}: run tools/cues.mjs (it writes vo.wav), pass --vo <file>, or master the effects alone (--master-only)`);
  let bedFile = null;
  if (voiced && !o['no-bed']) {
    if (o.bed) { bedFile = P(o.bed); if (!fs.existsSync(bedFile)) problems.push(`no bed ${rel(bedFile)}`); }
    else if (fs.existsSync(P('bed.mp3'))) bedFile = P('bed.mp3');
  }
  if (!bedFile) {
    const bedOnly = ['bed-gain', 'bed-skip', 'bed-at'].filter((k) => o[k] != null).map((k) => '--' + k).concat(mutes.length ? ['--mute'] : []);
    if (voiced && bedOnly.length) notes.push(`no bed in this mix, so ${bedOnly.join(', ')} ${bedOnly.length > 1 ? 'do' : 'does'} nothing`);
  }
  let bedAt = null;
  if (bedAtSpec && bedFile) {
    if (bedAtSpec.startsWith('cue:')) {
      const id = bedAtSpec.slice(4);
      if (cues && !(cues.CUE && Object.prototype.hasOwnProperty.call(cues.CUE, id) && Number.isFinite(cues.CUE[id]))) {
        problems.push(`--bed-at ${bedAtSpec}: cues.json has no cue "${id}" (it has: ${Object.keys((cues && cues.CUE) || {}).join(', ') || 'none'})`);
      } else if (cues) bedAt = cues.VO_OFFSET + cues.CUE[id];
    } else bedAt = Number(bedAtSpec);
  }
  const stemFiles = stems.map((s) => ({ ...s, path: P(s.file) }));
  for (const s of stemFiles) if (!fs.existsSync(s.path)) problems.push(`no stem ${rel(s.path)}`);
  if (!voiced && !useSfx && !stemFiles.length) problems.push(`--${mode} with --no-sfx and no --stem: there is nothing to master`);
  if (problems.length) throw new MixError(problems);

  const frames = Math.round((rec.frames / rec.fps) * SR), dur = frames / SR;
  const vOffset = voiced ? cues.VO_OFFSET : null;
  if (bedAt != null && Math.round(bedAt * SR) >= frames) throw new MixError(`--bed-at ${bedAtSpec} puts the bed at ${fmt(bedAt)} s, at or after the picture's end (${fmt(dur)} s)`);
  for (const m of mutes) if (m.a >= dur) notes.push(`--mute ${m.a}-${m.b} starts after the picture's end (${fmt(dur)} s)`);
  log(`mix: ${name}, ${mode} mode: ${target.lufs} LUFS, ${fmt(target.tp, 1)} dBTP; picture ${fmt(dur)} s (${rec.frames} frames at ${rec.fps} fps)`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-mix-'));
  try {
    const inputs = [];
    const stemRecord = [];
    const tmpWav = (n, data) => { const f = path.join(tmp, n + '.wav'); fs.writeFileSync(f, wavStereo(data)); return f; };
    // Stems go into the ffmpeg graph with a second of zeros after the picture's end: the sidechain path drops its
    // last few buffers at the end of a stream, and without the pad the bed would stop short of the last frame.
    // The graph trims the premix back to the picture's length.
    const padded = (buf) => { const out = new Float32Array(buf.length + 2 * SR); out.set(buf); return out; };

    // ---- voice: level, gain, delay
    let voice = null;
    if (voiced) {
      const v = decode(voFile);
      const raw = tmpWav('voice-in', v);
      const L = loudness(raw);
      if (!(L.lufs >= DEFAULTS.voFloor)) {
        throw new MixError(`the voice ${rel(voFile)} measures ${fmt(L.lufs, 1)} LUFS, quieter than ${DEFAULTS.voFloor} LUFS: levelling it to ${DEFAULTS.voLevel} LUFS would add ${Number.isFinite(L.lufs) ? fmt(DEFAULTS.voLevel - L.lufs, 1) + ' dB' : 'unbounded gain'}. Is it the right file?`);
      }
      const levelDb = DEFAULTS.voLevel - L.lufs, g = lin(levelDb) * voGain, delay = Math.round(vOffset * SR);
      const buf = new Float32Array(frames * 2);
      const past = placeInto(buf, v, g, delay, frames);
      if (past > 0) notes.push(`the voice runs ${fmt(past / SR, 2)} s past the picture's end and is cut there`);
      voice = { buf, lufs: L.lufs, levelDb, gain: voGain, delay: vOffset, delayFrames: delay };
      log(`  voice   ${rel(voFile)}: ${fmt(L.lufs, 1)} LUFS -> ${DEFAULTS.voLevel} LUFS (${dbFmt(levelDb)} dB), x${voGain} (${dbFmt(20 * Math.log10(Math.max(voGain, 1e-9)))} dB); starts at ${fmt(vOffset)} s (VO_OFFSET, cues.json)`);
      stemRecord.push({ role: 'voice', file: rel(voFile), sha256: sha256File(voFile), gain: voGain, delay: vOffset, measuredLufs: L.lufs, levelDb });
    }

    // ---- bed: skip, place, fade, mute, gain
    let bed = null;
    if (bedFile) {
      const b = decode(bedFile), bedFrames = b.length >> 1, skip = Math.round(bedSkip * SR);
      if (skip >= bedFrames) throw new MixError(`--bed-skip ${bedSkip} skips past the end of ${rel(bedFile)} (${fmt(bedFrames / SR, 2)} s long)`);
      const plan = bedPlan({ frames, bedFrames, skip, at: bedAt, gain: bedGain, mutes });
      const buf = new Float32Array(frames * 2);
      for (let j = Math.max(0, plan.start); j < plan.end; j++) {
        const k = skip + j - plan.start, g = plan.gainAt(j);
        if (g) { buf[2 * j] = b[2 * k] * g; buf[2 * j + 1] = b[2 * k + 1] * g; }
      }
      bed = { buf, plan };
      const where = bedAt != null ? `at ${fmt(bedAt)} s (--bed-at ${bedAtSpec})` : plan.longer ? 'at 0 (it is longer than the picture)' : `at ${fmt(plan.start / SR)} s, so its end lands on the last frame`;
      log(`  bed     ${rel(bedFile)} x${bedGain}: ${fmt(plan.len / SR, 2)} s after a ${fmt(skip / SR, 2)} s skip; starts ${where}; ${plan.cut ? `cut at ${fmt(plan.end / SR)} s` : `ends at ${fmt(plan.end / SR)} s`} with a ${plan.fadeSec} s fade (${plan.longer ? 'longer' : 'shorter'} than the picture)${mutes.length ? '; muted ' + mutes.map((m) => `${m.a}-${m.b}`).join(', ') : ''}; ducked under the voice`);
      stemRecord.push({ role: 'bed', file: rel(bedFile), sha256: sha256File(bedFile), gain: bedGain, skip: bedSkip,
        start: plan.start / SR, at: bedAtSpec, end: plan.end / SR, fade: plan.fadeSec, longer: plan.longer, endOnLastFrame: plan.endOnLast, mutes });
    }

    // ---- effects and extra stems, summed into one bus
    let rest = null;
    const addRest = (src, gain, at) => { if (!rest) rest = new Float32Array(frames * 2); return placeInto(rest, src, gain, at, frames); };
    if (useSfx) {
      const s = decode(sfxFile);
      const past = addRest(s, sfxGain, 0);
      if (past > 0) notes.push(`out/${name}.wav runs ${fmt(past / SR, 2)} s past the picture's end and is cut there`);
      log(`  effects out/${name}.wav x${sfxGain}`);
      stemRecord.push({ role: 'effects', file: rel(sfxFile), sha256: sha256File(sfxFile), gain: sfxGain, delay: 0 });
    } else log('  effects none (--no-sfx)');
    for (const s of stemFiles) {
      const past = addRest(decode(s.path), s.gain, Math.round(s.delay * SR));
      if (past > 0) notes.push(`stem ${rel(s.path)} runs ${fmt(past / SR, 2)} s past the picture's end and is cut there`);
      log(`  stem    ${rel(s.path)} x${s.gain}, starting at ${fmt(s.delay)} s`);
      stemRecord.push({ role: 'stem', file: rel(s.path), sha256: sha256File(s.path), gain: s.gain, delay: s.delay });
    }

    // ---- the premix: duck, sum, limit (ffmpeg); written as float so nothing clips before the normalization
    const lab = {};
    if (voice) { lab.vo = `${inputs.length}:a`; inputs.push(tmpWav('voice', padded(voice.buf))); }
    if (bed) { lab.bed = `${inputs.length}:a`; inputs.push(tmpWav('bed', padded(bed.buf))); }
    if (rest) { lab.rest = `${inputs.length}:a`; inputs.push(tmpWav('rest', padded(rest))); }
    const graph = [], parts = [];
    const d = DEFAULTS.duck;
    if (voice && bed) {
      graph.push(`[${lab.vo}]asplit=2[vo][sc]`, `[${lab.bed}][sc]sidechaincompress=threshold=${d.threshold}:ratio=${d.ratio}:attack=${d.attack}:release=${d.release}[bed]`);
      parts.push('[vo]', '[bed]');
    } else {
      if (voice) parts.push(`[${lab.vo}]`);
      if (bed) parts.push(`[${lab.bed}]`);
    }
    if (rest) parts.push(`[${lab.rest}]`);
    const sum = parts.length > 1 ? `${parts.join('')}amix=inputs=${parts.length}:normalize=0:duration=first` : `${parts[0]}anull`;
    graph.push(`${sum},alimiter=limit=${fmt(lin(DEFAULTS.limit), 6)}:attack=${DEFAULTS.limitAttack}:release=${DEFAULTS.limitRelease}:level=0:latency=1,atrim=end_sample=${frames},aformat=sample_fmts=flt:sample_rates=${SR}:channel_layouts=stereo[out]`);
    const premix = o['keep-premix'] ? premixOut + `.tmp-${process.pid}.wav` : path.join(tmp, 'premix.wav');
    run(['-y', ...inputs.flatMap((f) => ['-i', f]), '-filter_complex', graph.join(';'), '-map', '[out]', '-c:a', 'pcm_f32le', premix], 'premix');

    // ---- two-pass loudness normalization, under the copied picture
    const ln = `loudnorm=I=${target.lufs}:TP=${target.tp}:LRA=${target.lra}`;
    const m1 = loudnormJson(run(['-i', premix, '-af', `${ln}:print_format=json`, '-f', 'null', '-'], 'loudness, first pass'));
    if (!m1) throw new MixError('loudnorm printed no measurement on its first pass');
    const preI = +m1.input_i, preTp = +m1.input_tp;
    log(`  premix  ${fmt(preI, 1)} LUFS, ${fmt(preTp, 1)} dBTP, LRA ${fmt(+m1.input_lra, 1)} LU (limited at ${DEFAULTS.limit} dBFS)`);
    if (!(preI > -70)) throw new MixError(`the mix is silent (${m1.input_i} LUFS): there is nothing to normalize`);
    const ln2 = `${ln}:measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}:linear=true:print_format=json`;
    const tmpMaster = path.join(tmp, 'master.mp4');
    const m2 = loudnormJson(run(['-y', '-i', picture, '-i', premix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-filter:a', `${ln2},aresample=${SR},atrim=end_sample=${frames}`, '-c:a', 'aac', '-b:a', '256k', '-ar', String(SR),
      '-movflags', '+faststart', tmpMaster], 'master'));
    const M = loudness(tmpMaster, { peak: true });
    log(`  master  ${rel(master)}: ${fmt(M.lufs, 1)} LUFS, ${fmt(M.tp, 1)} dBTP, LRA ${fmt(M.lra, 1)} LU (loudnorm ${m2 ? m2.normalization_type : '?'})`);
    if (Math.abs(M.lufs - target.lufs) > 1) notes.push(`WARN the master is ${fmt(M.lufs, 1)} LUFS, more than 1 LU from the ${target.lufs} LUFS target`);
    if (M.tp > -1.0) notes.push(`WARN the master's true peak is ${fmt(M.tp, 1)} dBTP, over the -1.0 dBTP ceiling check uses`);
    const vHash = decodedVideoHash(tmpMaster), masterSha = sha256File(tmpMaster);
    if (rec.video && rec.video.hash && rec.video.hash !== vHash) notes.push('WARN the master\'s decoded video does not hash the same as its render\'s (render.json); check --file will report it');

    // Everything is measured; only now are the old outputs replaced. The old master.json goes first, so an
    // interrupted copy never leaves a record beside a master it does not describe.
    fs.rmSync(masterJson, { force: true });
    fs.copyFileSync(tmpMaster, master);
    if (o['keep-premix']) fs.renameSync(premix, premixOut);
    else fs.rmSync(premixOut, { force: true });   // an old premix would describe another mix

    const record = {
      format: 'sabotage-motion/master@1',
      created: new Date().toISOString(),
      name, mode,
      target,
      voiceDelay: voiced ? vOffset : null,          // seconds of picture time: cues.json's VO_OFFSET, applied once, here
      master: { file: rel(master), sha256: masterSha, video: { hash: vHash }, frames: rec.frames, fps: rec.fps, samples: frames },
      render: { file: rel(recFile), sha256: sha256File(recFile) },
      picture: { file: rel(picture), sha256: rec.sha256 },
      cues: cues ? { file: rel(cuesFile), sha256: sha256File(cuesFile), VO_OFFSET: cues.VO_OFFSET } : null,
      stems: stemRecord,
      chain: { voLevel: DEFAULTS.voLevel, duck: bed && voice ? d : null, limit: DEFAULTS.limit, limitAttack: DEFAULTS.limitAttack, limitRelease: DEFAULTS.limitRelease, lra: target.lra, loudnorm: m2 ? m2.normalization_type : null },
      measured: {
        voice: voice ? { lufs: voice.lufs, levelDb: voice.levelDb } : null,
        premix: { lufs: preI, tp: preTp, lra: +m1.input_lra, thresh: +m1.input_thresh },
        master: { lufs: M.lufs, tp: M.tp, lra: M.lra },
      },
      premix: o['keep-premix'] ? { file: rel(premixOut), sha256: sha256File(premixOut) } : null,
    };
    const tmpJson = `${masterJson}.tmp-${process.pid}`;
    fs.writeFileSync(tmpJson, JSON.stringify(record, null, 2) + '\n');
    fs.renameSync(tmpJson, masterJson);
    for (const n of notes) log(`  ${n.startsWith('WARN') ? '' : 'note: '}${n}`);
    log(`wrote ${[rel(master), rel(masterJson), ...(o['keep-premix'] ? [rel(premixOut)] : [])].join(', ')}`);
    return { record, notes };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    if (o['keep-premix']) fs.rmSync(premixOut + `.tmp-${process.pid}.wav`, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    mixPiece(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) { console.error(`mix: ${e.message}\nusage: node tools/mix.mjs <name> [options]  (see the header of tools/mix.mjs)`); process.exitCode = 2; }
    else if (e instanceof MixError) {
      console.error('mix: refused:');
      for (const p of e.problems) console.error(`  - ${p}`);
      process.exitCode = 1;
    } else throw e;
  }
}
