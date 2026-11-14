// tools/voice-elevenlabs.mjs against a local fake of the with-timestamps endpoint (no network, no
// credits): the request it sends, the files it writes, and that the audio is saved before anything that
// can fail. The fake answers with synthetic audio (tone bursts) and character timings made up for the
// request's own text. The real API is only called by voice-live.test.mjs, and only with SM_LIVE=elevenlabs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { synthAudio, voicePiece, runCues, readCues, readMonoWav, elevenlabsFrom, cuesTool, lib, boardFixture } from './voice-helpers.mjs';

// The fake: every request is recorded; `reply` decides the answer.
const seen = [];
let reply = null;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const r = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') };
    seen.push(r);
    const { status = 200, json, headers = {} } = reply(r);
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(json));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

// Timings for any text: each token gets 0.3 s plus a 0.1 s gap, a tag 0.05 s ending where the next word
// starts; the audio is 16-bit PCM at 48 kHz with a tone burst under each word.
function fakeTake(text) {
  const tokens = [];
  let t = 0.15;
  for (const m of text.matchAll(/\[[^\]]*\]|\S+/g)) {
    if (m[0].startsWith('[')) { tokens.push([m[0], t - 0.05, t]); continue; }
    tokens.push([m[0], t, t + 0.3]); t += 0.4;
  }
  const dur = t + 0.3;
  const audio = synthAudio({ duration: dur, words: tokens.filter(([x]) => !x.startsWith('[')).map(([, s, e]) => ({ start: s, end: e })) });
  const pcm = Buffer.alloc(audio.length * 2);
  audio.forEach((v, i) => pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2));
  return { tokens, dur, pcm, ...elevenlabsFrom(tokens) };
}

function runVoice(dir, args, env = {}) {
  return new Promise((resolve) => {   // async: the fake server answers from this same process
    const p = spawn(process.execPath, ['tools/voice-elevenlabs.mjs', ...args], { cwd: dir,
      env: { ...process.env, ELEVENLABS_API_BASE: base, ELEVENLABS_API_KEY: 'test-key-123', ELEVENLABS_VOICE_ID: 'voice-abc', ...env } });
    let out = '';
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => resolve({ status, out }));
  });
}
const script = 'Stop pasting the same prompt. [curious] Save it as a skill instead. [chuckles]';

test('--dry-run prints the joined script, tags as written, and sends nothing', async () => {
  const dir = voicePiece('voice-dry', {});
  seen.length = 0;
  const r = await runVoice(dir, ['--model', 'some-model', '--dry-run'], { ELEVENLABS_API_KEY: '', ELEVENLABS_VOICE_ID: '' });
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes(`text: ${script}`), r.out);
  assert.match(r.out, /would POST .*\/v1\/text-to-speech\/<ELEVENLABS_VOICE_ID>\/with-timestamps\?output_format=pcm_48000/);
  assert.match(r.out, /body: \{"text":"Stop pasting .*\[chuckles\]","model_id":"some-model"\}/);
  assert.equal(seen.length, 0);
  const noModel = await runVoice(dir, ['--dry-run']);
  assert.equal(noModel.status, 2);
  assert.match(noModel.out, /pass --model/);
});

