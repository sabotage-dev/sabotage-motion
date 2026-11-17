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

The colour match against a brand kit is its own mode, `node render.mjs palette`, on the same probe frames (in colour):
`references/looks.md` section 7. A look's or a kit's font that is not in the piece is a `fonts` FAIL here.

## Contents
1. Source checks
2. Artifact checks (`--file`)
3. Overlays, and files from elsewhere
4. Thresholds and the measurements that set them
5. Blind spots: when to look and listen yourself
6. The examples' results
7. Flashes: `flash`

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
| `flash` | FAIL | Run on the piece's current render: the newest `video` or `full` render in `out/` of the whole piece, with the scene, params and frame rate being checked, whose render record still matches the file and the source. Something flashes more than three times a second over too large an area (section 7). With no such render (none yet, only part of the piece, or the source changed since), it is not checked and says to render. An `--alpha` check is not checked: an overlay's flashes depend on what it is laid over. | Nothing: keep it to three flashes a second or fewer, make the flashing area smaller, or lower its contrast. |

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
| `flash` | FAIL | The rule of section 7 on the file itself, decoded, whatever its provenance (with `--plain` too): what is delivered is what is measured. A file with alpha (an alpha pixel format, or a VP9 stream tagged `alpha_mode=1`, which ffprobe reports as plain `yuv420p`) is an overlay and is not checked, with `--plain` too. |

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
  (`file_spec` against the piece's settings, `faststart`, and `loudness` with `--lufs`). Run it in the piece the
  file was cut from, or one with the same size, frame rate and length: `file_spec` compares the file with the scene
  in the folder you run it in, and fails a 75 s export checked from the 3 s template.
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
| flash: a transition | General: 0.1 of relative luminance from the pixel's last turning point, the darker end under 0.80. Red: more than 0.2 in CIE 1976 u'v' back from the far end of the swing, one end a saturated red (R/(R+G+B) of 0.8 or more on linear RGB) | WCAG 2.3.1's definitions of a general flash and a red flash, applied to each pixel (section 7). |
| flash: too fast | more than 7 transitions of one kind (four complete flashes) in a half-open second | WCAG 2.3.1: no more than three flashes in any one-second period. Counted on each frame's presentation timestamp in exact integer ticks of the stream's time base, so 29.97 fps is 30000/1001, never 30, and a variable-rate file is dated by when its frames are shown. |
| flash: area | more than 21,824 px of a 341x256 window, either way round, at 1024 px on the longer side | WCAG's area: a 341x256 px rectangle at 1024x768 stands for 10 degrees of the visual field, and a flash may cover a quarter of it (21,824 px). A phone is held either way, so the window is tried both ways; a frame smaller than the window clips it. |
| captions | lines fill the safe width / 1.165; between words, a space or the pop's growth plus half a space and the stroke, whichever is larger | 1.165 is the largest scale a popped word reaches (`anticip` dips below 0 before it settles), so a popped word at the end of a full line stays inside (P3). A popped long word used to touch its neighbours, and a word wider than the line was drawn whole, past the safe edge or into an `exclude` rectangle; both are fixed (P4, council round 1): the gap grows beside long words, and an oversized word is scaled to fit the line. |

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
- **`flash` is a safety net, not a certified test** (section 7). It also needs a picture: without `--file` it reads
  the newest current render in `out/`, so render the whole piece before you trust a source check's `flash` line.

## 6. The examples' results
Measured on an Apple-silicon Mac with Chrome 157 and ffmpeg 9 (2026-11-17), on fresh renders and masters made the way
each example's README names them:

| Example | `check` (source) | `check --file` | Kept on purpose |
|---|---|---|---|
| `explainer-beat` | 12 ok, 0 WARN | 17 ok, 0 WARN | none |
| `lower-third` (`--alpha`) | 7 ok, 5 not checked (silent, no hook, an overlay's first frame and its flashes) | `.mov` and `.webm` with `--plain --alpha`: `file_spec` ok, `flash` not checked (an overlay) | none |
| `showreel` | 1 FAIL, 1 WARN, 5 not checked | 1 FAIL, 1 WARN | `first_frame_empty`: the reel fades up from black, as a reel does. It has no `boxes(t)`, so its four text checks say "not checked"; its board sets no `hookMax`, so `hook_long` is not checked either. Not kept on purpose, and re-cut in P11b: `flash` FAILs in four stretches (the inverting frame and its slices at 3.7-4.6 s, the particle burst at 6.3-8.9 s, the liquid at 10.0-10.9 s, and the quarter-second montage cuts into the lockup's flash at 14.1-16.7 s), up to 87,296 px of a window, general. |
| `terminal-demo` | 11 ok, 0 WARN, 1 not checked (no `hookMax`) | 15 ok, 0 WARN, 2 not checked (no `hookMax`, no voice) | none |
| `repo-launch` | 11 ok, 0 WARN, 1 not checked (no `hookMax`) | 15 ok, 0 WARN, 2 not checked (no `hookMax`, no voice) | none |

The template itself, copied fresh, reports 0 FAIL and 0 WARN on `tiktok` and on `tiktok-ad` (`flash` is not checked
until it is rendered). CI runs every source check except the two probe checks and `flash` on the examples on macOS
and Linux; the probe checks, `flash` and the masters run on a Mac before a release.

## 7. Flashes: `flash`
`flash` is a safety net modelled on WCAG 2.3.1 (three flashes or below threshold). It is not a certified
photosensitivity test: a piece made for broadcast still goes through a certified tool (a Harding-type test) before it
airs.

It reads the delivered picture: every frame of the file, decoded by ffmpeg, scaled so its longer side is 1024 px (area
averaging down, bilinear up), as RGB. So it sees what a viewer sees, motion blur and grain included, at every energy
and look, and it sees a flash that lands between the probe's samples (the probe draws one subframe a frame; the render
blurs them all).

- **Rotation**: a file with a display rotation is measured as displayed. ffmpeg turns each frame upright, and a
  rotation of 90 or 270 degrees swaps the width and height before the picture is scaled.
- **Variable frame rate**: each frame is dated by its own presentation timestamp in the stream's time base, never by
  one probed rate, so a file whose frames come unevenly is judged by when they are shown.
- **Alpha**: a file with alpha (an alpha pixel format, or a VP9 stream tagged `alpha_mode=1`, which ffprobe reports
  as plain `yuv420p`) is an overlay, and is not checked: what it flashes depends on the video it is laid over.

- **Every pixel on its own**, never an average: an average hides a pattern whose halves swap, spreads a small
  flashing spot over a whole cell, and softens a real flash near the threshold below it.
- **A general transition**: the pixel's relative luminance (linearised sRGB, as WCAG defines it) has moved 0.1 or more
  from its last turning point, the opposite way to its last transition, with the darker of the two under 0.80. Smaller
  wobbles (grain, dithering, a stepped ramp) never end a transition, so a fade up and down counts as fully as a cut,
  and a flicker between two bright levels (0.85 and 1.0) never counts.
- **A red transition**, on chromaticity (CIE 1976 u'v'): the far end of a swing is the colour farthest from the end
  the swing left, and a transition is the colour coming back more than 0.2 from that far end, into a saturated red or
  out of one (R/(R+G+B) of 0.8 or more on linear RGB, not the stored values), opposite to the last. A fade between red
  and another colour counts as fully as a cut, and no earlier colour anchors it.
- **Too fast**: more than seven transitions of one kind (four complete flashes) dated within a half-open second
  (t - 1 s, t], compared in exact integer ticks of the stream's time base. Three flashes and then a lasting change (seven transitions)
  pass, as WCAG passes them.
- **The area**: at each frame, every pixel flashing too fast counts, whether or not it changes at that frame, so a
  strobe split across columns or a band sweeping the frame is seen whole. A frame fails when one kind's too-fast
  pixels cover more than 21,824 px of some 341x256 window, either way round. General and red are counted separately.
- **On purpose, the cautious side** (plan Q24 and Q25, kept by the owner on 2026-11-16: three flashes a second or
  fewer are fine): WCAG's exception for fine, balanced patterns is not applied, so a checkerboard or full-range noise
  that inverts every frame fails; and a small shape that repeats its path more than three times a second makes its
  whole path flash too fast. A false FAIL costs a change to the piece; a missed strobe costs a viewer.
- **Cuts count.** Cuts between dark and light shots are a flash sequence: eight such cuts within a second fail like
  any strobe.

The result names the first frame over the limit (its time, the window and its area, general or red), how many frames
are over it and the last one. An OK line names the largest too-fast area it saw. Measured on an Apple-silicon Mac
(2026-11-17): 6 s for a 15 s, 1080x1920, 30 fps master; 22 s for a 20 s, 1920x1080, 60 fps one.

What the tests hold it to (`test/flash-units.test.mjs`, frames built in code): it fails four general flashes in a
second, four red ones between a saturated red and a purple 0.22 apart in u'v' with less than 0.1 of luminance between
them (cut, faded through a middle colour, and as a ramp), a strobe reversing every frame (with or without a
counter-moving pixel in every 4x4 block), a 4 Hz ramp of 0.04 a frame (with small reversals or grain-sized noise),
fine checkerboards and noise inverting every frame, a band sweeping the frame four times a second, a 65x341 px
rectangle and a 341x65 px strip flashing four times a second, and eight transitions in 0.968 s at 29.97 fps. It passes
three flashes a second (cut, faded, or ramped), four 7-frame pulses spanning 1.03 s, eight transitions over 1.001 s at
29.97 fps, 8 px halves swapping four times a second, a 6x6 px spot flashing in every 16x16 cell, a bar crossing the
frame once, swings of 0.08, a slow fade, and grain.
