# check: what it measures, its thresholds, and how to silence it on purpose

```sh
node render.mjs check                                    # the source: the piece as it is now
node render.mjs check --file out/<name>-final.mp4        # plus the master tools/mix.mjs wrote
node render.mjs check --target tiktok-ad                 # text against that target's safe area (default: BOARD.target)
node render.mjs check --file clip.mp4 --plain --lufs -14 # a file made elsewhere, as a plain file
```
It runs every check it can, says which it could not run and why (`skip`), prints one line per result, and exits 1 on
any FAIL. `--strict` fails on a WARN too, `--json` prints the results as JSON
(`{id, scope, level, t?, detail, measured, threshold}`), `--only id,id` runs just those checks, and `--dump <file>`
writes the raw measurements (numbers only, no on-screen text or params) for tuning on your own pieces. Exit 2 is a
usage error.

A FAIL is a fact about the file: the wrong master, the wrong loudness, a late hook, text outside a measured safe
area. A WARN is craft, or anything measured against an estimate: read it, then fix it or keep it on purpose.

## Contents
1. Source checks
2. Artifact checks (`--file`)
3. Overlays, and files from elsewhere
4. Thresholds and the measurements that set them
5. Blind spots: when to look and listen yourself
6. The examples' results

## 1. Source checks
Run on the piece as it is now, at half size with one subframe and grain off (the probe), and on the scene's text
boxes at every subframe time the render uses.

| Check | Level | Rule | To silence it on purpose |
|---|---|---|---|
| `fonts` | FAIL | Every family in `CFG.FONTS` loads. | Nothing: declare the face in `index.html`, put the file in `fonts/`. |
| `board_order` | FAIL | Beat windows are contiguous and in order, and `CFG.DUR` equals `boardDur()` within one frame. | Nothing: set `CFG.DUR = boardDur()`. |
| `hook_long` | FAIL | With `hookMax` on the board: `VO_OFFSET + HOOK_END` is no later than `hookMax`. On a voiced master, the voice delay the mix applied must also equal `VO_OFFSET`. | Drop `hookMax` from the board (then it is not checked). |
| `board_copy_missing` | WARN | A string in a beat's `on` never appears in that beat's window. The texts of each `group` seen anywhere in the window are joined in order of first appearance (one entry per box id), and the string is searched in that text, case-insensitive, spaces collapsed. Needs `boxes(t)`. | Take the string out of `on`, or draw it. |
| `board_copy_unread` | WARN | A string in `on` is found for less than `max(1.0, 0.25 x words)` seconds in total. | Hold it longer, or take it out of `on`. |
| `board_sfx_missing` | WARN | A beat with an `sfx` note has no 50 ms window above -40 dBFS RMS in the effects stem inside its window. With `sfxHit: true`: no 10 ms window more than 12 dB over the 100 ms before it (and above -40 dBFS). | `sfx: null` on the beat: silence on purpose, never checked. |
| `motion_dead` | WARN | A heuristic. A frame pair moves when at least 4 probe pixels change by 2/255 or more in luma; a run of 3.0 s or more with no moving pair, outside holds, is flagged. | `export const HOLDS = [[t0, t1]]` in the scene, or `hold: true` on the beat. |
| `first_frame_empty` | WARN | The first frame's luma standard deviation is under 4/255: a flat frame, a blank thumbnail. Skipped for alpha renders. | Nothing to switch off: open on content, or keep the WARN (it does not fail without `--strict`). |
| `text_safe` | FAIL, or WARN on an estimate | Each text box, mapped through the camera `frame(t)` returns at every subframe sample, is outside the safe area (or inside an `exclude` rectangle). More than 0.25 s of exposure in one beat is a FAIL on a measured target; less (a slam, a whip) is a WARN. On an estimate target it is always a WARN. Needs `boxes(t)`. | `deco: true` on a box that is decoration, not reading text. |
| `text_overlap` | WARN | Two boxes from different groups overlap by more than 2% of the smaller one's area, at the same sample. | Put text that is meant to touch in one `group`, or mark decoration `deco: true`. |
| `audio_spike` | WARN | The loudest 50 ms window of the effects stem peaks more than 18 dB above the 90th percentile of the windows that are not silent (peak above -60 dBFS): a click, or a gain envelope that starts after its source. | Fix the envelope (`envGain` in `audio.js` starts at 0 for this reason); section 5 has its blind spot. |

