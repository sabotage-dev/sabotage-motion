# sabotage-motion: v1 build plan

| | |
|---|---|
| Revision | 1.2 (2026-11-12): council rounds 1-2 folded (section 22) |
| Owner | Sabotage Development LLC, public repo `sabotage-dev/sabotage-motion` (not created yet, D5), MIT |
| Status | Plan under council review. Nothing is built yet. |
| Decisions | D1-D8 in section 19, ruled by the owner on 2026-11-12 |
| Open questions | Q1-Q10 in section 20, each with the default the build takes if nobody overrules it |

## 1. What this is

sabotage-motion is a Claude Code skill for motion graphics in short-form video. The agent writes a scene as a pure
function of time, draws it with Canvas2D over an optional WebGL2 pass, and renders it frame-exact through headless
Chrome into ffmpeg. Sound effects are synthesized in code on the same timeline. The skill ships a template that is
copied into each piece, so every piece keeps its own engine and can be re-rendered later.

It is a rewrite, for public use, of a private skill that has rendered the owner's short-form videos since
2026-09-28. The engine stays the same. What changes:

- The voice, mix and footage tools that grew up beside the private skill move into it, generalized: any word-timing
  source, any voice, any music bed.
- A storyboard becomes the single source for the script, the voice cues, the timeline and the checks.
- Measured checks replace "look at the contact sheet" as the only review.
- Private material comes out: per-brand notes, private paths, brand examples, the owner's voice and likeness.

"Lightweight" means dependencies, not scope (D6): Node, Google Chrome, ffmpeg and `playwright-core`. No React, no
framework, no render service, no Python.

### 1.1 Goals (v1)

1. **Engine, unchanged in contract** (section 5): `frame(t)` scenes, Canvas2D plus a WebGL2 post chain, motion blur
   from subframe accumulation, synthesized sound effects, transparent output, stills and contact sheets.
2. **Storyboard** (section 6): `board.js` per piece; a `board` render mode; a slate scene for animatics; checks
   against the board.
3. **Voice-driven timing** (section 7): word or character timings from a TTS take or a transcript become cue points;
   optional silence insertion before a phrase; an optional hook-length gate; an optional ElevenLabs voice tool.
4. **Captions** (section 8): word-by-word captions from the same timings.
5. **Mix and master** (section 9): voice, an optional music bed ducked under it, extra stems and the synthesized
   effects, mastered to -14 LUFS for social, or to a quieter target for effects-only pieces.
6. **Footage** (section 10): clips and screen recordings as frame sequences, drawn frame-exact.
7. **`check`** (section 11): measured checks on the piece and the master file, with exit codes.
8. **Safe zones** (section 12): per-platform presets, an overlay on contact sheets and boards, and a check.
9. **Portable** (section 13): macOS and Linux, bundled open-licence fonts, a `doctor` mode.
10. **Packaging** (section 4): one skill that installs as a personal skill, a project skill or a Claude Code
    plugin from this repo's marketplace.
11. **Three runnable examples** (section 15).

### 1.2 Non-goals (v1)

- A live preview with a scrubber, parallel or distributed rendering, a fresh-context reviewer agent, a tested
  GPU-accelerated Linux recipe (all v2, D4).
- Windows.
- 3D scenes (Three.js) and photoreal people or scenes.
- Music generation. The user brings a bed.
- TTS providers beyond the one ElevenLabs tool. Any other voice comes in through the generic timing format.
- Lottie or SVG animation import.
- Cut strips (frames either side of every cut) in the review sheets.
- Hosted rendering, a GitHub Action, an npm package of the engine.

## 2. Words

