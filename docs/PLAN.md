# sabotage-motion: v1 build plan

| | |
|---|---|
| Revision | 3.0 (2026-11-15): council round 10 on the flash rule folded (23.9, 23.10). 2.9 (2026-11-15): council round 9 folded; WCAG's fine-pattern exception not applied (23.9, 23.10, Q25). 2.8 (2026-11-15): council round 8 on the flash rule folded (23.9, 23.10). 2.7 (2026-11-15): council round 7 on the flash rule folded (23.9, 23.10). 2.6 (2026-11-15): council round 6 on the flash rule folded (23.9, 23.10). 2.5 (2026-11-15): council round 5 on the flash rule folded (23.9, 23.10, Q24). 2.4 (2026-11-15): the flash rule counts flashes per pixel (23.9, 23.10). 2.3 (2026-11-15): council round 4 on the flash rule folded (23.10). 2.2 (2026-11-15): council round 3 on 23.9 folded (23.10). 2.1 (2026-11-15): council round 2 on 23.9 folded (23.10). 2.0 (2026-11-15): council round 1 on 23.9 folded (23.10, Q23); 0.3 named (24, D13). 1.9 (2026-11-15): P11 energy presets (23.9, D12, Q19-Q22). 1.8 (2026-11-15): council round 2 on section 23 folded (23.8); Q6 ruled. 1.7 (2026-11-15): council round 1 on section 23 folded (23.8; Q8 amended, Q18). 1.6 (2026-11-15): version 0.2, five additions as phases P6-P10 (section 23, D11, Q11-Q17). 1.5 (2026-11-13): council rounds 1-3 folded (section 22); delivery tags (7.1, D9); the leak denylist checked before each push, not in CI (16, D10) |
| Owner | Sabotage Development LLC, public repo `sabotage-dev/sabotage-motion` (D5), MIT |
| Status | Plan cleared council round 3. P0 is built and merged (PR #1). P1 (storyboard, voice-driven timing, captions) is built and merged (PR #2). P2 (mix and master, footage) is built and merged (PR #3). P3 (`check` and safe zones) is built and merged (PR #4). P4 (the skill text and the three examples) is built and merged (PR #5). P5 released 0.1.0 (PR #6, tag `v0.1.0`). Version 0.2 is planned in section 23. |
| Decisions | D1-D10 in section 19, ruled by the owner on 2026-11-12 and 2026-11-13; D11 and D12 in section 23.7, D13 in section 24 (2026-11-15, 2026-11-15) |
| Open questions | Q1-Q10 in section 20, Q11-Q18 in section 23.7 and Q19-Q25 in section 23.9, each with the default the build takes if nobody overrules it |

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
index.html  fonts/  board.js  scene.js  slate.js  grid.js  audio.js  shaders.js  lib.js  gl.js  main.js  wav.js
render.mjs  check.mjs  safezones.json  package.json
tools/cues.mjs  tools/voice-elevenlabs.mjs  tools/mix.mjs  tools/frames.mjs
```

- SKILL.md refers to its own files through `${CLAUDE_SKILL_DIR}` (for example
  `cp -R "${CLAUDE_SKILL_DIR}/template" motion/<piece>`). Claude Code substitutes it for personal, project and plugin
  installs alike; for a plugin skill it is the skill's own subdirectory (Claude Code skills docs, checked 2026-11-12).
- Tools live inside the template, not beside SKILL.md, so a piece re-renders with the engine it was made with after
  the skill updates. The private skill works this way today.
- Outputs (`out/`, `stills/`, `board.png`, `contact.png`) are gitignored in the template's `.gitignore`.
- `check.mjs` holds `check`'s detectors and thresholds as plain functions of the measurements `render.mjs` gathers
  (added in P3, so each one is tested without a browser); `grid.js` is a scene that draws a labelled grid at a
  target's size, an optional aid for reading safe-zone edges off screenshots (section 12, Q3).

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
| `render.mjs` writes `<output file>.render.json` (for example `out/scene.mp4.render.json`) after every `video`/`full` render, and deletes the old record before a render starts | Ties a master to the source it came from (section 11.2) | `render.mjs` |
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
- `anchor` defaults to the first four words of `vo`, not counting delivery tags like `[curious]` (7.1). `gapBefore` asks `cues.mjs` to open that much silence before
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
`words / wps + 0.25` s (delivery tags are not words), a silent beat lasts its `dur`. `VO_OFFSET` is the summed `dur` of any leading silent beats
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
- **Room in the voice for interleaved silent beats.** `cues.mjs` splices `D` seconds of zeros into `vo.wav` at
  `s = max(prevWordEnd, CUE[i] − lead)` (seconds into the raw take; both tag-aware, 7.1), with a 5 ms fade out before the zeros and a
  5 ms fade in after them so the cut cannot click. When the pause before the anchor is at least `lead`, the zeros
  land exactly on the silent run's window; when it is shorter, the splice falls at the previous word's end and the
  window opens at most `lead` before the zeros, so the last moment of the previous word (under `lead`) carries
  into the silent run, the way a J-cut would. No word is cut: the previous word has ended by `s`, and the anchor
  starts at or after it. A take with no pause at all (`prevWordEnd ≥ CUE[i]`) splices at the anchor and warns that the take runs
  the words together. The quietest-point search and the `-50 dBFS` refusal belong to `gapBefore` only (section
  7.4). Later cues shift by `D`; the picture windows come from the shifted cues alone, so they stay contiguous.
  `GAPS[].at` is `s`.
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
| `board_copy_missing` | WARN | A string in a beat's `on` is never found in that beat's window. Matching works across the whole window, not per sample, so words that appear one at a time still match: for each `group` (or for all boxes, without groups), the box texts seen at any sample inside the window are joined in order of first appearance (ties in reading order), one entry per box `id` (so a box seen at many samples counts once, and two boxes that both say "go" give "go go"), and the `on` string is searched in that text, case-insensitive, whitespace collapsed. Needs `boxes(t)`; otherwise reported as not checked. |
| `board_copy_unread` | WARN | A string in `on` is found for less than `max(1.0, 0.25 × words)` seconds in total. |
| `board_sfx_missing` | WARN | A beat with an `sfx` note has no 50 ms window above -40 dBFS RMS in the effects stem inside its window. With `sfxHit: true`, it needs a transient instead: a 10 ms window more than 12 dB above the RMS of the preceding 100 ms and above -40 dBFS. `sfx: null` is never checked. |
| `hook_long` | FAIL | With `hookMax` set: `VO_OFFSET` + `HOOK_END` (the hook beat's last word or closing tag, 7.1) is later than `hookMax`. On a master mixed with a voice, also requires the voice delay `mix.mjs` recorded to equal `VO_OFFSET` (section 11.2). |

## 7. Voice-driven timing

### 7.1 The timing format (`take.json`)

```json
{ "source": "elevenlabs|whisper|words", "duration": 12.48, "sampleRate": 48000,
  "words": [{ "text": "Stop", "start": 0.12, "end": 0.38 }],
  "chars": { "text": "Stop pasting ...", "starts": [], "ends": [] },
  "tags": [{ "text": "[chuckles]", "start": 11.28, "end": 11.73 }] }
```

`chars` is present only when the source gives character timings. Matching uses `chars` when present (exact phrase
match, case-sensitive) and the word sequence otherwise (case-sensitive, punctuation stripped at word edges).

**Delivery tags.** A `[...]` span in a `vo` line (`[curious]`, `[short pause]`, `[chuckles]`) is a delivery tag: it
goes to the TTS as written and shows on the board sheet as direction, but it is never a word. Every adapter moves
tags out of `words` and `chars` so the text still reads as spoken. Tags with nothing or only spaces between them
form one span, cut as a unit with those spaces. A span with both sides open goes with one adjacent space. A side is
open at an edge, a space, a closing mark such as `,` after it, or an opening mark such as `(` before it; quotes
count by position, so an apostrophe never opens. So "Hello [sighs], world" reads "Hello, world" and "Stop now
[laughs] [sighs]." reads "Stop now.". A span glued to a word on one side goes alone ("prompt.[sighs] Save" reads
"prompt. Save"). A span glued on both sides keeps one space if it had one, and is refused by the board if it had
none. A test checks this on thousands of generated lines: words never merge, no space is doubled or stranded before
punctuation, the take's character path agrees, and two lines joined into one script read as the two lines do. They
go into `tags`, keeping their
times. Measured on the owner's ElevenLabs takes (three takes, one model): a tag's span ends where the next word
starts, most last about 50 ms and `[chuckles]` 0.36 to 0.45 s, and the spans are not silent (-51 to -23 dBFS RMS:
the next word's breath and onset, or the chuckle itself). So a tag is dropped as text and kept as sound that belongs
to the line it is written in:

- Tags are not words: they are not in `WORDS`, never captioned, not counted by the estimate (6.3), and never matched
  as anchors. The default anchor is the line's first four words after any opening tags; an `anchor` containing `[`
  is refused.
- Tags written directly before a beat's anchor in the same `vo` line (nothing but spaces between) move that beat's
  cue to the first such tag's start, so the cut and any spliced silence come before the line's breath or chuckle.
- Tags written after a line's last word belong to that line: `prevWordEnd` in 6.3 and 7.4 means the end of the
  last word or closing tag before the cue, and `TAKE.lastWordEnd` and `HOOK_END` include a closing tag on the last
  line or the hook line (the content cannot start until it ends).

Together these keep every splice and every `gapBefore` cut outside a tag's span.

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
export const BOARD_KEY = '{"lead":0.1,...}';             // the board fields these cues were made from
export const WORDS = [{ text: 'Stop', start: 0.12, end: 0.38 }];
```

- One cue per beat with `vo`, keyed by beat id, from its anchor (with an occurrence count when a phrase repeats).
  Without a count, the next beat's anchor is searched for after the last word of the previous one. Every time in
  `cues.js` except `VO_OFFSET` is seconds into `vo.wav`; the board helpers convert to picture time.
- A missing anchor stops the tool with the phrase it could not find. It checks every anchor before it writes
  anything, so a bad take never replaces a good `cues.js`.
- `BOARD_KEY` records what the cues depend on, by meaning rather than spelling: each voiced beat's id, line
  (trimmed), anchor (the default one filled in), occurrence and gap; each leading or interleaved silent beat's id
  and dur; which beat is the hook; `lead` and `hookMax`. A render refuses a `cues.js` whose key no longer matches
  `board.js`, or that has no key, so a changed silent beat or leading duration cannot slide the picture off the
  voice. The silent beats after the last line (timed from the take's end at render) and notes that move no time
  (copy, look, sound) keep the cues. Each voiced beat's anchor must also play inside its own window, which is how
  "two anchors closer than `lead`" is refused even when every window is positive.
- `VO_OFFSET` is written once, by `cues.mjs` (section 6.3), and read by the board helpers, captions and `mix.mjs`.
  The private version keeps it in two places (a constant in the scene and an environment variable for the mixer),
  which can drift.
- `cues.json` is written beside it for the Node tools.

### 7.4 Gaps

`gapBefore` opens silence before a beat's anchor: the cut goes at the quietest 10 ms between `prevWordEnd` and the
cue (both tag-aware, 7.1, so the cut never lands in a tag's span); it refuses when that point is louder than -50 dBFS (it would split speech) or
when there is no pause at all; every later timing shifts by the gap. Ported from the private helper, which has used
it on every voiced piece. Interleaved silent beats use the same splice without the refusal (section 6.3). The voice file with gaps is `vo.wav`; the raw take is kept as `take-raw.wav`.

### 7.5 Hook gate

With `hookMax` set on the board, `cues.mjs` refuses a take whose hook beat ends after `hookMax - VO_OFFSET`, and
says by how much, before the scene or mix uses it. `check` measures it again on the master (6.5).

### 7.6 `tools/voice-elevenlabs.mjs`

Optional. Joins the board's `vo` lines, delivery tags included as written, into one continuous request (one take
keeps the delivery consistent; the tool keeps no list of allowed tags, since that is the model's business), calls
the with-timestamps endpoint, writes `take-raw.wav` immediately (so a failed check does not waste the credits), then
`take.json`. Reads `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from the environment or `--env-file`; the model is
`--model`, with no default baked in (the README names the current one). Sends no voice settings unless asked.
`--language` pins the language code. Prints the character cost the response reports.

## 8. Captions

`lib.js` gains `captions(ctx, WORDS, t, opts)`: groups words into lines that fit `opts.maxW` with `measureText`,
shows one line group at a time, pops the active word (`anticip` or a spring, 1.15 to 1), colours it with the accent,
and places the block inside the target's safe zones. It returns its text boxes so a scene can pass them through
`boxes(t)`. Offsets are applied once from `VO_OFFSET`. Delivery tags never appear: they are not in `WORDS` (7.1).

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
- All stems are resampled to 48 kHz stereo, mixed without normalization, limited at -6 dBFS (attack 5 ms, release
  60 ms, the private mixer's; its 5 ms lookahead is compensated here, where the private mixer's output ran 5 ms
  behind the picture), then loudness-normalized
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

- `render.mjs` writes `<output file>.render.json` after every `video` or `full` render (named after the whole file, so an `.mp4` and an alpha `.mov` of the same name keep separate records; the old record is deleted before a render starts, so a failed render leaves none): a hash over the piece's source
  (every file except `out/`, `stills/`, `node_modules/` and the review sheets), the scene file, params, size, fps,
  subframes and alpha mode, and a hash of the rendered file's decoded video (`ffmpeg -map 0:v -f hash -hash sha256`).
- `mix.mjs` writes `out/<name>.master.json` (section 9), including the SHA-256 of the whole master file. Any change
  to the file after the mix (another audio track, a re-encode) breaks the match.
- The effects stem is bound too (P3 round 1): `full` records its WAV's SHA-256, `audio` writes `<wav>.render.json`
  with the source hash and the WAV's SHA-256, and `provenance` requires the stem `master.json` names to match a record's
  WAV hash, made from the current source (a `--no-sfx` master has no stem to bind). The source hash does not cover
  `--scene` or `--param`, so that record must also carry the picture's scene, params, fps and length (round 2).

| Check | Level | How it is measured |
|---|---|---|
| `provenance` | FAIL | `master.json` exists (a `--file` without one FAILs; `--plain` checks a foreign file as a plain file, and then only `file_spec`, `faststart` and `loudness` with `--lufs` run); the SHA-256 of the whole `--file` equals the master hash `master.json` records (any other mix of the same picture fails); the `render.json` it names exists and its SHA-256 equals the one recorded; the piece's current source hash equals the one in `render.json` (otherwise the master is stale: re-render). The decoded video hash `master.json` records equals the one in `render.json` (the mixer copied the picture untouched; section 21). Only then do the 11.1 results stand for this file, and `check --file` runs the 11.1 checks with the scene, params, size, fps, subframes and alpha mode recorded in `render.json`, not the command line's. |
| `file_spec` | FAIL | `ffprobe`: width, height, fps and pixel format match the ones `render.json` records; the frame count (`-count_frames`) equals `round(DUR × FPS)` for that render's scene; the duration matches within one frame; an audio stream exists unless that scene is `silent`. With `--plain`, they are compared with the piece's current settings. |
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
`check` and the overlays say "estimate". A target may also list `exclude` rectangles inside its safe area that the
platform covers anyway (TikTok's action-button column): text that overlaps one is outside the safe area, and the
overlays shade it.

- The platforms' published 9:16 safe zones for ads ship as measured targets (P3, 2026-11-14). They are stricter than
  organic posts, so they are targets of their own rather than replacements:
  - `tiktok-ad`: x 120 to 960, y 240 to 1260, less the action-button column at x 780 to 960 from y 840 down (an
    `exclude`). From TikTok's In-Feed safe zone template, "In-Feed-Standard Version LTR.zip" (Feed.png, dated
    2025-04-14, drawn on a 720x1280 grid: 80 at the sides, 160 top, 440 bottom, a 120-wide button column over the
    bottom 720), linked from ads.tiktok.com/help/article/tiktok-auction-in-feed-ads, measured from the PNG at
    1080x1920.
  - `reels-ad`: x 65 to 1015, y 269 to 1248. From Meta's ads guide for Instagram Reels
    (facebook.com/business/ads-guide/update/video/instagram-reels): "Consider leaving at least 14% of the top, 35% of
    the bottom, and 6% on each side of your asset free from text, logos...", rounded to whole pixels.
  - `shorts-ad`: x 48 to 888, y 288 to 1248. From Google Ads Help, "Safe zones for vertical video ads on YouTube"
    (support.google.com/google-ads/answer/16041697): the reference image's labels, 288 top, 672 bottom, 48 left,
    192 right on 1080x1920.
- The organic targets ship as researched estimates (P3, researched 2026-11-14): no platform publishes an organic
  zone, and several sources say so outright, so each edge comes from published third-party measurements, compared and
  cited in `safezones.json`. They keep `"estimate": true` (the overlays move with the device and the caption's length),
  so `text_safe` only warns on them:
  - `tiktok`: x 44 to 940, y 130 to 1436. Left, top and the 140-wide button rail from third-party measurements that
    agree (cadenus.io, vidova.ai); the bottom 484 px for the username, caption and sound rows (cadenus.io; 480-484
    elsewhere), which matches TikTok's own In-Feed ad template's 660 px less the ad's call-to-action and sponsored
    label.
  - `reels`: x 86 to 960, y 250 to 1600. The more conservative of two organic measurements on each edge
    (adchecklab.com, measured in the Instagram app; vidova.ai and outfy.com).
  - `shorts`: x 48 to 888, y 288 to 1540. The top, sides and button rail from Google's vertical-video ad zone (the
    same UI on organic Shorts); the bottom 380 px for the title, channel and subscribe rows, where three organic
    sources agree.
- While a target is an estimate, `text_safe` reports WARN instead of FAIL for it.
- `references/delivery.md` drops its own percentages and points at `safezones.json`, so the guide and the check
  never disagree.
- Overlays: `contact --safe` and `board --safe` shade the unsafe area, excluded rectangles included, on every panel.
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
  "Motion Designer" subtitle, the same name in the HUD, and that product's spark mark. The public reel ends on this
  repo's own studio name, sabotage development, and a mark drawn for it (an orrery). Its fonts are macOS system fonts today; they are replaced with open-licence faces, and
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
  speech is refused; the hook gate refuses a late take; `CUE` holds only beat ids. Delivery tags, on a synthetic
  take (tone bursts for words, a 50 ms burst under a short tag, a 0.4 s noise burst under a long one), with tags
  opening a line, mid-line, closing a line, and closing the last line: no tag reaches `WORDS`, `chars`, captions or
  the estimate; an anchor right after a mid-line tag matches; the default anchor skips an opening tag; an opening
  tag moves its beat's cue to the tag's start; a closing tag counts in `prevWordEnd`, `TAKE.lastWordEnd` and
  `HOOK_END`; no splice or `gapBefore` cut lands inside any tag's span; an anchor containing `[` is refused.
- **Board timing**: estimate and cue-based windows for boards with leading, interleaved and trailing silent beats;
  windows are contiguous, half-open and start at 0 in every case, including: a single voiced beat whose first cue is
  later than `lead`; the five-beat board `cold (dur 1) / hook (vo) / mid (dur 1.5) / save (vo) / end (dur 2.5)`; an
  interleaved beat with a 1.0 s pause before the next anchor and a breath 0.4 s into that pause (the breath must
  play inside the previous voiced beat's window, not the silent run's); a take with no pause before
  the next anchor (splice at the anchor, with the warning). For every interleaved case the test also asserts the
  zeros' picture-time interval against the silent run's window: equal when the pause is at least `lead`, otherwise
  opening at most `lead` after it. `--offset` below the leading silent sum is refused;
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
- **Leak check** (D10): nothing published contains a private home-directory path or any string from the owner's
  denylist (brand names, private paths, the owner's voice id). The denylist is never committed and is not stored on
  GitHub: it is a file on the owner's machine, read by the pre-push hook that `npm run hooks` writes into the clone's
  own `.git/hooks` (`scripts/leak.mjs install`). Git silently skips a hooks directory that is missing, so a hook
  kept in the working tree would stop running on any checkout that predates it; this one stays put, runs the
  checked-out `scripts/leak.mjs`, and blocks the push from a checkout that has none. The hook checks everything a push would publish that the remote does not already have, asking the remote itself
  (`git ls-remote`) rather than trusting local tracking refs: each commit's message, author and committer, the paths
  new in it (merges included) and its added lines; every tag object in a pushed tag's chain, and a tree or blob a tag
  points at; the branch and tag names. It blocks the push on a hit or when it finds no denylist. `history` checks
  every commit, tag and ref name in the clone. CI checks home paths in every tracked file, and tests the hook on
  throwaway repos (a bare repo as the remote) with a made-up denylist: a hit in each place it looks, a leak in an
  earlier commit of the same push, content and a new path introduced by a merge, nested and blob or tree tags, a
  stale tracking ref, ref names, commits already on the remote skipped, a commit that removes a leak allowed, no
  denylist blocking, and the installed hook blocking real pushes (a leak, and a branch without the check). Hits name
  the entry's number, never its text; a path or ref name prints with the entry masked, and overlapping entries are
  masked as one span.
  The path patterns are built from parts, so the check and this plan do not trip it.
- **Asset inventory**: `ASSETS.md` lists every binary file in the repo (fonts, audio, images, sequences) with its
  source and licence; the test fails on any binary not listed, and on any listed file that is missing.

## 17. Build phases

Each phase is one PR with a council round. The main loop verifies each phase by running its tests and the named
mutations before the round.

| Phase | Scope | Acceptance (measured, not read) | Size |
|---|---|---|---|
| **P0** Scaffold | Repo layout, plugin manifest, CI, the template copied from the private skill with private material removed, bundled fonts, `--scene` and `--target`, `doctor` | CI green on both OSes running the determinism, frame-count and alpha tests on the fixture; `doctor` passes on macOS and on the Linux runner and prints the WebGL renderer; Linux ms per frame recorded in the README; leak check: the hook's tests green in CI, and the whole history clean against the owner's denylist | M |
| **P1** Board and voice | `board.js` format, `beatWindow`/`beatAt`, `board` mode, slate scene, `cues.mjs` with all three adapters, gaps, hook gate, `voice-elevenlabs.mjs`, captions helper | Board and cues tests above; one opt-in live ElevenLabs smoke on the owner's account (`SM_LIVE=elevenlabs`) producing a take whose cues match its own `chars` | M |
| **P2** Mix and footage | `mix.mjs`, `frames.mjs`, `loadSeq`/`seqAt` | Mix and footage tests above; parity, run by the owner on private stems that are never committed, for the voiced graph against the private mixer and for `--master-only` against the private master script: the two premixes (before loudness normalization) are within one 100 ms window of each other in length; the lag `scripts/parity.mjs` measures between them (within 20 ms) is the one the owner states with `--lag`, within 0.1 ms (the private mixer's uncompensated 5 ms limiter lookahead, and nothing else); shifted by that stated lag, they have 100 ms RMS envelopes within 0.5 dB on at least 95% of windows, and the masters land within 0.5 LU integrated and 0.5 dB true peak; once with default settings and once with a non-default voice delay, bed skip, bed start and a mute window | M |
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

## 19. Decisions (owner, 2026-11-12 and 2026-11-13)

| # | Decision |
|---|---|
| D1 | Name `sabotage-motion`: repo `sabotage-dev/sabotage-motion`, skill name `sabotage-motion` (so it does not clash with the owner's private skill while both are installed). |
| D2 | MIT, copyright Sabotage Development LLC. |
| D3 | v1 = the engine plus voice cues, mix and master, footage and `check`. The owner's voice, likeness, music generation and every per-project note stay out. |
| D4 | v2: a live preview with a scrubber, parallel rendering, a fresh-context reviewer agent, a tested GPU-accelerated Linux recipe. |
| D5 | Drafted locally; the GitHub repo is created only after this plan clears the council. The plan cleared round 3 and the owner approved the repo on 2026-11-12. |
| D6 | "Lightweight" means dependencies: Node, Chrome, ffmpeg, `playwright-core`. No framework. |
| D7 | Notes that describe the owner's private setup stay out of this public repo; this plan carries only what the public build needs. |
| D8 | A storyboard is in v1 (owner, 2026-11-12: "Could we add some sort of story board feature to go with it?"): `board.js`, the board sheet, the slate scene and animatic, and the board checks (section 6). |
| D9 | Delivery tags are dropped from words, cues and captions (owner, 2026-11-12: "Yeah we have to drop them"), and kept as sound that belongs to their line (7.1). |
| D10 | No GitHub secrets (owner, 2026-11-13: "why do we need any secrets"). The leak denylist stays on the owner's machine and a pre-push hook checks it, so a leak is stopped before it is public rather than reported after; CI checks home paths only (16). |

## 20. Open questions (the build takes the default unless overruled)

| # | Question | Default |
|---|---|---|
| Q1 | Port the private Python and shell tools to Node? | Yes: one runtime (D6). |
| Q2 | Where does the example's voice come from? | An openly licensed TTS voice whose licence allows redistribution, licence file in the example folder; chosen in P4. Never the owner's voice. |
| Q3 | How are safe zones measured? | Ad zones come from the platforms' published templates, measured (`tiktok-ad`, `reels-ad`, `shorts-ad`). Organic zones come from published third-party measurements, compared and cited, since no platform publishes one; they ship as sourced estimates (`"estimate": true`, so `text_safe` WARNs), and no owner step is needed (owner, 2026-11-14). Section 12 has both. |
| Q4 | Which checks FAIL and which WARN? | As in sections 6.5 and 11: FAIL for a stale or unmatched master, a wrong file, wrong loudness, a voice delay that differs from `VO_OFFSET`, a late hook, text outside a measured safe area for more than 0.25 s in a beat, a missing font; WARN for craft and for anything measured against an estimate. `--strict` makes WARN fail. |
| Q5 | Require Google Chrome, or also allow Playwright's own Chromium? | Chrome or `CHROME_PATH`. Playwright's Chromium is documented only if P0 shows WebGL2 working in it headless on both OSes. |
| Q6 | List on skills.sh? | Yes, once the 0.2 features are complete: at the 0.2.0 release (owner, 2026-11-15: "we list when there features complete"). Until then every skills CLI install runs with telemetry off. |
| Q7 | Keep the private description's "no After Effects, HyperFrames or Remotion"? | No; other products are named only in the "when to use something else" section. |
| Q8 | Which fonts does the template bundle? | Two open-licence families (a display face and a text face, plus a mono), chosen in P0, licence files in `fonts/`. |
| Q9 | Determinism across machines? | Not promised: GPU and SwiftShader output differ. Tests compare frames on one machine; cross-machine output is compared by eye. |
| Q10 | `board.js` (ES module) or `board.json`? | `board.js`: the browser and Node both import it, and it can carry comments. |

## 21. Risks and what is not yet verified

| Risk | Mitigation |
|---|---|
| Headless WebGL2 on Linux CI may be missing or very slow under SwiftShader. | P0 runs `doctor` and the fixture on `ubuntu-latest` first; the fixture renders at scale 0.25. If WebGL2 does not come up, P0 stops and the plan is revised before anything else is built. **Measured in P0 (2026-11-12):** WebGL2 comes up on `ubuntu-latest` through SwiftShader with every flag set tried; about 2.7 to 6 s per full-size frame at 8 subframes, against about 0.25 s on an Apple-silicon Mac. |
| Google Chrome may not be on the CI runners, or not where Playwright looks. | `doctor` reports it; CI installs it if needed; `CHROME_PATH` overrides. |
| Long frame sequences use a lot of memory, since every frame is decoded and held. | `delivery.md` says to scale clips to their drawn size; P2 measures memory for a 20 s sequence at 960 px wide and states the limit. **Measured in P2 (2026-11-14, macOS only):** Chrome grows by about the decoded size of the sequence; 20 s at 960x540 added 1.24 GB, at 960x1706 3.6 GB. The README states it. |
| The ported mixer may not sound like the private one. | **Measured in P2 (2026-11-14)** on the owner's stems, never committed: `scripts/parity.mjs` passed all three runs. The voiced graph with a non-default voice delay, bed skip, bed start and mute window matched on 99.8% of 100 ms windows, with default settings on 100.0%, and `--master-only` against the private master script on 100.0%; the masters landed within 0.00 LU and 0.06 dB true peak. The private mixer's output ran 239 frames (4.98 ms) behind, its limiter lookahead uncompensated, so the voiced runs state it with `--lag -5` (measured 239 frames, inside the 0.1 ms tolerance of 240; rerun after council round 1, which made the lag a stated check rather than a correction); without that shift they match on 73-74%, and with no lag stated they miss on the lag check. Not covered: the `--master-only` run's effects peak at -6.3 dBFS, so the limiter (which the private master script does not have) never acted there. |
| The mixer cut the bed's last frames now and then on the Linux runners (ffmpeg 8): two different mix tests failed once each, on unchanged code. | **Found in P3 (2026-11-14):** ffmpeg's sidechain compressor ends its output at the first of its two inputs to end, even while the other still has samples on the way (`af_sidechaincompress.c`, the same in 8.0 and master). With the voice and the bed read from two files, ffmpeg 7 and later decode them on separate threads, so a bed lagging the voice by more than the 1 s pad lost its tail. `mix.mjs` now feeds the voice and the bed as one 4-channel file and splits it in the graph, so both branches advance together. The premixes of every path are bit-identical to before (ffmpeg 9, macOS), and a test runs five copies of one mix at once and requires one premix. It never failed on macOS, so the fix is shown by code and by CI rather than reproduced. |
| `check` thresholds give false positives on real pieces (grain, slow drifts, held end cards, small moving elements, slam entrances). | Grain off in the probe, tile-based motion, `HOLDS` and `hold: true`, a 0.25 s allowance per beat for text excursions, clean cases in `fixture-check`, tuning in P3 against real renders, WARN rather than FAIL for craft. `motion_dead` is a heuristic and the docs say so. **Measured in P3 (2026-11-14, fixture-check, Apple-silicon Mac):** with grain off and one subframe, the 4 s freeze repeats exactly (0 probe pixels change in every pair, with grain 0.05 on in the scene). The 10 px dot moving 1 px a frame changes 10 to 20 probe pixels a pair, every one by 8 levels or more, against the threshold of 4 pixels at 2 levels; the drift at 9 px a second changes 512 to 868. The slam entrance leaves the safe area for 0.03 s (a WARN, as 11.1 says). The thresholds stay at the plan's values. One tuning: `audio_spike` compares the loudest 50 ms with the 90th percentile of the windows that are not silent (peak above -60 dBFS), because a stem with sound in under a tenth of its windows otherwise compares every sound with silence; the fixture's effects measure 7.9 dB, the template's 11.9 dB, against 18. And `captions` lays lines out to the safe width divided by 1.165 (the largest scale a popped word reaches), so a popped word at the end of a full line stays inside the safe area. **Measured on three of the owner's posted pieces (P5, 2026-11-15; main at `d44ea90`; copies, never committed):** a 75 s voiced explainer, a 38 s comment reply and a 30 s intro, all 1080x1920 at 30 fps, built on the older private copy of the engine. Each scene loaded on this engine without edits, its picture matched the posted master (PSNR 37.7 to 39.5 dB) and its effects matched the mixed stem to within 1 LSB. Source checks and `check --file --plain --lufs -14` from each piece's own folder: 0 FAIL on all three; the explainer and the intro 0 WARN; the reply one WARN, `audio_spike` 19.3 dB against 18 at its designed impact hit (deliberate). Only 7 of the 16 checks had something to measure (the pieces have no `board.js`, `boxes(t)` or `master.json`), so the text, board, hook, provenance and voice-delay checks still rest on the fixtures and the examples. Found and fixed: `--dump` under `--plain` wrote nothing and said nothing; it now writes the file results. |
| The decoded-video hash of a master might not equal its render's after the remux, which would make every master fail `provenance`. | P3 measures it on all three examples before `provenance` is a FAIL; if the hashes differ, `provenance` compares per-frame hashes (`framemd5`) instead. **Measured in P3 (2026-11-14):** equal on every master the check suite mixes (a voiced master, a `--master-only` one, a 5 s render, an alternate scene, a non-default param), on macOS and on the Linux runners, because `mix.mjs` copies the picture stream. So `provenance` compares the decoded-video hash as planned. The three examples are P4. **Measured in P4 (2026-11-14, ffmpeg 9, macOS):** equal on both examples that have a master (`explainer-beat`, mixed with a voice, a bed and effects; `showreel`, `--master-only`): `provenance` passes on each. The lower third is an overlay and has no master (11.2: it is checked with `--plain`). |
| The denylist lives only on the owner's machine, so nothing on GitHub checks it: not a push from another machine without the hook, an edit in GitHub's web editor, a PR from a fork, or the title and body of a squash merge. | The owner pushes from the machine with the hook, and checks PR text before merging; a fork PR is checked when the owner pulls it locally. `node scripts/leak.mjs history` audits everything already pushed. |
| Timing formats move: the ElevenLabs alignment, openai-whisper's JSON, and other ASR tools differ. | Three adapters with recorded fixtures; the generic `words` format as the way in for everything else. |
| ffmpeg builds differ (missing `libvpx` or `prores_ks`). | `doctor` lists each encoder and filter with what to install. |
| A fresh agent finds the board and voice workflow heavier than the private one. | P4's usability test with two briefs; silent pieces skip the voice steps entirely. **Run in P4 (2026-11-15, at `a42a01c`, by the main loop):** each brief went to its own non-interactive Claude Code session (Opus 5.5, effort high) with only this plugin loaded from a read-only clone: no user settings, skills, CLAUDE.md, memory or MCP servers (a probe confirmed it), web tools off, Bash and file tools only, one empty folder each. Both logs were audited: every path a tool touched sat in the session's own folder, the plugin clone, its own scratch and transcript folders, or npm's cache. Brief 1, a 6 s 9:16 end card for a made-up app (a mark drawn in code, a name, a tagline, a call to action, a whoosh and a chime, -14 LUFS, text in TikTok's safe area): 8 min 42 s, 44 tool calls and no tool errors, 2 full renders (the second after a fix to its own mark), 2 masters (`--master-only`). Brief 2, a 15 s 9:16 explainer around a supplied take (a different voice of the same open model, timings in the `words` format), three beats, a board image first, big text and captions, a ducked synthesized bed, an effect on each beat change, -14 LUFS, the hook inside 4 s: 11 min 55 s, 40 tool calls and 3 tool errors, 2 full renders (the second after a board edit made the first master stale), 2 masters. Neither needed help; both used the skill unprompted, copied the template, ran `doctor`, and checked the source and then the master. The beat built its board first, cued the take, filled 15 s from 10.95 s of voice with gaps, and ended its hook at 3.63 s. `check --file` on each delivered master, re-run by the main loop: 0 FAIL, 0 WARN. Three stumbles, each fixed in the skill text or the code in council round 1's fold: the copied template was read-only (the clone was; `cp -R` keeps modes), so SKILL.md now runs `chmod -R u+w` after the copy; the popped caption word touched its neighbours ("Yourlaptopfan"), so the session patched the caption helper's space in its own wrapper, and `captions()` now leaves room for the pop between words (`wordGap`); and a board edit after the final render made the master stale, which `check --file` caught and said why, so SKILL.md's workflow now says to finish every file, board notes included, before the final render. |
| Private material leaks into the public repo. | The pre-push leak check with the owner's denylist (16, D10); D7. |
| A failed render deleted the file at its output path even when ffmpeg never opened it, so an earlier good render was lost (found in P3's review). | **Fixed in P4:** `video`, `audio` and `full` write to `<out>.partial.<ext>` and rename it onto the output only when it is complete; a failure removes only the temporary files, and only the old render record goes (it is deleted before any render starts). Tested with ffmpeg failing before it writes, killed during the encode and during `full`'s mux: the earlier output keeps its bytes, inode and modification time. |
| ffprobe reads a ProRes 4444 file back as `yuva444p12le` on ffmpeg 9, so `file_spec` failed every alpha `.mov` (it expected the `yuva444p10le` the encoder is given). | **Found and fixed in P4** on the lower-third example: `file_spec` accepts either for ProRes (the alpha test already did). |
| A popped caption word could touch its neighbours (the layout left only a plain space), and a single word wider than the line was drawn whole, past the safe edge or into an `exclude` rectangle (council round 1: the fresh-session test, and a reproduction 15 px into `tiktok-ad`'s button column). | **Fixed in round 1's fold:** the gap between two words is a space, or the popped word's growth toward its neighbour plus a clear gap (`wordGap`, by default half a space plus the stroke), whichever is larger, so short words keep the plain layout; a word wider than the line is scaled down to fit it. Unit tests cover both, and that a layout of short words is unchanged. The explainer's captions (stroke 10) space out a little, so its two review sheets were re-rendered; the others are unchanged. |
| Captions did not know about a target's `exclude` rectangles, so a full default caption line on `tiktok-ad` ran under the button column and `text_safe` failed it (P3's review). | **Fixed in P4:** `captions(..., { exclude })` lays the block out in the width the rectangles leave free at its height (left of x 780 at the bottom of `tiktok-ad`); `freeSpan()` does the same for any layout, and the template's title card uses it. |
| The template's example scene failed its own `check` on a fresh piece: a title block at 82% of the frame width and a subtitle tracking in past TikTok's right edge, no `boxes(t)`, and a first frame with luma std 3.4/255 (P3). | **Fixed in P4:** it lays out inside the target's safe area (the board's target when there is no `--target`, through `sceneTarget()`), tracks the subtitle in only as wide as fits, exports `boxes(t)`, and draws corner marks at the safe area from the first frame (std 4.7/255). A fresh copy reports 0 FAIL and 0 WARN on `tiktok` and on `tiktok-ad`. |
| The example voice must be redistributable, never the owner's, and free (Q2). | **Chosen in P4:** Kokoro-82M v1.0 (Apache-2.0), voice `af_heart`, run locally through the `kokoro` 0.9.4 Python package in a throwaway environment outside the repo. Its word timings are the model's own predicted durations (`start_ts`, `end_ts`), converted to the `words` format with `source: "kokoro"`. Measured on the take: `tools/cues.mjs` accepted a 0.35 s `gapBefore` (the quietest 10 ms of that pause is under -50 dBFS), and the hook ends at 3.85 s of picture time against `hookMax` 4.0. A second run gave identical timings and slightly different audio (the decoder adds noise). The owner still has to listen to it (P4 row). |
| Rendering the examples on the Linux runners (SwiftShader) would not fit the 45-minute job: the showreel is 1200 frames at 1080p with a raymarched blob. | **Measured in P4 (Apple-silicon Mac, Chrome 157, 8 subframes):** the explainer renders at 215 ms a frame (499 frames, 112 s), the lower third at about 245 (150 frames, 40 s per file), the showreel at 225 to 231 (1200 frames, 287 s); `check`'s probe pass takes 6 s on the showreel. So CI runs every source check except the two that probe every frame through WebGL (`motion_dead`, `first_frame_empty`) on all three examples, on both OSes and both Node versions (`test/examples-check.test.mjs`, 7 s on the Mac), and the full renders, the masters, the probe checks and `check --file` run on a Mac before a release, with the results in the PR. |
| The examples are full copies of the template, so they can drift from it. | `test/examples.test.mjs` requires every template file in each example to equal the template's byte for byte, except the files the example owns (its scene, board, sound, and for the showreel its looks and fonts). |

**Install routes, verified in P5 (2026-11-15, Claude Code 2.1.325, skills CLI 1.8.1, macOS):** each on a fresh, empty home folder (no `~/.claude`, no npm cache). `claude plugin validate --strict` passes on the repo and on `.claude-plugin/marketplace.json` (plugin source `./`). `claude plugin install sabotage-motion --marketplace sabotage-dev/sabotage-motion#<branch>` and the two-step `marketplace add` then `install sabotage-motion@sabotage-motion` both install 0.1.0 from GitHub. `npx skills add` with `-g -a claude-code` (telemetry off) copies the skill's 133 tracked files into `~/.claude/skills/sabotage-motion`. The README's by-hand first piece, run verbatim from a fresh clone, ends with `check --file` at 0 FAIL, 0 WARN. Then one Claude Code session per route, each in its own fresh home (`claude -p` on Opus 5.5, web tools off), given a plain request for a 5-second 9:16 title card for a made-up app that does not name the skill: each session called the skill on its own, built and mastered the piece inside its home folder, and reported `check --file` at 0 FAIL, 0 WARN; rerun on each master afterwards, the same (about 3 minutes per session).

Not verified yet:

- The ElevenLabs and openai-whisper field names: P1 checked both against the current docs on 2026-11-13 (ElevenLabs'
  API reference for the with-timestamps endpoint, openai-whisper's own docs); no live call has been made yet.
- How tags are timed by models other than the one measured (7.1); the P1 live smoke re-measures tag spans with the
  model the README names.
- Safe zones. The P3 row's "safe-zone numbers measured for each target the release names" is met for the ad
  targets: `tiktok-ad`, `reels-ad` and `shorts-ad` are measured from the platforms' published templates (2026-11-14),
  so `text_safe` FAILs on them. For the organic targets (`tiktok`, `reels`, `shorts`) no measurement exists to take:
  their date and method are recorded as researched estimates (published third-party measurements, compared and
  cited, researched 2026-11-14; section 12), and `text_safe` WARNs on them. No owner step is planned.
- That the decoded video of the examples' masters hashes the same as their renders: measured in P4 on both masters
  (section 21 above), on macOS only; CI does not render the examples' masters (too slow under SwiftShader).
- The camera config is read by calling `frame(t)` for each sample on the page's own 2D context, with no WebGL
  upload. **Measured in P3:** on fixture-check (19.2 s, 576 frames) the 4608 `frame` and `boxes` calls at 8
  subframes, plus a 540x960 probe of every frame, take 2.4 s on an Apple-silicon Mac (Chrome 157). On the Linux
  runners (SwiftShader) the probe pass alone takes 44 to 75 s, and the check suites 8 to 13 minutes at P3's first
  push (runner speed varies; the `--strict` test then ran three probe passes, and now probes one frame).

## 22. Council rounds

| Round | Seats (ratified from each CLI's record) | Result |
|---|---|---|
| 1 (2026-11-12, rev 1.0 at `51e4b7a`) | codex `gpt-6.1-sol` effort high (relaunched once after a usage-limit stop with no review); grok `grok-4.7`. The third seat did not run: its CLI was signed out. Two-seat round. | grok SHIP-WITH-FIXES (2 HIGH, 3 MEDIUM); codex NEEDS-WORK (2 HIGH, 8 MEDIUM). All 15 findings verified against the plan and the private sources and folded in rev 1.1; none refuted. |
| 2 (2026-11-12, rev 1.1 at `3b6ae3f`, delta) | codex `gpt-6.1-sol` effort high; grok `grok-4.7`. Third seat signed out again. Two-seat round. | Both NEEDS-WORK. Of the 15 round 1 items, 9 were closed by both seats and 6 called half-closed by at least one (timing, text checks, provenance, motion). New: grok 1 HIGH + 3 MEDIUM, codex 3 HIGH + 3 MEDIUM. All verified and folded in rev 1.2; none refuted. |
| 3 (2026-11-12, rev 1.2 at `92355c5`, delta, convergence) | codex `gpt-6.1-sol` effort high; grok `grok-4.7`. Two-seat round. | Both SHIP-WITH-FIXES. Of the 10 round 2 items both seats closed 9 and called the splice half-closed. One HIGH, raised by both seats: the spliced silence could sit more than `lead` off its silent beat. Folded in rev 1.3 (6.3: splice at `max(prevWordEnd, CUE − lead)`, which gives exact alignment when the pause allows and never cuts a word; both seats proposed splicing at the anchor, which keeps the error at exactly `lead`). Three non-blocking follow-ups folded too: `file_spec` reads `render.json`'s settings, `hook_long` on a master applies only to voiced mixes, copy matching keeps repeated words. No round 4: the fold is one rule in 6.3, and P1's board-timing test asserts it. |

Rev 1.4 (2026-11-12) is an owner decision, not a council round: delivery tags (7.1, D9), found while checking how
the plan handles voice. The P1 council round reviews it with the code that implements it. Rev 1.5 (2026-11-13) is
an owner decision too: the leak denylist moves from a CI secret to a pre-push hook (16, D10), reviewed with P0. The
P0 review's third seat (sonnet) then found that a hook kept in the working tree stops running on older checkouts;
the hook moved into `.git/hooks` (16).

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

## 23. Version 0.2: worth installing

0.1.0 shipped the engine, the workflow and the checks. 0.2 makes the skill easier to want and quicker to use for the
jobs people already bring to it (owner, 2026-11-15, D11). Five additions, each a phase with its own PR and council
round, in this order: P6 is docs only and goes first; P7 (looks and brand kit) and P8 (code and terminal motion)
are what P9's launch video is built from; P10 (caption a clip) stands alone and closes the release. The README
items for Linux speed and other coding agents stay out of 0.2. Council round 1 on this section (rev 1.6) is folded
in rev 1.7 (23.8). A sixth addition came later (owner, 2026-11-15, D12): P11, energy presets (23.9), built after P9
and before P10, so caption styles follow the preset.

### 23.1 P6: the README shows motion

- **Hero.** A looping cut of the showreel at the top of the README, in place of its contact sheet: 6 to 8 s, at
  most 640 px wide, at most 5 MB. GitHub plays a video in a README only when it is uploaded through the web editor,
  so the hero is a committed GIF (Q11), made by a committed script (`scripts/readme-media.mjs`, ffmpeg palette
  pass) from the showreel example's own render, so it can be remade after any change to the reel.
- **One prompt, three results.** The README prints the exact request, then the pieces three fresh Claude Code
  sessions made with only this skill (0.1.0) installed, side by side, each a GIF of at most 2 MB. The sessions run
  the P5 way (21): an empty home folder each, Opus, web tools off, a request that does not name the skill. One line
  under them says the agent designs each piece; the skill supplies the engine, the craft defaults and the checks.
  Only the media are committed, not the three pieces. The app in the request is made up, and its name is searched
  first so it is not a real product's. The request, word for word:

  > Make me a 5-second vertical (9:16) motion-graphics title card for a made-up travel app called Plumtrail, with
  > the line "Plan trips in one tap". Build it in this folder, render the final mastered MP4, and run the quality
  > check on that file. When you're done, tell me the final file's path and what the check said.

- `ASSETS.md` lists every new file with its source and licence; the inventory test covers them.

Acceptance: each GIF's size and dimensions measured; the README rendered on GitHub from the PR branch with every
GIF served; a test that fails when a README picture is missing or a GIF is over its budget; the asset inventory test
passes; no version bump (nothing installed changes).

### 23.2 P7: looks and a brand kit

- **Looks.** `looks.js` in the template: eight named looks, each a starting point the agent then makes its own. A
  look sets colour tokens (`bgA`, `bgB`, `ink`, `muted`, `accent`, `accent2`), font roles (display, body, mono), the
  background shader id (`bg`: `none`, `gradient`, `paper`, `grid` and any the look adds) and its parameters, the
  post settings (bloom, grain, chromatic aberration), the motion vocabulary (entrance easing, stagger, whether a
  light sweep or glitch is allowed) and the synthesized sound's timbre. `bg` stays the shader id, as the template,
  README and SKILL.md use it today; colours never go in it. The first cut: `product` (clean light UI), `neon`
  (dark, glow, glitch at cuts), `paper` (warm texture, serif, gentle springs, no glitch), `editorial` (bold serif,
  black and white plus one accent, hard cuts), `retro-crt` (scanlines, phosphor), `brutalist` (condensed type,
  primaries, snaps), `gradient` (soft mesh, rounded sans), `mono` (high-contrast black and white).
  `--param look=<name>` or `CFG.LOOK` picks one; explicit `--param` values still win over the look.
- **Fonts for the looks** (Q14, Q8 amended). Up to four more open-licence families (a serif display, a condensed
  display, a rounded sans, a hand face; Latin subsets; at most 400 KB together) live once in the skill's
  `looks/fonts/` with their licence texts, not in the template, so the examples do not each carry a copy. A piece
  gets a look's font files only when it uses that look: the agent copies them into the piece's `fonts/`.
- **Font loading.** Fonts named by a look or a brand kit are registered with `FontFace` from the piece's `fonts/`
  before `scene.init`, and added to `CFG.FONTS`, so a missing one fails the render (and is reported by `check`) the
  way a missing `@font-face` family does today. `doctor` reads the look and the kit as well as `index.html`.
- **What was drawn.** The harness records, at every `fillText` and `strokeText` call, the families in the `ctx.font`
  in effect (parsed from the shorthand), and the resolved tokens; the render record gains `fonts_used` and
  `tokens`. An assignment made only to measure or lay out text (as `captions(..., { draw: false })` does) is not a
  draw and is not recorded.
- **Colour probe.** `check`'s probe keeps luma only today; P7 adds an RGB sample of the same probe frames (1/2 size,
  grain off) for the colour match below.
- **Brand kit.** `brand.json` in the project root (Q17): `name`, `colors` (the look's token names), `fonts` (family
  and file per role), `logo` (files for dark and light grounds), an optional base `look`. When a piece is created
  the agent copies `brand.json` and every file it names into the piece, so the piece still re-renders on its own.
  Precedence: `--param` over the kit over the look over the template. `doctor` checks that every kit file exists and
  every colour parses. `node render.mjs brand` renders a brand sheet (swatches, type specimen, logo on each ground)
  to approve before anything is animated.
- **Skill text.** With a brand kit, use it. Without one, pick a look on purpose, say which and why, and do not fall
  back to the same palette from piece to piece. Section 14's "brand notes live in the project's CLAUDE.md" stays
  true for prose notes; tokens and files move to `brand.json`. The README's `--param` line names the colour tokens
  and the shader id correctly.

Acceptance: a looks sheet (one 5 s card in every look) committed as `docs/media/looks.png` and shown in the README;
every look's card passes `check` with 0 FAIL and 0 WARN; tests for precedence (`--param` over kit over look over
template), for a missing look or kit font failing the render, for `doctor` on a broken kit, and for `fonts_used`
(a scene that measures with the kit's fonts but draws with another records only the other); the brand sheet
renders. Colour match, used in the fresh-session rows: every pixel of the RGB probe frames is given to the nearest
colour (CIEDE2000) among the kit's tokens and every look's default tokens, and a pixel more than 10 from all of
them is given to none; the kit's `bgA` and `bgB` together must take at least 15% of the pixels and its `accent` at
least 0.5%, and no look's defaults (nor the template's) may take more than either, role by role: no other `bgA` and
`bgB` more than the kit's, no other `accent` more than the kit's (P7 council round 1: comparing a look's whole
palette with the kit's accent failed a piece drawn only in the kit's colours, since near-white inks sit within a
few units of each other). Two kit tokens of one colour each get its pixels. No clustering, so the result does not
change from run to run. The fixture kit's `bgA`, `bgB` and `accent` are each more than 15 from every look's tokens, so the template's
or a look's palette cannot pass for it. The fresh-session row: one session P5's way, given that `brand.json` (with
its fonts and logo) and a brief that does not mention it, makes a piece that passes the colour match, whose
`fonts_used` holds the kit's display and body families, and whose master passes `check --file`.

### 23.3 P8: code and terminal motion

- **Highlighting.** A built-in tokenizer for JavaScript and TypeScript, Python, shell, JSON and unified diff, with
  theme tokens taken from the look or brand. No dependency (D6, Q13).
- **Drawing.** `drawCode` (typed out by time with a seeded cadence, a cursor, line highlight, focus dimming,
  scrolling), `drawDiff` (added and removed lines revealed line by line), `terminal` (a session of commands and
  output with typed commands, output timing, a spinner and a progress bar), and frames for a window, a browser and
  a phone, all generic shapes with no product's marks.
- **Boxes.** `boxes(t)` is the scene's own pure function, so each helper has a layout-only call (as `captions` has
  with `draw: false`) that returns the boxes of the text visible at `t`: clipped to its frame, scrolled lines left
  out, one `group` per block so lines of one block are not overlaps of each other. Frames and the cursor are
  `deco`. The example's `boxes(t)` returns them, so `text_safe` and `text_overlap` see code and terminal text.
- Synthesized key ticks follow the typed characters, thinned to a ceiling per second so fast typing does not become
  noise.
- **Example** `examples/terminal-demo/` (8 s, 9:16): a made-up CLI installs and runs, then a short diff lands. It is
  added to the example suites (`test/helpers.mjs`).

Acceptance: golden token streams per language; at stated times the visible prefix of the typed code, the terminal
lines shown and the scroll offset equal their expected values (read from the layout call, and the frame hash
stable at those times); a fixture whose code sits outside `tiktok-ad`'s measured safe area for more than 0.25 s
FAILs `text_safe`, and the same block inside it passes; the example passes `check` and `check --file` with 0 FAIL
and 0 WARN.

### 23.4 P9: a launch video for a repo

- **`tools/repo-scan.mjs`** reads a project and prints JSON: name, one-line pitch (README, package metadata),
  install command, features (README headings and lists), colours with the file and line each came from (CSS custom
  properties, a Tailwind theme, a web manifest's `theme_color`), fonts (`@font-face`, font links), logo candidates
  ranked, and screenshots. It skips dependency and build folders and never touches the network.
- **`tools/shots.mjs`** takes pictures of a running local app or a local HTML file with `playwright-core` (already a
  dependency) at a stated viewport. A page that does not move is one full-page screenshot that the scene pans, so
  scrolling costs one image. A page that moves becomes a frame sequence in the layout `frames.mjs` writes and
  `loadSeq` reads (`assets/seq/manifest.json` with frames, fps, width, height and extension; numbered files from
  000), captured at the piece fps with the scroll position set per frame, so it is frame-exact. `loadSeq` holds every
  frame decoded, so `shots.mjs` refuses a sequence whose decoded size (frames x width x height x 4 bytes) is over
  1 GB and says to lower the size or the length. No live screen recording with real-time timing.
- **Recipe** `references/launch.md` and a SKILL.md workflow branch: scan, write `brand.json` from what the scan found
  and show it, write the board (hook, install in a terminal, two or three feature beats with code or screenshots in
  a frame, an end card with the logo and the install command), show the board before rendering, then the usual
  render, mix and `check`.
- **Example** `examples/repo-launch/` (15 s, 9:16), built from a made-up fixture repo kept inside the example (a
  README, package metadata, a logo, a stylesheet with its colours, and a static HTML page of the made-up app that
  `shots.mjs` captures). It is added to the example suites.

Acceptance: `repo-scan` tests on fixtures (colours from each source with file and line, logo ranking, dependency
folders skipped); a tall fixture page with landmarks at known heights, captured as a sequence, has each landmark at
its expected position in each frame within 1 px, and the sequence plays through `loadSeq` and `seqAt` at the piece
fps; the full-page screenshot matches the page's full height; the decoded-size refusal is tested; the example
passes `check` and `check --file` with 0 FAIL and 0 WARN; a fresh session P5's way, asked for a launch video in a
copy of the fixture repo, shows a board first and makes a piece that passes P7's colour match against the fixture's
colours and whose master passes `check --file`.

### 23.5 P10: caption a clip

- **The job.** A clip with speech (a talking head, a screen recording with narration) comes back with word-by-word
  captions inside the platform's safe area, its sound levelled and mastered, checked like any other piece.
- **Files and records** (Q15). The clip is never re-encoded through the browser:
  1. `tools/clip.mjs probe` reads the clip: display size after rotation, frame rate, duration, audio. A variable
     frame rate clip is first converted to a constant rate: its average rate, rounded to the nearest of 23.976, 24,
     25, 29.97, 30, 50, 59.94 and 60, and the recipe tells the user.
  2. **Clip timing.** A clip piece runs on the clip's clock: `CFG.DUR` is the clip's duration and `CFG.FPS` its
     constant rate. Its board, if it has one, is a single silent beat of that length, so `boardTiming` adds no
     `lead` or `tail`. `clip.mjs` writes both `cues.js` (which the captions and `check` read) and `cues.json` (which
     `mix.mjs` reads) from the transcript, with `VO_OFFSET` 0, no gap splice and the words at their own times; it
     does not go through `tools/cues.mjs`, which needs a voiced board.
  3. The captions render with alpha on that clock. The `.mov` or `.webm` is an intermediate with its own ordinary
     alpha render record.
  4. `tools/clip.mjs composite` overlays it onto the clip with ffmpeg into an opaque `yuv420p` `out/<name>.mp4`, and
     writes that picture's render record: every `sabotage-motion/render@1` field the mixer and `check` read today
     (`sha256` as bare hex, `video.hash` with its `sha256:` prefix, `frames`, `fps`, `dur`, `render: [w, h]`,
     `alpha: null`, `silent`, `scene`, `params`, `sub`, `target`, no `from`), with `source` copied from the overlay's
     record, plus `kind: "composite"`, `clip` (the clip's SHA-256) and `overlay` (the overlay record's SHA-256). The
     clip's audio is extracted to `vo.wav`.
  5. `node tools/mix.mjs <name> --no-sfx` mixes it as a voiced piece: `vo.wav` is the voice, an optional bed is
     ducked under it, and the master and `master.json` are written as today. A caption style with its own sound
     renders `out/<name>.wav` from the caption scene instead of `--no-sfx`; its record then matches the composite's
     scene, params, fps and duration, as the effects link requires.
  6. **`check` for a composite.** `render.mjs check` and `check.mjs` branch on `kind: "composite"`: the overlay
     record named by `overlay` must exist, match its hash and bind to the current source (a stale overlay FAILs
     provenance); the text checks replay the caption scene with the overlay's settings (alpha included) through
     `boxes(t)`; the picture checks (`first_frame_empty`, `motion_dead`) run on frames decoded from the composite with
     ffmpeg, a decode path `check` does not have today; `file_spec` reads the composite's own record (`yuv420p`);
     `vo_delay` reads `cues.js`'s `VO_OFFSET` 0. Safe zones: a 9:16 clip of another size gets the target's zones
     scaled to it; any other shape has `text_safe` reported as not checked, and the recipe says so.
- **Transcription** (Q18). The timing adapters read transcripts; they do not hear speech. whisper.cpp's
  `whisper-cli`, when installed, is an optional tool (MIT, no Python, D6) that `doctor` reports and the recipe uses;
  without it the recipe asks for a transcript. The adapters gain whisper.cpp's JSON output and SRT or WebVTT. SRT
  and WebVTT carry phrase times only: words inside a phrase are spread by length and marked as estimated, and the
  recipe says so.
- **Caption styles.** A few named styles (`pop`, `karaoke`, `boxed`, `minimal`) with emphasis words, over the
  existing `captions` helper and its safe-zone and exclude handling.
- **Skill text.** A "caption a clip" branch in SKILL.md's workflow, beside the overlay branch (which mixes nothing).
- **Example** `examples/caption-clip/`: the clip is made in code, with no person in it (Q12): a made-up product
  screen recording rendered by the engine, with the example voice from P4 as its own audio, committed small, with
  its `VOICE.md` (Apache-2.0) beside it. Its transcript is committed, and the example README says how both were
  made. The example suites learn that this example commits a source clip.

Acceptance: adapter tests for whisper.cpp, SRT and WebVTT (word spread, estimate flag); a sync fixture (a clip with
a white flash in its picture and a tone in its audio at the same known frame, and a transcript word at that tone)
goes through the whole path, and in the master the tone's onset is within one frame of that frame (the clip's own
time, so a shared offset of voice and captions fails), the flash is still at that frame, and the caption word's
first visible frame is within one frame of it; the master's frame count and duration equal the clip's; a stale
overlay FAILs `check --file`; a variable-rate clip is converted and says so; the example passes
`check --file` with 0 FAIL and 0 WARN; a fresh session P5's way, given a clip and its SRT and "add captions to
this", returns a master that passes `check --file`.

### 23.6 Release 0.2.0

After P10 and P11: version 0.2.0 in `plugin.json`, `package.json` and the lockfile; the README's examples table and
feature list updated; every install route re-run from `main` on a fresh home folder; tag `v0.2.0` (Q16); then the
skills.sh listing (Q6): one `npx skills add sabotage-dev/sabotage-motion` with telemetry on.

### 23.7 Decision and defaults

| # | Decision or question | Ruling or default |
|---|---|---|
| D11 | Scope of 0.2 (owner, 2026-11-15: "1-5") | README motion, looks and a brand kit, code and terminal motion, a repo launch recipe, caption a clip. |
| D12 | Energy presets (owner, 2026-11-15: the pieces were "pretty tame"; "Add some presets so we can go from subtle, normal, extreme, or something along those lines") | P11 (23.9). |
| Q8 (amended) | Which fonts does the template bundle? | Still the three faces chosen in P0. The look fonts (Q14) live in the skill's `looks/fonts/` and are copied into a piece only when its look uses them. |
| Q11 | README media format | A committed GIF: GitHub plays README video only when uploaded through its web editor, and a GIF plays everywhere the README is shown. |
| Q12 | Where the caption example's clip comes from | Made in code with no person in it (D7, and no third-party footage licence to carry). The recipe works on any clip the user brings. |
| Q13 | Code highlighting | Built in, for the five languages in 23.3; no dependency (D6). |
| Q14 | Fonts for the looks | Up to four more open-licence families, Latin subsets, at most 400 KB together, in `looks/fonts/`. |
| Q15 | How captions meet the clip | An alpha render on the clip's clock, composited by ffmpeg onto the original clip into an opaque picture with its own render record, then mixed; never the clip redrawn as a frame sequence. |
| Q16 | Versions | P6 changes docs only and is not a release; 0.2.0 and its tag come after P10 and P11. |
| Q17 | Where `brand.json` lives | The project root; each piece keeps its own copy and the files it names. |
| Q18 | How a clip is transcribed | whisper.cpp's `whisper-cli` when installed (optional, reported by `doctor`); otherwise the user's transcript (whisper.cpp or openai-whisper JSON, SRT, WebVTT). |

### 23.8 Council round 1 on section 23 (2026-11-15, rev 1.6 at `fcea224`)

Seats: codex `gpt-6.1-sol` effort high; sonnet on Claude Code (`claude-sonnet-5-5`; its Kiro login was signed out);
grok `grok-4.7`. All three SHIP-WITH-FIXES. Fifteen findings, each verified against the code and folded:

| Finding | Seats | Fold |
|---|---|---|
| P10's composite had no record `mix.mjs` or `check --file` accepts | sonnet, grok, codex | 23.5 files and records, Q15 |
| P10's voice path would move the clip's audio (`lead`, `tail`, gap splice) | sonnet, grok, codex | 23.5 audio clock |
| P10 had no way to hear a clip | codex | 23.5 transcription, Q18 |
| P10's sync row compared the captions with their own source | sonnet, codex | 23.5 acceptance: first visible frame against the audio |
| P10 had no SKILL.md branch; its voice licence had to travel | grok, codex | 23.5 skill text and example |
| P7's fonts had no loading path, and nothing recorded which fonts were drawn | sonnet, grok, codex | 23.2 font loading, what was drawn |
| P7's colour and font rows could not be measured | codex, sonnet, grok | 23.2 acceptance: CIEDE2000 on probe frames, `fonts_used` |
| `bg` is the shader id, not a colour | grok, codex | 23.2 looks |
| Q8 unamended, and template fonts would be copied into every example | sonnet, grok | 23.2 fonts, Q8 amended |
| P8's text needs layout-only boxes, groups and `deco`; typing was not proven; estimate zones only WARN | sonnet, grok, codex | 23.3 boxes and acceptance |
| P9's scroll row passed a capture that never scrolls; no `loadSeq` contract or memory budget | codex, grok, sonnet | 23.4 shots and acceptance |
| P6's prompt was not written down | grok | 23.1 (the README prints it) |

Round 2 (2026-11-15, delta at `4276c6b`; same three seats, all SHIP-WITH-FIXES). Eleven of the fifteen round 1
findings were closed by all three seats. What was still open, verified and folded in rev 1.8:

| Finding | Seats | Fold |
|---|---|---|
| The composite record named too few fields (`source`, `render`, `dur`, `silent`, `scene`, `params`), nothing read `kind`, and `check` had no decoded-picture probe | grok, sonnet, codex | 23.5 steps 4 and 6 |
| `clip.mjs` wrote `cues.json` only, but captions and `vo_delay` read `cues.js`; a board would still add `tail`; the mixer needs `vo.wav` and an effects stem or `--no-sfx` | sonnet, grok | 23.5 steps 2, 4 and 5 |
| The sync row passed when voice and captions shared a wrong offset | sonnet, grok | 23.5 acceptance: the tone and a flash at the clip's own frame |
| The colour probe keeps luma only; k-means is unseeded and splits gradients; a kit near a default palette passes vacuously | sonnet, codex, grok | 23.2 colour probe and colour match (nearest palette, fixture kit far from every look) |
| An assigned font is not a drawn font | codex, sonnet, grok | 23.2 what was drawn (`fillText`/`strokeText`) |
| The exact request was not in the plan | grok | 23.1 |
| A variable rate's target set was unstated; a clip of another size skipped `text_safe` silently | sonnet | 23.5 steps 1 and 6 |

No round 3: what remains is how P7 and P10 implement these contracts, which their own code reviews check.

### 23.9 P11: energy presets (owner, 2026-11-15, D12)

The owner's verdict on the 0.2 pieces so far: "pretty tame". The engine can hit hard (the showreel does), but the
skill steers away from it: the craft defaults say "stay subtle", `check` only flags a piece that freezes for 3 s
(`motion_dead`) and never one that merely drifts, the recipes have one shape, the examples are calm and agents copy
them, and most pieces have no beat to cut on. P11 makes intensity a choice the board states, with the bolder setting
as the default. Rev 1.9's version of this section had council round 1 (23.10); rev 2.0 folds it.

- **The setting.** `energy` on the board, `--param energy=` or `CFG.ENERGY`: `subtle`, `normal` (the default) or
  `extreme` (Q19). Any look takes any energy: the look decides the *kind* of motion it allows (paper and the other
  looks with `glitch: false` never glitch or flash-frame), the energy decides the *amount* (tempo, cut rate, camera
  amplitude, type scale). Extreme on a no-glitch look uses its strongest allowed moves (whips, punches, slams).
- **Beats and shots are different things.** A board beat holds its copy at least as long as `check` requires to read
  it (`board_copy_unread`: max(1.0 s, 0.25 s per word)), at every preset. A *shot* is what lies between two visual
  cuts, and cuts happen inside beats: a new angle, a new background, a punch-in, a swapped layer, while the copy stays
  on screen across them. So extreme's short shots never shorten a read. On a voiced board nothing snaps: the voice
  sets every window (cue anchors win, and a silent beat keeps its declared length, since those lengths keep each
  anchor inside its beat), and the beat grid only places the visual cuts and hits inside the windows. Only a board
  with no voice snaps its beat lengths to whole musical beats.
- **What each preset sets** (`energy.js` in the template). Shot lengths are cut intervals, in musical beats of the
  preset's tempo:

  | | subtle | normal | extreme |
  |---|---|---|---|
  | Tempo of the beat grid and the bed (Q22) | 84 BPM | 116 BPM | 136 BPM |
  | Cut interval in beats, and the mean shot length it gives | 4 to 5 beats: 2.8 to 3.6 s | 2 to 3 beats: 1.0 to 1.6 s | a half beat to one beat: 0.2 to 0.45 s, within beats that still hold their copy |
  | Camera | a slow push, a drift | push-ins, a punch on each hit | punch-ins, whips between beats, shake on impacts, zoom bounces |
  | Transitions | crossfade, soft wipe | mask wipe, slide, whip | whip, glitch cut and flash frame (where the look allows), speed ramp |
  | Largest line of type: one line's ink height as a share of frame height | 4 to 8% | 9 to 16% | 18 to 35% |
  | Easing | gentle springs | snap, swift | overshoot, anticipation, whip |
  | Post | low bloom and grain | medium | chromatic aberration and RGB split on hits, within the flash limit |
  | Sound | a soft pad, few hits | a beat bed, whooshes on cuts, hits | a driving beat, impacts, risers and drops, each under `audio_spike` |

- **The bed is its own stem.** `audio.js` writes the preset's beat pattern to `out/<name>.bed.wav`, the picture's
  full length and on its beat grid (silent at `subtle` if the board says so), separate from the effects stem. The
  changes to `mix.mjs` this needs: it uses `out/<name>.bed.wav` as the bed when no `--bed` is given, for voiced
  mixes (ducked under the voice like any bed) and for `--master-only` mixes alike; a generated bed starts at 0, is
  never end-aligned and has no default fade, since it already spans the picture; `master.json` records its hash,
  and `check --file`'s provenance includes it. `audio_spike` measures what is heard: the effects stem and the bed
  stem summed at the mixer's own gains (the effects at their bus gain, the bed at its bed gain, as `mix.mjs` sets
  them), so extreme's hits are judged against the beat under them. The bed stem gets a render record linked to the
  source the way the effects stem is, and a missing or stale bed is reported, never silently left out.
- **Text stays readable and inside the safe area through the moves.** Text-bearing layers are not carried by whips
  (a whip happens on the cut between two beats, when no copy is on screen). For every other move (push, punch,
  zoom bounce, shake) the camera rig computes, at each `t`, the largest zoom and offset that keep the text boxes on
  screen inside the target's safe area after the camera, and clamps to it. Word-by-word slams return one box per
  word under the phrase's shared `group` (the whole board copy string, as the template's title does), so
  `board_copy_*` still finds the phrase and `text_overlap` sees the words as one caption.
- **Helpers,** pure functions of `t` like everything else: the camera rig driven by a hit list (push, punch, seeded
  shake, whip), transitions (`whip`, `wipe`, `mask`, `zoomPunch`, `glitchCut`, `flash`), kinetic type (slams, scale and
  rotate in) with a layout-only call for `boxes(t)` as in P8, and `cuts(t)`, the scene's list of its visual cuts.
- **`energy_match` (WARN), measured, never taken on the scene's word (Q21):**
  - *Cuts* are the scene's declared cuts that the frames confirm. A declared cut at `c` (or a transition from `c` to
    `c + d`, d at most 0.3 s) is confirmed when the probe frames at the middle of the shot before it and the middle of
    the shot after it differ in at least 30% of their pixels by at least 16/255. A "shot" shorter than 0.15 s is part
    of the transition, not a shot, so a flash declared as a cut is never confirmed; an A-B-A-B run of real half-beat
    shots is, since each middle frame lies inside its own shot. Changes nobody declared (shake, flashes, glitches)
    never count, and a declared cut the frames do not show is reported. Mean shot length = length / (confirmed cuts
    + 1).
  - *Type size* is measured from ink, not boxes: each probe sample is rendered a second time with `fillText` and
    `strokeText` suppressed (P7 already wraps both), and the difference is the text mask, after the camera and the
    post chain like the frame itself. Each box is mapped through the camera as `text_safe` maps it, and inside it the
    mask's rows of ink are split into lines (runs of inked rows separated by empty ones); a line's ink height is its
    run's height. A box with no ink is reported. The tallest line's ink height over the piece, as a share of the frame
    height, is the type size, so a three-line block of small type reads as small type.
  - *Motion* is the median, over probe frame pairs outside holds, leaving out only the pairs that straddle a
    confirmed cut or lie inside a transition, of the share of pixels whose luma changes by at least 8/255.
  - It warns when a `normal` or `extreme` piece is calmer than its preset's floor on any of the three (mean shot
    longer than its range, type smaller than its range, motion under its floor), or a `subtle` piece busier than its
    ceiling. The motion floors and ceiling (Q23), and the 30%, 16/255, 8/255 and 0.25 s above, are first values,
    tuned in P11 on calibration fixtures whose ground truth is built in (a hard cut, a wipe, a whip, a shake, a
    full-frame flash, a slow drift, a static card), never on the preset cards themselves, and recorded in
    `references/check.md` like the other thresholds. The fixtures include an A-B-A-B run at extreme's half-beat
    shot, a multi-line block of small type, and a punch-in on large type.
- **`flash` (FAIL), on the delivered picture, at every preset (Q20).** It is a safety net modelled on WCAG 2.3.1, not
  a certified photosensitivity test; `references/check.md` says so, and that a piece made for broadcast still goes
  through a certified tool (a Harding-type test). It runs in `check --file` on the decoded master
  (and in P10 on the decoded composite), so it sees exactly what a viewer sees, motion blur and grain included, at
  the file's frame rate. Each frame is scaled so its longer side is 1024 px (down by area averaging, up bilinearly),
  and read as RGB;
  relative luminance comes from linearised sRGB, as WCAG defines it. Flashes are found per pixel, as WCAG defines
  them, never on averages: an average hides a pattern whose halves swap, spreads a small flashing spot over a whole
  cell, and softens a real flash near the threshold below it. Each pixel's
  relative luminance is followed frame by frame with a threshold zig-zag: a *general transition* of that pixel is
  confirmed when its luminance has moved 10% of the maximum or more from its last turning point, in the direction
  opposite to its previous transition, with the darker of the two below 0.80; smaller wobbles (grain, a noisy or
  stepped ramp) never end a transition, so a ramp counts as fully as a hard cut. Red is followed by the same kind of
  zig-zag on chromaticity (CIE 1976 u'v'): the *far end* of a pixel's current swing is the colour farthest from the
  end the swing left, and a *red transition* is confirmed when the colour is more than 0.2 back from that far end,
  one of the two a saturated red (R/(R+G+B) of 0.8 or more, on the linearised R, G and B of WCAG's relative-luminance
  definition, not the stored sRGB values), in the direction (into red or out of it) opposite to
  the previous red transition; before the first one it is measured from either end of the swing so far. So a fade
  between red and another colour counts as fully as a cut, and no earlier colour anchors it. A transition is dated at
  the time of the frame that confirms it, the frame's index over the file's exact frame rate (30000/1001 for 29.97).
  No pairing, so nothing earlier in the clip can shift the count: a pixel is *flashing too fast* at time t when it
  has more than seven transitions of one kind (four complete flashes, since a pixel's transitions alternate) dated
  within the half-open second (t - 1 s, t], compared in exact integer arithmetic on frame indices and the rational
  rate (a transition at frame i counts at frame f when (f - i) x denominator < numerator).
  WCAG excepts a fine, balanced pattern (white noise, a checkerboard with squares under 0.1 degree). `flash` does not
  apply that exception (Q25): every confirmed transition counts, so a fine pattern that flickers at full strength
  fails. An average softens real flashes, and a neighbourhood test can be satisfied by a few counter-moving pixels
  under a full-frame strobe (rounds 8 and 9), so the conservative side is the safe one for a safety net: a false
  FAIL costs a change to the piece; a missed strobe costs a viewer. Grain and dithering stay under the 0.1 swing and
  never count. Three
  flashes and then a lasting change, seven transitions, pass, as WCAG passes them. At each frame, the pixels flashing
  too fast form the area, whether or not they change at that very frame, so the result does not depend on the frame
  rate and a strobe split across columns or a sweeping band is seen whole. General and red are counted separately,
  as WCAG counts them: a frame FAILs `flash` when one kind's too-fast pixels cover more than 21,824 px of some
  341x256 window, in either orientation (a phone is held either way), by a summed-area table over the scaled frame;
  a frame shorter than the window on a side clips the window to it, so a full-bleed strobe on a wide strip still counts.
  A pattern whose halves swap four times a second (four transitions for each pixel, two flashes) passes; a small bright shape that keeps repeating its path more than three
  times a second makes its path's area flash too fast, and that area counts (Q24). Source
  `check` runs `flash` on `out/<name>.mp4` when that render's record matches the current source, and otherwise
  reports it not checked and says to render; delivery is `check --file` on the master, as the workflow already says.
  Fast cuts count too: at extreme's cut rate, shots that alternate dark and light are a flash sequence, so `energy.js` keeps consecutive
  shots' luminance close at extreme, and the agent slows the cuts where a piece needs a light-dark swing.
- **Skill text and recipes.** The board names its energy and the agent says which it chose and why; `subtle` is a
  choice, not the default. SKILL.md's craft defaults are rewritten per preset (the "post effects stay subtle" rule
  becomes the subtle row). P9's launch recipe and example are updated to the preset interface here (P9 merges
  first), and the repo-launch example is re-cut at `normal`.
