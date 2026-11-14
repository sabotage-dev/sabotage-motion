# sabotage-motion

Motion graphics for short-form video, written in code by your coding agent.

A Claude Code skill. The agent writes a scene as a pure function of time, `frame(t)`, drawn with Canvas2D over an
optional WebGL2 pass (bloom, grain, shader backgrounds, real motion blur). Headless Chrome renders every frame
exactly and pipes it to ffmpeg. Sound effects are synthesized in code on the same timeline, so they land on the
frame. No React, no framework, no render service: Node, Chrome and ffmpeg.

Planned for v1 (the storyboard, voice-driven timing and captions are built; mix and master and footage are built and in review):

- **Storyboard.** One `board.js` per piece: each beat's voice line, on-screen copy, visual note and sound cue. A
  board sheet shows a panel per beat, first as slates and then as real frames, and a slate scene gives you an
  animatic with the real voice before anything is animated.
- **Voice-driven timing.** Word or character timings from a TTS take or a transcript become cue points, so cuts
  land on the words. A hook-length check is optional.
- **Captions.** Word-by-word captions from the same timings.
- **Mix and master.** Voice, an optional music bed ducked under it, and the synthesized effects, mastered to
  -14 LUFS for social.
- **Footage.** Screen recordings and clips as frame sequences, so they stay frame-exact.
- **`check`.** Measured checks before you post: size, fps and frame count, loudness and true peak, stretches where
  nothing moves, an empty first frame, and text outside the platform's safe zones.
- **Transparent output.** ProRes 4444 or WebM with alpha, for overlays on other footage.

## Status

Early build, not ready for use yet. The v1 build plan is [docs/PLAN.md](docs/PLAN.md). Phase P0 is in place: the
engine template with bundled open-licence fonts, `--scene` and `--target`, a `render.json` record after every
video render, `doctor`, and CI on macOS and Linux. Phase P1 is merged (PR #2): the storyboard (`board.js`, the board
sheet, the slate scene), voice-driven timing (`tools/cues.mjs`, with the hook gate), the optional ElevenLabs voice
tool, and captions. Phase P2 is in review: mix and master (`tools/mix.mjs`) and footage (`tools/frames.mjs`,
`loadSeq` and `seqAt`). `check` comes in P3, and the skill text (SKILL.md is a stub for now) in P4.

## Storyboard and voice (P1)

Each piece has a `board.js`: its beats in order, each with a voice line (`vo`) or a length (`dur`), the
on-screen copy, a visual note and a sound note. The scene builds its timeline from it (`beatWindow(id)`,
`beatAt(t)`, `CFG.DUR = boardDur()` in `lib.js`), so the board is the one place timing lives. Run these in the
piece's folder:

```sh
node render.mjs board --slates              # board.png and board.md: a placeholder card per beat, estimated timing
node tools/voice-elevenlabs.mjs --model eleven_v4   # optional: voice the board in one take (take-raw.wav, take.json)
node tools/cues.mjs                         # cues.js, cues.json and vo.wav from take.json and take-raw.wav
node tools/cues.mjs --from whisper read.json --audio read.wav   # or: a human read, transcribed with openai-whisper
node render.mjs video --scene slate.js --out out/animatic.mp4   # the animatic's picture, timed by the take
node render.mjs board                       # the board sheet again, with the real scene and the take's timing
```

- **Timing sources.** `tools/cues.mjs` reads ElevenLabs' with-timestamps response (`--from elevenlabs`),
  openai-whisper's JSON written with `--word_timestamps True` (`--from whisper`), or a generic
  `{ words: [{ text, start, end }] }` file (`--from words`, the default) that any other tool can produce.
