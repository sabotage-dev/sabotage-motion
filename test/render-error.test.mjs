// The render error path (a P0 bug fixed in P3): when the scene throws partway through `video` or `full`,
// render.mjs prints the error and exits non-zero within a time limit, its ffmpeg child is gone, and the partial
// file and its render record are not left behind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { makePiece } from './helpers.mjs';

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
    const partial = mode === 'video' ? `${name}.mp4` : `${name}.video.mp4`;
    assert.ok(!fs.existsSync(path.join(dir, 'out', partial)), `the partial ${partial} was left behind`);
  });
}