| Word | Meaning |
|---|---|
| piece | One video's folder: a copy of the template plus the piece's own scene, board, assets and outputs. |
| scene | `scene.js`: `CFG`, `TL`, `init`, `frame(t)`, `post(t)`, optional `subBoost(t)`, `drawHud(t)`, `boxes(t)`, `HOLDS`. |
| board | `board.js`: the storyboard. An ordered list of beats. |
| beat | One unit of the board: a voice line or a fixed duration, the on-screen copy, a visual note, a sound note. |
| slate | A placeholder frame for a beat: its id, on-screen copy and visual note as a text card. |
| animatic | A render of the slate scene, timed by the board, muxed with the voice. |
| take | A voice recording with timings (TTS or a transcribed human read). |
| cue | Seconds into the voice where an anchor phrase starts. |
| picture time | Seconds from the first frame of the video. Every beat window, `TL` time and check time is in picture time. |
| `VO_OFFSET` | Picture time at which `vo.wav` starts. Written once, in `cues.js`, read by the board helpers, captions and the mixer. A cue plus `VO_OFFSET` is picture time. |
| stem | One audio input to the mix: voice, bed, effects, or an extra (a clip's own sound). |
| master | The final file: picture copied untouched, mixed and loudness-normalized audio. |
| target | A delivery preset: `tiktok`, `reels`, `shorts`, `youtube`, `square`, `feed45`, `web`, `none`. Sets size, fps and safe zones. |

## 3. The workflow

The order the skill teaches. Steps marked (voice) are skipped for silent pieces (stings, end cards, loops).

1. **Pin the brief**: target, duration, where the asset lives (standalone, overlay, loop), brand sources.
2. **Write the board** (`board.js`): beats with voice lines, on-screen copy, visual notes and sound notes.
3. **Board sheet** (`node render.mjs board`): slates, timed by an estimate (section 6.3). The person approves the
   structure here, before any voice or animation.
4. **(voice) Voice it**: `tools/voice-elevenlabs.mjs` from the board, or a human read transcribed elsewhere.
5. **(voice) Cues**: `tools/cues.mjs` writes `cues.js` (`CUE`, `WORDS`, `VO_OFFSET`, `HOOK_END`) and refuses a take
   that fails the hook gate or misses an anchor.
6. **(voice) Animatic**: render the slate scene's picture and mix it with the voice alone. The person hears the
   pacing.
7. **Animate**: replace slates with the real scene beat by beat; review with `board`, `contact` and `stills`.
8. **Sign-off on a rendered sample** before polishing (unchanged from the private skill).
9. **Check the source** (`node render.mjs check`), **render** (`full`, or `video --alpha` for overlays), **mix and
   master** (`tools/mix.mjs`), **check the master** (`node render.mjs check --file <master>`).
10. **Deliver**: the master's path, a preview encode when the chat tool caps attachments, the source left in place.

## 4. Repository and piece layout

```
sabotage-motion/
  .claude-plugin/plugin.json            plugin manifest
  .claude-plugin/marketplace.json       this repo as a one-plugin marketplace (format verified in P5)
  skills/sabotage-motion/
    SKILL.md
    references/techniques.md            motion craft catalog (from the private skill, brand pointers removed)
    references/delivery.md              sizes, encodes, alpha, compositing recipes, loudness
    references/storyboard.md            the board format, the board sheet, animatics
    references/voice.md                 timing sources, cues, gaps, the hook gate, the mixer
    references/check.md                 every check, its threshold and how to silence it on purpose
    template/                           copied into each piece; see below
    examples/showreel/  examples/explainer-beat/  examples/lower-third/
  test/                                 node:test suites and fixtures
  docs/PLAN.md  README.md  LICENSE
```

The template, as copied into a piece:

```
index.html  fonts/  board.js  scene.js  slate.js  audio.js  shaders.js  lib.js  gl.js  main.js  wav.js
render.mjs  safezones.json  package.json
tools/cues.mjs  tools/voice-elevenlabs.mjs  tools/mix.mjs  tools/frames.mjs
```

- SKILL.md refers to its own files through `${CLAUDE_SKILL_DIR}` (for example
  `cp -R "${CLAUDE_SKILL_DIR}/template" motion/<piece>`). Claude Code substitutes it for personal, project and plugin
  installs alike; for a plugin skill it is the skill's own subdirectory (Claude Code skills docs, checked 2026-11-12).
- Tools live inside the template, not beside SKILL.md, so a piece re-renders with the engine it was made with after
  the skill updates. The private skill works this way today.
- Outputs (`out/`, `stills/`, `board.png`, `contact.png`) are gitignored in the template's `.gitignore`.

## 5. Engine contract

Unchanged from the private skill (its `template/scene.js` header): draw everything from `t` with no state carried
between calls, never `Math.random()` (use the seeded helpers in `lib.js`), draw in design pixels (the harness clears
and pre-scales the 2D context before each `frame()` and `drawHud()`; offscreen canvases and blur radii are scaled by
hand), return a compositing config from `frame()`, list every font in `CFG.FONTS` so a missing face throws instead of
rendering in Times.

The only harness changes in v1:

| Change | Why | Where |
|---|---|---|
| `--scene <file>` (default `scene.js`), loaded by dynamic import | The slate scene and the real scene share one harness | `main.js`, `render.mjs` |
| `renderAudio({ TL, CFG, params })` receives the selected scene's `TL` and `CFG` from the harness, after that scene's `init`; `audio.js` no longer imports `scene.js` | With a static import, a `--scene slate.js` render would schedule the real scene's cues (`audio.js` imports `scene.js` today, and `init` fills `TL.words` and `TL.hits`). A scene without sound exports `silent = true`, and `audio` renders silence | `main.js`, `audio.js` |
| `--target <name>` | Size, fps and safe zones from `safezones.json` unless `CFG` sets them | `main.js`, `render.mjs` |
| Optional `boxes(t)` export: `[{id, text, x, y, w, h, group?, deco?}]` | Lets `check` see text without OCR. Semantics: one box per drawn run of text, in design pixels before the camera, bounds after any clip mask, and only while its alpha is above 0.05; `group` joins the words of one phrase or caption line (section 11) | scene contract |
| `render.mjs` writes `out/<name>.render.json` after every `video`/`full` render | Ties a master to the source it came from (section 11.2) | `render.mjs` |
| Optional `HOLDS` export: `[[t0, t1], ...]` | Marks deliberate holds (end cards hold to the last frame) | scene contract |
| `window.renderProbe(t, opts)`: one frame at a given scale, subframes and post overrides (`grain: 0`), returned as luma bytes | `check`'s motion analysis without noise from grain | `main.js` |
| Board composition in the page (section 6.2) | Captions under panels with the piece's own fonts; no ffmpeg `drawtext` | `main.js` |
| `doctor` mode | Section 13 | `render.mjs` |
| Fonts bundled as files | The private template uses macOS system fonts through `local()`, which do not exist on Linux | `index.html`, `fonts/` |

Every other harness behaviour carries over as is: subframe accumulation with a 180-degree shutter and Halton jitter,
`subBoost(t)`, the post chain, ProRes 4444 or VP9 alpha, container extension fixed to the codec, `--out` and `--dir`
resolved against the piece, `--param k=v`, the audio report after every audio render (peak, RMS, spike warning),
audio rendered before video so a broken `audio.js` fails fast.

## 6. Storyboard

### 6.1 `board.js`

An ES module, so the scene can import it in the browser and the Node tools can import it too:

```js
export const BOARD = {
  title: 'What a skill is',
  target: 'tiktok',
  wps: 3.0,                 // speaking rate for estimates before a take exists (words per second)
  hookMax: 4.0,             // optional: the hook beat's last word must end before this many seconds
  beats: [
    { id: 'hook', vo: 'Stop pasting the same instructions into your agent.', on: ['Stop pasting'],
      look: 'one word slams in on black', sfx: 'whoosh into a hit', hook: true },
    { id: 'save', vo: 'Save them as a skill instead.', anchor: 'Save them', gapBefore: 0.6,
      on: ['SKILL.md'], look: 'a file icon drops in, its name types on', sfx: 'tick per letter' },
    { id: 'end', dur: 2.5, on: ['example.com'], look: 'end card, holds to the last frame', hold: true },
  ],
};
```

- A beat has either `vo` (a voice line) or `dur` (seconds, for silent beats). Silent beats may lead, sit between
  voiced beats, or trail (section 6.3).
- Beat ids are unique and may not be `TAKE`, `VO_OFFSET` or `DUR`.
- `anchor` defaults to the first four words of `vo`. `gapBefore` asks `cues.mjs` to open that much silence before
  the anchor (section 7.4). `hook: true` marks the hook beat for the gate. `hold: true` adds the beat's window to the
  holds `check` accepts.
- `sfx` is a note for the person and a presence check (section 6.5); `sfxHit: true` asks for a transient instead;
  `sfx: null` means silence on purpose.
- The voice script is the voiced beats' `vo` lines joined in order; no separate script file.
- `lib.js` gains `beatWindow(id)` (picture time, half-open `[start, end)`), `beatAt(t)` and `boardDur()`. The scene's
  `TL` and `CFG.DUR` are built from them instead of hand-copied numbers; the template's `scene.js` and `slate.js`
  both set `CFG.DUR = boardDur()`.

### 6.2 `render.mjs board`

One PNG (`board.png`), plus `board.md` beside it with the same content as a table:

- one panel per beat, in order, 3 columns at 9:16 (4 at 16:9), each panel the frame at the beat's key time
  (`beat.key` seconds into the beat, default 60% of the way through);
- under each panel: the beat id, its time window, the voice line, the on-screen copy, and the sound note;
- `--slates` forces the slate scene; `--safe` draws the target's safe zones on every panel;
- times come from `cues.js` when it exists; otherwise from the estimate, and the sheet says "estimated timing" in
  its header.

The page renders each panel to an `ImageBitmap` at panel size and composes the sheet on its own canvas with the
piece's fonts, so the captions use the same font check as everything else.

### 6.3 Beat timing

All windows are picture time, half-open, contiguous, and together cover `[0, boardDur())`. Defaults: `lead` 0.10 s
(a voiced beat's window opens this long before its anchor), `tail` 0.40 s (the last voiced beat's window closes
this long after its last word), both settable on the board.

**Before a take exists (estimate).** Beats run back to back in board order: a voiced beat lasts
`words / wps + 0.25` s, a silent beat lasts its `dur`. `VO_OFFSET` is the summed `dur` of any leading silent beats
plus `lead`. The board sheet and animatic say "estimated timing".

**Once `cues.js` exists.** The take is the only source for voiced beats; the estimate is never used again for them.
Windows are built from a list of boundaries, so they are contiguous by construction:

- **`VO_OFFSET` has one writer, `cues.mjs`.** Default: the summed `dur` of the leading silent beats plus `lead`.
  `--offset` replaces the default and is refused if it is smaller than that sum (the voice would play over the
  leading silent beats). Every time in `cues.js` other than `VO_OFFSET` is seconds into `vo.wav`.
- **Anchor time** of voiced beat *i*: `A(i) = VO_OFFSET + CUE[i]` (picture time).
- **Boundaries.** The first beat starts at 0, whatever it is. Leading silent beats run back to back from 0. The
  first voiced beat starts where the leading silent beats end (0 if there are none), so the voice's `lead` falls
  inside it. Every later voiced beat *i* starts at `A(i) − lead`. A run of interleaved silent beats with total
  duration `D` that sits before voiced beat *i* ends at `A(i) − lead` and starts at `A(i) − lead − D`, its beats
  back to back in board order. Trailing silent beats start at `VO_OFFSET + TAKE.lastWordEnd + tail`, back to back.
  Each beat ends where the next starts; `boardDur()` is the last end (with no trailing beat,
  `VO_OFFSET + TAKE.lastWordEnd + tail`).
- **Room in the voice for interleaved silent beats.** `cues.mjs` splices `D` seconds of zeros into `vo.wav` before
  voiced beat *i*'s anchor: at the quietest 10 ms between the previous word's end and the anchor's start when that
  window is at least 10 ms long, otherwise exactly at the anchor's start (with a warning that the take runs the
  words together; the `-50 dBFS` refusal applies only to `gapBefore`, section 7.4). Later cues shift by `D`. The
  picture windows above come from the shifted cues alone, so they stay contiguous wherever the splice lands; the
  silence in the voice sits within `lead` of its beat's window. `GAPS[].at` is the splice point in seconds into
  `vo.wav`.
