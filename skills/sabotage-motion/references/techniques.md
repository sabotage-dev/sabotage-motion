# Motion techniques catalog

The craft lives in timing, not effects. Each entry says what it is, when to use it, and where a working
implementation is: `T:` is `template/scene.js`, `R:` `examples/showreel/scene.js`, `E:`
`examples/explainer-beat/scene.js`, `L:` `examples/lower-third/scene.js`, `D:` `examples/terminal-demo/scene.js` (all
under `${CLAUDE_SKILL_DIR}`).

## Contents
1. Timing and easing
2. Kinetic type
3. Reveals and masks
4. Brand art (logos)
5. Light: glow, sweeps, trails
6. Camera and depth
7. Motion blur
8. Post-processing
9. Shader backgrounds and looks
10. Data and UI motion
11. Captions and lower thirds
12. Sound design and sync

## 1. Timing and easing
- **Four curves cover almost everything** (`lib.js`): `snap` for entrances (fast out, long settle), `swift` for
  moves between holds, `whip` for exits and transitions (nearly a cut, with a smear), `anticip` for playful pops
  (pulls back, then overshoots). Linear motion reads as cheap; keep it for constant drifts.
- **Springs for things that land**: `spring(t - start, f, z)`. `f` is in Hz (2 to 4 is snappy), `z` the damping
  ratio (0.3 bouncy, 0.55 confident, 0.8 calm). A spring first reaches 1 at about 0.4/f seconds: put the "land"
  sound there (T: `TL.hits`).
- **Stagger** related elements by 40 to 90 ms (`start + i * stagger`). Under 30 ms reads as a block; over 120 ms as
  separate events.
- **Hold long enough to read**: about 0.25 s per word, never under 1 s for a title. Viewers of short video decide
  in about 1.5 s, so the first readable frame should land by about 0.5 s.
- **Life during holds**: a slow camera push (`cam[0]` from 1 to 1.03), a gentle breathe, or one light sweep. A
  fully static hold looks like a freeze, and `check`'s `motion_dead` says so after 3 s unless the hold is declared
  (`HOLDS`, or `hold: true` on the beat; L: the read beat).
- **Progress windows**: `prog(t, a, b)` gives 0 to 1 through a window, so each element is `ease(prog(t, start, end))`
  and stands alone: any frame renders in isolation.
- **Time from the board, and from the voice.** `beatWindow(id)` gives a beat's window; a scene's `TL` hangs off it
  (T, L). In a voiced piece, land copy on the spoken word: `CUES.WORDS` times plus `boardInfo().voOffset` (E:
  `said()`).

## 2. Kinetic type
- **Rise from behind a line** (T: the title words; R: `sKinetic`): clip to the line's box, and translate the word up
  from below the baseline with a spring. The classic editorial reveal.
- **Decode / scramble** (R: `scramble()`, the callouts and labels): letters cycle through glyphs (seeded per
  letter and frame) before resolving left to right. Good for tech and mystery; wrong for warm brands.
- **Tracking in** (T: the subtitle; L: the role): `ctx.letterSpacing` from wide to normal while fading up. Calm and
  premium. Canvas adds the spacing after every character, so measure the wide state too, or it runs off the safe
  area (T: `L.subTrack0`).
- **Word-by-word captions synced to a voice**: section 11.
- **Big word slams** (R: `bigWord`, the montage; E: `STUTTERS`): a word scales from about 1.25 to 1 with `snap`,
  with motion blur. One key word, not a sentence. Fit the word at its largest scale, or the slam leaves the safe
  area (E: `fit(text, maxW / 1.25)`).
- **Auto-fit** (T: `layout()`; E: `fit()`): always measure and shrink to fit. Titles come from parameters and will be
  longer than you expect.
- **Fonts**: declare them in `index.html`, list them in `CFG.FONTS`. The bundled faces are Archivo Black
  (`DISPLAY`), Inter SemiBold (`BODY`) and JetBrains Mono (`MONO`); R adds Anton, Bodoni Moda Italic and Jost. A
  family named `serif` or `monospace` resolves to the CSS generic, so give faces names of their own.

