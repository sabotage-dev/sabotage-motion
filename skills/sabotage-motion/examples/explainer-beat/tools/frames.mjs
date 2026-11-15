// tools/frames.mjs: footage as a frame sequence the scene draws frame-exact (plan section 10).
//
//   node tools/frames.mjs <name> <src> --from s --dur s [--vf "<ffmpeg filter>"] [--q 4]
//                         [--fps N] [--scene file.js] [--target name]
//
// Cuts `dur` seconds of <src> (any clip or screen recording ffmpeg reads), starting `from` seconds in, into
// assets/seq/<name>/000.jpg, 001.jpg, ... at the piece's frame rate: round(dur x fps) frames. It records the
// sequence in assets/seq/manifest.json ({ "<name>": { frames, fps, w, h, ... } }), replacing an older cut of
// the same name. Paths resolve against the piece (this tool's parent folder), like render.mjs.
//
// The piece's frame rate is --fps, else the scene's CFG.FPS (scene.js, or --scene), else the fps of
// --target in safezones.json, else 30: the order render.mjs uses. Pass --fps when you render with --fps.
//
// In the scene (lib.js):
//   export async function init() { await loadSeq('clip'); }        // every frame decoded and held in memory
//   ctx.drawImage(seqAt('clip', t, 2.0), 0, 0, 1080, 608);          // the frame for t, the clip starting at 2.0 s
//   seqAt('clip', t, 2.0, { loop: true })                           // loop it instead of holding the last frame
//
// Every frame stays decoded in memory (w x h x 4 bytes each), so crop and scale here to the size the scene
// draws, for example --vf "crop=1080:1080:420:0,scale=540:540". --vf runs after the frame-rate conversion.
// --q is the JPEG quality: 2 (best, biggest) to 31 (default 4).
//
// The clip's sound is not kept. To mix it in, cut the same span and pass it to the mixer as a stem that
// starts where the scene starts the clip (t0):
//   ffmpeg -ss <from> -t <dur> -i <src> -vn -ac 2 -ar 48000 clip.wav
//   node tools/mix.mjs <name> --stem clip.wav:1:<t0>
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEQ_DIR = path.join(ROOT, 'assets', 'seq'), MANIFEST = path.join(SEQ_DIR, 'manifest.json');

export class FramesError extends Error {}
class UsageError extends Error {}
const fmt = (x, d = 3) => Number(x).toFixed(d);

function parseArgs(argv) {
  const VAL = new Set(['from', 'dur', 'vf', 'q', 'fps', 'scene', 'target']);
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { o.help = true; continue; }
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const k = a.slice(2);
    if (!VAL.has(k)) throw new UsageError(`unknown option ${a}`);
    const v = argv[i + 1];
    if (v == null || (v.startsWith('--') && k !== 'vf')) throw new UsageError(`${a} needs a value`);
    if (k in o) throw new UsageError(`${a} given twice`);
    o[k] = v; i++;
  }
  return o;
}
const number = (o, k, { min = -Infinity, max = Infinity, int = false, def } = {}) => {
  if (o[k] == null) return def;
  const x = Number(o[k]);
  if (o[k] === '' || !Number.isFinite(x) || x < min || x > max || (int && !Number.isInteger(x))) {
    throw new UsageError(`--${k} ${o[k]}: needs ${int ? 'a whole number' : 'a number'}${min > -Infinity ? ` from ${min}` : ''}${max < Infinity ? ` to ${max}` : ''}`);
  }
  return x;
};

// The piece's fps, the way main.js picks it: --fps, then CFG.FPS, then the --target's fps, then 30.
async function pieceFps(o) {
  const fps = number(o, 'fps', { min: 1, max: 240 });
  if (fps) return { fps, from: '--fps' };
  const sceneFile = o.scene || 'scene.js';
  if (!/^[\w][\w./-]*\.m?js$/.test(sceneFile) || sceneFile.includes('..') || !fs.existsSync(path.join(ROOT, sceneFile))) {
    throw new UsageError(`--scene ${sceneFile}: no such scene file in this piece`);
  }
  let cfg;
  try { cfg = (await import(pathToFileURL(path.join(ROOT, sceneFile)).href)).CFG; } catch (e) {
    throw new FramesError(`could not read CFG.FPS from ${sceneFile} in Node (${e.message.split('\n')[0]}): pass --fps`);
  }
  if (cfg && cfg.FPS) return { fps: +cfg.FPS, from: `${sceneFile} CFG.FPS` };
  if (o.target) {
    let zones;
    try { zones = JSON.parse(fs.readFileSync(path.join(ROOT, 'safezones.json'), 'utf8')); } catch (e) { throw new FramesError(`--target needs a readable safezones.json (${e.message})`); }
    const t = zones.targets && zones.targets[o.target];
    if (!t) throw new UsageError(`--target ${o.target}: unknown target (safezones.json has: ${Object.keys(zones.targets || {}).join(', ')})`);
    if (t.fps) return { fps: +t.fps, from: `target ${o.target}` };
  }
  return { fps: 30, from: 'the default (no CFG.FPS, no --target)' };
}

