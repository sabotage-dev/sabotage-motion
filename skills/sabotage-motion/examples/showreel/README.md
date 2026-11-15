# showreel

20 s of what the engine can draw, 16:9 at 60 fps, cut to a 120 BPM grid: kinetic type, a grid of morphing shapes,
22,000 particles, a raymarched blob, liquid metaballs refracting a word, a data panel, an eight-cut montage, and an
end card. The music is synthesized in `audio.js` from the scene's timeline. It ends on the end card of sabotage
development, the studio behind this repo; its orrery mark was drawn for this reel.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one). The full render is 1200 frames: about 5 minutes on an Apple-silicon Mac, far longer under
software WebGL on Linux (use `--scale 0.5` there).

```sh
node render.mjs board                              # board.png and board.md
node render.mjs contact                            # contact.png
node render.mjs check                              # the source: 0 FAIL, 1 WARN (first_frame_empty, on purpose)
node render.mjs full --out out/showreel.mp4        # the picture and the music (out/showreel.wav)
node tools/mix.mjs showreel --master-only          # the music mastered to -14 LUFS
node render.mjs check --file out/showreel-final.mp4   # the master: 0 FAIL, the same 1 WARN
```

The one WARN is kept on purpose: the reel fades up from black, so its first frame is flat. It has no `boxes(t)`, so
`check`'s text checks report "not checked" (`references/check.md`). Its board mirrors the reel's sections rather
than driving them: the reel is locked to its music grid, and `scene.js` refuses a board that moves a section.

This example's own files: `board.js`, `scene.js`, `audio.js`, `shaders.js` (its background looks), `index.html` and
three more open-licence faces in `fonts/` (Anton, Bodoni Moda Italic and Jost, with their licences), `board.png` and
`contact.png`. Everything else is the template, unchanged.
