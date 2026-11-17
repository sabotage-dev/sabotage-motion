// Mutation check for `render.mjs check` (plan section 16: "disabling any one detector fails a test"). Each
// mutation below breaks one detector, threshold or wire on purpose in a scratch copy of the repo, runs the
// tests that should notice, and counts it caught when they fail. The repo itself is never touched.
//
//   node test/mutations.mjs              every mutation (about 25 minutes on an Apple-silicon Mac)
//   node test/mutations.mjs --fast       only those the unit tests catch (seconds)
//   node test/mutations.mjs --only <name-substring>
//   node test/mutations.mjs --list       every mutation, and STALE beside any whose text is not in its file exactly once
// Exit 1 when any mutation survives (no test failed) or no longer applies (its text is not in the file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = 'skills/sabotage-motion/template/';
const UNIT = ['test/check-units.test.mjs'], SRC = ['test/check.test.mjs'], FILE = ['test/check-file.test.mjs'], ZONES = ['test/safezones.test.mjs'];
const LU = ['test/looks-units.test.mjs'], LB = ['test/looks.test.mjs'];   // P7: looks and brand kits
// P8: code and terminal motion; TDC runs examples-check on the terminal-demo example alone
const CU = ['test/code-units.test.mjs'], CB = ['test/code.test.mjs'], CE = ['test/code-example.test.mjs'];
const TDC = ['--test-name-pattern=terminal-demo', 'test/examples-check.test.mjs'], EXT = ['test/examples.test.mjs'];
const DOCS = ['test/docs.test.mjs'], ASSETS = ['test/assets.test.mjs'];
// P9: a launch video for a repo; RLC runs examples-check on the repo-launch example alone
const RS = ['test/repo-scan.test.mjs'], SH = ['test/shots.test.mjs'], LE = ['test/launch-example.test.mjs'];
const RLC = ['--test-name-pattern=repo-launch', 'test/examples-check.test.mjs'];

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
  ['boxes: text off the canvas counts as seen', T + 'check.mjs', [['  const c = clipRect(b, W, H);\n  if (!c) return null;\n  const pts = [[c.x, c.y],', '  const c = b;\n  const pts = [[c.x, c.y],']], UNIT],
  ['F4 quad: text off the canvas counts as seen', T + 'check.mjs', [['  const c = clipRect(b, W, H);\n  if (!c) return null;\n  let poly = [[c.x, c.y],', '  const c = b;\n  let poly = [[c.x, c.y],']], UNIT],
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
  ['P4 file_spec: ProRes read back at 12 bits refused', T + 'check.mjs', [["prores: ['yuva444p10le', 'yuva444p12le']", "prores: ['yuva444p10le']"]], UNIT],
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
  ['captions: no room left for the pop', T + 'lib.js', [['maxW: opts.maxW || (span ? (span.right - span.left) / CAPTION_POP_MAX : 900)', 'maxW: opts.maxW || (span ? (span.right - span.left) : 900)']], UNIT],
  ['captions: one group per line, not per block', T + 'lib.js', [['group: `cap-${groups.indexOf(g)}`, line: li', 'group: `cap-${groups.indexOf(g)}-${li}`, line: li']], UNIT],
  ['captions: draw: false still draws', T + 'lib.js', [['const boxes = [], draw = opts.draw !== false;', 'const boxes = [], draw = true;']], UNIT],
  ['F2 captions: no room for the pop between words', T + 'lib.js', [['const gapOf = (a, b) => Math.max(space, ((CAPTION_POP_MAX - 1) / 2) * Math.max(a.w, b.w) + clear);', 'const gapOf = (a, b) => space;']], UNIT],
  ['F2 captions: the clear gap ignores the stroke', T + 'lib.js', [['const clear = o.wordGap != null ? o.wordGap : space / 2 + o.stroke;', 'const clear = o.wordGap != null ? o.wordGap : space / 2;']], UNIT],
  ['F2 captions: an oversized word keeps its width', T + 'lib.js', [['const fit = width > o.maxW ? o.maxW / width : 1;', 'const fit = 1;']], UNIT],
  ['F2 captions: an oversized word is drawn at its full width', T + 'lib.js', [['sc = s * w.fit, tx = mx - w.raw / 2;', 'sc = s, tx = mx - w.raw / 2;']], UNIT],
  ['P4 captions: exclude ignored', T + 'lib.js', [['const span = safe ? captionSpan(safe, opts.exclude, {', 'const span = safe ? captionSpan(safe, undefined, {']], UNIT],
  ['P4 captions: the block centred on the safe area, not the free span', T + 'lib.js', [['const cx = opts.x != null ? opts.x : (span.left + span.right) / 2;', 'const cx = opts.x != null ? opts.x : safe.x + safe.w / 2;']], UNIT],
  ['P4 captionSpan: a rectangle cuts the wrong side', T + 'lib.js', [['if (e.x + e.w / 2 >= (left + right) / 2) right = Math.min(right, e.x);', 'if (e.x + e.w / 2 < (left + right) / 2) right = Math.min(right, e.x);']], UNIT],
  ['P4 captionSpan: the band ignores the block\'s height', T + 'lib.js', [['if (!(e.y < bottom && e.y + e.h > top && e.x < right', 'if (!(e.x < right']], UNIT],
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
  // ---- council round 1 fold (F1-F8)
  ['F1 render.mjs: a scene under out/ is accepted', T + 'render.mjs', [['  if (skipped) return `${f}: a scene under', '  if (false) return `${f}: a scene under']], ['test/render-error.test.mjs']],
  ['F2 render.mjs: ffmpeg dying leaves its partial file', T + 'render.mjs', [['removePartials(); process.exit(1); });', 'process.exit(1); });']], ['test/render-error.test.mjs']],
  ['F2 render.mjs: a failed mux leaves the output and the temp', T + 'render.mjs', [['  await abortVideo();\n  removePartials();\n', '  await abortVideo();\n']], ['test/render-error.test.mjs']],
  ['F3 copy: only the first occurrence counts', T + 'check.mjs', [['at >= 0; at = text.indexOf(want, at + 1)) {', 'at >= 0; at = -1) {']], UNIT],
  ['F4 exclude: tested on the bounding box', T + 'check.mjs', [['...exclude.map((x) => polyRectDepth(quad, x)));', '...exclude.map((x) => polyRectDepth([[b.v.x, b.v.y], [b.v.x + b.v.w, b.v.y], [b.v.x + b.v.w, b.v.y + b.v.h], [b.v.x, b.v.y + b.v.h]], x)));']], UNIT],
  ['F4 exclude: the polygon\'s own edges are not separating axes', T + 'check.mjs', [['    if (len > 1e-9) axes.push([-dy / len, dx / len]);\n', '']], UNIT],
  ['F5 render.mjs: an effects failure only under audio_spike', T + 'render.mjs', [["for (const id of ['board_sfx_missing', 'audio_spike']) push({ id, scope: 'source', level: 'FAIL', detail: `the effects did not render", "for (const id of ['audio_spike']) push({ id, scope: 'source', level: 'FAIL', detail: `the effects did not render"]], SRC],
  ['F6 render.mjs: a scene problem FAILs a run that does not check the scene', T + 'render.mjs', [['  const quiet = !runSource;', '  const quiet = false;']], FILE],
  ['F7 render.mjs: --only file checks without --file is allowed', T + 'render.mjs', [['  if (fileOnly.length) return usage(', '  if (false) return usage(']], SRC],
  ['F8 provenance: the effects problem ignored', T + 'check.mjs', [['    if (f.effectsProblem) probs.push(f.effectsProblem);\n', '']], UNIT],
  ['F8 effectsLink: the source not compared', T + 'check.mjs', [['  if (!match.rec.source || !match.sourceNow || match.rec.source.hash !== match.sourceNow.hash) {', '  if (false) {']], UNIT],
  ['F8 render.mjs: audio writes no record', T + 'render.mjs', [['      writeAudioRecord(out, src);\n', '']], FILE],
  ['F8 render.mjs: full does not record its stem\'s hash', T + 'render.mjs', [[', audioSha256: sha256(fs.readFileSync(atmp)) });', ' });']], FILE],
  ['F8 render.mjs: the effects stem not looked up', T + 'render.mjs', [['          facts.effectsProblem = C.effectsLink({ file: fx.file, sha256: fx.sha256 }, cands, facts.rec || null);\n', '']], FILE],
  // ---- council round 2 fold
  ['R2 sceneProblem: the folder\'s case counts', T + 'render.mjs', [['low = parts.map((x) => x.toLowerCase());', 'low = parts;']], ['test/render-error.test.mjs']],
  ['R2 effectsLink: the settings not compared', T + 'check.mjs', [['hits.find((c) => c.rec === pic || !soundDiff(c.rec, pic).length) : hits[0];', 'hits[0] : hits[0];']], UNIT],
  ['R2 render.mjs: the picture\'s record not passed to effectsLink', T + 'render.mjs', [['cands, facts.rec || null);', 'cands);']], FILE],
  ['R2 render.mjs: a mixed --only drops its file checks', T + 'render.mjs', [['[...only].filter((id) => C.FILE_IDS.includes(id)) : [];', '([...only].every((id) => C.FILE_IDS.includes(id)) ? [...only] : []) : [];']], SRC],
  ['render.mjs: ffmpeg left running when a scene throws', T + 'render.mjs', [['  process.exitCode = 1;\n  await abortVideo();', '  process.exitCode = 1;']], ['test/render-error.test.mjs']],
  // ---- P4: render to a temporary sibling, rename on success
  ['P4 render.mjs: video encodes onto the output itself', T + 'render.mjs', [['const frames = await renderVideo(page, part, from, to);', 'const frames = await renderVideo(page, out, from, to);'],
    ["      promote(part, out);\n      console.log('wrote', out);\n      writeRenderJson(out, src, { from, to, frames,", "      console.log('wrote', out);\n      writeRenderJson(out, src, { from, to, frames,"]], ['test/render-error.test.mjs']],
  ['P4 render.mjs: full muxes onto the output itself', T + 'render.mjs', [["...(videoExt === '.mp4' ? ['-movflags', '+faststart'] : []), part]);", "...(videoExt === '.mp4' ? ['-movflags', '+faststart'] : []), out]);"],
    ["      promote(part, out);\n      console.log('wrote', out, '(audio kept at'", "      console.log('wrote', out, '(audio kept at'"]], ['test/render-error.test.mjs']],
  ['P4 render.mjs: full writes its effects stem onto out/<name>.wav itself', T + 'render.mjs', [['await renderAudioTo(page, apart);', 'await renderAudioTo(page, atmp);'],
    ["'-i', vtmp, '-i', apart,", "'-i', vtmp, '-i', atmp,"], ['      promote(apart, atmp);\n', '']], ['test/render-error.test.mjs']],
  // ---- P4: the asset inventory and the examples
  ['P4 ASSETS.md: a binary not listed (the bed)', 'ASSETS.md', [["| `skills/sabotage-motion/examples/explainer-beat/bed.mp3` |", "| `skills/sabotage-motion/examples/explainer-beat/bed-gone.mp3` |"]], ['test/assets.test.mjs']],
  ['P4 ASSETS.md: a listed file that is missing', 'ASSETS.md', [['|---|---|---|\n', '|---|---|---|\n| `skills/sabotage-motion/examples/showreel/fonts/missing.woff2` | made up | SIL OFL 1.1 |\n']], ['test/assets.test.mjs']],
  ['P4 ASSETS.md: a row with no licence', 'ASSETS.md', [["synthesized from code by `examples/explainer-beat/make-bed.mjs` in this repo (no samples, no recordings) | MIT (this repo's own work), `LICENSE` |", "synthesized from code by `examples/explainer-beat/make-bed.mjs` in this repo (no samples, no recordings) |  |"]], ['test/assets.test.mjs']],
  ['P4 examples: an example\'s engine drifts from the template', 'skills/sabotage-motion/examples/showreel/render.mjs', [["const mode = argv[0];", "const mode = argv[0] ;"]], ['test/examples.test.mjs']],
  ['P4 examples: take.json names another engine than VOICE.md', 'skills/sabotage-motion/examples/explainer-beat/take.json', [['{ "source": "kokoro",', '{ "source": "another-tts",']], ['test/examples.test.mjs']],
  ['P4 examples: the board moves a voiced beat its cues were made from', 'skills/sabotage-motion/examples/explainer-beat/board.js', [["gapBefore: 0.35,", "gapBefore: 0.5,"]], ['test/examples.test.mjs']],
  ['P4 delivery.md: a safe-zone edge drifts from safezones.json', 'skills/sabotage-motion/references/delivery.md', [['| `tiktok` | 1080x1920 | 30 | x 44-940, y 130-1436 |', '| `tiktok` | 1080x1920 | 30 | x 44-950, y 130-1436 |']], ['test/docs.test.mjs']],
  ['P4 render.mjs: a finished video is never renamed onto its output', T + 'render.mjs', [["      promote(part, out);\n      console.log('wrote', out);\n      writeRenderJson(out, src, { from, to, frames,", "      console.log('wrote', out);\n      writeRenderJson(out, src, { from, to, frames,"]], ['test/render-error.test.mjs']],
  ['P5 render.mjs: --dump under --plain writes nothing again', T + 'render.mjs', [["  if (!dump && opt('dump')) dump = { format: 'sabotage-motion/check-dump@1' };\n", '']], ['test/check-file.test.mjs']],
  ['P6 readme-media: the hero budget allows 50 MB', 'scripts/readme-media.mjs', [['hero: { bytes: 5 * 1024 * 1024, width: 640 }', 'hero: { bytes: 50 * 1024 * 1024, width: 640 }']], ['test/docs.test.mjs']],
  ['P6 readme-media: GIFs never measured', 'scripts/readme-media.mjs', [["    if (!r.endsWith('.gif')) continue;", '    continue;']], ['test/docs.test.mjs']],
  ['P6 readme-media: the hero width allows 1280 px', 'scripts/readme-media.mjs', [['hero: { bytes: 5 * 1024 * 1024, width: 640 }', 'hero: { bytes: 5 * 1024 * 1024, width: 1280 }']], ['test/docs.test.mjs']],
  ['P6 readme-media: the tile budget allows 20 MB', 'scripts/readme-media.mjs', [['tile: { bytes: 2 * 1024 * 1024, width: 360 }', 'tile: { bytes: 20 * 1024 * 1024, width: 360 }']], ['test/docs.test.mjs']],
  ['P6 readme-media: the tile width allows 3600 px', 'scripts/readme-media.mjs', [['tile: { bytes: 2 * 1024 * 1024, width: 360 }', 'tile: { bytes: 2 * 1024 * 1024, width: 3600 }']], ['test/docs.test.mjs']],
  ['P6 readme-media: <img> tags never read', 'scripts/readme-media.mjs', [['refs.push(m[1] ?? m[2] ?? m[3]);', 'void m;']], ['test/docs.test.mjs']],
  ['P6 readme-media: reference images never resolved', 'scripts/readme-media.mjs', [['    const d = defs.get((m[2] || m[1]).trim().toLowerCase());\n    if (d) refs.push(d);', '    void m;']], ['test/docs.test.mjs']],
  // ---- P7: looks and a brand kit (plan 23.2). The colour match's thresholds and rules, CIEDE2000, the precedence,
  // brand.json's problems, the font parser, and every wire: font registration, fonts_used, the colour probe, the
  // render record, palette, doctor, the brand sheet, the template's scene and sound reading the style, the docs.
  ['P7 palette: limit 10 -> 11', T + 'check.mjs', [['palette: { limit: 10, bg: 0.15, accent: 0.005 }', 'palette: { limit: 11, bg: 0.15, accent: 0.005 }']], LU],
  ['P7 palette: bg 15% -> 16%', T + 'check.mjs', [['palette: { limit: 10, bg: 0.15, accent: 0.005 }', 'palette: { limit: 10, bg: 0.16, accent: 0.005 }']], LU],
  ['P7 palette: accent 0.5% -> 0.6%', T + 'check.mjs', [['palette: { limit: 10, bg: 0.15, accent: 0.005 }', 'palette: { limit: 10, bg: 0.15, accent: 0.006 }']], LU],
  ['P7 palette: a colour exactly at the limit is no one\'s', T + 'check.mjs', [['if (!(bd <= limit)) { none += n; continue; }', 'if (!(bd < limit)) { none += n; continue; }']], LU],
  ['P7 palette: a tie goes to the later palette', T + 'check.mjs', [['const d = ciede2000(lab, entries[e].lab); if (d < bd) {', 'const d = ciede2000(lab, entries[e].lab); if (d <= bd) {']], LU],
  ['P7 palette: the kit\'s background at exactly 15% fails', T + 'check.mjs', [['{ ok: bg >= T.palette.bg,', '{ ok: bg > T.palette.bg,']], LU],
  ['P7 palette: the kit\'s accent at exactly 0.5% fails', T + 'check.mjs', [['{ ok: accent >= T.palette.accent,', '{ ok: accent > T.palette.accent,']], LU],
  ['P7 palette: bgB not counted with bgA (hand-made matches)', T + 'check.mjs', [['share(p.roles ? p.roles.bg : (p.tokens.bgA || 0) + (p.tokens.bgB || 0))', 'share(p.roles ? p.roles.bg : (p.tokens.bgA || 0))']], LU],
  ['P7 palette: bgB not counted in the background role', T + 'check.mjs', [["    if (E.keys.includes('bgA') || E.keys.includes('bgB')) o.roles.bg += n;", "    if (E.keys.includes('bgA')) o.roles.bg += n;"]], LU],
  ['P7 palette: a look\'s background not compared', T + 'check.mjs', [['{ ok: obg.v <= bg,', '{ ok: true,']], LU],
  ['P7 palette: a look\'s accent not compared', T + 'check.mjs', [['{ ok: oac.v <= accent,', '{ ok: true,']], LU],
  ['P7 ciede2000: the rotation term dropped', T + 'check.mjs', [['Rt = -Math.sin(2 * dTh * DEG) * Rc;', 'Rt = 0 * Rc;']], LU],
  ['P7 ciede2000: the a* rescale (G) dropped', T + 'check.mjs', [['const a1p = (1 + G) * a1, a2p = (1 + G) * a2;', 'const a1p = a1, a2p = a2;']], LU],
  ['P7 lab: sRGB not linearized', T + 'check.mjs', [['return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);', 'return v;']], LU],
  ['P7 precedence: the look over the kit', T + 'looks.js', [["    if (L && L.tokens[k]) { v = L.tokens[k]; from = 'look'; }\n    if (brand && brand.colors && brand.colors[k] != null) { v = brand.colors[k]; from = 'brand'; }",
    "    if (brand && brand.colors && brand.colors[k] != null) { v = brand.colors[k]; from = 'brand'; }\n    if (L && L.tokens[k]) { v = L.tokens[k]; from = 'look'; }"]], LU],
  ['P7 precedence: the kit over --param', T + 'looks.js', [["    if (params[k] != null && params[k] !== '') {", "    if (params[k] != null && params[k] !== '' && !(brand && brand.colors && brand.colors[k] != null)) {"]], LU],
  ['P7 precedence: the kit\'s fonts ignored', T + 'looks.js', [['if (brand && brand.fonts && brand.fonts[r]) f =', 'if (false) f =']], LU],
  ['P7 brand.json: colours not parsed', T + 'looks.js', [['else if (!normHex(v)) p.push(', 'else if (false) p.push(']], LU],
  ['P7 brand.json: files not looked for', T + 'looks.js', [['if (exists && !exists(f)) p.push(', 'if (false) p.push(']], LU],
  ['P7 fontFamilies: quotes kept', T + 'looks.js', [['else if (ch === \'"\' || ch === "\'") q = ch;', 'else if (false) q = ch;']], LU],
  ['P7 bgConfig: grid lines always in accent', T + 'looks.js', [["c(TOKENS.includes(bp.line) ? bp.line : 'accent')", "c('accent')"]], LU],
  ['P7 fixture kit: its accent close to a look\'s', 'test/fixtures/brand-kit/brand.json', [['"accent": "#10A8F8"', '"accent": "#2F6BEE"']], LU],
  ['P7 main.js: look and kit faces loaded but not added', T + 'main.js', [['document.fonts.add(await ff.load());', 'await ff.load();']], LB],
  ['P7 main.js: a missing look or kit font does not stop a render', T + 'main.js', [['if (!CHECK) throw new Error(problem);   // a render stops here', 'if (false) throw new Error(problem);   // a render stops here']], LB],
  ['P7 main.js: a missing look or kit font not reported under check', T + 'main.js', [['FONT_PROBLEMS.push(problem); failed.add(f.family);', 'failed.add(f.family);']], LB],
  ['P7 main.js: look and kit families not added to CFG.FONTS', T + 'main.js', [['if (fams.length) { CFG.FONTS = CFG.FONTS || []; for (const f of fams) if (!CFG.FONTS.includes(f)) CFG.FONTS.push(f); }', '']], LB],
  ['P7 main.js: brand.json not read', T + 'main.js', [['  BRAND = await loadBrand();', '  BRAND = null;']], LB],
  ['P7 main.js: the style not handed to init', T + 'main.js', [['target: T, style: STYLE }));', 'target: T }));']], LB],
  ['P7 main.js: the style not handed to audio.js', T + 'main.js', [['CFG, params, dur, sr, style: STYLE });', 'CFG, params, dur, sr });']], LB],
  ['P7 main.js: strokeText not recorded', T + 'main.js', [["for (const m of ['fillText', 'strokeText']) {", "for (const m of ['fillText']) {"]], LB],
  ['P7 main.js: measureText recorded as a draw', T + 'main.js', [["for (const m of ['fillText', 'strokeText']) {", "for (const m of ['fillText', 'strokeText', 'measureText']) {"]], LB],
  ['P7 main.js: the colour probe keeps the grain', T + 'main.js', [['const p = window.renderProbe(f / FPS, { rgb: true });', 'const p = window.renderProbe(f / FPS, { rgb: true, post: {} });']], LB],
  ['P7 main.js: the colour probe skips frames', T + 'main.js', [['for (let f = 0; f < N; f++) {\n    const p = window.renderProbe(f / FPS, { rgb: true });', 'for (let f = 0; f < N; f += 2) {\n    const p = window.renderProbe(f / FPS, { rgb: true });']], LB],
  ['P7 main.js: brand sheet swatches in one colour', T + 'main.js', [['sc.fillStyle = hex; sc.fillRect(x, y, sw, swH);', 'sc.fillStyle = S.tokens.bgA; sc.fillRect(x, y, sw, swH);']], LB],
  ['P7 main.js: brand sheet logos not drawn', T + 'main.js', [['sc.drawImage(img, x + (gw - iw) / 2, y + (logoH - ih) / 2 - 12, iw, ih);', 'void iw;']], LB],
  ['P7 render.mjs: tokens not in the record', T + 'render.mjs', [['brand: INFO.STYLE.brand, tokens: INFO.STYLE.tokens, ...extra,', 'brand: INFO.STYLE.brand, ...extra,']], LB],
  ['P7 render.mjs: fonts_used not in the video record', T + 'render.mjs', [['writeRenderJson(out, src, { from, to, frames, fonts_used: await page.evaluate(() => window.fontsUsed()) });', 'writeRenderJson(out, src, { from, to, frames });']], LB],
  ['P7 render.mjs: fonts_used not in the full record', T + 'render.mjs', [['frames, fonts_used: await page.evaluate(() => window.fontsUsed()), audio:', 'frames, audio:']], LB],
  ['P7 render.mjs: palette exits 0 on a failure', T + 'render.mjs', [['return res.ok ? 0 : 1;', 'return 0;']], LB],
  ['P7 render.mjs: palette not at the probe scale', T + 'render.mjs', [["mode === 'palette' ? C.T.probeScale : 1;", "mode === 'palette' ? 1 : 1;"]], LB],
  ['P7 render.mjs: palette against the kit and the template only', T + 'render.mjs', [['    ...LK.LOOK_NAMES.map((n) => ({ id: `look ${n}`, tokens: LK.LOOKS[n].tokens }))];', '  ];']], LB],
  ['P7 render.mjs: doctor skips brand.json', T + 'render.mjs', [["if (!fs.existsSync(kitPath)) line(true, 'brand kit',", "if (true) line(true, 'brand kit',"]], LB],
  ['P7 render.mjs: doctor skips the look and kit faces', T + 'render.mjs', [['for (const f of I.FACES) line(f.ok,', 'for (const f of []) line(f.ok,']], LB],
  ['P7 render.mjs: brand.png in the source hash', T + 'render.mjs', [["['board.png', 'contact.png', 'board.md', 'brand.png']", "['board.png', 'contact.png', 'board.md']"]], LB],
  ['P7 scene.js: the title ink not the style\'s', T + 'scene.js', [['ink: ST.tokens.ink, accent: ST.tokens.accent,', "ink: '#F4F1EA', accent: ST.tokens.accent,"]], LB],
  ['P7 scene.js: the background not the style\'s', T + 'scene.js', [['...bgConfig(ST, { alpha: ALPHA }),', "...bgConfig({ ...ST, bg: 'gradient', tokens: { ...ST.tokens, bgA: '#101018', bgB: '#2A1630' } }, { alpha: ALPHA }),"]], LB],
  ['P7 scene.js: the title not in the display face', T + 'scene.js', [["l.font = fontStr(ST, 'display', L.fs);", 'l.font = `${L.fs}px DISPLAY`;']], LB],
  ['P7 audio.js: the timbre ignored', T + 'audio.js', [["...(style ? style.sound : {}) };", '};']], LB],
  ['P7 docs: the README --param line names bg as a colour again', 'README.md', [['and `bg`, the\nbackground shader id: `none`, `gradient`, `paper`, `grid`, `crt` or `mesh`, never a colour)', 'and `bg`, `ink`)']], ['test/docs.test.mjs']],
  ['P7 docs: the looks table drifts from looks.js', 'skills/sabotage-motion/references/looks.md', [['| `brutalist` | condensed type, primaries, snaps | `none` |', '| `brutalist` | condensed type, primaries, snaps | `grid` |']], ['test/docs.test.mjs']],
  ['P7 ASSETS.md: a look font not listed', 'ASSETS.md', [['| `skills/sabotage-motion/looks/fonts/caveat-latin-700-normal.woff2` |', '| `skills/sabotage-motion/looks/fonts/caveat-gone.woff2` |']], ['test/assets.test.mjs']],
  ['P7 palette: a kit colour shared by two tokens credits only the first', T + 'check.mjs', [['      if (pi === 0 && seen.has(key)) {', '      if (false && seen.has(key)) {']], ['test/looks-units.test.mjs']],
  ['P7 palette: a pixel of bgA = bgB counts twice for the background', T + 'check.mjs', [["    if (E.keys.includes('bgA') || E.keys.includes('bgB')) o.roles.bg += n;", "    for (const k of E.keys) if (k === 'bgA' || k === 'bgB') o.roles.bg += n;"]], ['test/looks-units.test.mjs']],
  ['P7 palette: another --scale is accepted', T + 'render.mjs', [["  if (flag('scale') && +opt('scale') !== C.T.probeScale) return usage(", "  if (false) return usage("]], ['test/looks.test.mjs']],
  ['P7 brand.json: a kit that parses to null renders as no kit', T + 'main.js', [["  if (!kit || typeof kit !== 'object' || Array.isArray(kit)) throw new Error('brand.json must hold an object", "  if (false) throw new Error('brand.json must hold an object"]], ['test/looks.test.mjs']],
  ['P7 doctor: a kit that parses to null is not checked', T + 'render.mjs', [['      if (parsed) {   // null or false parse too', '      if (kit) {   // null or false parse too']], ['test/looks.test.mjs']],
  // ---- P8: code and terminal motion (plan 23.3). The highlighter's rules (golden token streams), the theme from the tokens,
  // the seeded typing, scrolling and the cursor, the boxes (cut, scrolled out, groups, deco, the alpha floor), diffs, the
  // terminal, key ticks and their ceiling, frames, and the terminal-demo example's wires: its boxes(t), its key ticks, its
  // colours. CU and CB/CE are fast; TDC runs check on the terminal-demo example alone.
  ["P8 js: keywords not keywords", T + "code.js", [["    if (JS_KW.has(w) || (ts && TS_KW.has(w))) return 'kw';", "    if (false) return 'kw';"]], CU],
  ["P8 ts: its own keywords not keywords", T + "code.js", [["(JS_KW.has(w) || (ts && TS_KW.has(w)))", "(JS_KW.has(w) || (false && TS_KW.has(w)))"]], CU],
  ["P8 ts: primitive types not types", T + "code.js", [["    if (ts && TS_TYPES.has(w)) return 'type';", "    if (false) return 'type';"]], CU],
  ["P8 js: a call not a function", T + "code.js", [["    if (after === '(') return 'fn';\n    return 'plain';\n  };\n}", "    return 'plain';\n  };\n}"]], CU],
  ["P8 js: a property after ?. not a property", T + "code.js", [["if (prev === '.' || prev === '?.') return", "if (prev === '.') return"]], CU],
  ["P8 js: PascalCase not a type", T + "code.js", [["    if (isPascal(w)) return 'type';", "    if (false) return 'type';"]], CU],
  ["P8 js: template literals not strings", T + "code.js", [["  [TEMPLATE, 'str'],", "  [TEMPLATE, 'plain'],"]], CU],
  ["P8 js: block comments not comments", T + "code.js", [["|$)/y, 'com'],\n  [TEMPLATE,", "|$)/y, 'plain'],\n  [TEMPLATE,"]], CU],
  ["P8 js: bigints not numbers", T + "code.js", [["n?/y, 'num'],", "/y, 'num'],"]], CU],
  ["P8 python: comments not comments", T + "code.js", [["const pyRules = [\n  NL, WS,\n  [/#", "const pyRules = [\n  NL, WS,\n  [/~"]], CU],
  ["P8 python: triple-quoted strings not strings", T + "code.js", [["|$))/y, 'str'],", "|$))/y, 'plain'],"]], CU],
  ["P8 python: a lower-case class not a type", T + "code.js", [["if (prev === 'class' || isPascal(w)) return 'type';", "if (isPascal(w)) return 'type';"]], CU],
  ["P8 shell: commands not commands", T + "code.js", [["    st.cmdPos = false;\n    return 'cmd';", "    st.cmdPos = false;\n    return 'plain';"]], CU],
  ["P8 shell: after a pipe not a command", T + "code.js", [["if (['||', '&&', ';;', '|', '&', ';', '('].includes(s) && !(pat && s === '|'))", "if (['||', '&&', ';;', '&', ';', '('].includes(s) && !(pat && s === '|'))"]], CU],
  ["P8 shell: flags not flags", T + "code.js", [["  if (/^--?[A-Za-z0-9]/.test(w)) return 'flag';", "  if (false) return 'flag';"]], CU],
  ["P8 shell: --flag=value not split", T + "code.js", [["  if (f) return [{ k: 'flag', s: f[1] },", "  if (false) return [{ k: 'flag', s: f[1] },"]], CU],
  ["P8 shell: a prompt not a prompt", T + "code.js", [["(st.lineStart ? 'prompt' : 'plain')", "('plain')"]], CU],
  ["P8 shell: variables not variables", T + "code.js", [["[0-9#?@*$!-])/y, 'var'],", "[0-9#?@*$!-])/y, 'plain'],"]], CU],
  ["P8 shell: in after for, case or select not a keyword", T + "code.js", [["  if (w === 'in' && st.awaitIn) {", "  if (false) {"]], CU],
  ["P8 json: keys not keys", T + "code.js", [["(nextChar(src, j) === ':' ? 'prop' : 'str')", "('str')"]], CU],
  ["P8 diff: --- in a hunk read as a header", T + "code.js", [["    if (!st.hunk && /^(?:--- ", "    if (/^(?:--- "]], CU],
  ["P8 diff: a new file does not end the hunk", T + "code.js", [["if (/^diff /.test(line)) { st.hunk = false; st.counts = null; return 'meta'; }", "if (/^diff /.test(line)) { return 'meta'; }"]], CU],
  ["P8 tokenize: a token spans lines", T + "code.js", [["    const parts = t.s.split('\\n');", "    const parts = [t.s];"]], CU],
  ["P8 tokenize: neighbours of one kind not merged", T + "code.js", [["if (last && last.k === t.k && t.k !== 'nl') last.s += p; else", "if (false) last.s += p; else"]], CU],
  ["P8 theme: keywords not the accent", T + "code.js", [["plain: T.ink, kw: T.accent, lit:", "plain: T.ink, kw: T.accent2, lit:"]], CU],
  ["P8 theme: strings not accent2", T + "code.js", [["str: T.accent2, num:", "str: T.accent, num:"]], CU],
  ["P8 theme: comments not muted", T + "code.js", [["    com: T.muted, fn:", "    com: T.ink, fn:"]], CU],
  ["P8 theme: added and removed lines swapped", T + "code.js", [["fromGreen(T.accent2) <= fromGreen(T.accent) ?", "fromGreen(T.accent2) > fromGreen(T.accent) ?"]], CU],
  ["P8 theme: contrast floor 3 -> 2.5", T + "code.js", [["export const CODE_CONTRAST = 3;", "export const CODE_CONTRAST = 2.5;"]], CU],
  ["P8 theme: colours not raised to read", T + "code.js", [["for (const x of KINDS) colors[x] = readable(over[x] || k[x], surface, T.ink);", "for (const x of KINDS) colors[x] = over[x] || k[x];"]], CU],
  ["P8 theme: the mono face not the style's", T + "code.js", [["family: over.family || fam('mono', 'MONO')", "family: over.family || 'MONO'"]], CU],
  ["P8 theme: the panel not from the tokens", T + "code.js", [["const surface = over.surface || mix(T.bgA, T.ink, 0.06);", "const surface = over.surface || '#1E1E25';"]], CU],
  ["P8 typing: not seeded", T + "code.js", [["const rnd = mulberry32((ty.seed >>> 0) || 1);", "const rnd = mulberry32(1);"]], CU],
  ["P8 typing: no jitter", T + "code.js", [["(1 + ty.jitter * (2 * rnd() - 1))", "(1 + 0 * (2 * rnd() - 1))"]], CU],
  ["P8 typing: no pause after a newline", T + "code.js", [["if (c === '\\n') { t += ty.linePause; indent = true; }", "if (c === '\\n') { indent = true; }"]], CU],
  ["P8 typing: no pause after a space", T + "code.js", [["+ (c === ' ' ? ty.spacePause : 0);", "+ 0;"]], CU],
  ["P8 typing: indentation typed key by key", T + "code.js", [["if (indent && c === ' ') { T[i] = i > from ? T[i - 1] : t; continue; }", "if (false) { T[i] = i > from ? T[i - 1] : t; continue; }"]], CU],
  ["P8 typing: the first key late", T + "code.js", [["    T[i] = t;\n    keys.push(", "    T[i] = t + 0.01;\n    keys.push("]], CU],
  ["P8 typing: a key shows only after its time", T + "code.js", [["if (T[m] <= t) lo = m + 1; else hi = m;", "if (T[m] < t) lo = m + 1; else hi = m;"]], CU],
  ["P8 scroll: no margin under the cursor", T + "code.js", [["const want = (L) => clamp(L - (g.rows - 1 - margin), 0, maxTop);", "const want = (L) => clamp(L - (g.rows - 1), 0, maxTop);"]], CU],
  ["P8 scroll: past the last line", T + "code.js", [["const want = (L) => clamp(L - (g.rows - 1 - margin), 0, maxTop);", "const want = (L) => Math.max(0, L - (g.rows - 1 - margin));"]], CU],
  ["P8 scroll: moves jump instead of easing", T + "code.js", [["s + m.by * swift(prog(t, m.at, m.at + m.dur))", "s + m.by * (t >= m.at ? 1 : 0)"]], CU],
  ["P8 scroll: explicit moves ignored", T + "code.js", [["  if (o.scroll) {\n    let prev = 0;", "  if (false) {\n    let prev = 0;"]], CU],
  ["P8 cursor: never blinks", T + "code.js", [["  return p < period / 2;", "  return true;"]], CU],
  ["P8 cursor: blinks while keys come", T + "code.js", [["  if (t - last < CURSOR_SOLID) return true;", "  if (false) return true;"]], CU],
  ["P8 cursor: solid 0.5 -> 0.6 s", T + "code.js", [["export const CURSOR_SOLID = 0.5;", "export const CURSOR_SOLID = 0.6;"]], CU],
  ["P8 boxes: not cut to their viewport", T + "code.js", [["x1 > x0 && y1 > y0 ? { ...b, x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;", "x1 > x0 && y1 > y0 ? { ...b } : null;"]], CU],
  ["P8 boxes: lines scrolled out kept", T + "code.js", [["return x1 > x0 && y1 > y0 ? { ...b, x: x0", "return true ? { ...b, x: x0"]], CU],
  ["P8 boxes: a code block's lines in separate groups", T + "code.js", [["h: b.size, group: b.id, line: L + 1 }, view);", "h: b.size, group: `${b.id}:${L}`, line: L + 1 }, view);"]], CU],
  ["P8 boxes: a session's rows in separate groups", T + "code.js", [["group: b.id, line: n.i + 1 }", "group: `${b.id}:${n.i}`, line: n.i + 1 }"]], CU],
  ["P8 boxes: a diff's lines in separate groups", T + "code.js", [["group: b.id, line: i + 1 }, slot);", "group: `${b.id}:${i}`, line: i + 1 }, slot);"]], CU],
  ["P8 boxes: the code cursor not deco", T + "code.js", [["text: '', ...r, deco: true }, view);", "text: '', ...r }, view);"]], CU],
  ["P8 boxes: the terminal cursor not deco", T + "code.js", [["text: '', ...c, deco: true }, view);", "text: '', ...c }, view);"]], CU],
  ["P8 boxes: a frame not deco", T + "code.js", [["w: O.w, h: O.h, deco: true });", "w: O.w, h: O.h });"]], CU],
  ["P8 boxes: a frame's title not deco", T + "code.js", [["w: lw, h: fs, deco: true });", "w: lw, h: fs });"]], CU],
  ["P8 boxes: alpha floor 0.05 -> 0.04", T + "code.js", [["const BOX_ALPHA = 0.05;", "const BOX_ALPHA = 0.04;"]], CU],
  ["P8 boxes: a dimmed line still reported", T + "code.js", [["if ((e || b.numbers) && alpha * dim > BOX_ALPHA) {", "if ((e || b.numbers) && alpha > BOX_ALPHA) {"]], CU],
  ["P8 boxes: dx and dy not applied", T + "code.js", [["const st = codeAt(b, t), out = [];\n  out.state = st;\n  if (alpha <= 0) return out;\n  const vx = b.x + dx, vy = b.y + dy,", "const st = codeAt(b, t), out = [];\n  out.state = st;\n  if (alpha <= 0) return out;\n  const vx = b.x, vy = b.y,"]], CU],
  ["P8 diff: an opening line pushes the lines under it a whole row", T + "code.js", [["    at += hgt;", "    at += 1;"]], CU],
  ["P8 diff: the changes land at once", T + "code.js", [["start + step * k++", "start + 0 * k++"]], CU],
  ["P8 diff: it does not follow a change down", T + "code.js", [["const want = Math.max(0, i + 1 + margin - g.rows);", "const want = Math.max(0, i + margin - g.rows);"]], CU],
  ["P8 diff: context counted as landed", T + "code.js", [["(r.kind === 'add' || r.kind === 'del') && t >= r.at).length", "t >= r.at).length"]], CU],
  ["P8 diff: added lines open at once", T + "code.js", [["open: r.kind === 'add' ? snap(prog(t, r.at, r.at + b.grow)) : 1,", "open: r.kind === 'add' ? (t >= r.at ? 1 : 0) : 1,"]], CU],
  ["P8 terminal: output lines all at once", T + "code.js", [["at: t + i * every,", "at: t,"]], CU],
  ["P8 terminal: the spinner turns twice as fast", T + "code.js", [["Math.floor((t - r.at) * r.fps + 1e-9)", "Math.floor((t - r.at) * r.fps * 2 + 1e-9)"]], CU],
  ["P8 terminal: the bar not eased", T + "code.js", [["const fill = k >= 1 ? 1 : swift(k);", "const fill = k >= 1 ? 1 : k;"]], CU],
  ["P8 terminal: a step's at ignored", T + "code.js", [["const begin = (t, s) => Math.max(t + (s.after || 0), s.at != null ? s.at : -Infinity);", "const begin = (t, s) => t + (s.after || 0);"]], CU],
  ["P8 terminal: a command's at ignored", T + "code.js", [["at0 = s.at != null ? Math.max(t, s.at) :", "at0 = false ? 0 :"]], CU],
  ["P8 terminal: Enter not a key press", T + "code.js", [["keys.push(...cad.keys, { t: enter, key: 'enter' });", "keys.push(...cad.keys);"]], CU],
  ["P8 terminal: a prompt before its step is done", T + "code.js", [["rows.push({ type: 'cmd', at: rows.length ? t : -Infinity, text: prompt + cmd,", "rows.push({ type: 'cmd', at: -Infinity, text: prompt + cmd,"]], CU],
  ["P8 terminal: no closing prompt", T + "code.js", [["if (o.end !== false) rows.push(", "if (false) rows.push("]], CU],
  ["P8 terminal: it does not scroll", T + "code.js", [["const want = Math.max(0, i + 1 - g.rows);", "const want = 0;"]], CU],
  ["P8 terminal: a bar's box leaves out the bar", T + "code.js", [["ext = [0, cols + 1 + r.width + 1 + `${n.pct}%`.length];", "ext = null;"]], CU],
  ["P8 keys: ceiling 12 -> 13", T + "code.js", [["export const KEY_MAX = 12;", "export const KEY_MAX = 13;"]], CU],
  ["P8 keys: no gap kept between ticks", T + "code.js", [["if (kept.length && k.t - kept[kept.length - 1].t < 1 / max - 1e-9) continue;", ""]], CU],
  ["P8 keys: the one-second window not counted", T + "code.js", [["if (kept.length - w >= max) continue;", ""]], CU],
  ["P8 keySounds: the ticks late", T + "code.js", [["src.start(k.t); src.stop(k.t + 0.06);", "src.start(k.t + 0.02); src.stop(k.t + 0.08);"]], CB],
  ["P8 keySounds: Enter not played", T + "code.js", [["  for (const k of ticks) {", "  for (const k of ticks.filter((x) => x.key !== 'enter')) {"]], CB],
  ["P8 frames: content under the title bar", T + "code.js", [["content: { x: r.x, y: r.y + bar, w: r.w, h: r.h - bar }", "content: { x: r.x, y: r.y, w: r.w, h: r.h }"]], CU],
  ["P8 frames: the browser bar a window's", T + "code.js", [["kind === 'browser' ? 72 : 56", "kind === 'browser' ? 56 : 56"]], CU],
  ["P8 frames: reported at any alpha", T + "code.js", [["  if (alpha > BOX_ALPHA) {\n    out.push({ id: `${id}:frame`", "  if (true) {\n    out.push({ id: `${id}:frame`"]], CU],
  ["P8 terminal-demo: boxes(t) without the terminal", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["  out.push(...terminal(ctx, TERM, t, { dy: ly, draw: false }));\n", ""]], TDC],
  ["P8 terminal-demo: boxes(t) without the diff", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["    out.push(...drawDiff(ctx, DIFFB, t, { alpha: dk, dy: (1 - dk) * 40, draw: false }));\n", ""]], TDC],
  ["P8 terminal-demo: the key ticks not played", "skills/sabotage-motion/examples/terminal-demo/audio.js", [["  keySounds(ac, keys, TL.keys, { seed: 5, level: 0.2, style });", ""]], CE],
  ["P8 terminal-demo: the key presses not thinned", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["TL.keys = keyTicks(typedTimes(TERM));", "TL.keys = typedTimes(TERM);"]], CE],
  ["P8 terminal-demo: the code not in the look's colours", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["TH = codeTheme(ST);", "TH = codeTheme(null);"]], CE],
  ["P8 docs: code.md's ceiling drifts", "skills/sabotage-motion/references/code.md", [["at most `KEY_MAX` (12) a second", "at most `KEY_MAX` (14) a second"]], DOCS],
  ["P8 docs: code.md leaves out a language", "skills/sabotage-motion/references/code.md", [["Languages: `js`, `ts` (also", "Languages: `js`, (also"]], DOCS],
  ["P8 docs: SKILL.md drops code.js", "skills/sabotage-motion/SKILL.md", [["| `code.js` |", "| `codes.js` |"]], DOCS],
  ["P8 docs: CI does not run the code suites", ".github/workflows/ci.yml", [[" && npm run test:code &&", " &&"]], DOCS],
  ["P8 ASSETS.md: the terminal demo's contact sheet not listed", "ASSETS.md", [["| `skills/sabotage-motion/examples/terminal-demo/contact.png` |", "| `skills/sabotage-motion/examples/terminal-demo/contact-gone.png` |"]], ASSETS],
  ["P8 examples: the template's code.js changed, not its copies", T + "code.js", [["// Code and terminal motion (plan 23.3): a built-in highlighter,", "// Code and terminal motion (plan 23.3): a built in highlighter,"]], EXT],
  // ---- P8 council round 1 fold: gutter numbers boxed, shell continuations, word-start comments, in and case bodies,
  // untyped code taller than its view, a box's text only what shows, hunks ended by their counts, escapes in triple
  // strings and nested template literals, each side of a hunk coloured as one source, one-line commands, shown lines'
  // indentation, output through normCode, an unknown kind's colour, the example's line and hunk header.
  ["P8 fold 1: a row with only its number has no box", T + "code.js", [["if ((e || b.numbers) && alpha * dim > BOX_ALPHA) {", "if (e && alpha * dim > BOX_ALPHA) {"]], CU],
  ["P8 fold 1: a number-only box has no text", T + "code.js", [["|| (b.numbers ? visible(num, nx, adv, view) : '');", "|| '';"]], CU],
  ["P8 fold 1: a number's box starts at the gutter's padding", T + "code.js", [["num = String(L + 1), nx = x0 + (nd - num.length) * adv;", "num = String(L + 1), nx = x0;"]], CU],
  ["P8 fold 2: a \\ continuation starts a new command", T + "code.js", [["  [/\\\\(?=\\n)/y, (s, src, j, st) => { st.cont = true; return 'op'; }],", "  [/\\\\(?=\\n)/y, 'op'],"]], CU],
  ["P8 fold 2: # starts a comment mid-word", T + "code.js", [["return p === undefined || /[\\s;|&()<>]/.test(p) ? 'com' : false; }],", "return 'com'; }],"]], CU],
  ["P8 fold 2: a declined rule is not passed over", T + "code.js", [["      if (k === false) continue;\n", ""]], CU],
  ["P8 fold 2: in forgets its for across a continuation", T + "code.js", [["st.awaitIn = ['for', 'case', 'select'].includes(w) ? w : false; return 'kw'; }", "st.awaitIn = false; return 'kw'; }"]], CU],
  ["P8 fold 2: after a case pattern's ) no command", T + "code.js", [["    if (pat && s === ')') { st.casePat = false; st.cmdPos = true; }", ""]], CU],
  ["P8 fold 2: a case pattern on its own line read as a command", T + "code.js", [["if (!st.cont) st.cmdPos = !(st.caseBody && st.casePat);", "if (!st.cont) st.cmdPos = true;"]], CU],
  ["P8 fold 2: esac read as a word in a case body", T + "code.js", [["  if (w === 'esac' && st.caseBody && (st.cmdPos || st.casePat)) {", "  if (false) {"]], CU],
  ["P8 fold 3: untyped code schedules moves at -Infinity", T + "code.js", [["} else if (o.follow !== false && o.type !== false) {", "} else if (o.follow !== false) {"], ["if (c === '\\n' && i >= from && Number.isFinite(cad.T[i])) {", "if (c === '\\n' && i >= from) {"]], CU],
  ["P8 fold 4: a box's text is the whole line (code)", T + "code.js", [["bb.text = (e && visible(text, tx, adv, view))", "bb.text = (e && text.trim())"]], CU],
  ["P8 fold 4: a box's text is the whole line (diff)", T + "code.js", [["if (bb) { bb.text = visible(shows, x0, adv, view); out.push(bb); }", "if (bb) { bb.text = shows.trim(); out.push(bb); }"]], CU],
  ["P8 fold 4: a box's text is the whole line (terminal)", T + "code.js", [["if (bb) { bb.text = ext ? text : visible(text, x0, adv, view); out.push(bb); }", "if (bb) { bb.text = text.trim(); out.push(bb); }"]], CU],
  ["P8 fold 4: a bar row's text keeps its hidden percentage", T + "code.js", [["text = [visible(r.text, x0, adv, view), visible(`${n.pct}%`, bx + bw + adv, adv, view)].filter(Boolean).join(' ');", "text = `${r.text} ${n.pct}%`;"]], CU],
  ["P8 fold 4: a cell cut at the edge does not count", T + "code.js", [["hi = Math.min(cs.length, Math.ceil((view.x + view.w - x) / adv - 1e-9));", "hi = Math.min(cs.length, Math.floor((view.x + view.w - x) / adv + 1e-9));"]], CU],
  ["P8 fold 5: a hunk never ends on its counts", T + "code.js", [["if (st.counts.old <= 0 && st.counts.new <= 0) { st.hunk = false; st.counts = null; }", ""]], CU],
  ["P8 fold 5: a blank line in a hunk not counted", T + "code.js", [["if (st.hunk && a > 0 && src[a - 1] === '\\n') useLine(st, 1, 1); return 'nl'; }],", "return 'nl'; }],"]], CU],
  ["P8 fold 5: a header without counts counts none", T + "code.js", [["return m ? { old: m[1] != null ? +m[1] : 1, new: m[2] != null ? +m[2] : 1 } : null;", "return m ? { old: m[1] != null ? +m[1] : 0, new: m[2] != null ? +m[2] : 0 } : null;"]], CU],
  ["P8 fold 5: an added line counts on the old side", T + "code.js", [["if (st.hunk) useLine(st, kind === 'add' ? 0 : 1, kind === 'del' ? 0 : 1);", "if (st.hunk) useLine(st, 1, kind === 'del' ? 0 : 1);"]], CU],
  ["P8 fold 6: an escaped quote ends a triple-quoted string", T + "code.js", [["(?:\"\"\"(?:\\\\[\\s\\S]|[^\\\\])*?(?:\"\"\"|$)", "(?:\"\"\"[\\s\\S]*?(?:\"\"\"|$)"]], CU],
  ["P8 fold 6: a template literal inside ${} ends the outer one", T + "code.js", [["    else if (c === '`') { const e = templateScan(s, j); if (!e.closed) return { end: e.end, stop: true }; next = e.end; }\n", ""]], CU],
  ["P8 fold 6: ${ not followed into", T + "code.js", [["    else if (c === '$' && s[j + 1] === '{') { const e = exprScan(s, j + 2); if (e.stop) return { end: e.end, closed: false }; j = e.end; } else j++;", "    else j++;"]], CU],
  ["P8 fold 7: diff lines coloured one by one", T + "code.js", [["for (const r of rows) if (r.kind !== 'hunk') { if (!pieces.has(r.piece)) pieces.set(r.piece, []); pieces.get(r.piece).push(r); }", "for (const r of rows) if (r.kind !== 'hunk') pieces.set(pieces.size, [r]);"]], CU],
  ["P8 fold 7: context coloured as the old file", T + "code.js", [["if (r.kind === mine || (mine === 'add' && r.kind === 'ctx')) r.toks = hl[i] || [];", "if (r.kind === mine || (mine === 'del' && r.kind === 'ctx')) r.toks = hl[i] || [];"]], CU],
  ["P8 fold 8: a command with a newline accepted", T + "code.js", [["    if (v.includes('\\n')) throw new Error(", "    if (false) throw new Error("]], CU],
  ["P8 fold 8: code.md does not say a command is one row", "skills/sabotage-motion/references/code.md", [["one with a newline is an error that says so", "one with a newline is cut at it"]], DOCS],
  ["P8 fold 9: shown lines' next indentation typed key by key", T + "code.js", [["indent = from > 0 && chars[from - 1] === '\\n';", "indent = false;"]], CU],
  ["P8 fold 9: terminal output not through normCode", T + "code.js", [[".flatMap((x) => normCode(String(x), tab).split('\\n'))", ".map(String)"]], CU],
  ["P8 fold 9: an unknown kind keeps the colour drawn before it", T + "code.js", [["const colorOf = (theme, k, fallback = 'plain') => theme.colors[k] || theme.colors[fallback] || theme.colors.plain;", "const colorOf = (theme, k, fallback = 'plain') => theme.colors[k];"]], CU],
  ["P8 fold 9: the example names line 16 again", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["src/clock.ts:15", "src/clock.ts:16"]], CE],
  ["P8 fold 9: the example's hunk header counts six lines", "skills/sabotage-motion/examples/terminal-demo/scene.js", [["@@ -14,5 +14,5 @@", "@@ -14,6 +14,6 @@"]], CE],
  ["P8 fold 9: code.md does not name nested template literals", "skills/sabotage-motion/references/code.md", [["`${...}` included, and nests", "`${...}` included"]], DOCS],
  // ---- P8 council round 2: hidden hunk headers keep their hunks apart, a regex in ${} (at its start, after an operator,
  // after return, in a template inside) stops the scan and the template ends at the next backtick, a template that runs
  // out is not closed, esac only where a command or a pattern starts, code.md's one account of a diff's colours.
  ["P8 R2 hunks: false joins its hunks for colouring", T + "code.js", [["    if (kind === 'hunk') piece++;", "    if (kind === 'hunk' && o.hunks !== false) piece++;"]], CU],
  ["P8 R2 a regex in ${} read as code", T + "code.js", [["    else if (c === '/' && (!prev || REGEX_PREV.has(prev) || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))) { next = regexEnd(s, j); if (next < 0) return { end: j, stop: true }; }\n", ""]], CU],
  ["P8 R2 a regex at the start of ${} read as division", T + "code.js", [["(!prev || REGEX_PREV.has(prev) || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))", "(REGEX_PREV.has(prev) || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))"]], CU],
  ["P8 R2 a regex after an operator in ${} read as division", T + "code.js", [["(!prev || REGEX_PREV.has(prev) || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))", "(!prev || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))"]], CU],
  ["P8 R2 a regex after return in ${} read as division", T + "code.js", [["(!prev || REGEX_PREV.has(prev) || (REGEX_AFTER.has(word) && (word !== 'of' || parens[parens.length - 1] === 'for')))", "(!prev || REGEX_PREV.has(prev))"]], CU],
  ["P8 R2 a template inside ${} that stopped is read past", T + "code.js", [["if (!e.closed) return { end: e.end, stop: true }; next = e.end; }", "next = e.end; }"]], CU],
  ["P8 R2 a template that runs out counts as closed", T + "code.js", [["  return { end: s.length, closed: false };\n}", "  return { end: s.length, closed: true };\n}"]], CU],
  ["P8 R2 no fallback to the next backtick", T + "code.js", [["return r.closed ? r.end : plainEnd(s, i);", "return r.end;"]], CU],
  ["P8 R2 esac as an argument ends the case", T + "code.js", [["st.caseBody && (st.cmdPos || st.casePat)) {", "st.caseBody) {"]], CU],
  ["P8 R2 esac where a pattern starts not a keyword", T + "code.js", [["st.caseBody && (st.cmdPos || st.casePat)) {", "st.caseBody && st.cmdPos) {"]], CU],
  ["P8 R2 code.md: context in the old file's colours", "skills/sabotage-motion/references/code.md", [["context lines take the new file's", "context lines take the old file's"]], DOCS],
  ["P8 R2 code.md: a hidden header joins the hunks", "skills/sabotage-motion/references/code.md", [["Each hunk starts afresh, whether its header shows or not.", "Hidden hunk headers join the hunks."]], DOCS],
  // ---- P8 council round 3: a ${} read a token at a time: a regex is a token (its closing / outside a [...] class, on
  // its line), a / after postfix ++ or -- (after a name, a ) or a ]) divides, a / after a control condition's ) starts a
  // regex, a keyword after a dot is a name, a comment is not a token; a string or a regex not closed on its line falls back.
  ["P8 R3 a regex that does not close on its line runs on", T + "code.js", [["    if (c === '\\n') return -1;\n    if (c === '\\\\') { if (s[k + 1] === '\\n') return -1; k++; }", "    if (c === '\\\\') { k++; }"]], CU],
  ["P8 R3 a / in a [...] class closes the regex", T + "code.js", [["else if (c === '[') cls = true;", "else if (false) cls = true;"]], CU],
  ["P8 R3 a / after postfix ++ starts a regex", T + "code.js", [["last = prev === 'a' || prev === ')' || prev === ']' ? ')' : c; }", "last = c; }"]], CU],
  ["P8 R3 ++ after a ) is not postfix", T + "code.js", [["prev === 'a' || prev === ')' || prev === ']' ? ')' : c;", "prev === 'a' || prev === ']' ? ')' : c;"]], CU],
  ["P8 R3 ++ after a ] is not postfix", T + "code.js", [["prev === 'a' || prev === ')' || prev === ']' ? ')' : c;", "prev === 'a' || prev === ')' ? ')' : c;"]], CU],
  ["P8 R3 a / after a control condition divides", T + "code.js", [["else if (c === ')') { if (parens.pop()) last = ';'; }", "else if (c === ')') { parens.pop(); }"]], CU],
  ["P8 R3 if, while, for and with not seen before (", T + "code.js", [["else if (c === '(') parens.push(CONTROL.has(word) ? word : '');", "else if (c === '(') parens.push('');"]], CU],
  ["P8 R4 of takes an operand anywhere (of / 2 read as a regex)", T + "code.js", [["(word !== 'of' || parens[parens.length - 1] === 'for')", "(true)"]], CU],
  ["P8 R4 of never takes an operand (a regex after for (... of read as division)", T + "code.js", [["(word !== 'of' || parens[parens.length - 1] === 'for')", "(word !== 'of')"]], CU],
  ["P8 R3 a string that does not close on its line runs on", T + "code.js", [["    else if (s[k] === '\\n') return -1;\n", ""]], CU],
  ["P8 R3 a keyword after a dot starts a regex", T + "code.js", [[" if (prev === '.') w = ''; }", " }"]], CU],
  ["P8 R3 a comment counts as the token before a /", T + "code.js", [["      if (n === '/') { while (j < s.length && s[j] !== '\\n') j++; } else { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 2; }\n      continue;", "      if (n === '/') { while (j < s.length && s[j] !== '\\n') j++; } else { const e = s.indexOf('*/', j + 2); j = e < 0 ? s.length : e + 2; }\n      prev = '/'; continue;"]], CU],
  ["P8 R3 code.md: a regex in ${} not named as read", "skills/sabotage-motion/references/code.md", [["Inside `${}`, a `/` where an operand belongs", "Inside a template, a `/` where an operand belongs"]], DOCS],
  // ---- P9: a launch video for a repo (plan 23.4). The scan's sources, lines, skips, rules and draft kit; the network
  // guard; the shots' size limit, full page, scroll, clock, animations, layout and fps; the example's wires; the docs.
  // RS and LE are fast; SH captures pages in Chrome (about 15 s a run); RLC runs check on the repo-launch example alone.
  ["P9 scan: node_modules read", T + "tools/repo-scan.mjs", [["export const SKIP_DIRS = ['node_modules', 'bower_components',", "export const SKIP_DIRS = ['bower_components',"]], RS],
  ["P9 scan: dist read", T + "tools/repo-scan.mjs", [["'target', 'dist', 'build', 'out',", "'target', 'build', 'out',"]], RS],
  ["P9 scan: hidden folders read", T + "tools/repo-scan.mjs", [["(name.startsWith('.') && name !== '.github')", "(false)"]], RS],
  ["P9 scan: .github skipped", T + "tools/repo-scan.mjs", [["(name.startsWith('.') && name !== '.github')", "(name.startsWith('.'))"]], RS],
  ["P9 scan: CSS custom properties not read", T + "tools/repo-scan.mjs", [["  for (const f of styleFiles) props.push(...customProps(texts.get(f.rel), f.rel));\n", ""]], RS],
  ["P9 scan: comments read as code", T + "tools/repo-scan.mjs", [["const stripCss = (s) => s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, blank).replace(/<!--[\\s\\S]*?-->/g, blank);", "const stripCss = (s) => s;"]], RS],
  ["P9 scan: lines off by one", T + "tools/repo-scan.mjs", [["  return lo + 1;\n}", "  return lo;\n}"]], RS],
  ["P9 scan: var() not followed", T + "tools/repo-scan.mjs", [["for (let k = 0; !c && k < 5; k++) {", "for (let k = 0; !c && k < 0; k++) {"]], RS],
  ["P9 parseColor: #rgba not doubled", T + "tools/repo-scan.mjs", [["const h = m[1].length <= 4 ?", "const h = m[1].length < 4 ?"]], RS],
  ["P9 parseColor: #rrggbbaa's alpha ignored", T + "tools/repo-scan.mjs", [["alpha: h.length === 8 ? parseInt", "alpha: false ? parseInt"]], RS],
  ["P9 scan: the Tailwind config not read", T + "tools/repo-scan.mjs", [["if (TAILWIND_RE.test(base)) colors", "if (false) colors"]], RS],
  ["P9 scan: Tailwind's DEFAULT kept in the name", T + "tools/repo-scan.mjs", [[".filter((x) => x !== 'DEFAULT').join('-')", ".join('-')"]], RS],
  ["P9 scan: the manifest's theme_color not read", T + "tools/repo-scan.mjs", [["      colors.manifest.push(...manifestColors(t, f.rel));\n", ""]], RS],
  ["P9 kit: theme_color wins over a named accent", T + "tools/repo-scan.mjs", [["if (!colors.accent && theme) {", "if (theme) {"]], RS],
  ["P9 kit: bgB not filled from bgA", T + "tools/repo-scan.mjs", [["  if (colors.bgA && !colors.bgB) {", "  if (false) {"]], RS],
  ["P9 kit: the last colour of a token wins", T + "tools/repo-scan.mjs", [["if (tok && !colors[tok]) {", "if (tok) {"]], RS],
  ["P9 tokenFor: borders, shadows and on- colours become tokens", T + "tools/repo-scan.mjs", [["  if (has(...T.never)) return null;\n", ""]], RS],
  ["P9 tokenFor: a scale's shades become tokens", T + "tools/repo-scan.mjs", [["!['2', '500'].includes(x))) return null;", "!['2', '500'].includes(x) && false)) return null;"]], RS],
  ["P9 tokenFor: muted read as ink", T + "tools/repo-scan.mjs", [["if (has(...T.muted)) return", "if (false) return"]], RS],
  ["P9 tokenFor: a surface is bgA", T + "tools/repo-scan.mjs", [["return has(...T.bgB, ...T.second) ? 'bgB' : 'bgA';", "return has(...T.second) ? 'bgB' : 'bgA';"]], RS],
  ["P9 scan: @font-face not read", T + "tools/repo-scan.mjs", [["fonts.push(...fontFaces(t, f.rel, resolveLocal), ...fontLinks(t, f.rel));", "fonts.push(...fontLinks(t, f.rel));"]], RS],
  ["P9 scan: font links not read", T + "tools/repo-scan.mjs", [["fonts.push(...fontFaces(t, f.rel, resolveLocal), ...fontLinks(t, f.rel));", "fonts.push(...fontFaces(t, f.rel, resolveLocal));"]], RS],
  ["P9 scan: woff2 not preferred", T + "tools/repo-scan.mjs", [[".filter(Boolean).sort((a, b) => rank(a) - rank(b));", ".filter(Boolean);"]], RS],
  ["P9 scan: a root-relative font url not looked for in public/", T + "tools/repo-scan.mjs", [["[u.slice(1), `public${u}`, `static${u}`]", "[u.slice(1), `static${u}`]"]], RS],
  ["P9 scan: --font-* roles not read", T + "tools/repo-scan.mjs", [["if (role && family) out.push({ role, family, file, line: p.line, why: p.name });", "if (false) out.push({ role, family, file, line: p.line, why: p.name });"]], RS],
  ["P9 scan: selector roles not read", T + "tools/repo-scan.mjs", [["const role = roleOfSelector(m[1].trim()), fam =", "const role = null, fam ="]], RS],
  ["P9 scan: the README's install command not read", T + "tools/repo-scan.mjs", [["if (!INSTALL_RE.test(cmd)) continue;", "if (true) continue;"]], RS],
  ["P9 scan: nested list items are features", T + "tools/repo-scan.mjs", [["lines[i].match(/^\\s?(?:[-*+]|\\d+[.)])\\s+(.+)$/)", "lines[i].match(/^\\s{0,3}(?:[-*+]|\\d+[.)])\\s+(.+)$/)"]], RS],
  ["P9 scan: boilerplate headings are features", T + "tools/repo-scan.mjs", [["!FEATURE_HEAD.test(h.text) && !BOILER_HEAD.test(h.text)) feats.push", "!FEATURE_HEAD.test(h.text)) feats.push"]], RS],
  ["P9 scan: the README's sentence before the metadata's description", T + "tools/repo-scan.mjs", [["pitch: meta.description || R.sentence || null,", "pitch: R.sentence || meta.description || null,"]], RS],
  ["P9 scan: a bin installed without -g", T + "tools/repo-scan.mjs", [["`npm install ${j.bin ? '-g ' : ''}${j.name}`", "`npm install ${j.name}`"]], RS],
  ["P9 logos: a logo word 40 -> 35", T + "tools/repo-scan.mjs", [["const LOGO_WORDS = { logo: 40,", "const LOGO_WORDS = { logo: 35,"]], RS],
  ["P9 logos: SVG over PNG not scored", T + "tools/repo-scan.mjs", [["const FORMAT_SCORE = { '.svg': 20,", "const FORMAT_SCORE = { '.svg': 10,"]], RS],
  ["P9 logos: the project's name not scored", T + "tools/repo-scan.mjs", [["{ score += 15; signal = true; why.push('named after the project'); }", "{ signal = true; why.push('named after the project'); }"]], RS],
  ["P9 logos: the README's first picture not scored", T + "tools/repo-scan.mjs", [["if (f === readmeFirst) { score += 30;", "if (f === readmeFirst) { score += 0;"]], RS],
  ["P9 logos: a page's icon not scored", T + "tools/repo-scan.mjs", [["if (icons.has(f)) { score += 10;", "if (icons.has(f)) { score += 0;"]], RS],
  ["P9 logos: depth not counted", T + "tools/repo-scan.mjs", [["if (parts.length > 3) { score -= 3 *", "if (parts.length > 3) { score -= 0 *"]], RS],
  ["P9 scan: --brand overwrites a kit", T + "tools/repo-scan.mjs", [["if (kitFile && fs.existsSync(kitFile)) throw", "if (false) throw"]], RS],
  ["P9 scan: a kit written without --brand", T + "tools/repo-scan.mjs", [["const kitFile = o.brand ? path.resolve(cwd, o.brand) : null;", "const kitFile = o.brand ? path.resolve(cwd, o.brand) : path.join(path.resolve(cwd, o._[0] || '.'), 'brand.json');"]], RS],
  ["P9 kit: a file outside the kit's folder kept", T + "tools/repo-scan.mjs", [["return r.startsWith('..') || path.isAbsolute(r) ? null : r;", "return r;"]], RS],
  ["P9 scan: a font link fetched", T + "tools/repo-scan.mjs", [["    if (!FONT_HOSTS.test(url)) continue;\n", "    if (!FONT_HOSTS.test(url)) continue;\n    globalThis.fetch?.(url)?.catch?.(() => {});\n"]], RS],
  ["P9 shots: the limit 1 GB -> 1.25 GB", T + "tools/shots.mjs", [["export const SEQ_MAX_BYTES = 1024 ** 3;", "export const SEQ_MAX_BYTES = 1.25 * 1024 ** 3;"]], SH],
  ["P9 shots: refused at exactly 1 GB", T + "tools/shots.mjs", [["if (!(bytes > SEQ_MAX_BYTES)) return null;", "if (!(bytes >= SEQ_MAX_BYTES)) return null;"]], SH],
  ["P9 shots: 3 bytes a pixel", T + "tools/shots.mjs", [["frames * w * h * 4;", "frames * w * h * 3;"]], SH],
  ["P9 shots: the size ignores dpr", T + "tools/shots.mjs", [["const w = Math.round(vp.w * dpr), h = Math.round(vp.h * dpr);", "const w = vp.w, h = vp.h;"]], SH],
  ["P9 shots: the page shot is the viewport", T + "tools/shots.mjs", [["type: 'png', fullPage: true,", "type: 'png', fullPage: false,"]], SH],
  ["P9 shots: the scroll not eased", T + "tools/shots.mjs", [["(to - from) * ease(n > 1 ? i / (n - 1) : 1));", "(to - from) * (n > 1 ? i / (n - 1) : 1));"]], SH],
  ["P9 shots: the last frame short of the scroll's end", T + "tools/shots.mjs", [["ease(n > 1 ? i / (n - 1) : 1)", "ease(n > 1 ? i / n : 1)"]], SH],
  ["P9 shots: the scroll not rounded to a pixel", T + "tools/shots.mjs", [["=> Math.round(from + (to - from) * ease(", "=> (from + (to - from) * ease("]], SH],
  ["P9 shots: the page's clock not run", T + "tools/shots.mjs", [["      if (i > 0) await page.clock.runFor(clockAt(i, s.fps) - clockAt(i - 1, s.fps));\n", ""]], SH],
  ["P9 shots: the page's own clock", T + "tools/shots.mjs", [["  if (clock) { await context.clock.install({ time: 0 }); await context.clock.pauseAt(CLOCK0); }", "  if (false) { await context.clock.install({ time: 0 }); await context.clock.pauseAt(CLOCK0); }"], ["      if (i > 0) await page.clock.runFor(", "      if (false) await page.clock.runFor("]], SH],
  ["P9 shots: CSS animations not set to their time", T + "tools/shots.mjs", [["          a.currentTime = (t - seen.get(a)) * 1000;\n", ""]], SH],
  ["P9 shots: scroll-driven animations seeked", T + "tools/shots.mjs", [["          if (a.timeline !== document.timeline) continue;", "          if (false) continue;"]], SH],
  ["P9 shots: a page that is not local taken", T + "tools/shots.mjs", [["const LOCAL_HOSTS = (h) => h === 'localhost'", "const LOCAL_HOSTS = (h) => true || h === 'localhost'"]], SH],
  ["P9 shots: frames numbered from 001", T + "tools/shots.mjs", [["path.join(tmp, `${String(i).padStart(3, '0')}.png`), type", "path.join(tmp, `${String(i + 1).padStart(3, '0')}.png`), type"]], SH],
  ["P9 shots: the manifest says jpg", T + "tools/shots.mjs", [["w, h, ext: 'png', src:", "w, h, ext: 'jpg', src:"]], SH],
  ["P9 shots: the fps not the piece's", T + "tools/shots.mjs", [["const { fps, from: fpsFrom } = await pieceFps(o);", "const { fps, from: fpsFrom } = { fps: 30, from: 'the default' };"]], SH],
  ["P9 shots: floor(dur x fps) frames", T + "tools/shots.mjs", [["  const frames = Math.round(dur * fps);", "  const frames = Math.floor(dur * fps);"]], SH],
  ["P9 shots: a scroll past the page's end captured", T + "tools/shots.mjs", [["if (Math.max(s.from, s.to) > max) throw", "if (false) throw"]], SH],
  ["P9 frames: installSeq records no entry", T + "tools/frames.mjs", [["  manifest[name] = entry;\n", ""]], SH],
  ["P9 repo-launch: boxes(t) without the terminal", "skills/sabotage-motion/examples/repo-launch/scene.js", [["    out.push(...terminal(ctx, TERM, t, { alpha: ta, dy: (1 - tm.k) * 30, draw: false }));\n", ""]], RLC],
  ["P9 repo-launch: boxes(t) without the code", "skills/sabotage-motion/examples/repo-launch/scene.js", [["    out.push(...drawCode(ctx, CODE, t, { alpha: ca, dy: (1 - cm.k) * 30, draw: false }));\n", ""]], RLC],
  ["P9 repo-launch: brand.json not the scan's", "skills/sabotage-motion/examples/repo-launch/brand.json", [['"accent": "#98BC0C"', '"accent": "#9ABC0C"']], LE],
  ["P9 repo-launch: the code in the template's colours", "skills/sabotage-motion/examples/repo-launch/scene.js", [["  TH = codeTheme(ST);", "  TH = codeTheme(null);"]], LE],
  ["P9 repo-launch: a colour written into the scene", "skills/sabotage-motion/examples/repo-launch/scene.js", [["c.fillStyle = i ? tk.accent : tk.ink;", "c.fillStyle = i ? '#FF4A1C' : tk.ink;"]], LE],
  ["P9 docs: launch.md's limit drifts", "skills/sabotage-motion/references/launch.md", [["a sequence over 1 GB decoded (frames x width x height x", "a sequence over 2 GB decoded (frames x width x height x"]], DOCS],
  ["P9 docs: launch.md's worked numbers drift", "skills/sabotage-motion/references/launch.md", [["3 s at 30 fps holds 0.44 GB", "3 s at 30 fps holds 0.50 GB"]], DOCS],
  ["P9 docs: launch.md names a folder the scan reads", "skills/sabotage-motion/references/launch.md", [["`node_modules`, `vendor`, `.venv`,", "`node_modules`, `vendors`, `.venv`,"]], DOCS],
  ["P9 docs: SKILL.md's launch branch shows the board after rendering", "skills/sabotage-motion/SKILL.md", [["4. **Show the board**: render the board sheet (`node render.mjs board --slates`) before rendering.\n5. **Render, mix, `palette` and `check`**: step 10 below.", "4. **Render, mix, `palette` and `check`**: step 10 below.\n5. **Show the board**: render the board sheet (`node render.mjs board --slates`) before rendering."]], DOCS],
  ["P9 docs: SKILL.md's branch does not name the recipe", "skills/sabotage-motion/SKILL.md", [["follow\n`references/launch.md`, in this order.", "follow\nthe recipe, in this order."]], DOCS],
  ["P9 docs: CI does not run the launch suites", ".github/workflows/ci.yml", [[" && npm run test:launch &&", " &&"]], DOCS],
  ["P9 docs: README has no repo-launch row", "README.md", [["| `repo-launch/` | 15 s, 9:16:", "| `launch/` | 15 s, 9:16:"]], DOCS],
  ["P9 ASSETS.md: the example's shot not listed", "ASSETS.md", [["| `skills/sabotage-motion/examples/repo-launch/assets/shots/app.png` |", "| `skills/sabotage-motion/examples/repo-launch/assets/shots/app-gone.png` |"]], ASSETS],
  ["P9 examples: the template's shots.mjs changed, not its copies", T + "tools/shots.mjs", [["// tools/shots.mjs: pictures of a running local app or a local HTML file,", "// tools/shots.mjs: pictures of a running local app or of a local HTML file,"]], EXT],
  // ---- P9 council round 1 fold: Chrome closed whatever throws, the final URL local, the scroll checked after the clock;
  // the install command (continuations, this package or an Install heading), every @font-face src, var() fallbacks, the
  // title at any level, exact token names first; the example's shot compared by landmarks; the recipe's sheets and start.
  ["P9 R1 shots: the temp files removed before Chrome closes", T + "tools/shots.mjs", [["    try { if (browser) await browser.close(); } finally { cleanup(); }", "    cleanup(); if (browser) await browser.close();"]], SH],
  ["P9 R1 shots: Chrome left open when a step throws", T + "tools/shots.mjs", [["    return await work(browser);", "    return await work(browser).catch((e) => { browser = null; throw e; });"]], SH],
  ["P9 R1 shots: the final URL not checked", T + "tools/shots.mjs", [["  stillLocal(page, src);\n", ""]], SH],
  ["P9 R1 shots: the scroll not checked again after the clock", T + "tools/shots.mjs", [["if (Math.abs(now - y) > 0.01) throw", "if (false) throw"]], SH],
  ["P9 R1 install: continuations not joined", T + "tools/repo-scan.mjs", [["      while (cmd.endsWith('\\\\') && k + 1 < b.length) cmd = cmd.slice(0, -1).trim() + ' ' + lines[b[++k]].trim();\n", ""]], RS],
  ["P9 R1 install: any install command taken", T + "tools/repo-scan.mjs", [["if (installsPackage(cmd, want) || GLOBAL_FLAG.test(cmd) || (h && INSTALL_HEAD.test(h.text))) {", "if (true) {"]], RS],
  ["P9 R1 install: a global flag not enough", T + "tools/repo-scan.mjs", [["if (installsPackage(cmd, want) || GLOBAL_FLAG.test(cmd) || (h && INSTALL_HEAD.test(h.text))) {", "if (installsPackage(cmd, want) || (h && INSTALL_HEAD.test(h.text))) {"]], RS],
  ["P9 R1 install: an Install heading not enough", T + "tools/repo-scan.mjs", [["if (installsPackage(cmd, want) || GLOBAL_FLAG.test(cmd) || (h && INSTALL_HEAD.test(h.text))) {", "if (installsPackage(cmd, want) || GLOBAL_FLAG.test(cmd)) {"]], RS],
  ["P9 R1 install: extras read before the version range", T + "tools/repo-scan.mjs", [[".replace(/[=<>~!].*$/, '').replace(/\\[.*\\]$/, '')", ".replace(/\\[.*\\]$/, '').replace(/[=<>~!].*$/, '')"]], RS],
  ["P9 R1 fonts: only the first src read", T + "tools/repo-scan.mjs", [["const srcs = [...body.matchAll(/(?:^|[;\\s{])src\\s*:\\s*([^;]+)/gi)].map((x) => x[1]);", "const srcs = [get('src') || ''];"]], RS],
  ["P9 R1 fonts: other formats ranked first", T + "tools/repo-scan.mjs", [["return i < 0 ? FONT_EXT_RANK.length : i; };", "return i; };"]], RS],
  ["P9 R1 colours: the var() fallback ignored", T + "tools/repo-scan.mjs", [["      if (m[2] == null) break;", "      if (true) break;"]], RS],
  ["P9 R1 name: only an h1 names the project", T + "tools/repo-scan.mjs", [["const title = heads[0] && lines.slice(", "const title = heads[0] && heads[0].level === 1 && lines.slice("]], RS],
  ["P9 R1 name: prose above the first heading allowed", T + "tools/repo-scan.mjs", [[".every((l, i) => !inCode[i] && /^\\s*($|<|!\\[|\\[!\\[)/.test(l))", ".every(() => true)"]], RS],
  ["P9 R1 name: the title listed as a feature", T + "tools/repo-scan.mjs", [["if (h !== title && h.level >= 2 && h.level <= 3", "if (h.level >= 2 && h.level <= 3"]], RS],
  ["P9 R1 kit: exact token names not read first", T + "tools/repo-scan.mjs", [["for (const read of [exactToken, tokenFor]) {", "for (const read of [tokenFor]) {"]], RS],
  ["P9 R1 example: the shot not compared (cards in the background colour)", "skills/sabotage-motion/examples/repo-launch/fixture/app/styles.css", [[".card { background: var(--surface);", ".card { background: var(--bg);"]], LE],
  ["P9 R1 docs: launch.md drops an alias", "skills/sabotage-motion/references/launch.md", [["`accent`, `primary`, `brand`, `highlight`, `tint` |", "`accent`, `primary`, `brand`, `highlight` |"]], DOCS],
  ["P9 R1 docs: launch.md drops the rule for the sheets", "skills/sabotage-motion/references/launch.md", [["**The two sheets always come before the full render**", "**Both sheets can come before the full render**"]], DOCS],
  ["P9 R1 docs: SKILL.md lets a session skip the sheets", "skills/sabotage-motion/SKILL.md", [["now (the request asked for the finished file): go on, and name both in your reply.", "now (the request asked for the finished file): go on."]], DOCS],
  ["P9 R1 docs: launch.md lets a piece start from the example", "skills/sabotage-motion/references/launch.md", [["0. **Start the piece from the template**, in the project:", "0. **Start the piece from the template or the example**, in the project:"]], DOCS],
  ["P9 R1 docs: SKILL.md's branch drops the template start", "skills/sabotage-motion/SKILL.md", [["Start the piece from the template, inside the project; the `repo-launch` example\nis a reference only, never a starting point.", "Start the piece from the template or the `repo-launch` example."]], DOCS],
  ["P9 R1 docs: the example README leaves out the board as slates", "skills/sabotage-motion/examples/repo-launch/README.md", [["node render.mjs board --slates                          # board.png as slates", "node render.mjs board                                   # board.png as slates"]], DOCS],
];