- **P10's caption styles follow the preset:** `minimal` is the subtle default, `pop` and `boxed` the normal ones,
  `karaoke` and word slams the extreme ones; a board can still name any style.
- **Examples.** The template card at all three presets side by side as README media (GIFs within P6's budgets).
- Every example carries `check.mjs` as a template copy, so the new checks reach them through the existing parity test.

Acceptance: the calibration fixtures measure as built (cuts counted exactly, a shake and a flash counted as no cut, a
declared cut with no change reported, a drawn-small box claiming a big size measured by its ink); a static card with
one full-frame flash, declared `extreme`, WARNs on `energy_match`; at each preset the template card's confirmed cut
rate, ink type size and motion fall inside that preset's ranges and its `check` and `check --file` show 0 FAIL and
0 WARN (copy read in full, text inside the safe area); `energy_match` warns on a `normal` board rendered calm and on
an `extreme` board rendered at normal pace; `flash` FAILs: four general flashes in a second; four red flashes in a second between a saturated red and a purple
0.22 apart in u'v' with less than 0.1 of luminance between them (so only the red rule can catch it), the same
after an earlier colour within 0.2 of both, the same as a fade through a middle colour, and as a continuous ramp
(six frames a cycle, and eight); a full-frame strobe reversing every frame at 30 and at 60 fps; the same with a
counter-moving pixel in every 4x4 block (at full and at 0.11 strength); an uneven strobe; a 4 Hz triangular ramp
(0.10 to 0.38 at 60 fps, 0.04 a frame), the same with small reversals and with grain-sized noise; 8 px halves
swapping eight times a second; checkerboards of 1, 2, 3 and 4 px inverting every frame and full-range noise every
frame (Q25); 4x4 px checks at 0.19 and 0.30 in a 256 px patch; 6 px bars every 20 px rising and falling together
by 0.125; a band 25% of the frame wide crossing it four times a second, at 30 and at 60 fps; a strobe staggered
across seven columns; one earlier transition and then four flashes; four 6-frame pulses within 0.9 s; eight
transitions within 0.968 s at 29.97 fps; a 65x341 px rectangle and a 341x65 px strip each flashing four times a
second; a 32x256 px bar repeating its path 4.3 times a second (Q24); and a sub-frame flash that the motion-blurred
master shows between the probe's samples; red strobes that are saturated only on linear RGB (stored (0.8, 0.15, 0.15)
against (0.2, 0, 1), and (230, 60, 60) against (0, 130, 0)); a full strobe on a 1024x200 px frame; eight transitions
within one second at the exact rate 3000001/100000. It passes: three general and three red flashes in a second (cut, faded,
and as a ramp of ten frames a cycle); a red ramp that reaches only 0.164 from the red; three flashes and then a
held rise; four 7-frame pulses spanning 1.03 s; eight transitions over 1.001 s at 29.97 fps, and eight whose first
is exactly one second before the last at 30 fps; 8 px halves swapping four times a second; a 6x6 px spot flashing
in every 16x16 cell; the bar crossing once; a flicker between 0.85 and 1.0 (the darker end above 0.80); swings of
0.08 every frame; a general strip and a red strip next to each other, each under the area on its own; a slow fade
up and down; and grain. `audio_spike` still warns on a click over the bed and passes the extreme card's hits only with the bed under them; the extreme
card passes `audio_spike` with its bed under it; an unvoiced `--master-only` mix carries the generated bed on the
beat grid; the bed is ducked under a voice
in a voiced fixture; a fresh session P5's way, given one brief three times (asking for subtle, saying nothing, asking
for extreme), makes three pieces whose measurements fall in their presets' ranges; and the owner watches those three
and confirms they read as subtle, normal and extreme.

