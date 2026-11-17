// tools/clip.mjs: caption a clip (plan 23.5). The clip is never re-encoded through the browser: the captions render
// with alpha on the clip's own clock (caption.js), and ffmpeg lays them over the clip.
//
//   node tools/clip.mjs probe <clip>                      what the clip is: display size (after its pixels' aspect and
//                                                         rotation), frame rate (constant or variable), frames, length,
//                                                         and every audio stream when there is more than one
//   node tools/clip.mjs prepare <clip> [--audio <n>] [--board] [--target <name>] [--title <text>]
//                       [--transcript <file> [--from words|whisper|whispercpp|srt|vtt] [--raw-track | --transcript-offset <s>]]
//   node tools/clip.mjs cues --transcript <file> [--from kind] [--raw-track | --transcript-offset <s>]
//   node tools/clip.mjs composite <name> [--overlay out/<name>.mov]
//
// One clock (plan 23.5): the clip's first frame is time 0 for the picture, the captions, vo.wav and the master.
// prepare: reads the clip and, only when every check passes, writes into the piece (this tool's parent folder):
//   clip.<ext>   the clip, copied; converted instead (clip.mp4) when its frame rate is variable (to its average rate
//                rounded to the nearest of 23.976, 24, 25, 29.97, 30, 50, 59.94 and 60) or its pixels are not square
//                (to square pixels at its display size), and it says so
//   clip.js      CLIP: the clip's file and SHA-256, display size, constant frame rate (fps, and fpsRational as ffmpeg
//                writes it), frames, length (frames / fps), its sound (which stream, where it starts), and where it came
//                from (a conversion, the source's audio offset)
//   vo.wav       the chosen audio stream (--audio <n>, 0 by default; prepare says which) from the clip's first video frame
//                to its last, 48 kHz 32-bit float: sound that starts after the picture is delayed by that much, sound that
//                starts before it is cut. The mix's voice
//   out/vo16k.wav  the same sound at 16 kHz mono 16-bit, for whisper-cli: a transcript of it is on the clip's clock
//   board.js     with --board: a single silent beat of the clip's length (so boardTiming adds no lead or tail), its
//                target (--target, else from the clip's shape: 9:16 tiktok, 16:9 youtube, 1:1 square, 4:5 feed45, else
//                none). Without --board the board must already be one silent beat of the clip's length.
//   cues.js, cues.json   with --transcript (or later with `cues`): the transcript's words on the clip's clock, VO_OFFSET
//                0, no CUE, no gaps (not through tools/cues.mjs, which needs a voiced board). Words an SRT or WebVTT phrase
//                was spread over are marked `est: true`, and it says how many. Without a transcript, an old cues.js is removed.
// A transcript of vo.wav (or out/vo16k.wav) or one timed to the picture (an editor's SRT) needs no shift. One made from
// the clip's raw audio track, when the sound starts more than a frame away from the first video frame (prepare and probe
// say so), is moved onto the clip's clock with --raw-track (by the sound's offset) or --transcript-offset <s>.
// The transcript format comes from --from, else its extension (.srt, .vtt) or, for JSON, its shape (whisper.cpp's
// transcription[], openai-whisper's segments[], the generic words[]). whisper.cpp's whisper-cli, when installed, makes
// one: whisper-cli -m <model> -f out/vo16k.wav -oj -ml 1 -sow -of out/vo16k (render.mjs doctor reports whether it is installed).
//
// composite: lays out/<name>.mov (or .webm) over the clip into an opaque yuv420p out/<name>.mp4, frame for frame, and
// writes out/<name>.mp4.render.json: the render@1 fields the mixer and check read, with `source`, scene, params and the
// look copied from the overlay's record, plus kind: "composite", clip (the clip's SHA-256), clipFile, overlay (the
// overlay record's SHA-256) and overlayFile. It refuses an overlay whose record is missing, does not match the file,
// is not alpha, is not on the clip's clock (fps, frames, size), or was rendered from another source (a stale overlay);
// a clip that changed since prepare; and a vo.wav that is not the clip's sound. Then: node tools/mix.mjs <name> --no-sfx.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeTake, cuesModuleText, CueError, TEXT_KINDS } from './cues.mjs';
import { boardKey, boardProblems } from '../lib.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SR = 48000;
// The constant rates a variable-rate clip is converted to: [rate, ffmpeg's rational].
export const RATES = [[24000 / 1001, '24000/1001'], [24, '24/1'], [25, '25/1'], [30000 / 1001, '30000/1001'], [30, '30/1'], [50, '50/1'], [60000 / 1001, '60000/1001'], [60, '60/1']];
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const fmt = (x, d = 3) => Number(x).toFixed(d);
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));
const rel = (f) => path.relative(ROOT, f) || f;

// A refusal: every reason at once.
export class ClipError extends Error {
  constructor(problems) { const list = [].concat(problems); super(list.join('\n')); this.problems = list; }
}

