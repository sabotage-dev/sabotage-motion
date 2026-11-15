# lower-third

A 5 s name strap for 16:9 footage, rendered with a transparent background to lay over someone else's video. Silent:
the sound belongs to the edit it goes into. The name is made up; pass your own with
`--param name=... --param role=...`.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one):

```sh
node render.mjs board                                       # board.png and board.md
node render.mjs contact                                      # contact.png, over a neutral backdrop
node render.mjs check --alpha                               # the source, as an overlay: 0 FAIL, 0 WARN
node render.mjs video --alpha --out out/lower-third.mov          # ProRes 4444 with alpha
node render.mjs video --alpha webm --out out/lower-third.webm    # VP9 with alpha
node render.mjs check --file out/lower-third.mov --plain --alpha         # the file: 0 FAIL, 0 WARN
node render.mjs check --file out/lower-third.webm --plain --alpha webm
```

Lay it over footage (here a generated test pattern; `references/delivery.md` section 4 has more):

```sh
ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30:duration=5 -i out/lower-third.mov \
  -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" -map "[v]" -c:v libx264 -crf 18 out/composite.mp4
```

An overlay has no master, so it is checked as one (`--alpha` on the source, `--plain --alpha` on the file):
`references/check.md` section 3 says why. This example's own files: `board.js`, `scene.js`, `board.png` and
`contact.png`. Everything else is the template, unchanged.