| # | Question | Default |
|---|---|---|
| Q19 | Names and default | `subtle`, `normal`, `extreme`, as the owner put it; `normal` is the default. |
| Q20 | The flash limit | WCAG 2.3.1 (three flashes) and its definitions, on the decoded master per pixel, without its fine-pattern exception (Q25): a pixel with more than seven counted transitions of a kind (four complete flashes) in a half-open second, in exact frame arithmetic, is flashing too fast; a frame fails when one kind's such pixels cover more than 21,824 px of a 341x256 window in either orientation, the frame scaled to 1024 px on its longer side; general and red counted separately. |
| Q21 | Where energy is measured | From the frames: cuts the scene declares count only when the frames confirm them; type size from the ink of a text-off render; motion from the probe. |
| Q22 | Tempos | 84, 116 and 136 BPM; a board may set its own tempo within 10% of its preset's. `energy_match` then judges the shot length against the preset's cut interval in beats at the board's own tempo (the seconds in the table are at the preset tempos). |
| Q24 | A small shape that repeats its path fast | It fails when its path's area is over the limit, though at any one moment it covers less (each pixel on the path flashes too fast; a conservative reading of WCAG's area for content that may reach someone with photosensitive epilepsy). Round 4 had read it the other way; the owner may relax it. |
| Q25 | WCAG's exception for fine balanced patterns | Not applied: fine patterns that flicker at full strength (pixel-scale checkerboards, full-range noise every frame) fail. Three attempts to apply it either hid real flashes or excused a strobe; a safety net errs toward failing. The owner may ask for it back with a certified-tool reference. |
| Q23 | Motion floors | First values: subtle at most 10% of pixels changing per frame pair, normal at least 2%, extreme at least 6%; tuned on the calibration fixtures in P11. |