## 3. Reveals and masks
- **Wipe**: draw a rect from `x0` to `x0 + k * w` (T: the accent bar; L: the plate). Reverse the anchor on the way
  out, so it wipes out the far side; that reads as intentional.
- **Clip-path reveals**: `ctx.save(); ctx.beginPath(); <shape>; ctx.clip(); draw; ctx.restore()`. A circle that
  grows (an iris), a diagonal band, or the text itself as the mask. Report a clipped word's box cut to the clip
  (T: `boxes()`), or `check` sees text that is not visible.
- **Stroke-on**: draw only part of a path, growing with progress (R: the mark's orbits, drawn as an arc of
  `TAU * on`). For an arbitrary path, precompute its cumulative arc length and draw the segment `[a, b]`: a pen
  writing a signature, an underline drawing itself, a logo tracing itself.
- **`source-atop` / `destination-in`**: paint only where something already is (sweeps, textures inside text), or
  keep only the overlap (texture-filled type).

## 4. Brand art (logos)
- **Never redraw a real logo.** Load the raster or SVG and reveal it. You can split it into layers (by colour, or
  by the SVG's own groups) and animate each layer's reveal, so the final frame is the exact brand art and the motion
  is the only invention.
- A stroke-on of the mark's outline that resolves into the real image is the safest premium move.
- When the current mark exists only as inline SVG in the product (no file), copy its exact path data into the scene
  (`new Path2D(d)`) rather than approximating it. If the project holds several different marks, use the one the
  live product shows and say which you picked.
- Respect clear space and the brand's exact colours; read the project's brand notes first.
- A made-up mark for a demo (R: the orrery) follows the same rules: one source of truth for its geometry, revealed,
  not redrawn per frame by hand.

## 5. Light: glow, sweeps, trails
- **Neon stack**: draw the art to an offscreen layer, then composite it several times with `'lighter'`, for
  example a blur of 18 px at 0.55, 5 px at 0.4, sharp at 1, and sharp again at 0.1. Cheaper and more controllable
  than bloom alone. Scale the blur radii by `scale` (they ignore the transform):
  ```js
  for (const [blur, a] of [[18, 0.55], [5, 0.4], [0, 1], [0, 0.1]]) {
    c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = a;
    c.filter = blur ? `blur(${blur * S}px)` : 'none';
    c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(LAYER, 0, 0); c.restore();
  }
  ```
- **Light sweep** (T: across the title; R: the wordmark's glint): a skewed white gradient band painted
  `source-atop` over the art, crossing once with `snap` during a hold.
- **Trails**: sample the moving element's state at `t - k * dt` for k = 1 to 14, and stroke the segments with
  falling alpha and width. Because the state is a function of `t`, the trail costs nothing to compute.
- **Bloom** (post): `thr` sets what glows (0.5 to 0.8); keep `bloom` at 0.15 to 0.5. Too strong goes milky.

## 6. Camera and depth
- `cam: [zoom, rotation, panX, panY]` from `frame()` is applied in the composite shader to the whole frame (the 2D
  layer and the background). Small values: zoom 1 to 1.05, rotation under 0.02 rad. `check` maps text boxes
  through it, so a push can carry text out of the safe area.
- **Parallax**: draw layers with different offsets driven by one camera value (far x 0.3, mid x 0.6, near x 1).
- **Shake**: noise on `panX`/`panY` that decays from an impact (R: `shake()` in `frame()`).
- **Whip-pan transitions**: animate `panX` by about 1.5 with `whip` across a 0.25 s cut window and raise
  `subBoost` there, so the blur hides the cut.

## 7. Motion blur
- Every output frame averages N subframes across a 180-degree shutter (`--sub`, default 8), jittered with Halton
  offsets that double as anti-aliasing.
- **`subBoost(t)`** returns a multiplier for fast segments (2 to 4x). Without it, fast moves show stepped copies
  instead of a smear (R: the whip-outs and the montage; E: the sweep at 4x, 32 subframes, which is the whole point
  of that piece).
- Stills use the same path, so a still at `t` shows the true blurred frame. Check fast moments in stills before a
  full render.

## 8. Post-processing (`post(t)`)
- `ca` (chromatic aberration) 0.0005 to 0.0015 at rest; spikes are a glitch accent. Skipped in alpha renders.
- `glitch` as decaying spikes at cut points: `0.75 * Math.exp(-(t - cut) * 40)` (R: `post()` over `TL.cuts`).
- `grain` 0.02 to 0.035. It inflates file size.
- `vig` 0.1 to 0.2. `flash` (to white) only on a hard impact, for a frame or two (R: 16 s; E: the end card).
- `fade` for a fade to black; in alpha mode it fades alpha too.
- `hud` with `drawHud()`: a difference-blended overlay layer (timecode, section labels, corner marks; R:
  `drawHud`). Very "motion designer reel"; skip it for brand work unless it fits.

## 9. Shader backgrounds and looks
- The template's `SCENE` ids: 1 gradient (drifting fbm between two colours), 2 paper (fibres and a vignette, for
  warm print looks), 3 grid (a tech grid with a travelling glow line), 4 crt (a phosphor screen: centre glow, a
  rolling bar, scanlines, a faint flicker), 5 mesh (a soft mesh of three colours drifting). A style names one by
  its id (`bg`: `none`, `gradient`, `paper`, `grid`, `crt`, `mesh`) and `bgConfig(style)` in `looks.js` fills its
  colours from the tokens, so `bg` never holds a colour. The post chain's `scan` lays scanlines over the whole
  frame (the `retro-crt` look).
- A look (`references/looks.md`) is a whole vocabulary, not only a shader: tokens, faces, post, motion and sound.
  Start a piece from one on purpose (or from the project's `brand.json`), then make it the piece's own.
- The showreel's `shaders.js` holds more looks, by id: 1 a raymarched SDF blob with an environment map and
  iridescence, 2 liquid metaballs that refract the 2D layer, 3 op-art rings, 4 an ASCII render, 5 halftone, 6
  duotone, 7 stripes, 8 climax rays and rings. To port one, copy its function and helpers into your `SCENE`, add a
  branch for its id in `sceneColor()`, and map the uniforms it reads. `uP`, `uQ`, `uR`, `uL` (`cfg.l`), `uBlobs`
  (`vec4[12]`, `cfg.blobs`) and `uTex` (this subframe's 2D canvas) are already passed by `gl.js`; declare the ones a
  look uses.
- The 2D canvas can feed a shader as a texture (`uTex`): ASCII-rendered type, liquid refraction of a word (R: the
  liquid section). Return `use2D: true, consume2D: true` from `frame()` so the canvas is uploaded for the shader
  but not also composited flat on top.
- One flag can lay one look over another in the same pass (R: `cfg.l = 1` floods the liquid over the blob).

## 10. Data and UI motion
- **Odometer counters** (R: `odometer`): each digit a vertical strip that rolls; drive the value with `E.outExpo`
  so it decelerates into the final number, and freeze it at rest.
- **Line charts** (R: `catmull`, `sData`): a Catmull-Rom curve through the points, revealed with a clip that
  follows the head, a glowing head dot, and the value riding with it.
- **Bars and rings** (R: `sData`): bars on a spring with a stagger; rings as arcs filling with `inOutCubic`.
- **Callouts** (R: `callout`): a leader line draws from the anchor, then the label decodes in.
- **Code, diffs and terminals** (D; `references/code.md`): `code.js` types code with a seeded cadence, lands a diff line
  by line, plays a terminal session (typed commands, output on its own clock, a spinner, a progress bar) inside generic
  window, browser and phone frames, colours it all from the look's tokens, and reports the visible lines as boxes.
  Lift or fade the windows in place; the key ticks are thinned to 12 a second.
- **Screen recordings and app mockups**, for a SaaS promo: cut the clip with `tools/frames.mjs` to the size you will
  draw it, `await loadSeq(name)` in `init`, draw `seqAt(name, t, t0)`; or draw a screenshot as an image. Animate a
  fake cursor along a spline with `swift`, zoom the camera onto the active control, and add a click ring (a circle
  scaling 0.6 to 1.4 while it fades). `tools/shots.mjs` takes the screenshot, or a scrolling sequence, of a local page
  (`references/launch.md`, and the `repo-launch` example, which pans a full-page shot inside a phone frame).

## 11. Captions and lower thirds
- **Word-by-word captions** (E): `captions(ctx, CUES.WORDS, t, { safe: target.safe, exclude: target.exclude })`
  draws the take's words a group of lines at a time, pops the spoken word (1.15 to 1 with `anticip`, or
  `pop: 'spring'`) in the accent colour, adds `VO_OFFSET` itself, and never shows delivery tags. It returns one box
  per word; with `draw: false` it only returns them, for `boxes(t)`. Options: `size`, `family`, `lines`, `pos`
  (`bottom`, `center`, `top`), `maxW`, `x`/`y`, `upper`, `stroke`, `strokeColor`, `color`, `accent`, `breakGap`,
  `hold`, `wordGap`. Lines are filled to the safe width less room for the pop, so a popped word at the end of a line
  stays inside. Between words the layout leaves room for the pop too: a plain space where the pop fits, more beside
  long words, so the spoken word never touches its neighbours (`wordGap` is the clear space it keeps, by default half
  a space plus the `stroke`). A word wider than the line is scaled down to fit it.
- **Caption styles**: `captionStyle(name, opts)` gives `captions()` options for `pop` (the default above), `karaoke`
  (`pop: 'none'`, `fill: 'spoken'`: the accent wipes across each word as it is said), `boxed` (`plate`: a dark box
  behind each line) and `minimal` (no pop, no stroke, no highlight, `shadow`, smaller type). `captionStyleFor(energy)`
  is the energy's default (`subtle` minimal, `normal` pop, `extreme` karaoke). `emphasis: ['word']` draws those words in
  `emphColor` with a bar under them, in any style. `caption.js` uses them to caption a clip (`references/delivery.md`
  section 8).
- **Captions beside a platform's buttons**: pass the target's `exclude` and the block keeps to the width those
  rectangles leave free at its height (on `tiktok-ad`, the left of x 780 at the bottom), centred there. Without it
  a full line runs under TikTok's button column and `check`'s `text_safe` fails it. For other layouts, `freeSpan()`
  gives the free width for any band of the frame (T uses it for the title block).
- **Lower thirds** (L): an accent bar grows, a plate wipes out of it, the name rises inside the plate's clip, the
  role tracks in, then all of it leaves in reverse order. Render `--alpha` and lay it over footage
  (`references/delivery.md`). Keep it inside the 16:9 safe area, and silent: the sound belongs to the edit.

## 12. Sound design and sync
- Everything is synthesized in `audio.js` with an `OfflineAudioContext`: no samples and no licences, and every cue
  is scheduled from the same `TL` the visuals use (the harness passes the selected scene's `TL` in), so sync is
  exact.
- Building blocks in the template: `whoosh` (band-passed noise sweep), `tick` (a sine blip with a pitch drop),
  `thump` (a low sine kick), `shimmer` (detuned high partials). The showreel's `audio.js` is a full arrangement on
  a 120 BPM grid: kicks, claps, hats, bass, pads, stabs, plucks, bells, risers, impacts, a sidechain duck on the
  music, a snare roll, a tape stop and a dropout before the last impact.
- **Audio-reactive visuals**: put the event times in `TL` and pulse visuals with `env(t, TL.hits, decay)`.
- Keep peaks under -1 dBFS (`render.mjs` prints peak, RMS and a spike check after every audio render). Under a
  voice, keep effects sparse and 6 to 10 dB below it; `tools/mix.mjs` sets the balance (`--sfx-gain`) and masters
  the whole mix (`references/voice.md`).
- End the soundtrack with a short fade (the template fades the last 0.18 s) so nothing clicks at the cut.
