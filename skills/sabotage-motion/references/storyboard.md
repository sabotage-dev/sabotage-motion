# Storyboard: the board, the board sheet, slates and the animatic

The board (`board.js`) is the one place a piece's structure and timing live. The voice script, the cues, the
scene's timeline, the board sheet and four of `check`'s checks all come from it.

## Contents
1. The board format
2. The board sheet
3. Slates and the animatic
4. Beat timing
5. Board checks
6. Writing a good board

## 1. The board format
`board.js` is an ES module that exports `BOARD` and imports nothing, so the browser and the Node tools both load it.

```js
export const BOARD = {
  title: 'What a skill is',
  target: 'tiktok',          // a safezones.json target: the slate's size and safe area, and check's default
  wps: 3.0,                  // speaking rate for estimates before a take exists (words per second)
  hookMax: 4.0,              // optional: the hook's last word must end before this picture time
  beats: [
    { id: 'hook', vo: 'Stop pasting the same instructions into your agent.', on: ['Stop pasting'],
      look: 'one word slams in on black', sfx: 'whoosh into a hit', hook: true },
    { id: 'save', vo: '[curious] Save them as a skill instead.', anchor: 'Save them', gapBefore: 0.6,
      on: ['SKILL.md'], look: 'a file icon drops in, its name types on', sfx: 'tick per letter' },
    { id: 'end', dur: 2.5, on: ['example.com'], look: 'end card, holds to the last frame', hold: true, sfx: null },
  ],
};
```

| Beat field | Meaning |
|---|---|
| `id` | Unique. Not `TAKE`, `VO_OFFSET`, `DUR` or `__proto__`. |
| `vo` or `dur` | A voice line, or the length in seconds of a silent beat. Silent beats may lead, sit between voiced beats, or trail. |
| `on` | The on-screen copy, a list of strings. `check` looks for each one in the beat's window. |
| `look` | The visual note, for the person and the board sheet. |
| `sfx` | The sound note. `check` wants sound in the beat's window; `sfxHit: true` wants a transient; `sfx: null` means silence on purpose and is never checked. |
| `anchor` | The phrase in `vo` whose first word cues the beat. Default: the line's first four words, after any opening tags. May not contain `[`. |
| `occurrence` | Which occurrence of the anchor in the whole take, when a phrase repeats. Default: the next one after the previous beat's anchor. |
| `gapBefore` | Seconds of silence `tools/cues.mjs` opens in the voice before the anchor (at the quietest point of the pause). |
| `hook` | The beat the hook gate measures. Default: the first voiced beat. |
| `hold` | A deliberate hold (an end card): `check`'s `motion_dead` leaves its window alone. |
| `key` | Seconds into the beat the board sheet shows. Default: 60% of the way through. |