### 23.10 Council round 1 on 23.9 (2026-11-15, rev 1.9 at `d55c925`)

Seats: codex `gpt-6.1-sol` effort high (BLOCK); sonnet on Claude Code (`claude-sonnet-5-5`, SHIP-WITH-FIXES); grok
`grok-4.7` (SHIP-WITH-FIXES). Each finding was verified against the code and folded in rev 2.0:

| Finding | Seats | Fold |
|---|---|---|
| The probe keeps a luma-difference histogram (no colour, position or direction) at one sample per frame, so it cannot measure WCAG flashes, and a sub-frame flash the master shows can fall between samples | codex, sonnet, grok (grok: measurable on RGB rasters) | `flash` runs on the decoded master, RGB, linear luminance, signed transitions per 341x256 window; a fixture for a flash between probe samples |
| Extreme's 0.35-0.8 s shots cannot meet `board_copy_unread` (1 s minimum inside a beat) | codex, sonnet, grok | Beats and shots are separate: cuts happen inside beats, copy holds across them |
| `energy_match` had no spike definition, no motion bands, read flashes, shakes and wipes as cuts, and a static card with one flash could pass as extreme | codex, sonnet, grok | Declared cuts confirmed by the frames; motion defined with thresholds; calibration fixtures with built-in ground truth; the static-card-with-a-flash fixture |
| Type share came from `boxes(t)`, which the scene declares | codex, sonnet, grok | Ink height from a text-off render |
| The bed would go into the effects stem, which `mix.mjs` never ducks | codex, grok | A separate bed stem that `mix.mjs` ducks |
| Snapping beats to the grid fights voice-driven timing | codex, sonnet | The voice wins; the grid places visual cuts; only silent beats snap |
| Looks set `glitch: false`, extreme asks for glitches | sonnet, grok | The look decides the kind of motion, the energy the amount |
| Whips and shake carry text out of the safe area; slams need a shared group | sonnet, grok | Text layers are not whipped, shake keeps boxes in the safe area, one group per line |
| Risers and drops trip `audio_spike` | sonnet | Each hit stays under `audio_spike` |
| P10 must check flashes in the composite; caption styles per preset were unstated | codex, grok | `flash` on P10's decoded composite; the style mapping |
| Q22's tempos and shot ranges did not agree; the diagnosis said `check` never flags stillness (`motion_dead` does, at 3 s) | grok | Cut intervals in beats; the diagnosis corrected |
| P11 rewrites P9's recipe while P9 is in review; the examples carry `check.mjs` copies | sonnet | P9 merges first and P11 updates it; the parity test carries the checks |