- **Cues.** Each voiced beat is cued where its anchor phrase starts (by default the line's first four words).
  `cues.js` holds those cues in seconds into `vo.wav`, plus `VO_OFFSET`, the picture time where the voice starts;
  the board helpers and captions add it once, so a scene never does.
- **Silences.** `gapBefore: 0.6` on a beat opens that much silence before its anchor, at the quietest point of the
  pause, and is refused where the cut would split speech. Silent beats between voiced ones get the same amount of
  silence spliced into the voice, so the picture and the voice stay in step.
- **Delivery tags.** `[curious]`, `[short pause]`, `[chuckles]` and the like in a `vo` line go to the TTS as
  written, but are never words, anchors or captions. Their sound belongs to the line they are written in.
- **Hook gate.** With `hookMax: 4.0` on the board, `tools/cues.mjs` refuses a take whose hook line ends after
  4.0 s of picture time, and says by how much.
- **Refusals write nothing.** A missing anchor, a gap that would split speech, a late hook, an `--offset` that
  would put the voice over the leading silent beats, or two anchors too close together stop the tool before it
  writes a file, so a bad take never replaces a good `cues.js`.
- **Captions.** `captions(ctx, CUES.WORDS, t, { safe: target.safe })` draws word-by-word captions inside the
  safe area, one group of lines at a time, the spoken word popped in the accent colour, and returns their text
  boxes.
- **ElevenLabs.** `tools/voice-elevenlabs.mjs` reads `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` from the
  environment or `--env-file`, sends no voice settings unless you pass `--voice-settings`, writes the audio
  before anything else so a later error never wastes the credits, and prints the character cost. It has no
  default model: the current one that reads delivery tags is `eleven_v4` (ElevenLabs' docs, checked
  2026-11-13).

## Mix, master and footage (P2, in review)

`tools/mix.mjs` puts the sound under a rendered picture and masters it for social. Run it in the piece's
folder after `node render.mjs full --out out/<name>.mp4` (which also writes the effects as `out/<name>.wav`):

```sh
node tools/mix.mjs piece                             # voice (vo.wav), bed.mp3 if there is one, effects: -14 LUFS
node tools/mix.mjs piece --bed music.mp3 --bed-skip 1.2 --bed-at cue:save --mute 6.0-7.5
node tools/mix.mjs animatic --no-bed --no-sfx        # the animatic: the slate picture and the voice alone
node tools/mix.mjs sting --sting                     # effects only, -20 LUFS, for a clip cut into another video
```

- **What it writes.** `out/<name>-final.mp4`: the picture copied untouched, the mix as AAC 256 kb/s, 48 kHz,
  `+faststart`. `out/<name>.master.json`: the mode, the loudness target, the voice delay it applied, a hash of
  every input and of the render record it read, and the master's own hashes, so `check --file` (P3) can tie the
  master to the render it came from. A refusal writes nothing and leaves the last master as it was.
- **Voice.** Measured (EBU R128) and levelled to -24 LUFS, then `--vo-gain` (3.2), and delayed by `VO_OFFSET`
  from `cues.json`. A take quieter than -50 LUFS stops the mix.
- **Bed.** `--bed-gain` (0.22); `--bed-skip` seconds cut from its start; by default it starts so its end lands on
  the last frame (at 0 when it is longer than the picture), or at `--bed-at` seconds or `cue:<beat id>`. It fades
  out where it stops (0.35 s, or 2.6 s when it is longer than the picture), is silent over each `--mute a-b`
  window (picture time, with a short ramp outside it), and ducks under the voice.
- **Effects and other stems.** `out/<name>.wav` at `--sfx-gain` (0.9), and any `--stem file:gain:delay`, such as a
  clip's own sound.
- **Modes.** Default: -14 LUFS, -2.0 dBTP. `--master-only` masters the effects alone at the same target;
  `--sting` at -20 LUFS, -3.0 dBTP. `--target-lufs` and `--tp` override. The stems are summed, limited at
  -6 dBFS, then normalized in two `loudnorm` passes.
- **Comparing mixers.** `--keep-premix` keeps the mix before normalization as `out/<name>.premix.wav`, and
  `node scripts/parity.mjs <premixA> <premixB> <masterA> <masterB>` (from this repo) compares two: their 100 ms
  levels, their lengths, and the masters' loudness and true peak. It also measures the lag between the premixes
  (within 20 ms), which must be the one you state with `--lag <ms>` (default 0). State a latency only when you
  know its cause: a limiter whose lookahead is not compensated delays its mixer's whole output by the lookahead.
  B is shifted by the stated lag before the levels are compared, so a lag nobody stated (the voice alone a few
  milliseconds late, say) misses instead of being lined up.

`tools/frames.mjs` turns a clip or screen recording into a frame sequence the scene draws frame-exact:

```sh
node tools/frames.mjs demo capture.mov --from 12.5 --dur 4 --vf "crop=1080:1080:420:0,scale=540:540"
```

It writes `assets/seq/demo/000.jpg ...` at the piece's frame rate (`round(dur x fps)` frames) and records the
sequence in `assets/seq/manifest.json`. In the scene, `await loadSeq('demo')` in `init`, then
`ctx.drawImage(seqAt('demo', t, 2.0), x, y, w, h)` draws the frame for `t` with the clip starting at 2.0 s:
the first frame before that, the last frame held at the end, or `seqAt('demo', t, 2.0, { loop: true })` to loop.
Every frame stays decoded in memory (width x height x 4 bytes), so crop and scale with `--vf` to the size the
scene draws; `frames.mjs` prints the total and warns over 1 GB. Measured on an Apple-silicon Mac with 48 GB
(Chrome 157, 2026-11-14), Chrome's memory grows by about that total: a 20 s sequence at 30 fps, 960x540
(1.16 GB decoded), added 1.24 GB and decoded in 0.5 s; at 960x1706 (3.66 GB decoded) it added 3.6 GB and decoded
in 1.2 s. Both rendered. The limit is the machine's free memory, so keep a sequence well under it, and smaller on
CI runners. The clip's sound goes in through `mix.mjs --stem` (the tool's header shows the ffmpeg line).

## Requirements

