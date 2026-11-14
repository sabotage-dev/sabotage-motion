// tools/voice-elevenlabs.mjs: voice the board with ElevenLabs, as one continuous take (plan section 7.6).
// Optional: any other voice comes in through tools/cues.mjs's timing formats.
//
//   node tools/voice-elevenlabs.mjs --model <model_id> [--env-file <file>] [--language <code>]
//        [--voice-settings '<json>'] [--format pcm_48000] [--dry-run]
//
// Joins the board's vo lines in order, delivery tags included as written (one take keeps the delivery
// consistent; which tags a model understands is the model's business, so nothing here filters them), and
// sends them in one request to the text-to-speech "with timestamps" endpoint
// (POST /v1/text-to-speech/{voice_id}/with-timestamps). It writes take-raw.wav the moment the audio
// arrives, so a later failure does not waste the credits, then:
//   take.json             the timings in the generic format (tags moved out of the words), for tools/cues.mjs
//   take.elevenlabs.json  the response's alignment as returned, for tools/cues.mjs --from elevenlabs
// Next step: node tools/cues.mjs
//
// ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID come from the environment, or from --env-file (KEY=value
// lines; its values win). --model is required, with no default baked in: the README names the current
// one. No voice settings are sent unless --voice-settings gives them (a JSON object, passed through).
// --language sets language_code. --format is the API's output_format: pcm_<rate> (default pcm_48000),
// wav_<rate>, or mp3_<rate>_<kbps> (converted with ffmpeg). It prints the character cost the response
// reports. --dry-run prints the request without sending it. ELEVENLABS_API_BASE replaces the API's
// address (the tests point it at a local fake server).
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boardScript, boardProblems } from '../lib.js';
import { fromElevenLabs, CueError } from './cues.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A 16-bit mono PCM WAV around raw little-endian samples.
function pcmWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
// Sample rate and length of a PCM or float WAV.
export function wavInfo(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12, rate = 0, block = 0, frames = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { rate = buf.readUInt32LE(off + 12); block = buf.readUInt16LE(off + 20); }
    if (id === 'data') { frames = Math.floor(Math.min(size, buf.length - off - 8) / Math.max(1, block)); break; }
    off += 8 + size + (size & 1);
  }
  if (!rate || !block) throw new Error('WAV has no fmt or data chunk');
  return { sampleRate: rate, frames, duration: frames / rate };
}

async function main(argv) {
  const opt = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/voice-elevenlabs.mjs --model <model_id> [--env-file <file>] [--language <code>] [--voice-settings <json>] [--format pcm_48000] [--dry-run]');
    return 0;
  }
  const dry = argv.includes('--dry-run');
  const env = { ...process.env };
  if (opt('env-file')) {
    const f = path.resolve(ROOT, opt('env-file'));
    if (!fs.existsSync(f)) { console.error(`--env-file: no such file ${opt('env-file')}`); return 2; }
    Object.assign(env, parseEnv(fs.readFileSync(f, 'utf8')));
  }
  const model = opt('model');
  if (!model) { console.error('voice: pass --model <model_id> (no default is built in; the README names the current model)'); return 2; }
  const format = opt('format') || 'pcm_48000';
  if (!/^(pcm|wav)_\d+$|^mp3_\d+_\d+$/.test(format)) { console.error(`--format ${format}: use pcm_<rate>, wav_<rate> or mp3_<rate>_<kbps>`); return 2; }
  let settings = null;
  if (opt('voice-settings') != null) {
    try { settings = JSON.parse(opt('voice-settings')); } catch (e) { console.error(`--voice-settings is not JSON: ${e.message}`); return 2; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { console.error('--voice-settings must be a JSON object'); return 2; }
  }

  const { BOARD } = await import(pathToFileURL(path.join(ROOT, 'board.js')).href);
  const bp = boardProblems(BOARD);
  if (bp.length) { console.error('voice: board.js has problems:\n' + bp.map((p) => '  - ' + p).join('\n')); return 1; }
  const text = boardScript(BOARD);
  if (!text) { console.error('voice: board.js has no vo lines to voice'); return 1; }
  const body = { text, model_id: model };
  if (opt('language')) body.language_code = opt('language');
  if (settings) body.voice_settings = settings;
  const base = (env.ELEVENLABS_API_BASE || 'https://api.elevenlabs.io').replace(/\/+$/, '');
  const query = `output_format=${encodeURIComponent(format)}`;
  console.log(`voice: ${text.length} characters, model ${model}, ${format}${body.language_code ? `, language ${body.language_code}` : ''}${settings ? ', voice settings given' : ''}`);
  console.log(`  text: ${text}`);
  if (dry) {
    console.log(`dry run: would POST ${base}/v1/text-to-speech/<ELEVENLABS_VOICE_ID>/with-timestamps?${query}`);
    console.log(`  body: ${JSON.stringify(body)}`);
    return 0;
  }
  const key = env.ELEVENLABS_API_KEY, voice = env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) { console.error('voice: set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID (in the environment or an --env-file)'); return 2; }

  const res = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?${query}`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  const cost = res.headers.get('character-cost') || res.headers.get('x-character-count');
  if (!res.ok) {
    console.error(`voice: the API answered ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 600)}`);
    return 1;
  }
  const json = await res.json();
  if (!json || typeof json.audio_base64 !== 'string' || !json.audio_base64) { console.error('voice: the response has no audio_base64'); return 1; }

  // the audio first: whatever goes wrong after this, the take is on disk
  const audio = Buffer.from(json.audio_base64, 'base64'), raw = path.join(ROOT, 'take-raw.wav');
  const [kind, rate] = format.split('_');
  if (kind === 'pcm') fs.writeFileSync(raw, pcmWav(audio, +rate));
  else if (kind === 'wav') fs.writeFileSync(raw, audio);
  else {
    const mp3 = path.join(ROOT, 'take-raw.mp3');
    fs.writeFileSync(mp3, audio);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', mp3, '-ar', '48000', '-ac', '1', raw], { encoding: 'utf8' });
    if (r.status !== 0) { console.error(`voice: the take is in take-raw.mp3, but ffmpeg could not convert it: ${r.stderr || r.error}`); return 1; }
  }
  const info = wavInfo(fs.readFileSync(raw));
  console.log(`wrote take-raw.wav (${info.duration.toFixed(2)} s at ${info.sampleRate} Hz)`);
  console.log(cost != null ? `characters billed: ${cost} (the response's character-cost header)` : 'the response reported no character cost');

  const { audio_base64, ...rest } = json;
  fs.writeFileSync(path.join(ROOT, 'take.elevenlabs.json'), JSON.stringify({ model_id: model, output_format: format, text, ...rest }, null, 1) + '\n');
  try {
    const take = fromElevenLabs(json);
    fs.writeFileSync(path.join(ROOT, 'take.json'), JSON.stringify({ ...take, model: model, duration: +info.duration.toFixed(6), sampleRate: info.sampleRate }, null, 1) + '\n');
    console.log(`wrote take.json (${take.words.length} words, ${take.tags.length} delivery tags) and take.elevenlabs.json`);
  } catch (e) {
    if (!(e instanceof CueError)) throw e;
    console.error(`voice: the audio is saved in take-raw.wav, but the timings could not be read: ${e.message}`);
    return 1;
  }
  console.log('next: node tools/cues.mjs');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