- **Validation.** `cues.mjs` refuses a board whose windows would have zero or negative length (two anchors closer
  than `lead`, or a `dur` of 0) and names the beats.
- `cues.js` keeps take facts apart from beat cues: `CUE` holds only beat ids; `TAKE = { duration, lastWordEnd }`
  holds the rest, so no beat id can collide with a take field.

`VO_OFFSET` is applied in exactly one place for each consumer: `beatWindow`, `captions`, and `mix.mjs`'s voice
delay and `--bed-at cue:<id>`.

### 6.4 Slate scene and animatic

`slate.js` is a complete scene that reads `BOARD` and draws, for the beat under `t`: the beat id small at the top,
the on-screen copy large and auto-fitted inside the safe zones, the visual note in a muted line, and a progress bar.
It is designed to be replaced beat by beat, not shipped. It exports `silent = true`. The animatic is the slate
picture plus the voice alone: `node render.mjs video --scene slate.js --out out/animatic.mp4`, then
`node tools/mix.mjs animatic --no-bed --no-sfx` (with `--no-sfx`, a missing effects stem is silence, so the
silent `video` render is enough).

### 6.5 Board checks (part of `check`)

| Check | Level | Rule |
|---|---|---|
| `board_order` | FAIL | Beat windows are contiguous and in order, and `CFG.DUR` equals `boardDur()` within one frame. |
| `board_copy_missing` | WARN | A string in a beat's `on` is never found in that beat's window. Matching works across the whole window, not per sample, so words that appear one at a time still match: for each `group` (or for all boxes, without groups), the distinct box texts seen at any sample inside the window are joined in order of first appearance (ties in reading order), and the `on` string is searched in that text, case-insensitive, whitespace collapsed. Needs `boxes(t)`; otherwise reported as not checked. |
| `board_copy_unread` | WARN | A string in `on` is found for less than `max(1.0, 0.25 × words)` seconds in total. |
| `board_sfx_missing` | WARN | A beat with an `sfx` note has no 50 ms window above -40 dBFS RMS in the effects stem inside its window. With `sfxHit: true`, it needs a transient instead: a 10 ms window more than 12 dB above the RMS of the preceding 100 ms and above -40 dBFS. `sfx: null` is never checked. |
| `hook_long` | FAIL | With `hookMax` set: `VO_OFFSET` + the hook beat's last word end is later than `hookMax`. On a master, also requires the voice delay `mix.mjs` recorded to equal `VO_OFFSET` (section 11.2). |

## 7. Voice-driven timing

### 7.1 The timing format (`take.json`)

```json
{ "source": "elevenlabs|whisper|words", "duration": 12.48, "sampleRate": 48000,
  "words": [{ "text": "Stop", "start": 0.12, "end": 0.38 }],
  "chars": { "text": "Stop pasting ...", "starts": [], "ends": [] } }
```

`chars` is present only when the source gives character timings. Matching uses `chars` when present (exact phrase
match, case-sensitive) and the word sequence otherwise (case-sensitive, punctuation stripped at word edges).

### 7.2 Adapters (`tools/cues.mjs --from <kind> <file>`)

- `elevenlabs`: the text-to-speech "with timestamps" response's `alignment` (`characters`,
  `character_start_times_seconds`, `character_end_times_seconds`), as the private helper reads it today; field names
  re-verified against the API docs in P1.
- `whisper`: openai-whisper's JSON written with `--word_timestamps True` (`segments[].words[]` with `word`, `start`,
  `end`); re-verified in P1. Other ASR tools convert to the `words` format.
- `words`: the generic format above.

### 7.3 Cues (`cues.js`)

```js
// generated by tools/cues.mjs; do not edit
export const VO_OFFSET = 0.10;                          // picture time where vo.wav starts (section 6.3)
export const CUE = { hook: 0.12, save: 3.67 };           // seconds into vo.wav, beat ids only
export const TAKE = { duration: 12.48, lastWordEnd: 12.40 };
export const GAPS = [{ before: 'cta', at: 9.85, dur: 1.5 }]; // zeros spliced for interleaved silent beats (seconds into vo.wav)
export const HOOK_END = 2.72;                            // seconds into vo.wav
export const WORDS = [{ text: 'Stop', start: 0.12, end: 0.38 }];
```