// ---------------------------------------------------------------- probe

const ratio = (s) => { const [p, q] = String(s || '').split('/').map(Number); return q ? p / q : p; };
// The constant rate nearest a measured average: [rate, rational].
export const nearestRate = (avg) => RATES.reduce((b, x) => (Math.abs(x[0] - avg) < Math.abs(b[0] - avg) ? x : b));
// Variable frame rate, from the packets' presentation times: any interval between consecutive frames more than 25%
// away from the median interval. intervals: seconds. Returns { vfr, median, avg } (avg: frames over their span).
export function rateOf(pts) {
  const t = [...pts].filter(Number.isFinite).sort((a, b) => a - b);
  if (t.length < 2) return { vfr: false, median: null, avg: null };
  const d = t.slice(1).map((x, i) => x - t[i]).filter((x) => x > 1e-9);
  const s = [...d].sort((a, b) => a - b), median = s[Math.floor(s.length / 2)];
  const vfr = d.some((x) => Math.abs(x - median) > 0.25 * median) || d.length < t.length - 1;
  return { vfr, median, avg: (t.length - 1) / (t[t.length - 1] - t[0]) };
}
// The rotation a phone records in a clip's metadata (display matrix side data, or the older rotate tag), in degrees.
function rotationOf(v) {
  const sd = (v.side_data_list || []).find((x) => x.rotation != null);
  if (sd) return ((Math.round(+sd.rotation) % 360) + 360) % 360;
  const tag = v.tags && v.tags.rotate;
  return tag != null ? ((Math.round(+tag) % 360) + 360) % 360 : 0;
}
// A stream's sample aspect ratio as [num, den], or null when its pixels are square or it does not say.
export function sarOf(v) {
  const m = String(v.sample_aspect_ratio || '').match(/^(\d+):(\d+)$/);
  if (!m || +m[1] === 0 || +m[2] === 0 || +m[1] === +m[2]) return null;
  return [+m[1], +m[2]];
}
// The display size of a stream: its stored size, widened (or narrowed) by its pixels' aspect ratio, then turned by
// its rotation. Returns [w, h].
export function displaySize(cw, ch, sar, rot) {
  const w = sar ? Math.round((cw * sar[0]) / sar[1]) : cw;
  return rot === 90 || rot === 270 ? [ch, w] : [w, ch];
}
// opts.audio: which audio stream is the clip's sound (0 = the first; prepare's --audio).
export function probeClip(file, opts = {}) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ClipError(`no clip ${file}`);
  const q = (args) => spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const a = q(['-show_streams', '-show_format']);
  if (a.error) throw new ClipError(`could not run ffprobe: ${a.error.message}`);
  if (a.status !== 0) throw new ClipError(`ffprobe could not read ${path.basename(file)}: ${String(a.stderr).trim().split('\n').pop()}`);
  const j = JSON.parse(a.stdout || '{}'), streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const auds = streams.filter((s) => s.codec_type === 'audio'), ai = opts.audio || 0, au = auds[ai];
  if (ai && !au) throw new ClipError(`${path.basename(file)} has ${auds.length} audio stream${auds.length === 1 ? '' : 's'}: --audio ${ai} is not one of them (0 is the first)`);
  if (!v) throw new ClipError(`${path.basename(file)} has no video stream`);
  const p = q(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-show_packets']);
  const pts = ((JSON.parse(p.stdout || '{}').packets) || []).map((x) => +x.pts_time);
  const rate = rateOf(pts), rot = rotationOf(v), sar = sarOf(v), [dw, dh] = displaySize(v.width, v.height, sar, rot);
  const vStart = Number.isFinite(+v.start_time) ? +v.start_time : 0;
  const track = (x, i) => {
    const st = Number.isFinite(+x.start_time) ? +x.start_time : vStart;
    return { index: i, codec: x.codec_name, rate: +x.sample_rate, channels: x.channels, language: x.tags && x.tags.language && x.tags.language !== 'und' ? x.tags.language : null,
      title: (x.tags && x.tags.title) || null, start: st, offset: r6(st - vStart) };
  };
  return {
    file, codec: v.codec_name, w: dw, h: dh, coded: [v.width, v.height], sar, rotation: rot,
    fps: ratio(v.r_frame_rate), fpsRational: v.r_frame_rate, avgFps: rate.avg != null ? rate.avg : ratio(v.avg_frame_rate), vfr: rate.vfr,
    frames: pts.length, duration: +((j.format || {}).duration ?? v.duration), videoStart: vStart,
    audio: au ? track(au, ai) : null, audios: auds.map(track),
  };
}
const shape = (w, h) => { const k = w / h, near = (x) => Math.abs(k - x) < 0.01 * x; return near(9 / 16) ? 'tiktok' : near(16 / 9) ? 'youtube' : near(1) ? 'square' : near(4 / 5) ? 'feed45' : 'none'; };
const trackName = (a) => `audio ${a.index}: ${a.codec} ${a.rate} Hz, ${a.channels} channel${a.channels > 1 ? 's' : ''}${a.language ? `, ${a.language}` : ''}${a.title ? ` "${a.title}"` : ''}${a.offset ? `, starting ${fmt(a.offset)} s ${a.offset > 0 ? 'after' : 'before'} the picture` : ''}`;
function describe(c) {
  const stored = [c.rotation || c.sar ? `stored ${c.coded[0]}x${c.coded[1]}` : '', c.sar ? `pixels ${c.sar[0]}:${c.sar[1]}, not square` : '', c.rotation ? `rotated ${c.rotation} degrees` : ''].filter(Boolean).join(', ');
  return `${c.w}x${c.h}${stored ? ` (${stored})` : ''}, ` +
    `${c.vfr ? `variable frame rate (average ${fmt(c.avgFps, 3)} fps)` : `${+fmt(c.fps, 3)} fps constant (${c.fpsRational})`}, ${c.frames} frames, ` +
    `${fmt(c.duration)} s, ${c.audio ? `sound: ${trackName(c.audio)}` : 'no sound'}` +
    (c.audios.length > 1 ? `\n  ${c.audios.length} audio streams (prepare --audio <n> picks one; 0 by default):\n${c.audios.map((a) => `    ${trackName(a)}`).join('\n')}` : '');
}