test('one request with the whole script; take-raw.wav, take.json and take.elevenlabs.json written; cues follow the characters', async () => {
  const dir = voicePiece('voice-fake', {});
  seen.length = 0;
  let fake;
  reply = (r) => { fake = fakeTake(r.body.text); return { json: { audio_base64: fake.pcm.toString('base64'), alignment: fake.alignment, normalized_alignment: fake.alignment }, headers: { 'character-cost': String(r.body.text.length) } }; };
  const r = await runVoice(dir, ['--model', 'some-model']);
  assert.equal(r.status, 0, r.out);
  assert.equal(seen.length, 1, 'one continuous take is one request');
  const q = seen[0];
  assert.equal(q.method, 'POST');
  assert.equal(q.url, '/v1/text-to-speech/voice-abc/with-timestamps?output_format=pcm_48000');
  assert.equal(q.headers['xi-api-key'], 'test-key-123');
  assert.deepEqual(q.body, { text: script, model_id: 'some-model' }, 'no voice settings or language unless asked');
  assert.match(r.out, new RegExp(`characters billed: ${script.length}`));
  // the raw take
  const wav = readMonoWav(path.join(dir, 'take-raw.wav'));
  assert.equal(wav.sr, 48000);
  assert.ok(Math.abs(wav.dur - fake.dur) < 1e-3, `${wav.dur} vs ${fake.dur}`);
  // take.json: the generic format, tags moved out; take.elevenlabs.json: the alignment as returned, no audio
  const take = JSON.parse(fs.readFileSync(path.join(dir, 'take.json'), 'utf8'));
  assert.equal(take.source, 'elevenlabs');
  assert.equal(take.model, 'some-model');
  assert.equal(take.chars.text, lib.stripTags(script));
  assert.deepEqual(take.tags.map((t) => t.text), ['[curious]', '[chuckles]']);
  const el = JSON.parse(fs.readFileSync(path.join(dir, 'take.elevenlabs.json'), 'utf8'));
  assert.deepEqual(el.alignment, fake.alignment);
  assert.equal(el.audio_base64, undefined);
  assert.ok(!JSON.stringify(el).includes('voice-abc') && !JSON.stringify(el).includes('test-key'), 'the voice id or key was saved');
  // then the cues: each beat's cue is its anchor's first character (or its opening tag's) in the take's own chars
  const c = runCues(dir);
  assert.equal(c.status, 0, c.out);
  const cues = readCues(dir);
  const start = (phrase) => take.chars.starts[take.chars.text.indexOf(phrase)];
  assert.ok(Math.abs(cues.CUE.hook - start('Stop pasting the same')) < 1e-6);
  const curious = take.tags.find((t) => t.text === '[curious]').start;
  assert.ok(Math.abs(cues.CUE.save - (curious + 1.5)) < 1e-6, 'save cues at [curious], after the 1.5 s for "mid"');
  // the same response read with --from elevenlabs gives the same cues
  fs.copyFileSync(path.join(dir, 'cues.json'), path.join(dir, 'cues.first.json'));
  const c2 = runCues(dir, ['--from', 'elevenlabs', 'take.elevenlabs.json']);
  assert.equal(c2.status, 0, c2.out);
  assert.deepEqual(readCues(dir), JSON.parse(fs.readFileSync(path.join(dir, 'cues.first.json'), 'utf8')));
});

test('--language, --voice-settings and --env-file reach the request; --env-file wins over the environment', async () => {
  const dir = voicePiece('voice-opts', {});
  fs.writeFileSync(path.join(dir, 'voice.env'), 'ELEVENLABS_API_KEY=file-key\nELEVENLABS_VOICE_ID=file-voice\n');
  seen.length = 0;
  reply = (r) => { const f = fakeTake(r.body.text); return { json: { audio_base64: f.pcm.toString('base64'), alignment: f.alignment } }; };
  const r = await runVoice(dir, ['--model', 'm2', '--language', 'en', '--voice-settings', '{"stability":0.4}', '--env-file', 'voice.env']);
  assert.equal(r.status, 0, r.out);
  assert.equal(seen[0].headers['xi-api-key'], 'file-key');
  assert.match(seen[0].url, /\/text-to-speech\/file-voice\/with-timestamps/);
  assert.deepEqual(seen[0].body, { text: script, model_id: 'm2', language_code: 'en', voice_settings: { stability: 0.4 } });
  assert.match(r.out, /reported no character cost/);
});

test('the audio is on disk before anything else can fail: a response with no alignment still leaves take-raw.wav', async () => {
  const dir = voicePiece('voice-noalign', {});
  reply = (r) => { const f = fakeTake(r.body.text); return { json: { audio_base64: f.pcm.toString('base64'), alignment: null } }; };
  const r = await runVoice(dir, ['--model', 'm']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /the audio is saved in take-raw\.wav, but the timings could not be read/);
  assert.ok(readMonoWav(path.join(dir, 'take-raw.wav')).dur > 1);
  assert.ok(!fs.existsSync(path.join(dir, 'take.json')));
  // an error from the API writes nothing and shows the answer
  const dir2 = voicePiece('voice-401', {});
  reply = () => ({ status: 401, json: { detail: { status: 'invalid_api_key' } } });
  const r2 = await runVoice(dir2, ['--model', 'm']);
  assert.equal(r2.status, 1);
  assert.match(r2.out, /answered 401.*invalid_api_key/);
  assert.ok(!fs.existsSync(path.join(dir2, 'take-raw.wav')));
});
