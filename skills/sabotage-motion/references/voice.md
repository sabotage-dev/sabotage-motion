# Voice: takes, timings, cues, captions and the mix

A voiced piece runs: board, take (audio and word timings), `tools/cues.mjs` (cues and the voice file the mix uses),
the scene timed from the cues, captions from the same words, then `tools/mix.mjs` (voice, bed and effects, mastered).
Silent pieces skip all of it.

## Contents
1. A take and its timing format
2. Where a take comes from
3. Delivery tags
4. Cues (`tools/cues.mjs`)
5. Silences: gaps and silent beats
6. The hook gate
7. Using the cues in a scene
8. Captions
9. The mix (`tools/mix.mjs`)
10. The mixer's known limits

## 1. A take and its timing format
A take is two files in the piece: `take-raw.wav` (the voice; any format ffmpeg reads works through `--audio`) and
`take.json`, its timings in the generic `words` format:

```json
{ "source": "kokoro", "duration": 14.025, "sampleRate": 24000,
  "words": [{ "text": "Fast", "start": 0.3, "end": 0.65 }, { "text": "motion", "start": 0.65, "end": 1.05 }],
  "chars": { "text": "Fast motion ...", "starts": [], "ends": [] },
  "tags": [{ "text": "[chuckles]", "start": 11.28, "end": 11.73 }] }
```

- `words` is required: each word's text (punctuation attached, as spoken) and its start and end in seconds into the
  take. `source` names where the timings came from; `tools/cues.mjs` keeps it.