// ---------------------------------------------------------------- the transcript

export function transcriptKind(file, text) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.srt') return 'srt';
  if (ext === '.vtt') return 'vtt';
  let j;
  try { j = JSON.parse(text); } catch { throw new ClipError(`${path.basename(file)}: not .srt, .vtt or JSON (name the format with --from)`); }
  if (j && Array.isArray(j.transcription)) return 'whispercpp';
  if (j && Array.isArray(j.segments)) return 'whisper';
  if (j && Array.isArray(j.words)) return 'words';
  throw new ClipError(`${path.basename(file)}: JSON, but not whisper.cpp's (transcription[]), openai-whisper's (segments[]) or the words format (words[]); name it with --from`);
}
// The clip's cues: its words on the clip's clock (moved `shift` seconds: a transcript timed to the raw audio track of a clip
// whose sound starts away from its first frame), VO_OFFSET 0, no CUE, no gaps.
export function clipCues(take, { dur, board, shift = 0 }) {
  const words = take.words.map((w) => ({ text: w.text, start: r6(w.start + shift), end: r6(w.end + shift), ...(w.est ? { est: true } : {}) }));
  const probs = [];
  if (!words.length) probs.push('the transcript has no words');
  const early = words.filter((w) => w.start < -1e-6);
  if (early.length) probs.push(`${early.length} word${early.length > 1 ? 's start' : ' starts'} before the clip's first frame after the ${fmt(shift)} s shift, from "${early[0].text}" at ${fmt(early[0].start)} s: is the shift right?`);
  const late = words.filter((w) => w.start >= dur - 1e-6);
  if (late.length) probs.push(`${late.length} word${late.length > 1 ? 's start' : ' starts'} at or after the clip's end (${fmt(dur)} s), from "${late[0].text}" at ${fmt(late[0].start)} s: is it this clip's transcript?`);
  if (probs.length) throw new ClipError(probs);
  const lastWordEnd = r6(Math.min(dur, Math.max(...words.map((w) => w.end))));
  return { VO_OFFSET: 0, CUE: {}, TAKE: { duration: r6(dur), lastWordEnd }, GAPS: [], HOOK_END: null, WORDS: words, BOARD_KEY: boardKey(board) };
}
// The board a clip piece needs: one silent beat the clip's length.
export function clipBoard({ dur, target, title }) {
  return { title, target, beats: [{ id: 'clip', dur: r6(dur), on: [], look: 'the clip, with its captions', sfx: null }] };
}
export function boardFits(board, dur) {
  const p = boardProblems(board);
  if (p.length) return p;
  if (board.beats.length !== 1 || board.beats[0].vo != null || Math.abs(board.beats[0].dur - dur) > 1e-6) {
    return [`board.js must be a single silent beat of the clip's length (dur: ${r6(dur)}), so the board adds no lead or tail; pass --board to write it`];
  }
  if (board.hookMax != null) return ['board.js sets hookMax, but a clip\'s board has no voice line'];
  return [];
}
export const boardText = (b) => `// THE STORYBOARD of a captioned clip, written by tools/clip.mjs prepare --board: one silent beat the clip's length, so
// the captions run on the clip's own clock (plan 23.5). captionStyle (pop, karaoke, boxed, minimal) and emphasis (a
// list of words) may be added here; --param style= and --param emphasis= win over them.
export const BOARD = ${JSON.stringify(b, null, 2).replace(/"(\w+)":/g, '$1:')};
`;

// ---------------------------------------------------------------- audio and pictures

