# Delivery: sizes, encodes, overlays, compositing, loudness

## Contents
1. Sizes, frame rates and safe areas
2. Encode settings and file size
3. Transparent overlays (alpha)
4. Compositing into an existing video with ffmpeg
5. Audio: mixing, mastering, loudness
6. Footage in a piece
7. Sending previews
8. Caption a clip

## 1. Sizes, frame rates and safe areas
`--target <name>` takes the canvas size, frame rate and safe area from `safezones.json` in the piece; `CFG.W`,
`CFG.H` and `CFG.FPS` in the scene win over it. Design at the final size; use `--scale` only for quick looks.
`safezones.json` is the one source for these numbers (`check` reads the same file), with a `source` and a `measured`
date for every edge. This table is a copy for reading; a test keeps it equal to the file.

| Target | Size | fps | Safe area (design pixels) | Excluded inside it | Numbers |
|---|---|---|---|---|---|
| `tiktok` | 1080x1920 | 30 | x 44-940, y 130-1436 |  | estimate |
| `reels` | 1080x1920 | 30 | x 86-960, y 250-1600 |  | estimate |
| `shorts` | 1080x1920 | 30 | x 48-888, y 288-1540 |  | estimate |
| `tiktok-ad` | 1080x1920 | 30 | x 120-960, y 240-1260 | x 780-960, y 840-1260 | measured 2026-11-14 |
| `reels-ad` | 1080x1920 | 30 | x 65-1015, y 269-1248 |  | measured 2026-11-14 |
| `shorts-ad` | 1080x1920 | 30 | x 48-888, y 288-1248 |  | measured 2026-11-14 |
| `youtube` | 1920x1080 | 30 | x 96-1824, y 54-1026 |  | estimate |
| `square` | 1080x1080 | 30 | x 54-1026, y 54-1026 |  | estimate |
| `feed45` | 1080x1350 | 30 | x 54-1026, y 68-1282 |  | estimate |
| `web` | 1920x1080 | 30 | x 96-1824, y 54-1026 |  | estimate |
| `none` | set `CFG.W`/`CFG.H` |  | none |  |  |

- **Ad targets** (`*-ad`) are measured from each platform's published safe-zone template or spec for 9:16 ads.
  They are stricter than organic posts. `check` fails text outside them for more than 0.25 s in a beat.
- **Organic targets** (`tiktok`, `reels`, `shorts`) are researched estimates: no platform publishes an organic
  zone, so each edge comes from published third-party measurements, compared and cited in the file. The overlays
  move with the device and the caption's length, so `check` only warns on them, and the overlays say "estimate".
  Keeping text inside the ad zone is the safe choice when you are unsure.
- **Excluded rectangles** are areas the platform covers inside the safe area (TikTok's action-button column on
  `tiktok-ad`). Text over one counts as outside. `captions(..., { exclude })` and `freeSpan()` keep text beside them.
- **See them**: `node render.mjs contact --safe` and `node render.mjs board --safe` shade what is outside the safe
  area, excluded rectangles included. `contact --scale 0.333` gives a 9:16 review sheet at about phone width.
- **Refine an edge yourself**: `grid.js` is a scene that draws a labelled grid at a target's size, with lines every
  10 px and the target's current rectangle in yellow:
  `node render.mjs full --scene grid.js --target tiktok --out out/grid-tiktok.mp4`. Post it privately, screenshot
  the app over it, and read the first row or column no overlay covers. It is optional; the shipped numbers do not
  need it.
- **Website loops**: match the slot's size, 30 fps, 3 to 8 s, seamless (`t` wraps), muted and small. Export a
  poster PNG too (`node render.mjs stills <t>`).

## 2. Encode settings and file size
- Default (`render.mjs`): libx264, `-crf 17 -preset slow -maxrate 45M`, yuv420p, `+faststart`. `--crf` and `--preset`
  change them.
- Grain and noise drive the size. If a file is too big, lower `grain` before raising the CRF.
- For social uploads CRF 17 to 20 is plenty; the platforms re-encode anyway.
- Web loops: CRF 23 to 28, no audio (`-an`), and a WebM beside the MP4
  (`ffmpeg -i loop.mp4 -c:v libvpx-vp9 -b:v 0 -crf 33 -an loop.webm`).
- The frame count is exact: `round(DUR x FPS)` frames (from `--from` to `--to` for `video`). Pick a `DUR` that
  divides cleanly.

## 3. Transparent overlays (alpha)
`--alpha` renders a transparent background: the shader background is skipped, and the 2D layer and bloom keep their
coverage. Use it for captions, lower thirds, end cards or stings that go on top of footage made elsewhere.

- `--alpha` (or `--alpha prores`) writes ProRes 4444 `.mov` (straight alpha). Best for editors and for ffmpeg; big.
  ffprobe reports its pixel format as `yuva444p10le` or `yuva444p12le` depending on the ffmpeg version; both are
  right.