`boxes(t)` is the scene's list of the text on screen at `t`: `[{ id, text, x, y, w, h, group?, deco? }]`, one box per
drawn run of text, in design pixels before the camera, cut to any clip mask, and only while the text's alpha is
above 0.05 (the template's `scene.js` header). `captions(..., { draw: false })` returns the captions' boxes. Without
`boxes(t)` the four text checks say "not checked".

## 2. Artifact checks (`--file`)
A master is only as good as the source it came from, so these first prove which source that was.

| Check | Level | Rule |
|---|---|---|
| `provenance` | FAIL | `out/<name>.master.json` exists; the SHA-256 of the whole file equals the master hash it records (so any other mix of the same picture fails); the render record it names exists and matches its recorded hash; the piece's source hash now equals the record's (otherwise the master is stale: re-render); the decoded video of the master equals the render's (the mixer copied the picture untouched); and the effects stem it mixed matches a render of this source. Only then do the source checks run, replaying the render's scene, params, fps, subframes and alpha mode from its record rather than the command line. |
| `file_spec` | FAIL | ffprobe: width, height, fps and pixel format match the render record; the frame count equals `round(DUR x FPS)`; the duration matches within one frame; an audio stream exists unless the scene is `silent`. |
| `faststart` | WARN | In an `.mp4`, the `moov` atom comes before `mdat`, so playback starts before the download ends. |
| `loudness` | FAIL | Integrated loudness within 1 LU of the target `master.json` records (or `--lufs`), and true peak at or under -1.0 dBTP (or `--tp`). Without either, not checked. |
| `vo_delay` | FAIL | A voiced master's voice delay equals `cues.js`'s `VO_OFFSET`. `--master-only` and `--sting` masters skip it. |

The source hash covers every file in the piece except `out/`, `stills/`, `node_modules/`, the review sheets and
render records. Any edit after the render (a scene, a board, `cues.js`, a font) makes the master stale; re-render
and re-mix.

## 3. Overlays, and files from elsewhere
`provenance` needs a `master.json`, and only `tools/mix.mjs` writes one. A render that is not mixed has none:

- **Alpha overlays** (a lower third, a caption track, a transparent end card): check the source as an overlay, and
  the file as a plain file. This is the route the `lower-third` example uses:
  ```sh
  node render.mjs check --alpha                                       # the source; first_frame_empty is skipped for an overlay
  node render.mjs check --file out/lower-third.mov --plain --alpha    # ProRes 4444: size, fps, frame count, pixel format
  node render.mjs check --file out/lower-third.webm --plain --alpha webm
  ```
  Without `--alpha` on the source check, the probe sees the scene over its non-alpha backdrop, and an overlay whose
  first frame is meant to be clear warns as a blank thumbnail. With `--plain`, `file_spec` compares the file with the
  piece's current settings (`--scale`, `--alpha`), so pass the same flags the render used; `loudness` runs only
  with `--lufs`.
- **A file made elsewhere** (an export from an editor, a re-encode): `--plain` checks it as a plain file
  (`file_spec` against the piece's settings, `faststart`, and `loudness` with `--lufs`).
- **An overlay with sound** that someone else will cut into their edit: master it with `tools/mix.mjs <name> --sting`
  (which needs an `.mp4` picture), then `check --file` binds it like any master.

## 4. Thresholds and the measurements that set them
The thresholds are `T` at the top of `check.mjs`, and `test/mutations.mjs` in this skill's repository breaks each one
on purpose to prove a test notices.

| Threshold | Value | What set it |
|---|---|---|
| motion: a pixel moves | 2/255 luma or more | With grain off and one subframe, a held frame repeats exactly: on the check fixture a 4 s freeze changed 0 probe pixels in every pair, with grain 0.05 on in the scene (P3, Apple-silicon Mac, 2026-11-14). Any change at all is real. |
| motion: a pair moves | 4 probe pixels or more | The fixture's smallest clean mover, a 10 px dot moving 1 px a frame, changes 10 to 20 probe pixels a pair, each by 8 levels or more; a drift at 9 px a second changes 512 to 868 (P3). |
| motion: a dead run | 3.0 s | The plan's starting value; no clean piece measured has a still run that long outside a hold. |
| first frame | luma std under 4/255 | The plan's value. Measured (P4): the template's first frame 4.7 after P4 gave it corner marks (3.4 before, which warned), the explainer's 12.6, the showreel's 0 (it opens on black, on purpose). |
| text: FAIL exposure | 0.25 s in one beat | A slam entrance on the fixture leaves the safe area for 0.03 s, which stays a WARN (P3). |
| text overlap | 2% of the smaller box | The plan's value; captions in one group never trip it. |
| copy readable | max(1.0 s, 0.25 s a word) | The craft rule (hold text about 0.25 s a word, a title at least 1 s). |
| sound present | 50 ms above -40 dBFS RMS | The plan's value. |
| a hit | 10 ms more than 12 dB over the 100 ms before it | The plan's value; a sustained sound fails it, a click passes. |
| spike | 18 dB over the 90th percentile of the non-silent 50 ms windows | Tuned in P3: silence is left out of the percentile, because a stem with sound in under a tenth of its windows otherwise compared every sound with silence. Measured: the check fixture's effects 7.9 dB, the template's 11.9 dB (P3); the explainer's 14.1 dB and the showreel's 2.8 dB (P4). |
| loudness | within 1 LU; true peak at or under -1.0 dBTP | AAC adds about 0.5 dB of true peak, which is why the mixer aims at -2.0 dBTP (-3.0 for stings). |
| captions | lines fill the safe width / 1.165 | 1.165 is the largest scale a popped word reaches (`anticip` dips below 0 before it settles), so a popped word at the end of a full line stays inside (P3). |

The organic safe zones (`tiktok`, `reels`, `shorts`) are estimates, so `text_safe` only warns on them; the ad
zones are measured from the platforms' templates and fail. `references/delivery.md` section 1 has the numbers,
`safezones.json` their sources.

## 5. Blind spots: when to look and listen yourself
- **`audio_spike` misses a lone click in an otherwise silent stem.** Silence is left out of the 90th percentile, so
  when the effects stem is silent except for one sound, that sound is the whole percentile and nothing stands above
  it: a click at the start of the only whoosh in a sting, or a single tick on an overlay, is not flagged. Listen to
  the effects stem on headphones (`node render.mjs audio --out out/fx.wav`) whenever it holds only one or two
  sounds, after changing an envelope, and before mastering a sting.
- **`motion_dead` is a heuristic.** It sees change, not meaning: a looping shimmer keeps a dead stretch "alive".
  Read the contact sheet.
- **Text checks see only what `boxes(t)` reports.** Text drawn without a box is invisible to them, and a box that
  does not follow its text's clip or scale reports the wrong place. Keep one function that gives both the drawing
  and the box (the template's `wordAt()`, the explainer's `headline()`).
- **`board_copy_missing` reads text, not legibility**: white on white passes. Look at the board sheet.
- **`vo_delay` and `hook_long` trust the mix's recorded delay**; a `VO_OFFSET` past the end of the picture passes
  and plays no voice (`references/voice.md`, section 10). Listen to every master once.
- **Loudness is not balance.** `loudness` passes a master whose bed drowns the voice. Listen.

## 6. The examples' results
Measured on an Apple-silicon Mac with Chrome 157 and ffmpeg 9 (2026-11-14), on the masters each example's README
names:

| Example | `check` (source) | `check --file` | Kept on purpose |
|---|---|---|---|
| `explainer-beat` | 11 ok, 0 WARN | 16 ok, 0 WARN | none |
| `lower-third` (`--alpha`) | 7 ok, 4 not checked (silent, no hook, an overlay's first frame) | `.mov` and `.webm` with `--plain --alpha`: `file_spec` ok | none |
| `showreel` | 0 FAIL, 1 WARN, 5 not checked | 0 FAIL, 1 WARN | `first_frame_empty`: the reel fades up from black, as a reel does. It has no `boxes(t)`, so its four text checks and `hook_long` say "not checked". |

The template itself, copied fresh, reports 0 FAIL and 0 WARN on `tiktok` and on `tiktok-ad`. CI runs every source
check except the two probe checks on all three examples on macOS and Linux; the probe checks and the masters run on
a Mac before a release.