function ff(args, what) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-v', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
  if (r.error) throw new ClipError(`could not run ffmpeg (${what}): ${r.error.message}`);
  if (r.status !== 0) throw new ClipError(`ffmpeg failed (${what}): ${String(r.stderr).trim().split('\n').slice(-3).join(' | ')}`);
}
// The clip's sound from its first video frame to its last, as a 48 kHz 32-bit float WAV: sound that starts after the
// picture is delayed by that much, sound that starts before it is cut, and the end is padded or cut to the clip's length.
export function extractVoice(clip, c, dur, out) {
  const off = c.audio.offset, n = Math.round(off * SR);
  const align = n > 0 ? `adelay=delays=${n}S:all=1,` : n < 0 ? `atrim=start_sample=${-n},asetpts=PTS-STARTPTS,` : '';
  ff(['-i', clip, '-map', `0:a:${c.audio.index}`, '-vn', '-af', `aresample=${SR},${align}apad,atrim=end_sample=${Math.round(dur * SR)}`, '-ar', String(SR), '-c:a', 'pcm_f32le', out], 'the clip\'s sound');
}
// What a clip needs before it can be captioned on its own clock: a constant frame rate (rate: [fps, rational] for a variable
// one) and square pixels (size: [w, h], its display size, for a clip whose pixels are not square). Null when it needs
// neither. Widths and heights are made even, as yuv420p needs.
export function normalizePlan(c) {
  const even = (x) => Math.max(2, 2 * Math.round(x / 2));
  const rate = c.vfr ? nearestRate(c.avgFps) : null, size = c.sar ? [even(c.w), even(c.h)] : null;
  return rate || size ? { rate, size } : null;
}
// The clip re-encoded by that plan: the picture at the rate's frames and the display size with square pixels, the chosen
// sound as AAC (the only audio stream of the result).
function normalizeClip(src, plan, audioIndex, out) {
  const vf = [plan.rate ? `fps=${plan.rate[1]}` : '', plan.size ? `scale=${plan.size[0]}:${plan.size[1]}:flags=lanczos,setsar=1` : ''].filter(Boolean).join(',');
  ff(['-i', src, '-map', '0:v:0', '-map', `0:a:${audioIndex}?`, '-vf', vf, '-fps_mode', plan.rate ? 'cfr' : 'passthrough', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], 'the conversion');
}
// A 16 kHz mono 16-bit copy of vo.wav, the input whisper-cli takes, so a transcript is made on the clip's own clock.
function whisperCopy(vo, out) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  ff(['-i', vo, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], 'the 16 kHz copy for whisper-cli');
}
function decodedVideoHash(file) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'hash', '-hash', 'sha256', '-'], { encoding: 'utf8' });
  const m = r.status === 0 && r.stdout.match(/SHA256=([0-9a-f]{64})/);
  if (!m) throw new ClipError(`could not hash the decoded video of ${rel(file)}: ${r.stderr || r.error}`);
  return 'sha256:' + m[1];
}
// The piece's source hash, by render.mjs's rules (sourceHash there): every file except out/, stills/, node_modules/,
// .git/, the review sheets, render records and `skip`. A composite's overlay must have been rendered from this source.
export function sourceHash(root, skip = new Set()) {
  const files = [];
  const walk = (dir, r) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name), rp = r ? `${r}/${name}` : name;
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git' || (!r && (name === 'out' || name === 'stills'))) continue;
        walk(abs, rp);
      } else {
        if (skip.has(abs) || name === '.DS_Store' || name.endsWith('.render.json')) continue;
        if (!r && ['board.png', 'contact.png', 'board.md', 'brand.png'].includes(name)) continue;
        files.push(`${rp}\0${sha256(fs.readFileSync(abs))}\n`);
      }
    }
  };
  walk(root, '');
  return { hash: 'sha256:' + sha256(files.join('')), files: files.length };
}
const partialOf = (f) => { const ext = path.extname(f); return (ext ? f.slice(0, -ext.length) : f) + '.partial' + ext; };
function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
async function loadModule(file) {
  if (!fs.existsSync(file)) return null;
  return import(pathToFileURL(file).href + `?t=${Date.now()}`);
}

// ---------------------------------------------------------------- prepare and cues

