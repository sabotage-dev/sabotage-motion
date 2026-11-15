// The render error path (a P0 bug fixed in P3): when the scene throws partway through `video` or `full`,
// render.mjs prints the error and exits non-zero within a time limit, its ffmpeg child is gone, and the partial
// file and its render record are not left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { makePiece, sha256File } from './helpers.mjs';

const dir = makePiece('render-error');
// Every running process whose command line names this file (ffmpeg gets the output path as an argument).
const procsNaming = (needle) => execFileSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8' })
  .split('\n').filter((l) => l.includes(needle) && !l.includes('ps -A'));

for (const mode of ['video', 'full']) {
  test(`a scene that throws during ${mode}: render.mjs exits 1 within 60 s and no ffmpeg is left running`, () => {
    const name = `throws-${mode}-${process.pid}`;
    const t0 = Date.now();
    const r = spawnSync(process.execPath, ['render.mjs', mode, '--scene', 'throws.js', '--scale', '0.25', '--sub', '1', '--out', `out/${name}.mp4`],
      { cwd: dir, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.equal(r.signal, null, `render.mjs ${mode} hung and was killed after ${((Date.now() - t0) / 1000).toFixed(0)} s:\n${out}`);
    assert.equal(r.status, 1, out);
    assert.match(out, /planted: the scene throws at t=0\.5/);
    assert.deepEqual(procsNaming(name), [], 'an ffmpeg process is still running');
    assert.ok(!fs.existsSync(path.join(dir, 'out', `${name}.mp4.render.json`)), 'a failed render left a render record');
    for (const partial of mode === 'video' ? [`${name}.mp4`, `${name}.partial.mp4`] : [`${name}.video.mp4`, `${name}.partial.mp4`, `${name}.partial.wav`, `${name}.mp4`]) {
      assert.ok(!fs.existsSync(path.join(dir, 'out', partial)), `the partial ${partial} was left behind`);
    }
  });
}

// ---- round 1, F2: ffmpeg dying on its own (here: killed with SIGKILL mid-stream), in video's encode and in full's
// encode and mux. A stand-in ffmpeg first on PATH passes every other call to the real one; for the step under test
// it writes a partial file, as a real encoder would have, and kills itself.
const realFfmpeg = execFileSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).trim();
const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-fake-ffmpeg-'));
fs.writeFileSync(path.join(fakeBin, 'ffmpeg'), `#!/bin/sh
last=""; for a in "$@"; do last="$a"; done
case "$SM_FAKE_FFMPEG_DIE:$*" in
  early:*"-f rawvideo"*) exit 1 ;;
  encode:*"-f rawvideo"*) head -c 2000000 > /dev/null; printf partial > "$last"; kill -9 $$ ;;
  mux:*"-c:v copy"*) printf partial > "$last"; kill -9 $$ ;;
esac
exec "${realFfmpeg}" "$@"
`, { mode: 0o755 });
const fakeEnv = (die) => ({ ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, SM_FAKE_FFMPEG_DIE: die });
for (const [mode, die, left] of [['video', 'encode', ['NAME.mp4', 'NAME.partial.mp4']], ['full', 'encode', ['NAME.video.mp4', 'NAME.mp4', 'NAME.partial.mp4', 'NAME.partial.wav']],
  ['full', 'mux', ['NAME.video.mp4', 'NAME.mp4', 'NAME.partial.mp4', 'NAME.partial.wav']]]) {
  test(`ffmpeg killed mid-${die} during ${mode} (round 1, F2): exit 1, and no output, temp or record is left`, () => {
    const name = `killed-${mode}-${die}-${process.pid}`;
    const r = spawnSync(process.execPath, ['render.mjs', mode, '--scale', '0.25', '--sub', '1', '--out', `out/${name}.mp4`],
      { cwd: dir, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL', env: fakeEnv(die) });
    const out = (r.stdout || '') + (r.stderr || '');
    assert.equal(r.signal, null, `render.mjs hung:\n${out}`);
    assert.equal(r.status, 1, out);
    for (const f of [...left.map((x) => x.replace('NAME', name)), `${name}.mp4.render.json`]) assert.ok(!fs.existsSync(path.join(dir, 'out', f)), `${f} was left behind\n${out}`);
    assert.deepEqual(procsNaming(name), [], 'an ffmpeg process is still running');
  });
}

// ---- P4: a render writes to out/<name>.partial.<ext> and renames it onto the output only when it is complete, so a
// failed render never touches an earlier good output: ffmpeg failing before it writes anything, killed during the
// encode, or killed during full's mux. Only the old render record goes (it is deleted before any render starts).
// untouched: the same bytes, and the same file (inode and modification time), so even rewriting it with identical
// bytes (a deterministic render does that) counts as touching it
const stamp = (f) => { const p = path.join(dir, 'out', f); if (!fs.existsSync(p)) return null; const st = fs.statSync(p); return `${sha256File(p)} ino ${st.ino} mtime ${st.mtimeMs}`; };
for (const mode of ['video', 'full']) {
  test(`an earlier ${mode} render survives a failed ${mode} render to the same output, byte for byte (P4)`, () => {
    const name = `keep-${mode}-${process.pid}`;
    const args = [mode, '--scale', '0.25', '--sub', '1', '--out', `out/${name}.mp4`];
    const good = spawnSync(process.execPath, ['render.mjs', ...args], { cwd: dir, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL' });
    assert.equal(good.status, 0, (good.stdout || '') + (good.stderr || ''));
    const kept = [`${name}.mp4`, ...(mode === 'full' ? [`${name}.wav`] : [])];
    const before = Object.fromEntries(kept.map((f) => [f, stamp(f)]));
    assert.ok(fs.existsSync(path.join(dir, 'out', `${name}.mp4.render.json`)), 'the good render wrote no record');
    for (const f of [`${name}.partial.mp4`, `${name}.partial.wav`, `${name}.video.mp4`]) assert.ok(!fs.existsSync(path.join(dir, 'out', f)), `the good render left ${f}`);
    for (const die of mode === 'full' ? ['early', 'encode', 'mux'] : ['early', 'encode']) {
      const r = spawnSync(process.execPath, ['render.mjs', ...args], { cwd: dir, encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL', env: fakeEnv(die) });
      const out = (r.stdout || '') + (r.stderr || '');
      assert.equal(r.signal, null, `render.mjs hung (${die}):\n${out}`);
      assert.equal(r.status, 1, `${die}: ${out}`);
      for (const f of kept) assert.equal(stamp(f), before[f], `ffmpeg failing (${die}) changed or removed the earlier ${f}\n${out}`);
      for (const f of [`${name}.partial.mp4`, `${name}.partial.wav`, `${name}.video.mp4`]) assert.ok(!fs.existsSync(path.join(dir, 'out', f)), `ffmpeg failing (${die}) left ${f}\n${out}`);
      assert.ok(!fs.existsSync(path.join(dir, 'out', `${name}.mp4.render.json`)), `ffmpeg failing (${die}) left the old record`);
      assert.deepEqual(procsNaming(name), [], 'an ffmpeg process is still running');
    }
  });
}

// ---- round 1, F1: a scene inside a folder the source hash skips is refused, for video, full and check
test('a scene under out/, stills/ or node_modules/ is refused: it is outside the source hash (round 1, F1)', () => {
  for (const f of ['out/x.js', 'stills/x.js', 'lib/node_modules/x.js']) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(dir, 'scene.js'), path.join(dir, f));
  }
  for (const mode of ['video', 'full', 'check']) {
    const r = spawnSync(process.execPath, ['render.mjs', mode, '--scene', 'out/x.js', '--scale', '0.25', '--sub', '1', '--out', 'out/refused.mp4'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `${mode}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /out\/x\.js: a scene under out\/ is outside the source hash/);
  }
  for (const f of ['stills/x.js', 'lib/node_modules/x.js']) {
    const r = spawnSync(process.execPath, ['render.mjs', 'video', '--scene', f], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2); assert.match(r.stderr, /is outside the source hash/);
  }
  // council round 2: the folder's case does not matter (on macOS's default disk OUT/x.js opens out/x.js)
  for (const [f, under] of [['OUT/x.js', 'OUT'], ['Stills/x.js', 'Stills'], ['lib/Node_Modules/x.js', 'Node_Modules']]) {
    const r = spawnSync(process.execPath, ['render.mjs', 'video', '--scene', f, '--scale', '0.25', '--sub', '1', '--out', 'out/refused.mp4'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2, `${f}: ${r.stdout}${r.stderr}`); assert.match(r.stderr, new RegExp(`a scene under ${under}/ is outside the source hash`));
  }
  assert.ok(!fs.existsSync(path.join(dir, 'out', 'refused.mp4')));
});
