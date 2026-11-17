---
name: sabotage-motion
description: Make motion-graphics videos in code. Kinetic typography, title and end cards, logo stings and reveals, animated captions and lower thirds, word-by-word captions on a clip with speech, transparent overlays for existing footage, product and app promo animations, launch videos for a code repo, data and counter animations, and synthesized sound effects synced to the picture, with an optional voice-over timed word by word, a music bed, and a master for social. A scene is a pure function of time, drawn with Canvas2D over an optional WebGL2 pass and rendered frame-exact to MP4, MOV or WebM through headless Chrome and ffmpeg, then measured before it ships (safe zones, loudness, frame count, dead stretches). Use it whenever someone wants an animated video asset, a sting, an intro or outro, an end card, animated text over a clip, a storyboarded explainer, a short vertical social clip (9:16) or a website loop whose content is graphics and type rather than filmed people. Not for photoreal people or scenes (that is a generative video model), and not for animating UI inside an app (that is CSS or JS).
---

# sabotage-motion

Every frame is a pure function of time `t`, drawn with Canvas2D (type, shapes, images) over an optional WebGL2
background shader. Each frame averages several subframes for real motion blur, runs through bloom and a post
chain, is read back from headless Chrome and piped into ffmpeg. Sound effects are synthesized in the browser from
the same timeline, so they land on the frame. Any frame renders on its own, which is what makes stills, contact
sheets and board sheets cheap to review.

A piece is a folder: a copy of `template/` plus its own scene, storyboard, sound and assets. Every piece keeps
the engine it was made with, so it re-renders the same way after the skill updates.