const optOf = (argv) => (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
// A transcript file as a take.
function readTranscript(tFile, kind0) {
  if (!fs.existsSync(tFile)) throw new ClipError(`no transcript ${rel(tFile)}`);
  const text = fs.readFileSync(tFile, 'utf8');
  const kind = kind0 || transcriptKind(tFile, text);
  try { return { kind, take: normalizeTake(kind, TEXT_KINDS.includes(kind) ? text : JSON.parse(text)) }; } catch (e) {
    if (e instanceof CueError) throw new ClipError(e.problems.map((p) => `transcript: ${p}`));
    throw new ClipError(`transcript ${path.basename(tFile)}: ${e.message}`);
  }
}
// How far to move a transcript's times onto the clip's clock: --transcript-offset <s>, or --raw-track (a transcript
// made from the clip's raw audio track: its 0 is the sound's first sample, which plays `offset` seconds into the picture).
function shiftOf(opt, argv, offset) {
  const o = opt('transcript-offset');
  if (o != null && argv.includes('--raw-track')) throw new ClipError('--transcript-offset and --raw-track both move the transcript: give one');
  if (o != null) { const x = Number(o); if (o === '' || !Number.isFinite(x)) throw new ClipError(`--transcript-offset ${o}: needs a number of seconds`); return { shift: x, why: '--transcript-offset' }; }
  if (argv.includes('--raw-track')) return { shift: offset, why: `--raw-track: the clip's sound starts ${fmt(offset)} s into its picture` };
  return { shift: 0, why: null };
}
// The cues from a take, written; returns the cues and a line to print.
function writeCues(take, kind, tFile, { CLIP, board, shift, why }) {
  const cues = clipCues(take, { dur: CLIP.dur, board, shift });
  const est = cues.WORDS.filter((w) => w.est).length;
  writeAtomic(path.join(ROOT, 'cues.json'), JSON.stringify(cues, null, 1) + '\n');
  writeAtomic(path.join(ROOT, 'cues.js'), cuesModuleText(cues, `${kind} (${path.basename(tFile)})`).replace('generated by tools/cues.mjs', 'generated by tools/clip.mjs'));
  const line = `transcript ${path.basename(tFile)} (${kind}): ${cues.WORDS.length} words${shift ? `, moved ${shift > 0 ? '+' : ''}${fmt(shift)} s onto the clip's clock (${why})` : ''}` +
    `${est ? `, ${est} of them spread over their phrase by length (${kind} gives phrase times only): estimated, so a word may light up a little early or late` : ''}`;
  return { cues, est, line, transcript: { file: rel(tFile), kind, words: cues.WORDS.length, estimated: est, ...(shift ? { shift: r6(shift) } : {}) } };
}
const clipJsText = (CLIP) => `// written by tools/clip.mjs prepare; do not edit. Run it again for another clip or transcript.\nexport const CLIP = ${JSON.stringify(CLIP, null, 1)};\n`;
// The note prepare gives when the sound does not start on the first frame (more than one frame away).
function offsetNote(off, fps) {
  if (!(Math.abs(off) > 1 / fps + 1e-9)) return null;
  return `the clip's sound starts ${fmt(Math.abs(off))} s ${off > 0 ? 'after' : 'before'} its first frame. vo.wav (and the mix) is aligned to the picture: ` +
    `a transcript of vo.wav (out/vo16k.wav) or one timed to the picture (an editor's SRT) needs nothing; one made from the clip's raw audio ` +
    `track must be moved ${off > 0 ? '+' : ''}${fmt(off)} s: --raw-track (or --transcript-offset ${fmt(off)})`;
}

export async function prepare(argv, log = console.log) {
  const opt = optOf(argv);
  const src = argv[1];
  if (!src || src.startsWith('--')) throw new ClipError('usage: node tools/clip.mjs prepare <clip> [--audio <n>] [--board] [--transcript <file> [--from kind] [--raw-track | --transcript-offset <s>]]');
  const srcFile = path.resolve(ROOT, src), tFile = opt('transcript') && path.resolve(ROOT, opt('transcript'));
  const ai = opt('audio') != null ? Number(opt('audio')) : 0;
  if (!(Number.isInteger(ai) && ai >= 0)) throw new ClipError(`--audio ${opt('audio')}: an audio stream's number, 0 for the first`);
  const problems = [];
  if (tFile && !fs.existsSync(tFile)) problems.push(`no transcript ${rel(tFile)}`);
  const c0 = probeClip(srcFile, { audio: ai });
  if (!c0.audio) problems.push(`${path.basename(srcFile)} has no sound: captions follow speech, so a clip needs its sound`);
  if (!(c0.frames > 1)) problems.push(`${path.basename(srcFile)} has ${c0.frames} frame${c0.frames === 1 ? '' : 's'}: not a clip`);
  if (problems.length) throw new ClipError(problems);
  log(`clip: ${path.basename(srcFile)}: ${describe(c0)}`);
  log(`  sound: audio stream ${ai} of ${c0.audios.length}${c0.audios.length > 1 ? ` (--audio ${ai})` : ''}`);
  const { shift, why } = shiftOf(opt, argv, c0.audio.offset);
  // the transcript, read and checked before anything is written
  const tr = tFile ? readTranscript(tFile, opt('from')) : null;

  // the clip in the piece: copied, or converted (a constant rate, square pixels)
  const plan = normalizePlan(c0);
  const dest = plan ? path.join(ROOT, 'clip.mp4') : path.join(ROOT, 'clip' + (path.extname(srcFile).toLowerCase() || '.mp4'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-clip-'));
  try {
    const staged = path.join(tmp, path.basename(dest));
    if (plan) {
      if (plan.rate) log(`  variable frame rate: converting to a constant ${+fmt(plan.rate[0], 3)} fps (the average ${fmt(c0.avgFps, 3)} fps, rounded to the nearest of 23.976, 24, 25, 29.97, 30, 50, 59.94, 60)`);
      if (plan.size) log(`  non-square pixels (${c0.sar[0]}:${c0.sar[1]}): converting to square pixels at the display size, ${plan.size[0]}x${plan.size[1]}`);
      normalizeClip(srcFile, plan, ai, staged);
    } else if (path.resolve(srcFile) !== dest) fs.copyFileSync(srcFile, staged);
    const copied = fs.existsSync(staged);
    const destAudio = plan ? 0 : ai;   // a converted clip keeps the chosen sound as its only audio stream
    const c = probeClip(copied ? staged : dest, { audio: destAudio });
    if (c.vfr) throw new ClipError(`${path.basename(dest)} still has a variable frame rate after the conversion`);
    if (c.sar) throw new ClipError(`${path.basename(dest)} still has non-square pixels after the conversion`);
    const dur = r6(c.frames / c.fps);

    // the board: written with --board, else the piece's own must fit
    const target = opt('target') || shape(c.w, c.h);
    const bFile = path.join(ROOT, 'board.js');
    let board;
    if (argv.includes('--board')) board = clipBoard({ dur, target, title: opt('title') || `Captions: ${path.basename(srcFile)}` });
    else {
      const m = await loadModule(bFile);
      board = m && m.BOARD;
      const p = board ? boardFits(board, dur) : ['no board.js: pass --board to write one (a single silent beat of the clip\'s length)'];
      if (p.length) throw new ClipError(p);
    }
    if (tr) clipCues(tr.take, { dur, board, shift });   // refused before anything is written

    // write: the clip, its sound, clip.js, the board, the cues
    if (copied) fs.renameSync(staged, dest);
    extractVoice(dest, c, dur, path.join(tmp, 'vo.wav'));
    fs.renameSync(path.join(tmp, 'vo.wav'), path.join(ROOT, 'vo.wav'));
    whisperCopy(path.join(ROOT, 'vo.wav'), path.join(ROOT, 'out', 'vo16k.wav'));
    // prepare run again on the piece's own clip keeps where that clip first came from
    const prev = path.resolve(srcFile) === dest ? await loadModule(path.join(ROOT, 'clip.js')).catch(() => null) : null;
    const sha = sha256File(dest), keep = prev && prev.CLIP && prev.CLIP.sha256 === sha && prev.CLIP.from;
    const CLIP = { file: path.basename(dest), sha256: sha, w: c.w, h: c.h, rotation: c.rotation, fps: c.fps, fpsRational: c.fpsRational,
      frames: c.frames, dur, audio: c.audio,
      from: keep || { file: path.basename(srcFile), vfr: c0.vfr, avgFps: r6(c0.avgFps), audio: ai, audioOffset: c0.audio.offset,
        ...(plan && plan.rate ? { convertedTo: plan.rate[1] } : {}), ...(plan && plan.size ? { sar: `${c0.sar[0]}:${c0.sar[1]}`, squaredTo: plan.size } : {}) } };
    const wrote = [...(copied ? [path.basename(dest)] : []), 'vo.wav', 'out/vo16k.wav'];
    if (argv.includes('--board')) { writeAtomic(bFile, boardText(board)); wrote.push('board.js'); }
    let tline = null;
    if (tr) {
      const w = writeCues(tr.take, tr.kind, tFile, { CLIP, board, shift, why });
      CLIP.transcript = w.transcript; tline = w.line;
      wrote.push('cues.js', 'cues.json');
    } else {
      for (const f of ['cues.js', 'cues.json']) if (fs.existsSync(path.join(ROOT, f))) { fs.rmSync(path.join(ROOT, f)); wrote.push(`(removed ${f}: it was another clip's or transcript's)`); }
    }
    writeAtomic(path.join(ROOT, 'clip.js'), clipJsText(CLIP));
    wrote.splice(copied ? 1 : 0, 0, 'clip.js');
    log(`  ${c.w}x${c.h} at ${+fmt(c.fps, 3)} fps (${c.fpsRational}), ${c.frames} frames, ${fmt(dur)} s: the captions run on this clock`);
    if (tline) log(`  ${tline}`);
    log(`  target ${board.target}${board.target === 'none' ? ': no safe area, so check reports text_safe as not checked' : ''}`);
    if (plan && plan.rate) log(`  note: the clip had a variable frame rate and was converted to ${+fmt(plan.rate[0], 3)} fps constant (clip.mp4); the master is at that rate`);
    if (plan && plan.size) log(`  note: the clip's pixels were not square (${c0.sar[0]}:${c0.sar[1]}); clip.mp4 is ${plan.size[0]}x${plan.size[1]} with square pixels, as it displays, and the master is that size`);
    const note = offsetNote(c0.audio.offset, c0.fps);
    if (note) log(`  note: ${note}${shift ? `; moved ${fmt(shift)} s (${why})` : ''}`);
    log(`wrote ${wrote.join(', ')}`);
    if (!tr) log(`next: transcribe out/vo16k.wav (whisper-cli -m <model> -f out/vo16k.wav -oj -ml 1 -sow -of out/vo16k), or bring a transcript, then node tools/clip.mjs cues --transcript <file>`);
    return { CLIP, board, converted: !!(plan && plan.rate), squared: !!(plan && plan.size) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// cues: a transcript onto a prepared clip's clock (cues.js, cues.json), without preparing the clip again.
export async function cuesStep(argv, log = console.log) {
  const opt = optOf(argv);
  const tFile = opt('transcript') && path.resolve(ROOT, opt('transcript'));
  if (!tFile) throw new ClipError('usage: node tools/clip.mjs cues --transcript <file> [--from kind] [--raw-track | --transcript-offset <s>]');
  const m = await loadModule(path.join(ROOT, 'clip.js'));
  const CLIP = m && m.CLIP;
  if (!CLIP) throw new ClipError('no clip.js: run node tools/clip.mjs prepare <clip> first');
  const b = await loadModule(path.join(ROOT, 'board.js')), board = b && b.BOARD;
  const p = board ? boardFits(board, CLIP.dur) : ['no board.js: run prepare with --board'];
  if (p.length) throw new ClipError(p);
  const off = CLIP.from && CLIP.from.audioOffset != null ? CLIP.from.audioOffset : CLIP.audio.offset;
  const { shift, why } = shiftOf(opt, argv, off);
  const tr = readTranscript(tFile, opt('from'));
  const w = writeCues(tr.take, tr.kind, tFile, { CLIP, board, shift, why });
  writeAtomic(path.join(ROOT, 'clip.js'), clipJsText({ ...CLIP, transcript: w.transcript }));
  log(`cues: ${w.line}`);
  const note = offsetNote(off, CLIP.fps);
  if (note && !shift) log(`  note: ${note}`);
  log('wrote cues.js, cues.json, clip.js');
  return w;
}

// ---------------------------------------------------------------- composite

export async function composite(argv, log = console.log) {
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const name = argv[1];
  if (!name || !/^[\w][\w.-]*$/.test(name)) throw new ClipError('usage: node tools/clip.mjs composite <name> [--overlay out/<name>.mov]  (a name, not a path)');
  const m = await loadModule(path.join(ROOT, 'clip.js'));
  const CLIP = m && m.CLIP;
  if (!CLIP) throw new ClipError('no clip.js: run node tools/clip.mjs prepare <clip> --transcript <file> first');
  const P = (f) => path.resolve(ROOT, f);
  const overlay = opt('overlay') ? P(opt('overlay')) : [P(`out/${name}.mov`), P(`out/${name}.webm`)].find((f) => fs.existsSync(f)) || P(`out/${name}.mov`);
  const ovRec = overlay + '.render.json', clip = P(CLIP.file), voFile = P('vo.wav');
  const problems = [];
  let rec = null;
  if (!fs.existsSync(clip)) problems.push(`the clip ${CLIP.file} is missing: run prepare again`);
  else if (sha256File(clip) !== CLIP.sha256) problems.push(`${CLIP.file} changed since prepare: run prepare again`);
  if (!fs.existsSync(overlay)) problems.push(`no overlay ${rel(overlay)}: render the captions first (node render.mjs video --scene caption.js --alpha --out out/${name}.mov)`);
  else if (!fs.existsSync(ovRec)) problems.push(`no render record ${rel(ovRec)} beside the overlay: render it with this piece's render.mjs`);
  else {
    try { rec = JSON.parse(fs.readFileSync(ovRec, 'utf8')); } catch (e) { problems.push(`${rel(ovRec)} is not JSON: ${e.message}`); }
    if (rec) {
      if (rec.sha256 !== sha256File(overlay)) problems.push(`${rel(overlay)} changed after the render its record describes: render it again`);
      if (!rec.alpha) problems.push(`${rel(overlay)} is not an alpha render: render the captions with --alpha`);
      if (!(Math.abs(rec.fps - CLIP.fps) < 1e-6)) problems.push(`the overlay runs at ${rec.fps} fps, the clip at ${CLIP.fps}: render it on the clip's clock (caption.js takes it from clip.js)`);
      if (rec.frames !== CLIP.frames || (rec.from || 0) !== 0) problems.push(`the overlay has ${rec.frames} frames${rec.from ? ` from ${rec.from} s` : ''}, the clip ${CLIP.frames}: render the whole clip`);
      if (!rec.render || rec.render[0] !== CLIP.w || rec.render[1] !== CLIP.h) problems.push(`the overlay is ${rec.render ? rec.render.join('x') : '?'}, the clip ${CLIP.w}x${CLIP.h}: render it at scale 1`);
      const now = sourceHash(ROOT, new Set([overlay, partialOf(overlay)]));
      if (!rec.source || rec.source.hash !== now.hash) problems.push(`the piece's source changed since ${rel(overlay)} was rendered: the overlay is stale, render it again`);
    }
  }
  if (!fs.existsSync(voFile)) problems.push('no vo.wav: run prepare again (it writes the clip\'s sound there)');
  if (problems.length) throw new ClipError(problems);

  const out = P(`out/${name}.mp4`), part = partialOf(out), recOut = out + '.render.json';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-comp-'));
  try {
    // vo.wav must be the clip's sound, extracted the way prepare does it (the mix's voice is the clip's own audio)
    extractVoice(clip, probeClip(clip, { audio: CLIP.audio.index || 0 }), CLIP.dur, path.join(tmp, "vo.wav"));
    if (sha256File(path.join(tmp, 'vo.wav')) !== sha256File(voFile)) throw new ClipError('vo.wav is not the clip\'s sound: run prepare again');
    fs.rmSync(recOut, { force: true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const fr = CLIP.fpsRational;
    const pre = overlay.toLowerCase().endsWith('.webm') ? ['-c:v', 'libvpx-vp9'] : [];
    // both pictures on one clock (frame N at N / fps), so frame N of the overlay lands on frame N of the clip
    ff(['-i', clip, ...pre, '-i', overlay, '-filter_complex',
      `[0:v]setpts=N/(${fr})/TB[b];[1:v]setpts=N/(${fr})/TB[o];[b][o]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[v]`,
      '-map', '[v]', '-an', '-frames:v', String(CLIP.frames), '-r', fr, '-c:v', 'libx264', '-crf', opt('crf') || '17', '-preset', 'medium',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part], 'the composite');
    fs.renameSync(part, out);
    const ovSha = sha256File(ovRec);
    const record = {
      format: 'sabotage-motion/render@1', created: new Date().toISOString(), mode: 'composite', kind: 'composite', file: rel(out),
      scene: rec.scene, target: rec.target, silent: false, params: rec.params || {},
      size: [CLIP.w, CLIP.h], render: [CLIP.w, CLIP.h], scale: 1, fps: CLIP.fps, dur: CLIP.dur, sub: rec.sub,
      alpha: null, look: rec.look, brand: rec.brand, tokens: rec.tokens, from: 0, to: CLIP.dur, frames: CLIP.frames, fonts_used: rec.fonts_used,
      clip: CLIP.sha256, clipFile: CLIP.file, overlay: ovSha, overlayFile: rel(ovRec),
      source: rec.source,
      video: { hash: decodedVideoHash(out) },
      sha256: sha256File(out),
    };
    writeAtomic(recOut, JSON.stringify(record, null, 2) + '\n');
    log(`composite: ${rel(overlay)} over ${CLIP.file}: ${CLIP.frames} frames at ${+fmt(CLIP.fps, 3)} fps, ${CLIP.w}x${CLIP.h}, yuv420p`);
    log(`wrote ${rel(out)}, ${rel(recOut)}`);
    log(`next: node tools/mix.mjs ${name} --no-sfx   (the clip's sound from vo.wav, mastered to -14 LUFS)`);
    return record;
  } finally {
    fs.rmSync(part, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main(argv) {
  const cmd = argv[0];
  try {
    if (cmd === 'probe') {
      if (!argv[1]) throw new ClipError('usage: node tools/clip.mjs probe <clip>');
      const c = probeClip(path.resolve(ROOT, argv[1]), { audio: optOf(argv)('audio') != null ? Number(optOf(argv)('audio')) : 0 });
      console.log(`clip: ${path.basename(c.file)}: ${describe(c)}`);
      if (c.vfr) console.log(`  prepare converts it to a constant ${+fmt(nearestRate(c.avgFps)[0], 3)} fps first`);
      if (c.sar) console.log(`  prepare converts it to square pixels at its display size first (${normalizePlan(c).size.join('x')})`);
      const note = c.audio && offsetNote(c.audio.offset, c.fps);
      if (note) console.log(`  note: ${note}`);
      if (argv.includes('--json')) console.log(JSON.stringify(c, null, 1));
      return 0;
    }
    if (cmd === 'prepare') { await prepare(argv); return 0; }
    if (cmd === 'cues') { await cuesStep(argv); return 0; }
    if (cmd === 'composite') { await composite(argv); return 0; }
    console.error('usage: node tools/clip.mjs <probe <clip>|prepare <clip> [--board] [--transcript <file>]|cues --transcript <file>|composite <name>>  (see the header)');
    return 2;
  } catch (e) {
    if (e instanceof ClipError) {
      console.error(`clip: refused, nothing written:`);
      for (const p of e.problems) console.error(`  - ${p}`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