- One cue per beat with `vo`, keyed by beat id, from its anchor (with an occurrence count when a phrase repeats).
  Every time in `cues.js` except `VO_OFFSET` is seconds into `vo.wav`; the board helpers convert to picture time.
- A missing anchor stops the tool with the phrase it could not find. It checks every anchor before it writes
  anything, so a bad take never replaces a good `cues.js`.
- `VO_OFFSET` is written once, by `cues.mjs` (section 6.3), and read by the board helpers, captions and `mix.mjs`.
  The private version keeps it in two places (a constant in the scene and an environment variable for the mixer),
  which can drift.
- `cues.json` is written beside it for the Node tools.

### 7.4 Gaps

`gapBefore` opens silence before a beat's anchor: the cut goes at the quietest 10 ms between the previous character
or word's end and the anchor's start; it refuses when that point is louder than -50 dBFS (it would split speech) or
when there is no pause at all; every later timing shifts by the gap. Ported from the private helper, which has used
it on every voiced piece. Interleaved silent beats use the same splice without the refusal (section 6.3). The voice file with gaps is `vo.wav`; the raw take is kept as `take-raw.wav`.

### 7.5 Hook gate

With `hookMax` set on the board, `cues.mjs` refuses a take whose hook beat ends after `hookMax - VO_OFFSET`, and
says by how much, before the scene or mix uses it. `check` measures it again on the master (6.5).

### 7.6 `tools/voice-elevenlabs.mjs`

Optional. Joins the board's `vo` lines into one continuous request (one take keeps the delivery consistent), calls
the with-timestamps endpoint, writes `take-raw.wav` immediately (so a failed check does not waste the credits), then
`take.json`. Reads `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from the environment or `--env-file`; the model is
`--model`, with no default baked in (the README names the current one). Sends no voice settings unless asked.
`--language` pins the language code. Prints the character cost the response reports.

## 8. Captions

`lib.js` gains `captions(ctx, WORDS, t, opts)`: groups words into lines that fit `opts.maxW` with `measureText`,
shows one line group at a time, pops the active word (`anticip` or a spring, 1.15 to 1), colours it with the accent,
and places the block inside the target's safe zones. It returns its text boxes so a scene can pass them through
`boxes(t)`. Offsets are applied once from `VO_OFFSET`.

## 9. Mix and master (`tools/mix.mjs`)

```
node tools/mix.mjs <name> [--vo vo.wav] [--bed bed.mp3] [--stem file[:gain[:delay_s]]]...
                   [--bed-gain 0.22] [--sfx-gain 0.9] [--vo-gain 3.2] [--bed-skip s] [--bed-at s|cue:<id>]
                   [--mute a-b[:ramp],...] [--no-bed] [--no-sfx] [--master-only | --sting]
                   [--target-lufs -14] [--tp -2.0]
```

Modes and targets (one table, also used by `references/delivery.md` section 5):

| Mode | Inputs | Target |
|---|---|---|
| default | voice, optional bed, effects, extra stems | -14 LUFS integrated, -2.0 dBTP |
| `--master-only` | the synthesized soundtrack alone (no voice, no bed) | -14 LUFS, -2.0 dBTP (the private master script's behaviour) |
| `--sting` | the synthesized soundtrack alone, for an asset cut into someone else's video | -20 LUFS, -3.0 dBTP |
| any | `--target-lufs`, `--tp` | override the mode's numbers |

`mix.mjs` writes `out/<name>.master.json` beside the master: the mode, the target loudness and true peak, the
voice delay it applied (none for `--master-only` and `--sting`), a hash of every input stem, the path and
SHA-256 of the `render.json` it read, the decoded video hash of the master, and the SHA-256 of the whole master
file it wrote (section 11.2).

Ported from the private mix and master scripts, behaviour kept:

- Inputs: `out/<name>.mp4` (picture) and `out/<name>.wav` (the synthesized effects stem). The voice is delayed by
  `VO_OFFSET` from `cues.json`.
- The voice is measured (EBU R128 integrated) and levelled to -24 LUFS before `--vo-gain`; a take quieter than
  -50 LUFS stops the mix (it would get about +56 dB).
- The bed: skips `--bed-skip` seconds, starts so its end lands on the last frame (or at `--bed-at`), fades 0.35 s if
  it is shorter than the picture and 2.6 s if longer, is silenced over `--mute` windows, and is ducked by the voice
  through a sidechain compressor (threshold 0.02, ratio 5, attack 25 ms, release 350 ms).
- All stems are resampled to 48 kHz stereo, mixed without normalization, limited at -6 dBFS, then loudness-normalized
  in two passes (`loudnorm` at the mode's target, LRA 11, linear), encoded AAC 256 kb/s at 48 kHz, with the picture
  stream copied and `+faststart`. AAC adds about 0.5 dB of true peak (measured on the private masters), which is
  why the targets sit below the -1.0 dBTP ceiling `check` enforces.
- Prints the voice level and gain, the bed placement, the premix's measured loudness, and the final integrated
  loudness and true peak.
- The defaults (bed 0.22, effects 0.9, voice 3.2 after levelling) are the private mixer's, which put the ducked bed
  about 17 dB under the voice. They are a starting point, not a rule.

## 10. Footage (`tools/frames.mjs`)

```
node tools/frames.mjs <name> <src> --from s --dur s [--vf "<ffmpeg filter>"] [--q 4]
```

Writes `assets/seq/<name>/000.jpg...` at the piece's fps and updates `assets/seq/manifest.json` with the frame
count. `lib.js` gains `loadSeq(name)` (for `init`) and `seqAt(name, t, t0, {loop})`: frame `floor((t - t0) × fps)`,
looped or held on the last frame. Clip audio goes through `mix.mjs --stem`. The section in `references/delivery.md`
says to crop and scale in `--vf` to the size the scene draws, because every frame is held decoded in memory.

## 11. `check`

```
node render.mjs check                                   source checks on the piece
node render.mjs check --file out/<name>-final.mp4       the same, plus artifact checks on that file
               [--target tiktok] [--lufs -14 --tp -1.0] [--json] [--strict]