function probeSize(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file], { encoding: 'utf8' });
  const s = r.status === 0 && JSON.parse(r.stdout).streams[0];
  if (!s) throw new FramesError(`ffprobe could not read ${path.basename(file)}`);
  return { w: s.width, h: s.height };
}
function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export async function cutFrames(argv, log = console.log) {
  const o = parseArgs(argv);
  if (o.help) { log('usage: node tools/frames.mjs <name> <src> --from s --dur s [--vf "<filter>"] [--q 4] [--fps N]  (see the header)'); return null; }
  if (o._.length !== 2) throw new UsageError('give a sequence name and a source: node tools/frames.mjs <name> <src> --from s --dur s');
  const [name, srcArg] = o._;
  if (!/^[\w][\w.-]*$/.test(name) || name === 'manifest.json') throw new UsageError(`${name}: a sequence name, not a path (letters, digits, _ . -)`);
  const src = path.resolve(ROOT, srcArg);
  if (!fs.existsSync(src)) throw new FramesError(`no source ${srcArg}`);
  const from = number(o, 'from', { min: 0, def: 0 });
  const dur = number(o, 'dur', { min: 0 });
  if (!(dur > 0)) throw new UsageError('--dur: how many seconds of the source to cut (more than 0)');
  const q = number(o, 'q', { min: 2, max: 31, int: true, def: 4 });
  const { fps, from: fpsFrom } = await pieceFps(o);
  const count = Math.round(dur * fps);
  if (count < 1) throw new UsageError(`--dur ${dur} at ${fps} fps is less than one frame`);

  // Cut into a fresh folder beside the old one, then swap, so a failed cut leaves the old sequence intact and
  // a shorter re-cut leaves no stale frames behind.
  fs.mkdirSync(SEQ_DIR, { recursive: true });
  const out = path.join(SEQ_DIR, name), tmp = path.join(SEQ_DIR, `.${name}.tmp-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  try {
    const vf = [`fps=${fps}`, o.vf].filter(Boolean).join(',');
    const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-i', src, '-an', '-sn', '-dn', '-vf', vf,
      '-frames:v', String(count), '-c:v', 'mjpeg', '-q:v', String(q), '-start_number', '0', path.join(tmp, '%03d.jpg')], { encoding: 'utf8' });
    if (r.error) throw new FramesError(`could not run ffmpeg: ${r.error.message}`);
    if (r.status !== 0) throw new FramesError(`ffmpeg could not cut ${srcArg}: ${String(r.stderr).trim().split('\n').slice(-2).join(' | ')}`);
    const got = fs.readdirSync(tmp).filter((f) => /^\d{3,}\.jpg$/.test(f)).length;
    if (got !== count) {
      throw new FramesError(`${srcArg} gave ${got} of the ${count} frames asked for (${fmt(dur, 2)} s from ${fmt(from, 2)} s at ${fps} fps): is the source long enough?`);
    }
    const { w, h } = probeSize(path.join(tmp, '000.jpg'));

    // The manifest is read before the old frames go, so one that cannot be read refuses with the old sequence still
    // in place. This sequence's entry is dropped before the swap and written again after it: a crash in between
    // leaves no entry (loadSeq then refuses the name) rather than the old entry describing the new frames.
    let manifest = {};
    if (fs.existsSync(MANIFEST)) {
      try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch (e) { throw new FramesError(`assets/seq/manifest.json is not JSON (${e.message}): fix or delete it`); }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new FramesError('assets/seq/manifest.json is not an object of sequences: fix or delete it');
    }
    const save = () => writeAtomic(MANIFEST, JSON.stringify(Object.fromEntries(Object.keys(manifest).sort().map((k) => [k, manifest[k]])), null, 2) + '\n');
    if (Object.prototype.hasOwnProperty.call(manifest, name)) { delete manifest[name]; save(); }
    fs.rmSync(out, { recursive: true, force: true });
    fs.renameSync(tmp, out);

    const srcRel = path.relative(ROOT, src);
    manifest[name] = { frames: count, fps, w, h, ext: 'jpg', src: srcRel.startsWith('..') || path.isAbsolute(srcRel) ? path.basename(src) : srcRel,
      from, dur, ...(o.vf ? { vf: o.vf } : {}), q };
    save();

    const mb = (count * w * h * 4) / (1 << 20);
    log(`frames: ${name}: ${count} frames at ${fps} fps (${fpsFrom}), ${w}x${h}, from ${fmt(from, 2)} s for ${fmt(dur, 2)} s of ${path.basename(src)}`);
    log(`  held decoded in memory by loadSeq: about ${mb.toFixed(0)} MB${mb > 1024 ? ' (WARN: over 1 GB; crop and scale it smaller with --vf)' : ''}`);
    log(`wrote assets/seq/${name}/000.jpg ... ${String(count - 1).padStart(3, '0')}.jpg and assets/seq/manifest.json`);
    return manifest[name];
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await cutFrames(process.argv.slice(2));
  } catch (e) {
    if (e instanceof UsageError) { console.error(`frames: ${e.message}`); process.exitCode = 2; }
    else if (e instanceof FramesError) { console.error(`frames: refused: ${e.message}`); process.exitCode = 1; }
    else throw e;
  }
}
