// `check` on the three examples, in place (plan sections 15 and 17, P4): the source checks that need no WebGL
// probe pass with no FAIL and no WARN. motion_dead and first_frame_empty render every frame through WebGL, which
// takes minutes for the 20 s, 60 fps showreel under SwiftShader on the Linux runners, so they and `check --file` on
// the masters run on a Mac before a release (the PR records the results); see references/check.md for the WARN
// the showreel keeps on purpose. The lower third is an overlay, so it is checked as one (--alpha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { examplesDir, EXAMPLES } from './helpers.mjs';

const IDS = 'fonts,board_order,hook_long,board_copy_missing,board_copy_unread,board_sfx_missing,text_safe,text_overlap,audio_spike';
for (const ex of EXAMPLES) {
  test(`${ex}: check (${IDS.split(',').length} source checks, no probe) reports no FAIL and no WARN`, () => {
    const args = ['render.mjs', 'check', '--json', '--only', IDS, ...(ex === 'lower-third' ? ['--alpha'] : [])];
    const r = spawnSync(process.execPath, args, { cwd: path.join(examplesDir, ex), encoding: 'utf8', timeout: 600000, killSignal: 'SIGKILL', maxBuffer: 64 << 20 });
    assert.equal(r.signal, null, `check timed out:\n${r.stderr}`);
    let results;
    try { results = JSON.parse(r.stdout); } catch { assert.fail(`check printed no JSON (exit ${r.status}):\n${r.stdout}\n${r.stderr}`); }
    const bad = results.filter((x) => x.level === 'FAIL' || x.level === 'WARN').map((x) => `${x.level} ${x.id}: ${x.detail}`);
    assert.deepEqual(bad, []);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(results.some((x) => x.id === 'fonts' && x.level === 'OK'), 'the fonts loaded');
  });
}