Round 2 (2026-11-15, delta at `31020c3`): codex BLOCK, sonnet and grok SHIP-WITH-FIXES. Folded in rev 2.1:

| Finding | Seats | Fold |
|---|---|---|
| `flash` compared adjacent frames only, so a gradual 4 Hz ramp (0.04 per frame at 60 fps) passed | codex | Transitions between luminance extremes per 16x16 cell; the ramp fixture |
| The 0.25 s persistence test rejected real A-B-A-B half-beat cuts, and the motion window left 0.02 s per extreme shot | codex, sonnet, grok | Cuts confirmed between the middles of the shots either side; sub-0.15 s "shots" are transitions; motion drops only the pairs at a cut |
| The bed never reached an unvoiced mix, was looked for as `bed.mp3`, end-aligned and faded | sonnet | The `mix.mjs` changes named: `out/<name>.bed.wav` for voiced and `--master-only`, at 0, full length, no fade, in provenance |
| `audio_spike` would judge extreme's hits against an effects stem with the beat taken out | sonnet | `audio_spike` measures effects and bed together |
| Ink height intersected pre-camera boxes with a post-camera mask, and a multi-line box read as one tall line | grok, sonnet | Boxes mapped through the camera; ink split into lines |
| Pushes, punches and zoom bounces could carry text out of the safe area | sonnet | The rig clamps every move to keep text boxes inside |
| One group per line broke `board_copy_*` on wrapped copy | codex | One group per board phrase |
| Subtle's beat endpoints (2.857 s, 3.571 s) fell outside 2.9-3.6 s; a whole beat at 136 BPM (0.441 s) outside 0.44 s | grok | Ranges stated from the beat counts: 2.8-3.6 s and 0.2-0.45 s |
| A silent beat snapped on a voiced board still moved the voiced windows | grok | Nothing snaps on a voiced board |
| `flash` only under `check --file` | sonnet | Source `check` runs it on a current render; delivery is `check --file` |

