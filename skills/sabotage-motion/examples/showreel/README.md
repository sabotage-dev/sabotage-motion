# showreel

20 s of what the engine can draw, 16:9 at 60 fps, cut to a 120 BPM grid: kinetic type, a grid of morphing shapes,
22,000 particles, a raymarched blob, liquid metaballs refracting a word, a data panel, a montage of four style frames
with a word landing on every beat, and an end card. The music is synthesized in `audio.js` from the scene's timeline. It ends on the end card of sabotage
development, the studio behind this repo; its orrery mark was drawn for this reel.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one). The full render is 1200 frames: about 5 minutes on an Apple-silicon Mac, far longer under
software WebGL on Linux (use `--scale 0.5` there).

```sh
node render.mjs board                              # board.png and board.md
node render.mjs contact                            # contact.png
node render.mjs check                              # the source: 0 FAIL, 0 WARN (flash once it is rendered)
node render.mjs full --out out/showreel.mp4        # the picture and the music (out/showreel.wav)
node tools/mix.mjs showreel --master-only          # the music mastered to -14 LUFS
node render.mjs check --file out/showreel-final.mp4   # the master: 0 FAIL, 0 WARN, flash included
```

**It passes `flash`** (`references/check.md` section 7). The first cut of the reel did not: it flashed more than three
times a second over too large an area in four stretches, so P11b (`docs/PLAN.md`, section 23.9) re-cut them, keeping
the reel's moves and its grid but fewer and lower-contrast changes on any one pixel:

- **2-4 s, kinetic type**: the outlined EMOTION rows behind the inverted frame scroll at 300 px/s, not 820, and faintly
  (a stroke crossing a pixel never swings 0.1 of luminance); the twelve slices slide 380 px as they fade, where they
  used to whip the whole frame's width and sweep every letter over every pixel in the band.
- **6-8 s, particles**: the word FLOW holds still (a 1.3 px shimmer strobed its every pixel), each dot is fainter
  (additive blending still builds the bright core), and the sphere turns at 0.6 rad/s, dimming as it forms.
- **8-12 s, the blob and the liquid**: the blob's surface pulses gently on the kick; the liquid cuts in on the beat at
  10 s, its surface rising from below, where it used to flood over the blob and drain away after a shower of drops (five
  changes on a pixel within a second); the word fades up where it floats and stays light inside the liquid; the
  refraction, the kick pulse, the surface waves and the highlights are gentler.
- **14-16 s, the montage**: four half-second style frames (halftone, ASCII, stripes, code), each holding still under
  two words that land on the beat (I MAKE / PIXELS MOVE / with NOTHING / BUT CODE), where eight quarter-second cuts
  over fast shader patterns, a zoom kick and a glitch on every cut flipped the whole frame many times a second. The
  lockup's flash is 0.35, not 1.0, and comes straight off the montage (no black frames before it).

It also opens on an ember glow where the dot lands, so its first frame is the thumbnail, not black. It has no
`boxes(t)`, so `check`'s text checks report "not checked" (`references/check.md`). Its board mirrors the reel's
sections rather than driving them: the reel is locked to its music grid, and `scene.js` refuses a board that moves a
section.

This example's own files: `board.js`, `scene.js`, `audio.js`, `shaders.js` (its background looks), `index.html` and
three more open-licence faces in `fonts/` (Anton, Bodoni Moda Italic and Jost, with their licences), `board.png` and
`contact.png`. Everything else is the template, unchanged.
