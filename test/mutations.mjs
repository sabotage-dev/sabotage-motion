// Mutation check for `render.mjs check` (plan section 16: "disabling any one detector fails a test"). Each
// mutation below breaks one detector, threshold or wire on purpose in a scratch copy of the repo, runs the
// tests that should notice, and counts it caught when they fail. The repo itself is never touched.
//
//   node test/mutations.mjs              every mutation (about 15 minutes on an Apple-silicon Mac)
//   node test/mutations.mjs --fast       only those the unit tests catch (seconds)
//   node test/mutations.mjs --only <name-substring>
//   node test/mutations.mjs --list
// Exit 1 when any mutation survives (no test failed) or no longer applies (its text is not in the file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = 'skills/sabotage-motion/template/';
const UNIT = ['test/check-units.test.mjs'], SRC = ['test/check.test.mjs'], FILE = ['test/check-file.test.mjs'], ZONES = ['test/safezones.test.mjs'];

// [name, file, [[from, to], ...], tests]
const M = [
  // ---- thresholds, on both sides of their edges (unit tests)
  ['motion: delta 2 -> 3', T + 'check.mjs', [['motion: { delta: 2, pixels: 4,', 'motion: { delta: 3, pixels: 4,']], UNIT],
  ['motion: pixels 4 -> 5', T + 'check.mjs', [['delta: 2, pixels: 4, run: 3.0', 'delta: 2, pixels: 5, run: 3.0']], UNIT],
  ['motion: run 3.0 -> 3.04 s', T + 'check.mjs', [['pixels: 4, run: 3.0 }', 'pixels: 4, run: 3.04 }']], UNIT],
  ['motion: a pixel moves at delta > 2, not >= 2', T + 'check.mjs', [['if (+d >= T.motion.delta) n += c;', 'if (+d > T.motion.delta) n += c;']], UNIT],
  ['motion: a pair moves at > 4 pixels, not >= 4', T + 'check.mjs', [['return n >= T.motion.pixels;', 'return n > T.motion.pixels;']], UNIT],
  ['motion: a run counts pairs, not frames', T + 'check.mjs', [['const a = i / fps, b = (j + 1) / fps;', 'const a = i / fps, b = j / fps;']], UNIT],
  ['motion: holds ignored', T + 'check.mjs', [['subtractIntervals(a, b, holds)) {', 'subtractIntervals(a, b, [])) {']], UNIT],
  ['motion: hold beats ignored', T + 'check.mjs', [['if (w.beat && w.beat.hold) h.push', 'if (false) h.push']], UNIT],
  ['first frame: std 4 -> 3', T + 'check.mjs', [['firstFrame: { std: 4 }', 'firstFrame: { std: 3 }']], UNIT],
  ['first frame: flat at <= 4, not < 4', T + 'check.mjs', [['return stats.std < T.firstFrame.std', 'return stats.std <= T.firstFrame.std']], UNIT],
  ['text_safe: FAIL over 0.26 s, not 0.25', T + 'check.mjs', [['textSafe: { fail: 0.25 }', 'textSafe: { fail: 0.26 }']], UNIT],
  ['text_safe: FAIL at 0.25 s exactly', T + 'check.mjs', [['const long = a.exp > T.textSafe.fail + EPS;', 'const long = a.exp >= T.textSafe.fail - EPS;']], UNIT],
  ['text_safe: estimate zones FAIL too', T + 'check.mjs', [["long && !estimate ? 'FAIL' : 'WARN'", "long ? 'FAIL' : 'WARN'"]], UNIT],
  ['text_safe: deco boxes checked', T + 'check.mjs', [['      if (b.deco) continue;\n      const out = Math.max(safe.x - b.v.x', '      const out = Math.max(safe.x - b.v.x']], UNIT],
  ['text_safe: a sample weighs a whole frame', T + 'check.mjs', [['const w = windowAt(windows, s.t), wt = 1 / (s.n * fps);', 'const w = windowAt(windows, s.t), wt = 1 / fps;']], UNIT],
  ['text_safe: the exclude rectangles ignored', T + 'check.mjs', [['if (insideRect(b.v, safe) && !(into > 0)) continue;', 'if (insideRect(b.v, safe)) continue;']], UNIT],
  ['text_safe: exposure for the whole piece, not per beat', T + 'check.mjs', [["const k = `${b.id}\\u0000${w ? w.id : ''}`;", 'const k = b.id;']], UNIT],
  ['camera: rotation the wrong way', T + 'check.mjs', [['const c = Math.cos(rot), s = Math.sin(rot);', 'const c = Math.cos(rot), s = Math.sin(-rot);']], UNIT],
  ['camera: pan y the wrong way', T + 'check.mjs', [['0.5 - y / H + panY;', '0.5 - y / H - panY;']], UNIT],
  ['camera: zoom ignored', T + 'check.mjs', [['const ox = zoom * (c * qx - s * qy), oy = zoom * (s * qx + c * qy);', 'const ox = (c * qx - s * qy), oy = (s * qx + c * qy);']], UNIT],
  ['boxes: text off the canvas counts as seen', T + 'check.mjs', [['  const c = clipRect(b, W, H);\n  if (!c) return null;', '  const c = b;']], UNIT],
  ['overlap: 2% -> 3%', T + 'check.mjs', [['overlap: { ratio: 0.02 }', 'overlap: { ratio: 0.03 }']], UNIT],
  ['overlap: flagged at exactly 2%', T + 'check.mjs', [['if (!(ratio > T.overlap.ratio + EPS)) continue;', 'if (!(ratio >= T.overlap.ratio - EPS)) continue;']], UNIT],
  ['overlap: groups ignored', T + 'check.mjs', [["if ((a.group ?? `#${a.id}`) === (b.group ?? `#${b.id}`)) continue;", '']], UNIT],
  ['overlap: deco boxes checked', T + 'check.mjs', [['const bs = s.vis.filter((b) => !b.deco), wt', 'const bs = s.vis, wt']], UNIT],
  ['copy: unread under 0.9 s, not 1.0', T + 'check.mjs', [['copyUnread: { min: 1.0, perWord: 0.25 }', 'copyUnread: { min: 0.9, perWord: 0.25 }']], UNIT],
  ['copy: 0.2 s a word, not 0.25', T + 'check.mjs', [['copyUnread: { min: 1.0, perWord: 0.25 }', 'copyUnread: { min: 1.0, perWord: 0.2 }']], UNIT],
  ['copy: case kept', T + 'check.mjs', [["const norm = (s) => String(s).toLowerCase().replace(", "const norm = (s) => String(s).replace("]], UNIT],
  ['copy: ties in reverse reading order', T + 'check.mjs', [['.sort((a, b) => a.first - b.first || a.order - b.order)', '.sort((a, b) => a.first - b.first || b.order - a.order)']], UNIT],
  ['copy: one entry per text, not per box id', T + 'check.mjs', [['const m = groups.get(g), e = m.get(b.id);', 'const m = groups.get(g), e = m.get(b.text);'], ['if (!e) m.set(b.id, {', 'if (!e) m.set(b.text, {']], UNIT],
  ['copy: first text of a box, not its longest', T + 'check.mjs', [['else if (String(b.text).length > e.text.length) e.text = String(b.text);', '']], UNIT],
  ['copy: groups merged', T + 'check.mjs', [["const g = b.group ?? '\\u0000';", "const g = '\\u0000';"]], UNIT],
  ['sfx: -40 -> -39 dBFS', T + 'check.mjs', [['sfx: { win: 0.050, db: -40,', 'sfx: { win: 0.050, db: -39,']], UNIT],
  ['sfx: hit 12 -> 11 dB', T + 'check.mjs', [['hitPre: 0.100, hitDb: 12,', 'hitPre: 0.100, hitDb: 11,']], UNIT],
  ['sfx: a hit may be quieter than -40 dBFS', T + 'check.mjs', [['        if (!(L > T.sfx.db)) continue;\n', '']], UNIT],
  ['sfx: sfx: null is checked', T + 'check.mjs', [["if (typeof b.sfx !== 'string' || !b.sfx.trim()) continue;", 'if (b.sfx === undefined) continue;']], UNIT],
  ['sfx: sfxHit ignored', T + 'check.mjs', [['    if (b.sfxHit) {\n      const W = Math.round(T.sfx.hitWin', '    if (false) {\n      const W = Math.round(T.sfx.hitWin']], UNIT],
  ['spike: 18 -> 16 dB', T + 'check.mjs', [['spike: { win: 0.050, db: 18,', 'spike: { win: 0.050, db: 16,']], UNIT],
  ['spike: silence counted in the percentile', T + 'check.mjs', [['const loud = peaks.filter((p) => db(p) > T.spike.floor)', 'const loud = peaks.filter(() => true)']], UNIT],
  ['loudness: 1 LU -> 0.9', T + 'check.mjs', [['loudness: { lu: 1.0, tp: -1.0 }', 'loudness: { lu: 0.9, tp: -1.0 }']], UNIT],
  ['loudness: ceiling -1.0 -> -1.1 dBTP', T + 'check.mjs', [['loudness: { lu: 1.0, tp: -1.0 }', 'loudness: { lu: 1.0, tp: -1.1 }']], UNIT],
  ['file_spec: a frame either way allowed', T + 'check.mjs', [['if (p.frames !== want)', 'if (Math.abs(p.frames - want) > 1)']], UNIT],
  ['file_spec: duration within two frames', T + 'check.mjs', [['<= 1 / x.fps + 1e-6))', '<= 2 / x.fps))']], UNIT],
  ['file_spec: audio not required', T + 'check.mjs', [['if (!p.audio && !x.silent)', 'if (false)']], UNIT],
  ['provenance: master hash not compared', T + 'check.mjs', [['if (!mj.master || mj.master.sha256 !== f.fileSha)', 'if (!mj.master)']], UNIT],
  ['provenance: render record hash not compared', T + 'check.mjs', [['else if (f.recSha !== mj.render.sha256)', 'else if (false)']], UNIT],
  ['provenance: stale source passes', T + 'check.mjs', [['if (!rec.source || rec.source.hash !== f.sourceNow.hash)', 'if (!rec.source)']], UNIT],
  ['provenance: decoded picture not compared', T + 'check.mjs', [['if (!rec.video || !mj.master || !mj.master.video || rec.video.hash !== mj.master.video.hash)', 'if (false)']], UNIT],
  ['vo_delay: any delay passes', T + 'check.mjs', [['return Math.abs(mj.voiceDelay - voOffset) <= 1e-6', 'return true']], UNIT],
  ['vo_delay: --master-only checked', T + 'check.mjs', [["if (!mj || mj.mode !== 'default') return skip", "if (!mj || mj.mode === 'sting') return skip"]], UNIT],
  ['hook_long: the master\'s voice delay ignored', T + 'check.mjs', [['if (Math.abs(voiceDelay - voOffset) > 1e-6) probs.push', 'if (false) probs.push']], UNIT],
  ['hook_long: equal to hookMax fails', T + 'check.mjs', [['if (end > hookMax + 1e-9) probs.push', 'if (end >= hookMax - 1e-9) probs.push']], UNIT],
  ['faststart: order reversed', T + 'check.mjs', [['return m < d ? ok(', 'return m > d ? ok(']], UNIT],
  ['faststart: 64-bit box sizes not read', T + 'check.mjs', [["if (size === 1) { if (off + 16 > buf.length) break; size = Number(buf.readBigUInt64BE(off + 8)); }", '']], UNIT],
  ['strict: a WARN never fails', T + 'check.mjs', [['exit: n.FAIL || (strict && n.WARN) ? 1 : 0', 'exit: n.FAIL ? 1 : 0']], UNIT],
  ['captions: no room left for the pop', T + 'lib.js', [['maxW: opts.maxW || (safe ? safe.w / CAPTION_POP_MAX : 900)', 'maxW: opts.maxW || (safe ? safe.w : 900)']], UNIT],
  ['captions: one group per line, not per block', T + 'lib.js', [['group: `cap-${groups.indexOf(g)}`, line: li', 'group: `cap-${groups.indexOf(g)}-${li}`, line: li']], UNIT],
  ['captions: draw: false still draws', T + 'lib.js', [['const boxes = [], draw = opts.draw !== false;', 'const boxes = [], draw = true;']], UNIT],
  // ---- every detector wired into render.mjs check (fixture tests)
  ['render.mjs: fonts not reported', T + 'render.mjs', [["    else if (INFOc.FONT_PROBLEMS.length) push(", "    else if (false) push("]], SRC],
  ['render.mjs: board_order not run', T + 'render.mjs', [['else push(C.boardOrderResult(lib.boardOrder(timing, dur ?? null, fps ?? null)));', '']], SRC],
  ['render.mjs: hook_long not run', T + 'render.mjs', [['      push(C.hookLongResult(lib.hookLong(BOARD, cues), voiced', '      void (C.hookLongResult(lib.hookLong(BOARD, cues), voiced']], SRC],
  ['render.mjs: motion_dead not run', T + 'render.mjs', [["if (want('motion_dead')) push(C.motionDead(", "if (false) push(C.motionDead("]], SRC],
  ['render.mjs: first_frame_empty not run', T + 'render.mjs', [['else push(C.firstFrameEmpty(scan.first));', '']], SRC],
  ['render.mjs: text_safe not run', T + 'render.mjs', [['if (zone) push(C.textSafe(samples,', 'if (false) push(C.textSafe(samples,']], SRC],
  ['render.mjs: text_overlap not run', T + 'render.mjs', [['        push(C.textOverlap(samples, { fps }));\n', '']], SRC],
  ['render.mjs: board copy not run', T + 'render.mjs', [['if (BOARD && timing.ok) push(C.boardCopy(samples, { fps, windows }));', 'if (false) push(C.boardCopy(samples, { fps, windows }));']], SRC],
  ['render.mjs: board_sfx_missing not run', T + 'render.mjs', [['if (BOARD && timing.ok) push(C.boardSfx(wav, { windows }));', 'if (false) push(C.boardSfx(wav, { windows }));']], SRC],
  ['render.mjs: audio_spike not run', T + 'render.mjs', [['          push(C.audioSpike(wav));\n', '']], SRC],
  ['render.mjs: HOLDS ignored', T + 'render.mjs', [['C.holdIntervals(holdsErr ? null : INFOc.HOLDS,', 'C.holdIntervals(null,']], SRC],
  ['main.js: the probe keeps the grain', T + 'main.js', [['post: opts.post || { grain: 0 } });', 'post: opts.post || {} });']], SRC],
  ['main.js: boxes sampled at the shutter centre only', T + 'main.js', [['      const n = subCount(t);\n      for (let s = 0; s < n; s++) {\n        const ts = subTime(t, s, n);', '      const n = 1;\n      for (let s = 0; s < n; s++) {\n        const ts = subTime(t, s, n);']], SRC],
  ['main.js: the camera not read', T + 'main.js', [['const cam = Array.isArray(cfg.cam) ? cfg.cam.map(Number) : [1, 0, 0, 0];', 'const cam = [1, 0, 0, 0];']], SRC],
  ['main.js: a missing font throws under check', T + 'main.js', [['if (problem && !CHECK) throw new Error(problem);', 'if (problem) throw new Error(problem);']], SRC],
  ['render.mjs: provenance not run', T + 'render.mjs', [['      prov = C.provenance(facts);\n      push(prov.result);', '      prov = C.provenance(facts);']], FILE],
  ['render.mjs: --file replays the command line, not render.json', T + 'render.mjs', [['      if (prov.rec) {\n        const r = prov.rec;', '      if (false) {\n        const r = prov.rec;']], FILE],
  ['render.mjs: source checks run on a master that is not bound', T + 'render.mjs', [['const runSource = !plain && (!fileArg || prov.bound);', 'const runSource = !plain;']], FILE],
  ['render.mjs: file_spec not run', T + 'render.mjs', [["      push(C.fileSpec(C.probeFile(file), { w: rec.render[0]", "      void (C.fileSpec(C.probeFile(file), { w: rec.render[0]"]], FILE],
  ['render.mjs: faststart not run', T + 'render.mjs', [["if (want('faststart')) push(C.faststartResult(", "if (false) push(C.faststartResult("]], FILE],
  ['render.mjs: loudness not run', T + 'render.mjs', [["else if (want('loudness')) push(C.loudnessResult(", "else if (false) push(C.loudnessResult("]], FILE],
  ['render.mjs: vo_delay not run', T + 'render.mjs', [['    else push(C.voDelayResult(mj, cues ? cues.VO_OFFSET : NaN));', '    else void 0;']], FILE],
  ['render.mjs: the zone\'s exclude not passed to text_safe', T + 'render.mjs', [['safe: zone.safe, exclude: zone.exclude, windows,', 'safe: zone.safe, windows,']], ZONES],
  ['overlays: the exclude rectangles not shaded', T + 'main.js', [['  for (const e of zone.exclude || []) sc.fillRect(x + e.x * k, y + e.y * k, e.w * k, e.h * k);\n', '']], ZONES],
  ['overlays: safeZone drops the exclude list', T + 'main.js', [['return { name, safe: T.safe, exclude: T.exclude || [], estimate: !!T.estimate };', 'return { name, safe: T.safe, estimate: !!T.estimate };']], ZONES],
  ['render.mjs: ffmpeg left running when a scene throws', T + 'render.mjs', [['  process.exitCode = 1;\n  await abortVideo();', '  process.exitCode = 1;']], ['test/render-error.test.mjs']],
];