- `chars` is optional, for sources with character timings; matching then uses it (exact phrase, case-sensitive).
  Without it, anchors match on the words (case-sensitive, punctuation stripped at the word's edges).
- `tags` holds delivery tags with their times (section 3).

## 2. Where a take comes from
- **Any TTS that reports timings**: convert its output to the format above. The `explainer-beat` example does this
  with an openly licensed local model (Kokoro-82M): the model predicts each word's duration before it renders, and
  those predictions are the timings (`examples/explainer-beat/VOICE.md` has the script).
- **A human read, or a TTS without timings**: transcribe it with word timestamps. openai-whisper's JSON written with
  `--word_timestamps True` reads directly: `node tools/cues.mjs --from whisper read.json --audio read.wav`. Other ASR or
  forced-alignment tools convert to the `words` format.
- **ElevenLabs** (optional, paid, your own account): `node tools/voice-elevenlabs.mjs --model <id>` joins the board's
  lines, tags included, into one request (one take keeps the delivery consistent), calls the text-to-speech "with
  timestamps" endpoint, writes `take-raw.wav` the moment the audio arrives (so a later failure does not waste the
  credits), then `take.json` and `take.elevenlabs.json`. It reads `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from
  the environment or `--env-file`, has no default model, sends no voice settings unless `--voice-settings` gives
  them, and prints the character cost. `--dry-run` prints the request without sending it. Keep an `--env-file`
  out of git (the template's `.gitignore` ignores `.env` files).
- `--from elevenlabs <file>` reads that API's response directly; `--from words` (the default, `take.json`) the
  generic format.

Use a voice you have the right to publish. The example's is synthetic and Apache-2.0; never clone a real person's
voice without their consent.

## 3. Delivery tags
A `[...]` span in a `vo` line (`[curious]`, `[short pause]`, `[chuckles]`) goes to the TTS as written and shows on the
board sheet as direction, but it is never a word: not in `WORDS`, never captioned, not counted by the estimate, never
an anchor (an `anchor` containing `[` is refused). Every adapter moves tags out of the words so the text still reads
as spoken ("Hello [sighs], world" reads "Hello, world").

A tag's sound belongs to the line it is written in:

- tags directly before a beat's anchor move that beat's cue to the first tag's start, so the cut and any spliced
  silence come before the breath or the chuckle;
- tags after a line's last word count as the end of that line, for the splice point, `TAKE.lastWordEnd` and the
  hook's end, so nothing is cut inside a tag.

Measured on one TTS model's takes: most tags last about 50 ms and a `[chuckles]` 0.36 to 0.45 s, and their spans
are not silent (the next word's breath and onset, or the chuckle itself). Which tags a model understands is the
model's business; nothing here filters them.

## 4. Cues (`tools/cues.mjs`)
```sh
node tools/cues.mjs                                   # take.json + take-raw.wav
node tools/cues.mjs --from whisper read.json --audio read.wav
node tools/cues.mjs --dry-run                         # every check, and what it would write, writing nothing
```
It finds each voiced beat's anchor in the take (by default the line's first four words; `occurrence` picks one when
a phrase repeats; without it, the next anchor is searched for after the previous one), and only when every check
passes writes:

- `cues.js` and `cues.json`: `VO_OFFSET` (the picture time where the voice starts), `CUE` (seconds into `vo.wav`
  where each voiced beat's anchor starts, beat ids only), `TAKE` (`duration`, `lastWordEnd`), `GAPS`, `HOOK_END`,
  `WORDS`, and `BOARD_KEY` (the board fields the cues depend on);
- `vo.wav`: the take with the silences the board asks for spliced in (48 kHz mono, 32-bit float);
- `take.json` and `take-raw.wav` when they came from other files.

It refuses, and writes nothing, when an anchor is not in the take, a `gapBefore` would split speech, the hook ends
after `hookMax`, `--offset` is below the leading silent beats, or a beat window would be empty (two anchors closer
than `lead`). A refusal lists every reason at once. Every time in `cues.js` except `VO_OFFSET` is seconds into
`vo.wav`; the board helpers add `VO_OFFSET` once.

Run it again whenever the take or a timing field of the board changes: a render refuses a `cues.js` made from a
different board.

## 5. Silences: gaps and silent beats
- **`gapBefore: 0.6`** on a beat opens that much silence before its anchor, cut at the quietest 10 ms between the
  previous word (or closing tag) and the anchor. It is refused where that point is louder than -50 dBFS (it would
  split speech) or there is no pause at all. Later times shift by the gap.
- **Silent beats between voiced beats** get their summed length of zeros spliced into the voice, at the previous
  word's end or `lead` before the anchor, whichever is later, with 5 ms fades either side. A take that runs straight
  into the anchor splices at the anchor, with a warning. No word is cut.
- `GAPS` in `cues.js` records each splice. The raw take stays in `take-raw.wav`; `vo.wav` is the one with silences.

## 6. The hook gate
With `hookMax: 4.0` on the board, `tools/cues.mjs` refuses a take whose hook beat (the one with `hook: true`, else the
first voiced beat) ends after 4.0 s of picture time, and says by how much. It prints the spare time when it passes.
`check`'s `hook_long` measures it again, and on a master it also requires that the mix applied `VO_OFFSET` as the
voice's delay. Shorten the line, or ask for a faster read; don't render a hook that runs long.

## 7. Using the cues in a scene
```js
import { beatWindow, boardInfo, CUES } from './lib.js';
const VO = boardInfo().voOffset, WORDS = CUES ? CUES.WORDS : [];
const [saveIn] = beatWindow('save');                       // picture time, from the take once cues.js exists
const said = (word, from) => { const w = WORDS.find((x) => VO + x.start >= from && x.text.toLowerCase().startsWith(word)); return w ? VO + w.start : null; };
export const TL = { slam: said('skill', saveIn) ?? saveIn + 0.5 };   // land the copy on the spoken word
```
`CUES` is `null` until a take exists, and the board then uses the estimate, so a scene should fall back to a time
inside the beat (E: `examples/explainer-beat/scene.js`, `said()`). Never add `VO_OFFSET` to a `beatWindow` time: it is
already picture time.

## 8. Captions
```js
import { captions, sceneTarget, CUES } from './lib.js';
// init: const T = await sceneTarget(target); SAFE = T.safe; EXCL = T.exclude || [];
const opts = () => ({ safe: SAFE, exclude: EXCL, size: 64, accent: '#FFC23A', stroke: 10 });
captions(ctx, CUES ? CUES.WORDS : [], t, opts());                                       // in frame(t)
export const boxes = (t) => captions(ctx, CUES ? CUES.WORDS : [], t, { ...opts(), draw: false });   // for check
```
Words are grouped into lines that fit the safe width (less room for the pop), shown a group of lines at a time,
with the spoken word popped and coloured. A new group starts after a sentence end or a pause longer than `breakGap`.
`VO_OFFSET` is added inside; tags never show. **Pass the target's `exclude`**: on `tiktok-ad` a full default line
otherwise runs under the button column (x 780 to 960 from y 840 down) and `text_safe` fails it; with `exclude` the
block keeps to the width left of the column at its height. A word wider than that width is scaled down to fit it,
so it never crosses the safe edge or the column. Between words the layout leaves room for the pop, so the spoken
word never touches its neighbours: a plain space where the pop fits, more beside long words (`wordGap` sets the clear
space kept, by default half a space plus `stroke`). `maxW`, `x` and `y` override the layout by hand.
`references/techniques.md` section 11 lists every option.

## 9. The mix (`tools/mix.mjs`)
Render first (`node render.mjs full --out out/<name>.mp4`, which also writes the effects as `out/<name>.wav`), then:

```sh
node tools/mix.mjs <name>                               # voice (vo.wav), bed.mp3 if there is one, effects: -14 LUFS
node tools/mix.mjs <name> --bed music.mp3 --bed-skip 1.2 --bed-at cue:save --mute 6.0-7.5
node tools/mix.mjs <name> --stem clip.wav:0.8:2.0       # an extra stem: a clip's own sound, at x0.8 from 2.0 s
node tools/mix.mjs <name> --master-only                 # the synthesized soundtrack alone, -14 LUFS
node tools/mix.mjs <name> --sting                       # the same at -20 LUFS, for a clip cut into someone else's video
node tools/mix.mjs animatic --no-bed --no-sfx           # the animatic: the slate picture and the voice alone
```

- **Voice**: measured (EBU R128 integrated) and levelled to -24 LUFS, then `--vo-gain` (3.2), delayed by `VO_OFFSET`
  from `cues.json`. A take quieter than -50 LUFS stops the mix (it would get about +56 dB: probably the wrong file).
- **Bed**: `--bed-gain` (0.22); `--bed-skip` seconds cut from its start; by default it starts so its end lands on the
  last frame (at 0 when it is longer than the picture), or at `--bed-at` seconds or `cue:<beat id>`. It fades out
  where it stops (0.35 s, or 2.6 s when it is longer than the picture), is silent over each `--mute a-b` window
  (picture time, with a short ramp), and is ducked under the voice by a sidechain compressor (threshold 0.02, ratio
  5, attack 25 ms, release 350 ms).
- **Effects**: `out/<name>.wav` at `--sfx-gain` (0.9; 1.0 with `--master-only` and `--sting`).
- The stems are summed without normalization, limited at -6 dBFS, normalized to the target in two `loudnorm` passes,
  and encoded AAC 256 kb/s at 48 kHz with the picture copied untouched and `+faststart`.
- It writes `out/<name>-final.mp4` and `out/<name>.master.json` (the mode, the target, the voice delay it applied, a
  hash of every input, the render record it read, and the master's own hashes), which `check --file` uses to tie
  the master to its render. It checks every input before it writes anything, and a refusal or a failed run leaves the
  last master as it was.
- The defaults (bed 0.22, effects 0.9, voice 3.2) put a ducked bed about 17 dB under the voice. They are a
  starting point; listen, and change them.
- A bed must be yours to publish: synthesize it (the `explainer-beat` example's `make-bed.mjs` writes one from code),
  or use a licence that allows it.
- `--keep-premix` keeps the mix before normalization (`out/<name>.premix.wav`), for comparing two mixers with
  `scripts/parity.mjs` in this skill's repository.

## 10. The mixer's known limits
- **A bed remainder shorter than its 0.35 s fade never reaches full gain.** When the bed is shorter than the picture
  and what is left of it after `--bed-skip` is under 0.35 s, the linear fade-out covers all of it. Use a longer bed,
  or a smaller `--bed-skip`.
- **A 5.1 bed or extra stem is downmixed without being measured again.** Every stem is decoded to stereo with
  ffmpeg's own downmix. The voice is measured after that downmix, so its level is right; a bed or `--stem` is only
  multiplied by its gain, so a 5.1 file can land a few dB away from where the same music in stereo would. Downmix it
  yourself first (`ffmpeg -i bed51.wav -ac 2 bed.wav`) and listen.
- **A `VO_OFFSET` at or past the picture's end cuts the whole voice.** The mix is cut to the picture's length, and the
  voice starts at `VO_OFFSET`, so nothing of it plays. It happens when leading silent beats or `--offset` outrun a
  short picture; `check`'s `vo_delay` passes (the delay matches), so listen to the master.
