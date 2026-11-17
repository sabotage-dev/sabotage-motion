// tools/clip.mjs: caption a clip (plan 23.5). The clip is never re-encoded through the browser: the captions render
// with alpha on the clip's own clock (caption.js), and ffmpeg lays them over the clip.
//
//   node tools/clip.mjs probe <clip>                      what the clip is: display size after rotation, frame rate
//                                                         (constant or variable), frames, length, sound
//   node tools/clip.mjs prepare <clip> --transcript <file> [--from words|whisper|whispercpp|srt|vtt] [--board]
//                       [--target <name>] [--title <text>]
//   node tools/clip.mjs composite <name> [--overlay out/<name>.mov]
//
// prepare: reads the clip and its transcript and, only when every check passes, writes into the piece (this tool's
// parent folder):
//   clip.<ext>   the clip, copied; a variable frame rate clip is first converted to a constant rate instead (clip.mp4):
//                its average rate rounded to the nearest of 23.976, 24, 25, 29.97, 30, 50, 59.94 and 60, and it says so
//   clip.js      CLIP: the clip's file and SHA-256, display size, constant frame rate (fps, and fpsRational as ffmpeg
//                writes it), frames, length (frames / fps), and where it came from (a conversion is recorded)
//   vo.wav       the clip's sound from its first video frame to its last (48 kHz, 32-bit float), the mix's voice
//   cues.js, cues.json   the transcript's words at the clip's own times: VO_OFFSET 0, no CUE, no gaps (it does not go
//                through tools/cues.mjs, which needs a voiced board). Words an SRT or WebVTT phrase was spread over are
//                marked `est: true`, and it says how many
//   board.js     with --board: a single silent beat of the clip's length (so boardTiming adds no lead or tail), its
//                target (--target, else from the clip's shape: 9:16 tiktok, 16:9 youtube, 1:1 square, 4:5 feed45, else
//                none). Without --board the board must already be one silent beat of the clip's length.
// The transcript format comes from --from, else its extension (.srt, .vtt) or, for JSON, its shape (whisper.cpp's
// transcription[], openai-whisper's segments[], the generic words[]). whisper.cpp's whisper-cli, when installed, makes
// one: whisper-cli -m <model> -f clip.wav -oj -ml 1 -sow (render.mjs doctor reports whether it is installed).
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
export function probeClip(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new ClipError(`no clip ${file}`);
  const q = (args) => spawnSync('ffprobe', ['-v', 'error', ...args, '-of', 'json', file], { encoding: 'utf8', maxBuffer: 256 << 20 });
  const a = q(['-show_streams', '-show_format']);
  if (a.error) throw new ClipError(`could not run ffprobe: ${a.error.message}`);
  if (a.status !== 0) throw new ClipError(`ffprobe could not read ${path.basename(file)}: ${String(a.stderr).trim().split('\n').pop()}`);
  const j = JSON.parse(a.stdout || '{}'), streams = j.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const au = streams.find((s) => s.codec_type === 'audio');
  if (!v) throw new ClipError(`${path.basename(file)} has no video stream`);
  const p = q(['-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-show_packets']);
  const pts = ((JSON.parse(p.stdout || '{}').packets) || []).map((x) => +x.pts_time);
  const rate = rateOf(pts), rot = rotationOf(v), turned = rot === 90 || rot === 270;
  const vStart = Number.isFinite(+v.start_time) ? +v.start_time : 0, aStart = au && Number.isFinite(+au.start_time) ? +au.start_time : vStart;
  return {
    file, codec: v.codec_name, w: turned ? v.height : v.width, h: turned ? v.width : v.height, coded: [v.width, v.height], rotation: rot,
    fps: ratio(v.r_frame_rate), fpsRational: v.r_frame_rate, avgFps: rate.avg != null ? rate.avg : ratio(v.avg_frame_rate), vfr: rate.vfr,
    frames: pts.length, duration: +((j.format || {}).duration ?? v.duration), videoStart: vStart,
    audio: au ? { codec: au.codec_name, rate: +au.sample_rate, channels: au.channels, start: aStart, offset: r6(aStart - vStart) } : null,
  };
}
const shape = (w, h) => { const k = w / h, near = (x) => Math.abs(k - x) < 0.01 * x; return near(9 / 16) ? 'tiktok' : near(16 / 9) ? 'youtube' : near(1) ? 'square' : near(4 / 5) ? 'feed45' : 'none'; };
function describe(c) {
  return `${c.w}x${c.h}${c.rotation ? ` (stored ${c.coded[0]}x${c.coded[1]}, rotated ${c.rotation} degrees)` : ''}, ` +
    `${c.vfr ? `variable frame rate (average ${fmt(c.avgFps, 3)} fps)` : `${+fmt(c.fps, 3)} fps constant (${c.fpsRational})`}, ${c.frames} frames, ` +
    `${fmt(c.duration)} s, ${c.audio ? `sound: ${c.audio.codec} ${c.audio.rate} Hz, ${c.audio.channels} channel${c.audio.channels > 1 ? 's' : ''}${c.audio.offset ? `, starting ${fmt(c.audio.offset)} s after the picture` : ''}` : 'no sound'}`;
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
// The clip's cues: its words at their own times on the clip's clock, VO_OFFSET 0, no CUE, no gaps.
export function clipCues(take, { dur, board }) {
  const words = take.words.map((w) => ({ text: w.text, start: r6(w.start), end: r6(w.end), ...(w.est ? { est: true } : {}) }));
  const probs = [];
  if (!words.length) probs.push('the transcript has no words');
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
  ff(['-i', clip, '-map', '0:a:0', '-vn', '-af', `aresample=${SR},${align}apad,atrim=end_sample=${Math.round(dur * SR)}`, '-ar', String(SR), '-c:a', 'pcm_f32le', out], 'the clip\'s sound');
}
// A variable-rate clip at a constant rate (the picture re-encoded at the rate's frames, the sound as AAC).
function convertCfr(src, rational, out) {
  ff(['-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-vf', `fps=${rational}`, '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out], 'the constant-rate conversion');
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

// ---------------------------------------------------------------- prepare

export async function prepare(argv, log = console.log) {
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  const src = argv[1];
  if (!src || src.startsWith('--')) throw new ClipError('usage: node tools/clip.mjs prepare <clip> --transcript <file> [--from kind] [--board]');
  const srcFile = path.resolve(ROOT, src), tFile = opt('transcript') && path.resolve(ROOT, opt('transcript'));
  if (!tFile) throw new ClipError('prepare needs --transcript <file>: whisper.cpp JSON, openai-whisper JSON, SRT, WebVTT or the words format (without whisper-cli, ask for one)');
  const problems = [];
  if (!fs.existsSync(tFile)) problems.push(`no transcript ${rel(tFile)}`);
  const c0 = probeClip(srcFile);
  if (!c0.audio) problems.push(`${path.basename(srcFile)} has no sound: captions follow speech, so a clip needs its sound`);
  if (!(c0.frames > 1)) problems.push(`${path.basename(srcFile)} has ${c0.frames} frame${c0.frames === 1 ? '' : 's'}: not a clip`);
  if (problems.length) throw new ClipError(problems);
  log(`clip: ${path.basename(srcFile)}: ${describe(c0)}`);

  // the transcript, read and checked before anything is written
  const text = fs.readFileSync(tFile, 'utf8');
  const kind = opt('from') || transcriptKind(tFile, text);
  let take;
  try { take = normalizeTake(kind, TEXT_KINDS.includes(kind) ? text : JSON.parse(text)); } catch (e) {
    if (e instanceof CueError) throw new ClipError(e.problems.map((p) => `transcript: ${p}`));
    throw new ClipError(`transcript ${path.basename(tFile)}: ${e.message}`);
  }

  // the clip in the piece: copied, or converted to a constant rate
  const conv = c0.vfr ? nearestRate(c0.avgFps) : null;
  const dest = conv ? path.join(ROOT, 'clip.mp4') : path.join(ROOT, 'clip' + (path.extname(srcFile).toLowerCase() || '.mp4'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-clip-'));
  try {
    const staged = path.join(tmp, path.basename(dest));
    if (conv) {
      log(`  variable frame rate: converting to a constant ${+fmt(conv[0], 3)} fps (the average ${fmt(c0.avgFps, 3)} fps, rounded to the nearest of 23.976, 24, 25, 29.97, 30, 50, 59.94, 60)`);
      convertCfr(srcFile, conv[1], staged);
    } else if (path.resolve(srcFile) !== dest) fs.copyFileSync(srcFile, staged);
    const clipNow = fs.existsSync(staged) ? staged : dest;
    const c = probeClip(clipNow);
    if (c.vfr) throw new ClipError(`${path.basename(dest)} still has a variable frame rate after the conversion`);
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
    const cues = clipCues(take, { dur, board });
    const est = cues.WORDS.filter((w) => w.est).length;

    // write: the clip, its sound, clip.js, the cues, the board
    const copied = fs.existsSync(staged);
    if (copied) fs.renameSync(staged, dest);
    extractVoice(dest, c, dur, path.join(tmp, 'vo.wav'));
    fs.renameSync(path.join(tmp, 'vo.wav'), path.join(ROOT, 'vo.wav'));
    // prepare run again on the piece's own clip keeps where that clip first came from
    const prev = path.resolve(srcFile) === dest ? await loadModule(path.join(ROOT, 'clip.js')).catch(() => null) : null;
    const sha = sha256File(dest), keep = prev && prev.CLIP && prev.CLIP.sha256 === sha && prev.CLIP.from;
    const CLIP = { file: path.basename(dest), sha256: sha, w: c.w, h: c.h, rotation: c.rotation, fps: c.fps, fpsRational: c.fpsRational,
      frames: c.frames, dur, audio: c.audio,
      from: keep || { file: path.basename(srcFile), vfr: c0.vfr, avgFps: r6(c0.avgFps), ...(conv ? { convertedTo: conv[1] } : {}) },
      transcript: { file: path.basename(tFile), kind, words: cues.WORDS.length, estimated: est } };
    writeAtomic(path.join(ROOT, 'clip.js'), `// written by tools/clip.mjs prepare; do not edit. Run it again for another clip or transcript.\nexport const CLIP = ${JSON.stringify(CLIP, null, 1)};\n`);
    writeAtomic(path.join(ROOT, 'cues.json'), JSON.stringify(cues, null, 1) + '\n');
    writeAtomic(path.join(ROOT, 'cues.js'), cuesModuleText(cues, `${kind} (${path.basename(tFile)})`).replace('generated by tools/cues.mjs', 'generated by tools/clip.mjs'));
    const wrote = [...(copied ? [path.basename(dest)] : []), 'clip.js', 'vo.wav', 'cues.js', 'cues.json'];
    if (argv.includes('--board')) { writeAtomic(bFile, boardText(board)); wrote.push('board.js'); }
    log(`  ${c.w}x${c.h} at ${+fmt(c.fps, 3)} fps (${c.fpsRational}), ${c.frames} frames, ${fmt(dur)} s: the captions run on this clock`);
    log(`  transcript ${path.basename(tFile)} (${kind}): ${cues.WORDS.length} words${est ? `, ${est} of them spread over their phrase by length (${kind} gives phrase times only): estimated, so a word may light up a little early or late` : ''}`);
    log(`  target ${board.target}${board.target === 'none' ? ': no safe area, so check reports text_safe as not checked' : ''}`);
    if (conv) log(`  note: the clip had a variable frame rate and was converted to ${+fmt(conv[0], 3)} fps constant (clip.mp4); the master is at that rate`);
    log(`wrote ${wrote.join(', ')}`);
    return { CLIP, cues, board, converted: !!conv };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
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
    extractVoice(clip, probeClip(clip), CLIP.dur, path.join(tmp, 'vo.wav'));
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
      const c = probeClip(path.resolve(ROOT, argv[1]));
      console.log(`clip: ${path.basename(c.file)}: ${describe(c)}`);
      if (c.vfr) console.log(`  prepare converts it to a constant ${+fmt(nearestRate(c.avgFps)[0], 3)} fps first`);
      if (argv.includes('--json')) console.log(JSON.stringify(c, null, 1));
      return 0;
    }
    if (cmd === 'prepare') { await prepare(argv); return 0; }
    if (cmd === 'composite') { await composite(argv); return 0; }
    console.error('usage: node tools/clip.mjs <probe <clip>|prepare <clip> --transcript <file> [--board]|composite <name>>  (see the header)');
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