- `--alpha webm` writes VP9 `.webm` with alpha. Small; Chrome plays it with alpha. **When ffmpeg reads it, put
  `-c:v libvpx-vp9` before `-i`**, or the native decoder drops the alpha and the overlay covers the footage in black.
- Stills in alpha mode are transparent PNGs. A contact sheet is easier to judge without `--alpha` (the lower-third
  example draws a neutral backdrop then).
- Glows are approximated as coverage, which works for most overlays. For a pure light effect (neon over footage),
  render the glow on black without alpha and screen-blend it (section 4).
- `check` an overlay as an overlay: `node render.mjs check --alpha` for the source, and
  `node render.mjs check --file out/<name>.mov --plain --alpha` for the file (`references/check.md`).

## 4. Compositing into an existing video with ffmpeg
Each recipe below was run on the examples (ffmpeg 9, 2026-11-14): the lower third over a generated test pattern
(`testsrc2`), and over a generated clip with a tone for its sound. Overlay an alpha clip at the start:
```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=5 -i out/lower-third.mov \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" -map "[v]" -c:v libx264 -crf 18 out/composite.mp4
```
The WebM, with its decoder named before its input:
```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=5 -c:v libvpx-vp9 -i out/lower-third.webm \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" -map "[v]" -c:v libx264 -crf 18 out/composite.mp4
```
Over real footage, start the overlay at 4.5 s and show it only in its window (`base.mp4` keeps its sound):
```sh
ffmpeg -i base.mp4 -itsoffset 4.5 -i overlay.mov \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto:enable='between(t,4.5,9.5)'[v]" -map "[v]" -map '0:a?' -c:a copy out.mp4
```
Screen-blend a glow-on-black render over footage (no alpha needed):
```sh
ffmpeg -i base.mp4 -i glow.mp4 -filter_complex \
  "[0:v]format=gbrp[a];[1:v]format=gbrp[b];[a][b]blend=all_mode=screen,format=yuv420p[v]" -map "[v]" out.mp4
```
- Scale or crop the base to the overlay's size first if they differ:
  `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920`.
- In `blend` expressions over inputs with different timebases, use the frame counter `N`, not `T`.
- Quote anything zsh would expand: `-map '0:a?'` (an unquoted `?` is a glob, and zsh stops with "no matches"),
  and single-quote filter graphs that hold `[` or `$`.

## 5. Audio: mixing, mastering, loudness
`node render.mjs full` keeps the synthesized effects next to the video (`out/<name>.wav`) and muxes them in (AAC 256k
in MP4, PCM in ProRes, Opus in WebM). `tools/mix.mjs <name>` mixes and masters the final sound under the picture,
copying the picture untouched; `references/voice.md` has its options.

| Mode | Inputs | Target |
|---|---|---|
| default | the voice, an optional bed ducked under it, the effects, extra stems | -14 LUFS integrated, -2.0 dBTP |
| `--master-only` | the synthesized soundtrack alone (plus any `--stem`) | -14 LUFS, -2.0 dBTP |
| `--sting` | the synthesized soundtrack alone, for an asset cut into someone else's video | -20 LUFS, -3.0 dBTP |
| any | `--target-lufs`, `--tp` | override the mode's numbers |

- AAC adds about 0.5 dB of true peak, which is why the targets sit below the -1.0 dBTP ceiling `check` enforces.
- A sting appended to someone else's clip: match that clip's level so the cut does not jump (`--target-lufs`).
- Effects under a voice: 6 to 10 dB below it (`--sfx-gain`); the default puts a ducked bed about 17 dB under it.
- Measure any file: `ffmpeg -i out.mp4 -af ebur128=peak=true -f null -` (read `I:` and the true `Peak:` in the
  summary), or `node render.mjs check --file <file> --plain --lufs -14` for a file made elsewhere.