**Not for:** photoreal people, faces or filmed-looking scenes (make those with a video model, then lay this
engine's overlays on top), or animating UI inside a web app.

## Quick start

```sh
cp -R "${CLAUDE_SKILL_DIR}/template" motion/<piece>
chmod -R u+w motion/<piece>                   # cp keeps the source's modes: a read-only install copies read-only
cd motion/<piece> && npm install              # playwright-core; it drives the installed Google Chrome
node render.mjs doctor                        # Chrome, WebGL2, ffmpeg, fonts: says what to install if anything is missing
node render.mjs contact --param "title=Hello there"   # 12 frames of the whole timeline in contact.png
node render.mjs stills 0.4,1.2,2.6            # style frames in stills/
node render.mjs check                         # measured checks on the source
node render.mjs full --out out/<piece>.mp4    # the video with its synthesized sound
```

Out of the box it is a 3 s, 1080x1920 kinetic title card that passes `check`. `--param look=<name>` (one of eight
looks: `product`, `neon`, `paper`, `editorial`, `retro-crt`, `brutalist`, `gradient`, `mono`), the colour tokens
`bgA`, `bgB`, `ink`, `muted`, `accent`, `accent2` (`=#hex`), `bg=<shader id>` (`none`, `gradient`, `paper`, `grid`,
`crt`, `mesh`; never a colour), `title=...` and `sub=...` show how far parameters go before you write code. `--alpha`
renders a transparent ProRes 4444 `.mov` (or `--alpha webm`) to lay over other footage. `--target <name>` sets the
size, frame rate and safe area from `safezones.json`. On an Apple-silicon Mac a frame takes about 0.25 s at
1080x1920 with 8 subframes; on Linux (software WebGL) 3 to 6 s, so draft at `--scale 0.5` there.

## Files in a piece

| File | Role | Edit? |
|---|---|---|
| `scene.js` | `CFG` (size, fps, duration, fonts), `TL` timeline, `init`, `frame(t)`, `post(t)`, optional `subBoost(t)`, `drawHud(t)`, `boxes(t)`, `HOLDS` | Yes: this is the piece |
| `board.js` | The storyboard: beats with voice lines, on-screen copy, visual and sound notes | Yes, first |
| `audio.js` | Synthesized sound effects scheduled from the scene's `TL`, in the style's timbre | Yes |
| `brand.json` | The project's brand kit, copied in with every file it names: colour tokens, fonts, logo, a base look | Copy, don't invent |
| `looks.js` | The eight looks, the kit's fields, and how a style resolves (`fontStr`, `bgConfig`, `lookFiles`) | To add a look |
| `index.html` | `@font-face` declarations; the bundled faces are in `fonts/` | Fonts only |
| `shaders.js` | Background shaders (`SCENE`: gradient, paper, grid, crt, mesh) and the composite, bloom and post chain | To add a shader |
| `lib.js` | Easing (`snap`, `swift`, `whip`, `anticip`), `spring`, noise, `env`, colours, the board helpers (`beatWindow`, `beatAt`, `boardDur`), `captions` and its styles (`captionStyle`, `captionStyleFor`), `loadSeq`/`seqAt`, `sceneTarget`, `scaleTarget`, `freeSpan` | Rarely |
| `code.js` | Code and terminal motion: highlighting (`codeTheme`), typed code (`codeBlock`, `drawCode`), diffs (`diffBlock`, `drawDiff`), a terminal session (`termSession`, `terminal`), window, browser and phone frames (`drawFrame`), key ticks (`typedTimes`, `keyTicks`, `keySounds`) | Rarely |
| `slate.js` | A placeholder card per beat, for the board sheet and the animatic | No |
| `caption.js` | A clip's captions: word by word, in a style (`pop`, `karaoke`, `boxed`, `minimal`), with alpha on the clip's clock | Params only |
| `clip.js` | Written by `tools/clip.mjs prepare` from a clip: its size, constant frame rate, frames and length | No |
| `grid.js` | A labelled measuring grid at a target's size (optional, for reading safe-zone edges off screenshots) | No |
| `cues.js`, `cues.json` | Written by `tools/cues.mjs` from a voice take (or `tools/clip.mjs` from a clip's transcript); never by hand | No |
| `tools/` | `cues.mjs` (voice timing), `voice-elevenlabs.mjs` (optional TTS), `mix.mjs` (mix and master), `frames.mjs` (footage), `repo-scan.mjs` (what a project's files say about it), `shots.mjs` (pictures of a local page), `clip.mjs` (caption a clip: probe, prepare, composite) | No |
| `main.js`, `render.mjs`, `check.mjs`, `gl.js`, `wav.js` | The harness, the driver, the checks | No |

Every file documents itself in its header: the scene contract at the top of `scene.js`, the board fields at the top
of `board.js`, every render mode and option at the top of `render.mjs`, each tool's options at the top of its file.
Read the `scene.js` header before writing a scene. The rules that keep frames correct:

- draw everything from `t`, with no state carried between calls, and never call `Math.random()` (use `mulberry32`
  or `hash` from `lib.js`)
- draw in design pixels: the harness clears the 2D context and pre-scales it before every `frame()`, but canvases
  you create need the scale applied by hand, and so do `shadowBlur`, `shadowOffsetX/Y` and `ctx.filter` blur radii,
  which ignore the transform (write `blur(${18 * scale}px)`, or glows look 4x too wide on quarter-size sheets)
- build `TL` from the board (`beatWindow(id)`) and set `CFG.DUR = boardDur()`, so retiming a beat moves everything
- when you replace the example `TL`, rewrite the cues in `audio.js` too (they read its fields)
- export `boxes(t)` for any text you draw, so `check` can see it without OCR (captions return theirs, and so does every
  `code.js` helper with `draw: false`)

## Workflow

Steps marked (voice) are skipped for silent pieces: stings, end cards, loops, overlays.

**A launch video for a repo** (a CLI, a library, an app) runs this workflow with a scan in front of it; follow
`references/launch.md`, in this order. Start the piece from the template, inside the project; the `repo-launch` example
is a reference only, never a starting point. Every file the work makes stays inside the piece (temporary ones too).
1. **Scan** the project: `node tools/repo-scan.mjs <project>` prints its name, pitch, install command, features, colours
   (each with its file and line), fonts, logo candidates and screenshots, and never touches the network.
2. **Write `brand.json` from what the scan found** (`--brand <project>/brand.json` writes the draft), render the kit
   sheet (`node render.mjs brand`) and **show it**, with the scan's notes, before using it.
3. **Write the board**: a hook, the install in a terminal (`terminal` in `code.js`), two or three feature beats with
   code or screenshots in a frame (`node tools/shots.mjs` pictures a local page), and an end card with the logo and the
   install command.
4. **Show the board**: render the board sheet (`node render.mjs board --slates`) before rendering.
5. **Render, mix, `palette` and `check`**: step 10 below.

**Caption a clip** the person brings (a talking head, a screen recording with narration; "add captions to this")
follows `references/delivery.md` section 8 instead of the steps below. The clip is never redrawn: the captions render
with alpha on the clip's own clock and ffmpeg lays them over it; unlike an overlay, the result is mixed and mastered.
1. **Transcript**: with `whisper-cli` installed (`doctor` says), transcribe the clip; otherwise ask for a transcript
   (SRT, WebVTT, whisper.cpp or openai-whisper JSON). SRT and WebVTT words are estimated within their phrase: say so.
2. **Prepare**: `node tools/clip.mjs prepare <clip> --transcript <file> --board` (it converts a variable frame rate
   clip to a constant rate, and says so: tell the person).
3. **Captions, composite, mix, check**: `node render.mjs check --scene caption.js --alpha`, then
   `node render.mjs video --scene caption.js --alpha --out out/<name>.mov` (`--param style=` for another style),
   `node tools/clip.mjs composite <name>`, `node tools/mix.mjs <name> --no-sfx`, and
   `node render.mjs check --file out/<name>-final.mp4`. Deliver `out/<name>-final.mp4`.

Both sheets, `brand.png` and `board.png`, are always rendered before the full render, even when nobody can approve them
now (the request asked for the finished file): go on, and name both in your reply.

1. **Pin the brief.** The destination (it sets the size, fps and safe area: pick a target in `safezones.json`),
   the duration, the exact copy, and where the asset lives (a standalone clip, an overlay on footage, a website
   loop). Write the copy down before animating: retiming around changed words is the expensive part.
2. **Read the brand, then pick the style.** `references/looks.md` has the details.
   - **With a brand kit, use it.** A `brand.json` in the project root holds the colour tokens, fonts (family and
     file per role), logo files and an optional base look. Copy it and every file it names into the piece, keeping
     their paths; `node render.mjs doctor` checks every file and colour, and `node render.mjs brand` writes the
     brand sheet (swatches, a type specimen, the logo on a dark and a light ground): show it to the person before
     anything is animated. The kit's colours and fonts win over any look; `--param` wins over the kit.
   - **Without one, pick a look on purpose, say which and why**, and do not fall back to the same palette from
     piece to piece (the template's own dark palette is a fallback, not a house style). Set `CFG.LOOK` in the scene
     (or try `--param look=<name>` first), and copy the look's font files from `${CLAUDE_SKILL_DIR}/looks/fonts/`
     into the piece's `fonts/` (only the ones it uses: `lookFiles(name)` in `looks.js` lists them; `doctor` names any
     that are missing). Then make the look the piece's own.
   - Brand notes in prose (tone, do and don't, what the live site ships) stay in the project's own CLAUDE.md;
     tokens and files belong in `brand.json`. If the project has brand colours and fonts but no kit, offer to write
     one. When a guide disagrees with what the live product ships, the shipped code wins: say so to the person.
     Use the real logo and reveal it; never redraw a brand mark. A font that is not in the project needs an open
     licence that allows video use.
   - Write the scene against the style (`init({ style })`: `style.tokens`, `fontStr(style, role, px)`,
     `...bgConfig(style)`), not hard-coded colours and faces, as the template's `scene.js` does.
3. **Write the board** (`board.js`): one beat per idea, each with a voice line (`vo`) or a length (`dur`), the
   on-screen copy (`on`), a visual note (`look`) and a sound note (`sfx`). `references/storyboard.md` has the format.
4. **Board sheet:** `node render.mjs board --slates` writes `board.png` and `board.md`, a placeholder panel per beat
   with estimated timing. The person approves the structure here, before any voice or animation.
5. **(voice) Voice it.** `node tools/voice-elevenlabs.mjs --model <id>` voices the board in one take, or bring any
   take with word timings (another TTS, or a human read transcribed elsewhere). `references/voice.md`.
6. **(voice) Cues.** `node tools/cues.mjs` writes `cues.js` (`CUE`, `WORDS`, `VO_OFFSET`, `HOOK_END`) and `vo.wav`. It
   refuses a take that misses an anchor or fails the hook gate, and writes nothing then.
7. **(voice) Animatic.** `node render.mjs video --scene slate.js --out out/animatic.mp4`, then
   `node tools/mix.mjs animatic --no-bed --no-sfx`: the slates with the real voice, so the person hears the pacing.
8. **Animate** beat by beat, replacing slates with the real scene. Review with `node render.mjs board` (now real
   frames, timed by the take), `contact` and `stills`, and Read the PNGs: one image shows the whole arc in seconds,
   where a full render takes minutes.
9. **Get sign-off on a rendered sample** (a contact sheet or a short preview) before polishing. Taste is theirs.
10. **Check, render, mix, check the master.** First `node render.mjs check` (fix every FAIL; read every WARN), and
    with a brand kit `node render.mjs palette` (the piece's pixels against the kit's colours; exit 1 means a look's
    or the template's colours took over somewhere). Every
    source file in the piece counts, `board.js` notes included (only `out/`, `stills/`, the review sheets and render
    records do not), so finish them before the final render: a later edit makes a mixed master stale, and
    `check --file` fails it until you render and mix again. Then, for:
    - **a video**: `node render.mjs full --out out/<name>.mp4`, then `node tools/mix.mjs <name>` (voice, bed and
      effects, mastered to -14 LUFS; `--master-only` for the effects alone, also -14 LUFS; `--sting` for an asset cut
      into someone else's video, -20 LUFS), then `node render.mjs check --file out/<name>-final.mp4`;
    - **a captioned clip**: the branch above; the overlay is composited over the clip and mixed, unlike an overlay;
    - **an overlay** (transparent, with no mix: the mixer takes only an `.mp4` picture):
      `node render.mjs video --alpha --out out/<name>.mov`, then `node render.mjs check --alpha` and
      `node render.mjs check --file out/<name>.mov --plain --alpha`. For WebM:
      `node render.mjs video --alpha webm --out out/<name>.webm`, then
      `node render.mjs check --file out/<name>.webm --plain --alpha webm`.

    `references/check.md` says what each result means.
11. **Deliver** the master's full path (for an overlay, the `.mov` or `.webm`). If the person's chat tool limits attachments, send a preview encode
    (`references/delivery.md`) and keep the master. Leave the source in the piece folder so it can be re-rendered.

## Craft defaults that make it look designed

- Entrances use `snap` or a spring; moves between holds use `swift`; exits use `whip`. Avoid linear motion except
  for slow drifts.
- Stagger related elements by 40 to 90 ms.
- Hold text about 0.25 s per word, and never less than 1 s for a title (`check` warns under that).
- Keep something alive during holds: a slow push, a breathe, one light sweep. A hold that is meant to be still (an
  end card held to the last frame) goes in `HOLDS` or gets `hold: true` on its beat.
- The first frame is the thumbnail: open on content, not a flat colour (`check` warns on a flat first frame).
- End cards and loops hold to the last frame, with no exit: the last frame is the loop point and often the
  thumbnail. The template's title card exits because it is a standalone sting.
- Raise `subBoost(t)` (2 to 4x) wherever motion is fast, or motion blur shows stepped copies instead of a smear.
- Post effects stay subtle: bloom 0.15 to 0.5, grain 0.02 to 0.035, chromatic aberration under 0.0015. Glitch and
  flash are accents at cut points.
- Match the effect vocabulary to the brand. Neon, glitch and scramble-decode suit tech and sci-fi; warm, human
  brands get paper texture, gentle springs, hand-feel type and no glitch at all. Each look carries its vocabulary
  (`style.motion`: entrance, stagger, whether a sweep or a glitch is allowed, hard cuts or whips); keep to it.
- Code and terminals: build the blocks in `init` from `codeTheme(style)`, so the code takes the piece's colours and
  mono face; type with a seeded cadence, fade or lift windows in place rather than sliding them in from off screen, and
  thin the key ticks with `keyTicks` (`references/code.md`).
- Keep text inside the target's safe area, and out of its `exclude` rectangles (TikTok's button column on
  `tiktok-ad`). `sceneTarget(target)` gives a scene its target's safe area even without `--target`, `freeSpan()` the
  width an exclude rectangle leaves free at a given height, and `captions(..., { safe, exclude })` keeps captions
  beside it. `contact --safe` and `board --safe` shade what is outside.

`references/techniques.md` is the full catalog: easing, kinetic type, masks, logo reveals, glow, trails, camera,
motion blur, post, shader looks, data and UI motion, captions, lower thirds, sound design.

## Examples

Each is a full piece in `${CLAUDE_SKILL_DIR}/examples/`, runnable from its folder, with its `contact.png` and
`board.png` committed. Copy one as a starting point the same way as the template (`cp -R`, then `chmod -R u+w`), except
`repo-launch/`: it is a reference only, and a launch piece starts from the template (`references/launch.md`).

- `showreel/` (20 s, 16:9, 60 fps): what the engine can draw, cut to a 120 BPM grid: kinetic type, shape morphs,
  22,000 particles, a raymarched blob, liquid metaballs refracting type, a data panel, an eight-cut montage, and an
  end card with a mark and a wordmark, with a fully synthesized score.
- `explainer-beat/` (16.7 s, 9:16): a three-beat explainer built the workflow's way: board, a voice take from an
  openly licensed TTS voice (`VOICE.md`), cues, word-by-word captions, a synthesized bed, the mix, and `check`
  clean on the master.
- `lower-third/` (5 s, 16:9, transparent): a name strap rendered `--alpha` to ProRes 4444 and WebM, and the recipe
  that composites it onto footage (`references/delivery.md`).
- `caption-clip/` (15 s, 9:16 at 540x960): a clip made in code (a made-up screen recording, no person in it, with the
  explainer's voice as its sound) captioned word by word from its transcript: `tools/clip.mjs prepare`, the captions
  with alpha, the composite, the mix of the clip's own sound, and `check --file` clean (`references/delivery.md`
  section 8).
- `terminal-demo/` (8 s, 9:16): a made-up command-line tool installed and run in a terminal (typed commands, a progress
  bar, a spinner), then its fix landing as a diff, with key ticks thinned to 12 a second, in the `neon` look, and
  `check` clean on the source and the master (`references/code.md`).
- `repo-launch/` (15 s, 9:16): a launch video for a made-up project kept in its `fixture/`: the scan, the kit it drafted,
  a full-page screenshot of the app panned in a phone, the install in a terminal, code with its TODOs lighting up, and
  an end card, with `palette`, `check` and `check --file` clean (`references/launch.md`).

## Gotchas (each one cost time before)

- **A missing font renders as Times, silently.** List every family in `CFG.FONTS`; the harness then throws. Don't
  name a family after a CSS generic (`serif`, `monospace`): a font string resolves to the generic instead. A look's
  or a kit's faces are added for you, and fail the render when their file is not in the piece: copy it, don't
  remove the look.
- **zsh mangles `$VAR[x]` and `=====`** inside commands. Put long ffmpeg filter graphs in a script, or single-quote them.
- **Use `N` (the frame counter), not `T`, in ffmpeg `blend` expressions** when the inputs have different timebases.
- **WebM alpha needs `-c:v libvpx-vp9` before `-i`** when ffmpeg reads it, or the alpha is silently dropped and the
  overlay covers the footage in black.
- **Grain drives file size**: a 20 s 1080p reel went from 46 MB at grain 0.032 to 375 MB at 0.05. Lower grain before
  raising the CRF.
- **Bloom too strong turns everything milky.** Start at 0.2 to 0.3.
- **Counters and odometers must freeze at rest.** An easing tail that never quite reaches the end value makes the
  last digit creep.
- **WebGL needs a GPU path.** `render.mjs` uses ANGLE on Metal on macOS and SwiftShader (software) on Linux. Set
  `CHROME_PATH` if Google Chrome is not installed; `doctor` says which renderer you got.
- **Shader y runs bottom-up, canvas y top-down.** `gl_FragCoord.y = 0` is the bottom row in `shaders.js`; Canvas2D
  `y = 0` is the top. Flip one when lining a shader effect up with 2D art.
- **`--out` and `--dir` resolve against the piece folder**, not your shell's working directory.
- **Grab frames no later than `DUR - 1/FPS`** with `ffmpeg -ss <t> -i out.mp4 -frames:v 1 f.png`: the last frame
  starts there, and later grabs return nothing.
- **A failed render keeps the earlier good one.** Renders write `out/<name>.partial.<ext>` and rename it on success;
  only the old `.render.json` is removed, so re-render before you mix.

## When to use something else

If a team writes React or HTML, wants a studio with a timeline scrubber, or renders at scale in the cloud,
Remotion or HyperFrames fit better. This skill is for an agent writing a piece in code, reviewing it from stills and
measured checks, and rendering it exactly on one machine.

## References

- `references/looks.md`: the style a piece draws with, the eight looks, picking one, the look fonts, `brand.json`,
  the brand sheet (`render.mjs brand`), the colour match (`render.mjs palette`) and what the render records.
- `references/storyboard.md`: the board format, the board sheet, slates and the animatic, beat timing.
- `references/voice.md`: timing sources and the `take.json` format, delivery tags, cues, gaps, the hook gate, the
  ElevenLabs tool, captions, and the mixer (with its known limits).
- `references/check.md`: every check, its threshold, the measurements behind it, and how to silence it on purpose;
  overlays and files from elsewhere.
- `references/techniques.md`: the motion craft catalog, with pointers into the template and the examples.
- `references/code.md`: code and terminal motion (`code.js`): highlighting and its colours, typed code, diffs, a terminal
  session, frames, the boxes `check` reads, key ticks.
- `references/launch.md`: a launch video for a repo: the scan (`tools/repo-scan.mjs`), the kit from it, pictures of the
  app (`tools/shots.mjs`: a full-page screenshot, or a frame sequence under 1 GB decoded), the board, and the checks.
- `references/delivery.md`: sizes and safe areas, encode settings, alpha overlays, compositing recipes, loudness
  targets, footage, previews, and captioning a clip (`tools/clip.mjs`).