const argv = process.argv.slice(2);
// A mutation applies when each of its texts is in its file exactly once (as the run below requires).
const applies = (file, edits) => { const src = fs.readFileSync(path.join(repo, file), 'utf8'); return edits.every(([from]) => src.split(from).length - 1 === 1); };
if (argv.includes('--list')) {
  let stale = 0;
  for (const [n, f, e, t] of M) { const ok = applies(f, e); if (!ok) stale++; console.log(`${ok ? '     ' : 'STALE'} ${n.padEnd(58)} ${path.basename(f).padEnd(11)} ${t.map((x) => path.basename(x)).join(' ')}`); }
  console.log(`${M.length} mutations, ${stale} stale`);
  process.exit(stale ? 1 : 0);
}
const onlyI = argv.indexOf('--only'), only = onlyI >= 0 ? argv[onlyI + 1] : null;
const todo = M.filter(([n, , , t]) => (!only || n.includes(only)) && (!argv.includes('--fast') || t === UNIT));

// a scratch copy of the repo (no .git, no test/.work, no example renders), sharing node_modules
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-mutate-'));
fs.cpSync(repo, work, { recursive: true, filter: (src) => {
  const r = path.relative(repo, src).split(path.sep);
  return !(r[0] === '.git' || r[0] === 'node_modules' || (r[0] === 'test' && r[1] === '.work') || (r[2] === 'examples' && r[4] === 'out'));
} });
fs.symlinkSync(path.join(repo, 'node_modules'), path.join(work, 'node_modules'), 'dir');
// a git repository, so the suites that list the repo's files (git ls-files: the asset inventory, the examples) see the
// copy's files, with its .gitignore rules, rather than failing outside a repository
spawnSync('git', ['init', '-q'], { cwd: work });
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