Round 3 (2026-11-15, delta at `e478035`): codex BLOCK, sonnet and grok SHIP-WITH-FIXES. Folded in rev 2.2:

| Finding | Seats | Fold |
|---|---|---|
| 16x16 cell means hide a pattern whose halves swap, and a small spot makes a whole cell count, so the area is wrong both ways | codex, sonnet | Transitions found per pixel; area counted from the pixels themselves, by window |
| "From one local extreme to the next" had no minimum swing, so small reversals or grain split a dangerous ramp | codex, sonnet | A threshold zig-zag per pixel: a transition ends only on a 10% move from the last turning point |
| `audio_spike` with the bed: which file, which gains, how fresh, and a row a wrong build would pass | sonnet | Summed at the mixer's gains, the bed stem linked to the source, a click over the bed must still warn |
| A board tempo 10% off its preset's moves the shot length out of the table's seconds | grok | Judged in beats at the board's own tempo |
| Five beats at 84 BPM "past 3.6 s" | grok | Not adopted: 5 x 60/84 = 3.571 s, inside 3.6 s |

Round 4 (2026-11-15, the flash rule at `8599c78`): codex, sonnet and grok all BLOCK. Rev 2.2's 0.1 s area memory
and its merging of over-limit runs let any strobe of about 10 Hz or faster merge into one flash and pass (a full-frame
reversal every frame, an uneven strobe, a repeating band sweep), and the same memory added up a small moving bar's
past positions into a false FAIL; flash pairing was ambiguous. Folded in rev 2.3: no memory (the area is what
confirms at that frame), runs merge only within one direction, flashes paired without overlap, and each of those
inputs is a fixture.