- **Node** 22 or 24.
- **Google Chrome**, or any Chrome or Chromium binary in `CHROME_PATH`. Playwright's own Chromium works too
  (`npx playwright-core install chromium`, then set `CHROME_PATH` to its binary); CI checks it on both OSes.
- **ffmpeg** and ffprobe with the `libx264`, `libvpx-vp9` and `prores_ks` encoders and the `loudnorm`, `ebur128`,
  `sidechaincompress` and `alimiter` filters (`brew install ffmpeg` on macOS; the distribution's ffmpeg on
  Ubuntu has them).
- macOS or Linux. WebGL2 runs on the GPU through Metal on macOS, and in software (SwiftShader) on Linux.

`node render.mjs doctor`, run in a piece (or `npm run doctor` in this repo), checks all of it: it finds Chrome,
opens a WebGL2 context and prints the renderer, checks each ffmpeg encoder and filter, loads every font the piece
declares, and renders one frame twice to confirm the hashes match. Each failing line says what to install.

## Render speed

Milliseconds per frame for one second (30 frames) of the template's default scene at 1080×1920 with 8
motion-blur subframes (the scene doubles them during fast moves), measured with
`node render.mjs video --to 1` (2026-11-13; the CI numbers are six measurements over three runs, Node 22 and 24,
and vary a lot with the runner):

| Machine | WebGL2 renderer | ms per frame |
|---|---|---|
| GitHub Actions `ubuntu-latest` (x64), Chrome 156 | SwiftShader (software, through ANGLE on Vulkan) | 2684 to 5960, median about 3630 |
| GitHub Actions `macos-latest` (arm64), Chrome 156 | ANGLE on Metal (paravirtual GPU) | 387 to 798, median about 555 |
| Apple M5 Pro laptop, Chrome 157 | ANGLE on Metal | 234 to 259 |

Linux works but is slow at full size: 3 to 6 s per frame, so a 15 s piece at 30 fps (450 frames) takes 20 to 45
minutes.
Use `--scale 0.5` (or less) and fewer `--sub` for drafts there. A GPU-accelerated Linux recipe is planned for v2.

## Development

```sh
npm ci
npm test                                   # every suite
npm run test:engine                        # determinism, frame count and container, alpha, scene swap, board sheet
npm run test:voice                         # cues, board timing, the ElevenLabs tool against a local fake server
npm run test:mix                           # the mixer, control by control, and the parity script
npm run test:footage                       # frame sequences: the cut, the manifest, seqAt in a render
npm run test:repo                          # leak check and asset inventory
```

The voice suites use synthetic takes only: hand-written timing files in each source's format
(`test/fixtures/takes/`) and tone or noise bursts for the audio. One live ElevenLabs smoke test calls the real
API and spends credits, so it is skipped unless you ask for it:
`SM_LIVE=elevenlabs SM_LIVE_MODEL=eleven_v4 ELEVENLABS_API_KEY=... ELEVENLABS_VOICE_ID=... node --test test/voice-live.test.mjs`.

The engine suites render `test/fixtures/fixture-clean` (a 2 s, 1080×1920 piece) and `test/fixtures/fixture-board`
(a five-beat board) at scale 0.25 in throwaway copies of the template under `test/.work/`. The mix suite renders
`test/fixtures/fixture-mix` (8 s, its effects a tick train) once and mixes synthetic stems under it: tone bursts
for a voice, seeded noise with an exact-zero marker for a bed. Each control is measured from the output audio
(sample positions and gains on the kept premix, loudness and true peak on the master). The footage suite cuts
ffmpeg-generated clips whose frames carry their own numbers, renders `test/fixtures/fixture-footage`, and reads
back which frame `seqAt` drew. `ASSETS.md` lists every binary file with its source and licence, and a test
keeps it complete.

**Leak check.** Nothing published here may contain an absolute home path or a string from the owner's denylist
(private names and ids). The denylist is never committed and is not stored on GitHub. It is a plain file on the
owner's machine, one string per line, matched case-insensitively: `~/.config/sabotage-motion/denylist.txt`, or the
file `SM_DENYLIST_FILE` names. The owner's clone runs `npm run hooks` once, which writes a pre-push hook into the
clone's own `.git/hooks` (not the working tree, so it keeps running on every checkout, and it blocks a push from a
checkout that has no `scripts/leak.mjs`, such as a branch from before the check existed). Before each push it runs
`scripts/leak.mjs`, which checks everything the push would publish that the remote does not already have (it asks the
remote with `git ls-remote`): each commit's message, author and committer, the paths new in it (merges included) and
the lines it adds; every tag object in a pushed tag's chain; the branch and tag names. It blocks the push on a hit,
and when it finds no denylist. `node scripts/leak.mjs history` checks every commit, tag and ref name in the clone. CI
checks home paths in every tracked file and tests the hook against throwaway repos. Hits are reported by entry
number, never by the entry's text; a path or ref name prints with the entry replaced by `[#N]`.

## License

MIT, copyright Sabotage Development LLC. See [LICENSE](LICENSE).
