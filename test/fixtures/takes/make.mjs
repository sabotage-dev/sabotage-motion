// Writes the recorded timing fixtures in this folder from one synthetic take, in each adapter's own
// format. Nothing here comes from a real recording: the times are made up, and the tests synthesize the
// matching audio (tone bursts for words, a short burst or a noise burst under each tag).
//   node test/fixtures/takes/make.mjs
//
// The script (fixture-board's two vo lines joined): an opening tag on the second line, and a closing tag
// at the end of the last line. Tag spans end where the next word starts, as ElevenLabs times them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TOKENS = [
  ['Stop', 0.12, 0.38], ['pasting', 0.42, 0.80], ['the', 0.84, 0.95], ['same', 0.99, 1.30], ['prompt.', 1.34, 1.80],
  ['[curious]', 2.55, 2.60],
  ['Save', 2.60, 2.90], ['it', 2.94, 3.05], ['as', 3.09, 3.20], ['a', 3.24, 3.30], ['skill', 3.34, 3.70], ['instead.', 3.74, 4.30],
  ['[chuckles]', 4.30, 4.72],
];
export const DURATION = 5.0;
const isTag = (t) => t.startsWith('[');
const r3 = (x) => Math.round(x * 1000) / 1000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // ElevenLabs "with timestamps": one entry per character, spaces included; a token's characters share
  // its span evenly, and a space runs from the end of the token before it to the start of the one after.
  const characters = [], starts = [], ends = [];
  TOKENS.forEach(([text, s, e], i) => {
    if (i) { characters.push(' '); starts.push(r3(TOKENS[i - 1][2])); ends.push(r3(s)); }
    const step = (e - s) / text.length;
    for (let k = 0; k < text.length; k++) { characters.push(text[k]); starts.push(r3(s + k * step)); ends.push(r3(s + (k + 1) * step)); }
  });
  const alignment = { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
  fs.writeFileSync(path.join(here, 'elevenlabs.json'), JSON.stringify({ audio_base64: 'AAAAAAAAAAA=', alignment, normalized_alignment: alignment }, null, 1) + '\n');

  // openai-whisper with --word_timestamps True: words carry a leading space and their punctuation; a
  // transcript has no delivery tags. Two segments, one per sentence.
  const words = TOKENS.filter(([t]) => !isTag(t));
  const seg = (id, ws) => ({ id, seek: 0, start: ws[0][1], end: ws[ws.length - 1][2], text: ' ' + ws.map((w) => w[0]).join(' '),
    tokens: [], temperature: 0.0, avg_logprob: -0.2, compression_ratio: 1.1, no_speech_prob: 0.01,
    words: ws.map(([w, s, e]) => ({ word: ' ' + w, start: s, end: e, probability: 0.95 })) });
  const segments = [seg(0, words.slice(0, 5)), seg(1, words.slice(5))];
  fs.writeFileSync(path.join(here, 'whisper.json'), JSON.stringify({ text: segments.map((s) => s.text).join(''), segments, language: 'en' }, null, 1) + '\n');

  // the generic words format, tags listed apart from the words
  fs.writeFileSync(path.join(here, 'words.json'), JSON.stringify({
    source: 'words', duration: DURATION, sampleRate: 48000,
    words: words.map(([text, start, end]) => ({ text, start, end })),
    tags: TOKENS.filter(([t]) => isTag(t)).map(([text, start, end]) => ({ text, start, end })),
  }, null, 1) + '\n');
  console.log('wrote elevenlabs.json, whisper.json, words.json');
}