Round 5 (2026-11-15, rev 2.4 at `9ef74c1`): codex, sonnet and grok all BLOCK. Pairing each pixel's transitions from
its first one let a single earlier transition put a later strobe out of phase (one up, then four flashes, passed);
taking the area only from pixels changing at that exact frame let a band sweep pass at 60 fps and a strobe staggered
across columns pass at any rate; four 7-frame pulses dated at their ends slipped out of the second. Folded in rev 2.5:
no pairing (more than six transitions in a half-open second), the area is every pixel flashing too fast at that moment,
and the window is checked in either orientation. The main loop's simulation of rev 2.5 (red included) gets all
twenty-four fixtures right.

Round 10 (2026-11-15, rev 2.9 at `4f31999`): codex and sonnet SHIP-WITH-FIXES, grok BLOCK. The red ratio did not say
stored or linear RGB (WCAG's R, G and B are the linear values of its relative-luminance definition; stored values
missed red strobes); a frame shorter than 256 px held no full window; the simulation approximated unusual rates.
Folded in rev 3.0: the ratio on linear RGB, the window clipped to a short frame, the exact rate. The simulation of
rev 3.0 gets all fifty-five fixtures right.

Round 9 (2026-11-15, rev 2.8 at `cd426b1`): codex, sonnet and grok all BLOCK. The balance test asked only for an
opposite transition somewhere in each 4x4 window, so a full-frame strobe with one counter-moving pixel per 4x4 block
(at full or at 0.11 strength) was excused, general and red; a fine checkerboard whose two phases confirm on
alternate frames was not; the simulation's frame edge differed from the plan's. Rev 2.9 drops the exception (Q25):
every transition counts. The simulation of rev 2.9 gets all fifty fixtures right, the fine patterns now among the
FAILs and the round 9 lattices FAIL too.