```

Runs every check it can, says which it could not run and why, prints one line per result, and exits 1 on any FAIL
(with `--strict`, on any WARN too). `--json` prints the same results as an array of
`{id, scope, level, t?, detail, measured, threshold}`.

### 11.1 Source checks (the piece as it is now)

| Check | Level | How it is measured |
|---|---|---|
| `fonts` | FAIL | Every `CFG.FONTS` family loads (the existing throw, reported as a result instead). |
| `board_*`, `hook_long` | as 6.5 | Section 6.5. |
| `motion_dead` | WARN | A heuristic. `renderProbe` at 1/2 scale, 1 subframe, grain 0, every frame; with grain off and a single subframe a held frame repeats exactly, so any change is real. A frame pair counts as moving when at least 4 probe pixels change by 2/255 or more in luma. Flags any run of 3.0 s or more with no moving pair that is not inside `HOLDS` or a `hold: true` beat. The clean fixture's small mover (a 10×10 design-pixel dot moving 1 design pixel per frame, 5×5 probe pixels moving 0.5) changes about 10 probe pixels by well over 2/255 per pair, so it counts as moving; P3 confirms on the fixture. |
| `first_frame_empty` | WARN | `renderProbe(0)`: luma standard deviation under 4/255 (a flat first frame is a blank thumbnail). |
| `text_safe` | FAIL (WARN while the target's zones are an estimate) | `boxes(t)` evaluated at every subframe time the render uses (the same `n = round(sub × subBoost(t))` samples across the 180-degree shutter), each mapped through the `cam` that `frame(t)` returns for that sample (zoom, rotation, pan, as the composite shader applies it). A sample outside the safe area contributes `1 / (n × FPS)` seconds of exposure. A non-`deco` box with more than 0.25 s of exposure in total within one beat is a FAIL; any smaller exposure (a slam entrance, a whip) is a WARN. Not run without `boxes(t)`. |
| `text_overlap` | WARN | At the same samples, two non-`deco` boxes from different groups intersect by more than 2% of the smaller one's area. |
| `audio_spike` | WARN | The existing 50 ms window analysis on the effects stem: a peak more than 18 dB above the 90th percentile window. |

### 11.2 Artifact checks (`--file`)

A master is only as good as the source it came from, so the artifact checks first prove which source that was.

- `render.mjs` writes `out/<name>.render.json` after every `video` or `full` render: a hash over the piece's source
  (every file except `out/`, `stills/`, `node_modules/` and the review sheets), the scene file, params, size, fps,
  subframes and alpha mode, and a hash of the rendered file's decoded video (`ffmpeg -map 0:v -f hash -hash sha256`).
- `mix.mjs` writes `out/<name>.master.json` (section 9), including the SHA-256 of the whole master file. Any change
  to the file after the mix (another audio track, a re-encode) breaks the match.

| Check | Level | How it is measured |
|---|---|---|
| `provenance` | FAIL | `master.json` exists (a `--file` without one FAILs; `--plain` checks a foreign file as a plain file, and then only `file_spec`, `faststart` and `loudness` with `--lufs` run); the SHA-256 of the whole `--file` equals the master hash `master.json` records (any other mix of the same picture fails); the `render.json` it names exists and its SHA-256 equals the one recorded; the piece's current source hash equals the one in `render.json` (otherwise the master is stale: re-render). The decoded video hash `master.json` records equals the one in `render.json` (the mixer copied the picture untouched; section 21). Only then do the 11.1 results stand for this file, and `check --file` runs the 11.1 checks with the scene, params, size, fps, subframes and alpha mode recorded in `render.json`, not the command line's. |
| `file_spec` | FAIL | `ffprobe`: width, height, fps and pixel format match the piece; the frame count (`-count_frames`) equals `round(DUR × FPS)`; the duration matches within one frame; an audio stream exists unless the scene is `silent`. |
| `faststart` | WARN | For `.mp4`: the `moov` atom comes before `mdat`. |
| `loudness` | FAIL | `ebur128=peak=true` on the file: integrated loudness within 1 LU of the target `master.json` records (or `--lufs`), and true peak at or under -1.0 dBTP (or `--tp`). With neither, reported as not checked. |
| `vo_delay` | FAIL | Only for a master mixed with a voice: the voice delay `master.json` records equals `cues.js`'s `VO_OFFSET`. The record is trusted because `provenance` has bound it to this exact file and `mix.mjs` applied it; `--master-only` and `--sting` masters skip this check. |

### 11.3 Thresholds

The thresholds above are starting values. P3 tunes them on the three examples and on recorded renders of real
pieces, so that clean pieces pass and the planted defects in section 16 fail; the tuned numbers go in
`references/check.md` with the measurement that set them.

## 12. Safe zones

`safezones.json` holds one entry per target: canvas size, fps, and the rectangle where text and key objects belong,
with a `source` line and a `measured` date per number. Until an entry is measured it carries `"estimate": true`, and
`check` and the overlays say "estimate".

- v1 ships `tiktok` from the owner's posted pieces (text column from x 84 to 936; content above y 1480 on 1080×1920)
  and leaves its top edge, `reels` and `shorts` to the P3 measurement (Q3).
- While a target is an estimate, `text_safe` reports WARN instead of FAIL for it.
- `references/delivery.md` drops its own percentages and points at `safezones.json`, so the guide and the check
  never disagree.
- Overlays: `contact --safe` and `board --safe` shade the unsafe area on every panel.
- The 9:16 review sheet at phone width is a documented flag combination (`contact --scale 0.333`), not a new mode.

## 13. Platforms and dependencies

- **macOS**: Google Chrome through Playwright's `chrome` channel, WebGL2 on ANGLE/Metal (`--use-angle=metal`), as
  the private engine runs today. About 200 ms per frame at 1080×1920 and 8 subframes on an Apple-silicon Mac.
- **Linux**: Google Chrome or `CHROME_PATH`; WebGL2 through SwiftShader (`--enable-unsafe-swiftshader`). Works and
  is tested in CI at small scale; slow at full size (P0 measures and the README states the number). A
  GPU-accelerated recipe is v2.
- **Node** 22 or 24. **ffmpeg** with `libx264`, `libvpx-vp9`, `prores_ks`, `loudnorm`, `ebur128`,
  `sidechaincompress`, `alimiter`.
- **`node render.mjs doctor`**: finds Chrome, opens a WebGL2 context and reports the renderer string (Metal, a GPU,
  or SwiftShader), checks each ffmpeg encoder and filter above, loads every font in `index.html`, and renders one
  probe frame twice to confirm the hashes match. Each line says what to install when something is missing.

## 14. The skill text

SKILL.md is rewritten from the private skill's, keeping its structure (quick start, files in a piece, workflow, craft
defaults, gotchas, references) and changing:

- The description keeps the trigger list (kinetic type, titles and end cards, stings, captions, lower thirds,
  overlays, promo and data animations, synced sound) and the "not for" lines. It names no brands, and no other
  products (Q7).
- The workflow becomes section 3's, with the board and the voice path.
- Paths use `${CLAUDE_SKILL_DIR}`; no private paths; no references to a specific chat tool's attachment cap ("send a
  preview encode if your chat tool limits attachments").
- The per-project notes section is replaced by one paragraph: put brand notes (colours, fonts, logo files, what the
  live site ships) in the project's own CLAUDE.md, and the skill reads them in the "read the brand" step.
- Gotchas keep the general ones (missing fonts, zsh quoting in ffmpeg commands, `N` vs `T` in `blend`, VP9 alpha
  decoding, grain and file size, bloom, frozen counters, GPU path, shader y vs canvas y, output path resolution) and
  drop the ones tied to private pipelines.
- A short "when to use something else" section: Remotion or HyperFrames when a team writes React or HTML, needs a
  studio with a scrubber, or renders at scale in the cloud.
- Every shipped reference is rewritten the same way, not only SKILL.md. `references/techniques.md` keeps its
  catalog; pointers into the private examples become pointers into the public ones, and brand-specific advice
  becomes general ("for a SaaS promo..."). `references/delivery.md` loses its private-pipeline material: the
  compositing notes tied to a private sting and a private Python pipeline, the gain one private asset ships at, and
  the chat tool's attachment cap; its safe-zone and loudness numbers come from `safezones.json` and section 9's
  table.

## 15. Examples

Each is a full piece (template plus its own scene and board), runnable from its folder, with a committed
`contact.png` and `board.png` and no other outputs.

- `showreel/` (20 s, 16:9, 60 fps): the private skill's showreel ported to the current harness. Before any frame
  of it is committed, its lockup is replaced: today it ends on a third-party product name as a wordmark, a
  "Motion Designer" subtitle, the same name in the HUD, and that product's spark mark. The public reel ends on a
  fictional name and mark. Its fonts are macOS system fonts today; they are replaced with open-licence faces, and
  the visual drift is accepted.
- No example contains a third-party name, logo or trademark.
- `explainer-beat/` (about 15 s, 9:16): a made-up three-beat explainer built the section 3 way: board, voice take,
  cues, captions, a bed, `mix.mjs`, `check` clean. Its voice comes from an openly licensed TTS voice whose licence
  allows redistribution (Q2), never the owner's voice. `VOICE.md` in the folder names the engine, the voice, its
  licence and the licence URL, and `take.json`'s `source` names the same engine.
- `lower-third/` (5 s, 16:9, alpha): a name strap rendered `--alpha` to ProRes 4444 and WebM, plus the
  `delivery.md` recipe that composites it onto a generated test pattern.

The private skill's two brand examples (a news sting and an app end card) are not carried over.

## 16. Tests

`node:test`, run in CI on `macos-latest` and `ubuntu-latest`, Node 22 and 24. Two fixture pieces, both 1080×1920
rendered at scale 0.25:

- `fixture-clean` (2 s): engine tests.
- `fixture-check` (12 s): moving content before and after every planted defect, plus clean cases that must not be
  flagged: an end card inside `HOLDS`, grain on, a single 10 px dot moving 1 px per frame on an otherwise held card,
  a slow drift, word-by-word captions, a slam entrance that briefly leaves the safe area. Sizes in these fixtures
  are stated in design pixels.

Suites:

- **Determinism**: the same frame rendered twice is byte-identical; frame `t` rendered after a different frame is
  identical to frame `t` rendered first (catches state carried between calls). Compared within one machine only
  (Q9).
- **Frame count and container**: `video` writes exactly `round(DUR × FPS)` frames; the extension follows the codec;
  `render.json` is written with the source and decoded-video hashes.
- **Alpha**: the ProRes file is `yuva444p10le` with a non-constant alpha plane; the WebM, decoded with
  `libvpx-vp9`, has one too.
- **Scene swap**: a `--scene slate.js` render of a piece whose real scene has a different `TL` and duration renders
  the slate's length with silent effects, and never evaluates the real scene's cues.
- **Cues**: each adapter on a recorded fixture gives the expected cues; a missing anchor stops before any write; the
  occurrence count works; a gap at a silent point shifts later timings by exactly the gap; a gap that would split
  speech is refused; the hook gate refuses a late take; `CUE` holds only beat ids.
- **Board timing**: estimate and cue-based windows for boards with leading, interleaved and trailing silent beats;
  windows are contiguous, half-open and start at 0 in every case, including: a single voiced beat whose first cue is
  later than `lead`; the five-beat board `cold (dur 1) / hook (vo) / mid (dur 1.5) / save (vo) / end (dur 2.5)`; an
  interleaved beat whose splice lands at a quiet point 0.3 s before the next anchor; a take with no pause before
  the next anchor (splice at the anchor, with the warning). `--offset` below the leading silent sum is refused;
  two anchors closer than `lead` are refused; `boardDur()` equals
  `CFG.DUR`; `VO_OFFSET` is applied once (a 0.10 s and a 2.10 s offset both land beat starts, captions and
  `--bed-at cue:` on the same picture frames as a hand calculation); `board_order` catches a bad board; the board
  sheet renders with slates and with a real scene.
- **Mix**: synthetic stems (voice as tone bursts, a noise bed, clicks as effects). For each mode in section 9 and for
  a custom target: integrated loudness within 0.5 LU of the target and true peak at or under -1.0 dBTP (the same
  ceiling `check` uses). Each control on its own, with non-default values: a 0.35 s and a 2.10 s voice delay (the
  voice's first burst lands on the right sample), `--bed-skip`, `--bed-at` in seconds and as a cue, both fade
  branches (a bed shorter and a bed longer than the picture), a mute window (silent inside, unchanged outside),
  ducking (the bed at least 10 dB lower inside voice bursts than between them), an extra stem with a delay, a
  `--no-sfx` mix with no effects stem on disk, and a near-silent voice stopping the mix. `master.json` records what was applied.
- **Footage**: the sequence count equals `round(dur × fps)`; `seqAt` indexes, loops and holds correctly.
- **Check**: `fixture-check` has one of each planted defect: a 4 s freeze outside any hold, a flat first frame, a
  text box outside the safe area for 0.5 s, two overlapping boxes, a word found for 0.2 s, a board beat whose copy
  never appears, a beat with a sound note and no sound in its window, a beat with `sfxHit` and only a sustained
  sound, a master whose source changed after render (stale), a master whose voice delay differs from `VO_OFFSET`, a
  master at the wrong loudness, a master with a wrong frame count, a second mix of the same picture with the voice
  2 s later substituted under the first mix's `master.json`, a `--file` with no `master.json`, a render made with a
  non-default param that puts text outside the safe area (checked with default params on the command line), and
  text outside the safe area only at the first and last subframes of each frame. Clean cases that must pass: a
  `--master-only` master (no `vo_delay`), a render of an alternate `--scene` checked through its `render.json`. Each is reported with the right id and level,
  and none of the clean cases is. Mutation: disabling any one detector fails a test.
- **Leak test**: no tracked file contains a private home-directory path or any string from the owner's denylist. The
  denylist (brand names, private paths, the owner's voice id) is never committed: CI reads it from the
  `SM_DENYLIST` Actions secret, and the test FAILs in CI when it is missing, except on pull requests from forks,
  where it reports "skipped: no denylist" in the job summary. The path patterns are built in the test from parts, so
  the test and this plan do not trip it.
- **Asset inventory**: `ASSETS.md` lists every binary file in the repo (fonts, audio, images, sequences) with its
  source and licence; the test fails on any binary not listed, and on any listed file that is missing.

## 17. Build phases

Each phase is one PR with a council round. The main loop verifies each phase by running its tests and the named
mutations before the round.

| Phase | Scope | Acceptance (measured, not read) | Size |
|---|---|---|---|
| **P0** Scaffold | Repo layout, plugin manifest, CI, the template copied from the private skill with private material removed, bundled fonts, `--scene` and `--target`, `doctor` | CI green on both OSes running the determinism, frame-count and alpha tests on the fixture; `doctor` passes on macOS and on the Linux runner and prints the WebGL renderer; Linux ms per frame recorded in the README; leak test green with the owner's denylist | M |
| **P1** Board and voice | `board.js` format, `beatWindow`/`beatAt`, `board` mode, slate scene, `cues.mjs` with all three adapters, gaps, hook gate, `voice-elevenlabs.mjs`, captions helper | Board and cues tests above; one opt-in live ElevenLabs smoke on the owner's account (`SM_LIVE=elevenlabs`) producing a take whose cues match its own `chars` | M |
| **P2** Mix and footage | `mix.mjs`, `frames.mjs`, `loadSeq`/`seqAt` | Mix and footage tests above; parity, run by the owner on private stems that are never committed, for the voiced graph against the private mixer and for `--master-only` against the private master script: the two premixes (before loudness normalization), aligned on the first sample, have 100 ms RMS envelopes within 0.5 dB on at least 95% of windows, and the masters land within 0.5 LU integrated and 0.5 dB true peak; once with default settings and once with a non-default voice delay, bed skip, bed start and a mute window | M |
| **P3** Check and safe zones | `check` and every detector, `boxes(t)`, `HOLDS`, `renderProbe`, `safezones.json`, `--safe` overlays, threshold tuning | `fixture-check` suite above; the three examples and at least three recorded real renders pass with no FAIL and no WARN that is not deliberate; safe-zone numbers measured for each target the release names, with the date and method in `safezones.json` | M |
| **P4** Skill text and examples | SKILL.md, the five references, the three examples, `ASSETS.md` | Examples render and pass `check` and `check --file`; `explainer-beat/VOICE.md` exists, names a licence that allows redistribution, and matches `take.json`'s `source`; the owner listens to it and confirms it is not their voice; the asset inventory test passes; a fresh Claude Code session with only the plugin installed, given two written briefs (a 9:16 end card, and a 15 s voiced beat with a board), produces both with no help; time, renders, retries and every stumble recorded, and the skill text fixed where it stumbled | M |
| **P5** Release 0.1.0 | README, install routes, public repo, tag | Each install route tested on a clean user account: personal skill copy, plugin from this repo's marketplace, and skills.sh if listed (Q6); a first piece rendered from the README alone | S |

## 18. Parity with the private skill

| Private behaviour | Here |
|---|---|
| Scene contract, fonts throw, subframe motion blur, `subBoost`, post chain, HUD layer | 5, unchanged |
| `stills`, `contact`, `video`, `audio`, `full`; `--param`; `--alpha prores|webm`; codec-led extension; piece-relative paths | 5, unchanged |
| Synthesized effects from the shared `TL`, the master chain, end fade, audio report | 5, unchanged |
| ElevenLabs take with character timings | 7.2, 7.6, generalized to any timing source |
| Silence opened before a phrase at the quietest point, refusing to split speech | 7.4 |
| Cues from anchor phrases and occurrence counts | 7.3, keyed by beat |
| Title-line end time refused over a limit | 7.5 and 6.5 (`hook_long`) |
| Voice delay as a scene constant and a mixer variable | 7.3: one `VO_OFFSET` |
| Voice levelling, bed skip and placement, fades, mute windows, sidechain duck, limiter, two-pass loudnorm, AAC, faststart | 9 |
| Separate master script that normalizes the synthesized soundtrack to -14 LUFS | 9, `--master-only` |
| Footage frame sequences with a manifest and a frame-index helper | 10 |
| Per-brand project notes | Removed; brand notes live in each project's CLAUDE.md (14) |
| Brand examples (a news sting, an app end card) | Removed (15) |
| The owner's voice clone, its delivery-tag rules, an illustrated avatar with blink and wave frames, a music-generation script | Removed; not part of v1 (D3) |
| Review by contact sheet and stills | Kept, plus the board sheet (6.2) and measured checks (11) |

## 19. Decisions (owner, 2026-11-12)

| # | Decision |
|---|---|
| D1 | Name `sabotage-motion`: repo `sabotage-dev/sabotage-motion`, skill name `sabotage-motion` (so it does not clash with the owner's private skill while both are installed). |
| D2 | MIT, copyright Sabotage Development LLC. |
| D3 | v1 = the engine plus voice cues, mix and master, footage and `check`. The owner's voice, likeness, music generation and every per-project note stay out. |
| D4 | v2: a live preview with a scrubber, parallel rendering, a fresh-context reviewer agent, a tested GPU-accelerated Linux recipe. |
| D5 | Drafted locally; the GitHub repo is created only after this plan clears the council. |
| D6 | "Lightweight" means dependencies: Node, Chrome, ffmpeg, `playwright-core`. No framework. |
| D7 | Notes that describe the owner's private setup stay out of this public repo; this plan carries only what the public build needs. |
| D8 | A storyboard is in v1 (owner, 2026-11-12: "Could we add some sort of story board feature to go with it?"): `board.js`, the board sheet, the slate scene and animatic, and the board checks (section 6). |

## 20. Open questions (the build takes the default unless overruled)

| # | Question | Default |
|---|---|---|
| Q1 | Port the private Python and shell tools to Node? | Yes: one runtime (D6). |
| Q2 | Where does the example's voice come from? | An openly licensed TTS voice whose licence allows redistribution, licence file in the example folder; chosen in P4. Never the owner's voice. |
| Q3 | How are safe zones measured? | The owner posts a private or unlisted 1080×1920 grid test video to each platform in P3 and measures the overlays from screenshots in each app. Targets not measured by release ship as `"estimate": true`. |
| Q4 | Which checks FAIL and which WARN? | As in sections 6.5 and 11: FAIL for a stale or unmatched master, a wrong file, wrong loudness, a voice delay that differs from `VO_OFFSET`, a late hook, text outside a measured safe area for more than 0.25 s in a beat, a missing font; WARN for craft and for anything measured against an estimate. `--strict` makes WARN fail. |
| Q5 | Require Google Chrome, or also allow Playwright's own Chromium? | Chrome or `CHROME_PATH`. Playwright's Chromium is documented only if P0 shows WebGL2 working in it headless on both OSes. |
| Q6 | List on skills.sh? | Yes, if the P5 install test passes. |
| Q7 | Keep the private description's "no After Effects, HyperFrames or Remotion"? | No; other products are named only in the "when to use something else" section. |
| Q8 | Which fonts does the template bundle? | Two open-licence families (a display face and a text face, plus a mono), chosen in P0, licence files in `fonts/`. |
| Q9 | Determinism across machines? | Not promised: GPU and SwiftShader output differ. Tests compare frames on one machine; cross-machine output is compared by eye. |
| Q10 | `board.js` (ES module) or `board.json`? | `board.js`: the browser and Node both import it, and it can carry comments. |

## 21. Risks and what is not yet verified

| Risk | Mitigation |
|---|---|
| Headless WebGL2 on Linux CI may be missing or very slow under SwiftShader. | P0 runs `doctor` and the fixture on `ubuntu-latest` first; the fixture renders at scale 0.25. If WebGL2 does not come up, P0 stops and the plan is revised before anything else is built. |
| Google Chrome may not be on the CI runners, or not where Playwright looks. | `doctor` reports it; CI installs it if needed; `CHROME_PATH` overrides. |
| Long frame sequences use a lot of memory, since every frame is decoded and held. | `delivery.md` says to scale clips to their drawn size; P2 measures memory for a 20 s sequence at 960 px wide and states the limit. |
| `check` thresholds give false positives on real pieces (grain, slow drifts, held end cards, small moving elements, slam entrances). | Grain off in the probe, tile-based motion, `HOLDS` and `hold: true`, a 0.25 s allowance per beat for text excursions, clean cases in `fixture-check`, tuning in P3 against real renders, WARN rather than FAIL for craft. `motion_dead` is a heuristic and the docs say so. |
| The decoded-video hash of a master might not equal its render's after the remux, which would make every master fail `provenance`. | P3 measures it on all three examples before `provenance` is a FAIL; if the hashes differ, `provenance` compares per-frame hashes (`framemd5`) instead. |
| The leak denylist lives in a CI secret; a fork PR cannot read it. | Fork PRs report the leak test as skipped in the job summary, and the owner's own pushes and release tags always run it. |
| Timing formats move: the ElevenLabs alignment, openai-whisper's JSON, and other ASR tools differ. | Three adapters with recorded fixtures; the generic `words` format as the way in for everything else. |
| ffmpeg builds differ (missing `libvpx` or `prores_ks`). | `doctor` lists each encoder and filter with what to install. |
| A fresh agent finds the board and voice workflow heavier than the private one. | P4's usability test with two briefs; silent pieces skip the voice steps entirely. |
| Private material leaks into the public repo. | The leak test with the owner's denylist; D7. |

Not verified yet:

- That the private harness renders correctly on Linux at all (it has only run on macOS).
- The ElevenLabs and openai-whisper field names (P1 re-checks both against current docs).
- The plugin marketplace file format and the skills.sh install flow (P5).
- Safe-zone numbers for Reels and Shorts, and the top edge for TikTok (P3).
- That the decoded video of a master hashes the same as its render (P3).
- Whether every scene's camera config can be read at an arbitrary `t` without rendering (`frame(t)` returns it today,
  so `check` calls `frame` on a scratch context; P3 confirms the cost).

## 22. Council rounds

| Round | Seats (ratified from each CLI's record) | Result |
|---|---|---|
| 1 (2026-11-12, rev 1.0 at `51e4b7a`) | codex `gpt-6.1-sol` effort high (relaunched once after a usage-limit stop with no review); grok `grok-4.7`. The third seat did not run: its CLI was signed out. Two-seat round. | grok SHIP-WITH-FIXES (2 HIGH, 3 MEDIUM); codex NEEDS-WORK (2 HIGH, 8 MEDIUM). All 15 findings verified against the plan and the private sources and folded in rev 1.1; none refuted. |
| 2 (2026-11-12, rev 1.1 at `3b6ae3f`, delta) | codex `gpt-6.1-sol` effort high; grok `grok-4.7`. Third seat signed out again. Two-seat round. | Both NEEDS-WORK. Of the 15 round 1 items, 9 were closed by both seats and 6 called half-closed by at least one (timing, text checks, provenance, motion). New: grok 1 HIGH + 3 MEDIUM, codex 3 HIGH + 3 MEDIUM. All verified and folded in rev 1.2; none refuted. |

Round 1 fold map (seat finding: where it landed):

| Finding | Seats | Fold |
|---|---|---|
| Cue windows dropped `VO_OFFSET`; mixed boards (leading, interleaved, trailing silent beats) had no timing; `CFG.DUR` never came from the board; a take field shared the beat-id namespace | grok F1, codex F1 | 2, 6.1, 6.3, 7.3, 7.4, 16 |
| The showreel ships a third-party wordmark and mark; `delivery.md` keeps private material; the leak test passes in CI without the denylist | grok F2 | 14, 15, 16 |
| Text checks: no camera transform, no grouping of word boxes, 10 Hz sampling, slam entrances fail, guide and check disagree on zones | grok F3, codex F5 | 5, 6.5, 11.1, 12 |
| `check` had no way to know a master's loudness target; the effects-only master did not match the private one | grok F4, codex F8 | 9, 11.2, 16, 18 |
| The example voice's licence was not an acceptance check | grok F5 | 15, 17 (P4) |
| A slate render still scheduled the real scene's sound cues | codex F2 | 5, 6.4, 16 |
| The leak test's own patterns appeared literally in this plan; no asset inventory | codex F3 | 16, 17 |
| Source probes could pass a stale or mismatched master | codex F4 | 5, 9, 11.2, 16 |
| Whole-frame motion averaging misses small moving elements | codex F6 | 11.1, 16, 21 |
| "No onset" is not "no sound" | codex F7 | 6.1, 6.5, 16 |
| The 2 s fixture cannot hold a 4 s freeze | codex F9 | 16 |
| Matching loudness numbers do not prove mix parity | codex F10 | 16, 17 (P2) |

Round 2 fold map:

| Finding | Seats | Fold |
|---|---|---|
| Cue-based windows left a hole at the start and a hole or overlap around interleaved silent beats; `VO_OFFSET` had two definitions; the splice refused a continuous take | grok F1, codex F1, codex F2 | 6.3 (boundary list, one writer for `VO_OFFSET`, splice without refusal), 7.3, 7.4, 16 |
| The animatic's mix needed an effects stem that `video` never writes | grok F2 | 6.4, 16 |
| A swapped audio mix under an old `master.json` passed; a missing `master.json` passed; `vo_delay` failed voiceless masters | grok F3, codex F3 | 9, 11.2 (`provenance` binds the whole master file; `vo_delay` voiced only), 16 |
| Source checks did not replay the render's recorded scene and params | codex F4 | 11.2, 16 |
| Copy matching per sample missed words that appear one at a time | grok F4 | 6.5, 16 |
| Shutter-centre sampling missed text visible at other subframes | codex F5 | 11.1, 16 |
| The motion threshold called the clean fixture's small mover frozen | codex F6 | 11.1 (changed-pixel count at 1/2 scale), 16 |