const argv = process.argv.slice(2);
if (argv.includes('--list')) { for (const [n, f, , t] of M) console.log(`${n.padEnd(58)} ${path.basename(f).padEnd(11)} ${t.map((x) => path.basename(x)).join(' ')}`); process.exit(0); }
const onlyI = argv.indexOf('--only'), only = onlyI >= 0 ? argv[onlyI + 1] : null;
const todo = M.filter(([n, , , t]) => (!only || n.includes(only)) && (!argv.includes('--fast') || t === UNIT));

// a scratch copy of the repo (no .git, no test/.work), sharing node_modules
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-mutate-'));
fs.cpSync(repo, work, { recursive: true, filter: (src) => {
  const r = path.relative(repo, src).split(path.sep);
  return !(r[0] === '.git' || r[0] === 'node_modules' || (r[0] === 'test' && r[1] === '.work'));
} });
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(work, 'node_modules'), 'dir');
const originals = new Map();
const run = (tests) => spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: work, encoding: 'utf8', maxBuffer: 256 << 20, timeout: 20 * 60 * 1000 });

let bad = 0;
try {
  // the tests must pass unmutated, or a failure proves nothing
  for (const tests of [...new Set(todo.map((m) => m[3].join(' ')))].map((s) => s.split(' '))) {
    const r = run(tests);
    if (r.status !== 0) { console.error(`baseline: ${tests.join(' ')} fails without any mutation; fix that first\n${(r.stdout || '').slice(-3000)}`); process.exit(1); }
  }
  for (const [name, file, edits, tests] of todo) {
    const f = path.join(work, file);
    if (!originals.has(f)) originals.set(f, fs.readFileSync(f, 'utf8'));
    let src = originals.get(f), applies = true;
    for (const [from, to] of edits) {
      const n = src.split(from).length - 1;
      if (n !== 1) { applies = false; break; }
      src = src.replace(from, to);
    }
    if (!applies) { bad++; console.log(`STALE     ${name}: its text is not in ${file} exactly once`); continue; }
    fs.writeFileSync(f, src);
    const t0 = Date.now(), r = run(tests);
    fs.writeFileSync(f, originals.get(f));
    const failed = (r.stdout || '').match(/^✖ (.+?) \(\d/m);
    const caught = r.status !== 0;
    if (!caught) bad++;
    console.log(`${caught ? 'caught   ' : 'SURVIVED '} ${name.padEnd(58)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s  ${caught ? (failed ? failed[1].slice(0, 90) : `exit ${r.status}${r.signal ? ' ' + r.signal : ''}`) : ''}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(`mutations: ${todo.length - bad} of ${todo.length} caught`);
process.exit(bad ? 1 : 0);