Round 8 (2026-11-15, rev 2.7 at `a53586b`): codex and grok BLOCK, sonnet SHIP-WITH-FIXES. The 3x3 average was wrong
both ways: it softened real flashes near the threshold below it (4x4 px checks at 0.19 and 0.30; 6 px bars rising by
0.125 together) and still failed fine patterns WCAG excepts (black-and-white 2x2 and 1x1 checkerboards, full-range
noise, a 3 px checkerboard); the average's domain and the downscaling filter were unstated; the simulation compared
floating-point times at the exact one-second boundary. Folded in rev 2.8: no averaging; the exception as a balance
test (a transition is exempt only when every 4x4 window around the pixel has the opposite direction at that frame);
area-averaging downscale stated; exact integer time. The simulation of rev 2.8 gets all forty-eight fixtures right.

Round 7 (2026-11-15, rev 2.6 at `aac9437`): codex and grok BLOCK, sonnet SHIP-WITH-FIXES. Red measured against the
pixel's most recent state of the other kind let a red fade pass (through a middle colour, or as a smooth ramp, no
step reached 0.2); "frames f - fps + 1 to f" had two readings at 29.97 fps; a 2x2 px checkerboard failed though
WCAG excepts balanced patterns finer than 0.1 degree. Folded in rev 2.7: red as a zig-zag from the far end of each
swing, the second as exact time, a 3x3 px average for the exception. The main loop's simulation, rewritten for rev
2.7, gets all forty-one fixtures right; while writing it, two of its own red-ramp expectations were wrong (a
7-frame ramp that peaks 0.164 from the red is not a red flash; an 8-frame ramp fits four flashes in 0.93 s) and were
corrected from the arithmetic, not the output.

Round 6 (2026-11-15, rev 2.5 at `abaae04`): codex and grok BLOCK, sonnet SHIP-WITH-FIXES. More than six transitions
counted a half-made fourth flash, so three flashes and then a lasting change failed though WCAG passes them; the red
rule was anchored to the clip's first colour, so an earlier colour within 0.2 of both states hid four red flashes;
"general or red" read two ways; the red fixtures passed on the general rule alone and the "three red flashes" one
had two; the halves wording and its fixture disagreed; no fixture needed the landscape window; the second's
boundary was not pinned to whole frames. Folded in rev 2.6: more than seven transitions (four complete flashes), red
transitions measured against the pixel's most recent state of the other kind, the kinds counted separately, fixtures
for each case, frames as the unit. The simulation of rev 2.6 gets all thirty-one fixtures right; the red fixtures
pass the general rule (0.088 of luminance between their states), and the side-by-side strips fail if the kinds were
counted together, so both test what they claim.

Before round 5 the main loop simulated rev 2.3 on every fixture: it got all fourteen right, but paired up and down
events of different pixels, so halves swapping twice a second (two flashes for each pixel, within the limit) would
have counted as four. Rev 2.4 counts flashes per pixel and takes the area from the pixels over the rate at each frame;
the same simulation gets all fifteen fixtures right under it.

## 24. Version 0.3 (planned)

Real 3D scenes (owner, 2026-11-15: "3d is 0.3", D13): an opt-in 3D layer, with Three.js (MIT) copied into a piece only
when the piece uses 3D (as the look fonts are), rendered under the 2D layers on the same clock so frames stay exact
and every check still applies; ready-made pieces for a phone or laptop mockup with a screenshot on its screen,
extruded text and logos, and orbit, dolly and fly-through camera moves, tied to the energy presets. It reverses v1's
non-goal "3D scenes (Three.js)" and needs D6 restated for an opt-in library. 0.2 keeps shader 3D (raymarched shapes)
and 2.5D depth. Planned in full after 0.2.0 ships.
