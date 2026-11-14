// Live ElevenLabs smoke (plan section 17, P1). It calls the real API and spends credits, so it is
// skipped unless SM_LIVE=elevenlabs. It needs ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID and SM_LIVE_MODEL
// (the model id the README names) in the environment:
//
//   SM_LIVE=elevenlabs SM_LIVE_MODEL=<model_id> ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... \
//     node --test test/voice-live.test.mjs
//
// It voices a two-line board with one delivery tag through tools/voice-elevenlabs.mjs, runs
// tools/cues.mjs on the take, and checks that each beat's cue is where the take's own character timings
// put its anchor (or its opening tag). It also prints every tag's measured span and level, which is how
// the plan's tag measurements (section 7.1) are re-checked for the current model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { voicePiece, runCues, readCues, readMonoWav, levelDb } from './voice-helpers.mjs';

const live = process.env.SM_LIVE === 'elevenlabs';
const skip = live ? false : 'live ElevenLabs smoke: set SM_LIVE=elevenlabs (spends credits) to run it';

test('live: a real take\'s cues match its own character timings', { skip, timeout: 180000 }, (t) => {
  for (const k of ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'SM_LIVE_MODEL']) assert.ok(process.env[k], `${k} is not set`);
  const board = { title: 'Live smoke', target: 'tiktok', beats: [
    { id: 'one', vo: 'Motion graphics, written as code.' },
    { id: 'two', vo: '[curious] Every frame is a function of time.' },
  ] };
  const dir = voicePiece('voice-live', { board });
  const v = spawnSync(process.execPath, ['tools/voice-elevenlabs.mjs', '--model', process.env.SM_LIVE_MODEL], { cwd: dir, encoding: 'utf8' });
  t.diagnostic((v.stdout + v.stderr).trim());
  assert.equal(v.status, 0);
  const c = runCues(dir);
  t.diagnostic(c.out.trim());
  assert.equal(c.status, 0);
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  const cues = readCues(dir);
  const at = (phrase) => { const i = take.chars.text.indexOf(phrase); assert.ok(i >= 0, `"${phrase}" is not in the take's characters`); return take.chars.starts[i]; };
  assert.ok(Math.abs(cues.CUE.one - at('Motion graphics, written as')) < 1e-6, `one: ${cues.CUE.one}`);
  const curious = take.tags.find((x) => x.text.toLowerCase() === '[curious]');
  const two = curious && curious.start <= at('Every frame is a') ? curious.start : at('Every frame is a');
  assert.ok(Math.abs(cues.CUE.two - two) < 1e-6, `two: ${cues.CUE.two} vs ${two}`);
  assert.ok(take.words.every((w) => !w.text.includes('[')), 'a tag is in the words');
  // the measurements section 7.1 rests on, for this model: each tag's span, the gap to the next word, its level
  const wav = readMonoWav(path.join(dir, 'take-raw.wav'));
  for (const tag of take.tags) {
    const next = take.words.find((w) => w.start >= tag.start);
    t.diagnostic(`${tag.text}: ${tag.start.toFixed(3)}-${tag.end.toFixed(3)} s (${((tag.end - tag.start) * 1000).toFixed(0)} ms), ` +
      `next word ${next ? `at ${next.start.toFixed(3)} s (${((next.start - tag.end) * 1000).toFixed(0)} ms after)` : 'none'}, ` +
      `${levelDb(wav.samples, tag.start, Math.max(tag.end, tag.start + 0.01), wav.sr).toFixed(1)} dBFS RMS`);
  }
});
