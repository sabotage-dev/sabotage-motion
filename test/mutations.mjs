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