- End the soundtrack with a short fade (the template's `audio.js` fades the last 0.18 s) so nothing clicks at the cut.

## 6. Footage in a piece
`node tools/frames.mjs <name> <src> --from s --dur s --vf "<filter>"` cuts a clip or screen recording into
`assets/seq/<name>/` at the piece's frame rate; the scene draws it with `seqAt(name, t, t0)` (`lib.js`). Every frame
stays decoded in memory (width x height x 4 bytes), so **crop and scale in `--vf` to the size the scene draws**:
measured on an Apple-silicon Mac, a 20 s sequence at 960x540 added about 1.2 GB to Chrome, at 960x1706 about 3.6 GB.
The tool prints the total and warns over 1 GB. The clip's own sound goes into the mix with `mix.mjs --stem`.

## 7. Sending previews
- If the person's chat tool limits attachment size, send a preview encode and keep the master on disk with its
  path: `ffmpeg -i out/<name>-final.mp4 -c:v libx264 -crf 26 -vf scale=-2:1280 -c:a aac -b:a 128k preview.mp4`.
- For review, a contact sheet (`node render.mjs contact`), the board sheet (`node render.mjs board`) and two or
  three stills are often faster for the person than a video, and they are what you should look at yourself before
  rendering the full thing.

## 8. Caption a clip
A clip with speech the person brings (a talking head, a screen recording with narration) comes back with word-by-word
captions inside the platform's safe area, its own sound levelled and mastered, checked like any other piece. The clip
is never redrawn as a frame sequence: the captions render with alpha on the clip's clock, ffmpeg lays them over the
clip, and the mixer masters the clip's sound under that picture. Start from a fresh copy of the template:

```sh
node tools/clip.mjs probe talk.mov                                   # size after rotation, frame rate, frames, length, sound
node tools/clip.mjs prepare talk.mov --transcript talk.srt --board   # writes the files below
node render.mjs check --scene caption.js --alpha                     # the captions as an overlay
node render.mjs video --scene caption.js --alpha --out out/talk.mov  # the captions, transparent, on the clip's clock
node tools/clip.mjs composite talk                                   # out/talk.mp4 (opaque yuv420p) and its render record
node tools/mix.mjs talk --no-sfx                                     # vo.wav (the clip's sound) as the voice, -14 LUFS
node render.mjs check --file out/talk-final.mp4                      # the master
```

- **What `prepare` writes**: the clip in the piece (`clip.<ext>`); `clip.js` (`CLIP`: the display size after rotation,
  the constant frame rate, the frame count and the length, frames / fps); `vo.wav`, the clip's sound from its first
  video frame to its last; `cues.js` and `cues.json`, the transcript's words at the clip's own times (`VO_OFFSET` 0, no
  gaps: it does not go through `tools/cues.mjs`); and with `--board` a `board.js` of one silent beat the clip's length,
  so the board adds no lead or tail. Its target comes from `--target`, else the clip's shape (9:16 `tiktok`, 16:9
  `youtube`, 1:1 `square`, 4:5 `feed45`, else `none`). Without `--board`, the piece's board must already be that one beat.
- **The transcript**: whisper.cpp's JSON when `whisper-cli` is installed (`node render.mjs doctor` reports it; it is
  optional): `ffmpeg -i talk.mov -ar 16000 -ac 1 talk.wav`, then `whisper-cli -m <model> -f talk.wav -oj -ml 1 -sow`
  (one word a segment), or `-ojf` (token times). Without it, ask the person for a transcript: openai-whisper's JSON,
  SRT, WebVTT or the generic words format. **SRT and WebVTT carry phrase times only**: each phrase's words are spread
  over it by their length and marked estimated (`est: true` in `cues.js`), and `prepare` says how many; tell the person
  a word may light up a little early or late.
- **A variable frame rate clip** (phones record them) is converted to a constant rate first: its average rate, rounded
  to the nearest of 23.976, 24, 25, 29.97, 30, 50, 59.94 and 60, written as `clip.mp4`. `prepare` prints it; tell the
  person the master is at that rate.
- **The style**: `caption.js` draws the captions with the `captions` helper in one of four styles: `pop` (the spoken
  word pops in the accent), `karaoke` (the accent wipes across each word as it is said), `boxed` (each line on a dark
  box), `minimal` (smaller type, a soft shadow, no highlight). `--param style=<name>` picks one, or the board's
  `captionStyle`; else the energy's default (`--param energy=subtle|normal|extreme`, or `CFG.ENERGY`: `minimal`, `pop`,
  `karaoke`; normal by default). `--param emphasis=word,word` (or the board's `emphasis`) marks words in `accent2`
  with a bar under them. The styles have no sound, so the mix is `--no-sfx`.
- **Safe zones**: a clip of its target's shape but another size (a 720x1280 phone clip on `tiktok`) gets the target's
  zones scaled to it, in the scene and in `check`. A clip of any other shape (a 4:3 clip on a 9:16 target) has
  `text_safe` reported as not checked: say so, or pick a target of its shape with `--target`.
- **Every `render.mjs` command in the piece names the scene**, `--scene caption.js` (`doctor` too): the template's
  `scene.js`, the title card, reads beats a clip's board does not have.
- **`composite`** refuses an overlay whose record is missing or does not match it, is not alpha, is not on the clip's
  clock (fps, frames, size at scale 1) or was rendered from another source (a stale overlay: render it again), a clip
  that changed since `prepare`, and a `vo.wav` that is not the clip's sound. Its record has `kind: "composite"` and
  names the overlay's record and the clip by SHA-256, so `check --file` binds the master to both
  (`references/check.md` section 3).
- The `caption-clip` example runs this on a clip made in code.