Board fields: `title`, `target`, `wps` (default 3.0), `hookMax`, `lead` (0.10 s: a voiced beat's window opens this
long before its anchor) and `tail` (0.40 s: the last voiced beat's window closes this long after its last word).

A `[...]` span in a `vo` line (`[curious]`, `[short pause]`, `[chuckles]`) is a delivery tag: it goes to the TTS as
written and shows on the board sheet as direction, but it is never a word, an anchor or a caption
(`references/voice.md`).

The scene reads the board through `lib.js`:

```js
import { beatWindow, beatAt, boardDur } from './lib.js';
export const CFG = { W: 1080, H: 1920, FPS: 30, DUR: boardDur(), FONTS: ['DISPLAY', 'BODY'] };
const [hookIn, hookOut] = beatWindow('hook');   // picture time, half-open [start, end)
export const TL = { slam: hookIn + 0.2, out: hookOut - 0.3 };
```

`beatAt(t)` returns the beat under `t`. Once a take exists, the windows come from it, so retiming the voice moves
the whole picture with it.

## 2. The board sheet
```sh
node render.mjs board --slates     # a placeholder card per beat, before anything is animated
node render.mjs board              # the real scene, at each beat's key time
node render.mjs board --safe       # with the target's unsafe area shaded on every panel
```
It writes `board.png` and `board.md` (the same content as a table): one panel per beat, three columns at 9:16 and
four at 16:9, and under each panel the beat's id, its time window, the voice line (tags in a different colour), the
on-screen copy, the visual note and the sound note. The header says where the timing came from: "estimated
timing" before a take exists, `cues.js` after. `--cols N` and `--scale` change the layout. The page composes the
sheet with the piece's own fonts, so a missing font fails here too.

Show the person the slate sheet before you voice or animate anything: it is the cheapest point to change the
structure.

## 3. Slates and the animatic
`slate.js` is a complete scene that draws, for the beat under `t`: the beat's number, id and window, its on-screen
copy large and fitted inside the safe area, the visual and sound notes, and a progress bar with a tick per beat. It
exports `silent = true`, so a slate render never loads `scene.js` or `audio.js`. It is meant to be replaced, beat by
beat, not shipped.

The animatic is the slate picture with the real voice:

```sh
node render.mjs video --scene slate.js --out out/animatic.mp4
node tools/mix.mjs animatic --no-bed --no-sfx
```

With `--no-sfx` a missing effects stem is silence, so the silent `video` render is enough. The person hears the
pacing before anything is animated.

## 4. Beat timing
All windows are picture time (seconds from the first frame), half-open, contiguous, and together cover
`[0, boardDur())`.

**Before a take exists (the estimate).** Beats run back to back in board order: a voiced beat lasts
`words / wps + 0.25` s (tags are not words), a silent beat its `dur`. The voice would start after any leading
silent beats plus `lead`.

**Once `cues.js` exists.** The take is the only source for voiced beats:

- `VO_OFFSET`, the picture time where `vo.wav` starts, is written once, by `tools/cues.mjs`: the leading silent
  beats' summed `dur` plus `lead`, or `--offset` (refused below that sum).
- A voiced beat opens `lead` before its anchor (`VO_OFFSET + CUE[id] - lead`); the first beat starts at 0 whatever it
  is, and leading silent beats run back to back from 0.
- Silent beats between voiced ones get the same length of silence spliced into the voice, at the end of the
  previous word or `lead` before the anchor, whichever is later, with 5 ms fades so the cut cannot click. No word is
  cut.
- Silent beats after the last line start `tail` after the last word, back to back.
- `boardDur()` is the last beat's end. Set `CFG.DUR = boardDur()`.

`cues.js` records which board it was made from (`BOARD_KEY`: each voiced line, anchor, occurrence and gap, each
leading or interleaved silent beat's `dur`, the hook, `lead` and `hookMax`). A render refuses a `cues.js` whose key
no longer matches `board.js`: run `node tools/cues.mjs` again after changing any of those. Copy, look and sound notes,
and silent beats after the last line, can change freely.

## 5. Board checks
`node render.mjs check` runs these with the others (`references/check.md` has the measurements):

| Check | Level | Rule |
|---|---|---|
| `board_order` | FAIL | Windows are contiguous and in order, and `CFG.DUR` equals `boardDur()` within one frame. |
| `hook_long` | FAIL | With `hookMax`: the hook's last word (or closing tag) ends after `hookMax` of picture time. |
| `board_copy_missing` | WARN | A string in a beat's `on` never appears in that beat's window. Needs `boxes(t)`. |
| `board_copy_unread` | WARN | It appears for less than `max(1.0, 0.25 x words)` seconds. |
| `board_sfx_missing` | WARN | A beat with an `sfx` note has no 50 ms above -40 dBFS in its window (with `sfxHit`, no transient 12 dB over the 100 ms before it). |

## 6. Writing a good board
- One beat per idea, and one idea per beat. A beat is a unit the person can approve or cut on its own.
- Put the exact on-screen words in `on`, as they will be drawn: `check` matches them case-insensitively across the
  beat's text, in reading order, so words that appear one at a time still match.
- Write the sound note even for quiet beats; `sfx: null` says the silence is on purpose.
- A hook beat with `hookMax` makes the hook a measured promise: `tools/cues.mjs` refuses a take that breaks it.
- End cards get `hold: true` and no exit.
- Write voice lines the way they will be spoken: the anchors are matched against the take's words.
- The examples have boards to copy: `examples/explainer-beat/board.js` (voiced, a hook gate, a `gapBefore`, an end
  card), `examples/lower-third/board.js` (silent, an overlay, sound off on purpose) and `examples/showreel/board.js`
  (silent sections that mirror a music-locked timeline).
