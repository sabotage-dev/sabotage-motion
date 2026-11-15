# explainer-beat

A made-up 9:16 explainer, 16.7 s: why fast motion stutters, and how motion blur fixes it. Three voiced beats and an
end card, built the way the skill's workflow runs: board, board sheet, voice take, cues, the scene timed from the
take, word-by-word captions, a music bed, the mix, and `check` on the master.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one):

```sh
node tools/cues.mjs                                   # cues.js, cues.json and vo.wav from take.json and take-raw.wav
node render.mjs board                                 # board.png and board.md, the real frames timed by the take
node render.mjs contact                               # contact.png
node render.mjs check                                 # the source: 0 FAIL, 0 WARN
node render.mjs full --out out/explainer-beat.mp4     # the picture and the effects stem (out/explainer-beat.wav)
node tools/mix.mjs explainer-beat                     # the voice, bed.mp3 and the effects, mastered to -14 LUFS
node render.mjs check --file out/explainer-beat-final.mp4   # the master: 0 FAIL, 0 WARN
```

This example's own files: `board.js`, `scene.js`, `audio.js`; the voice (`take.json`, `take-raw.wav`, `VOICE.md`,
`LICENSE-voice.txt`), and the cues made from it (`cues.js`, `cues.json`; `vo.wav` is made by `tools/cues.mjs`
and not committed); the bed (`bed.mp3`, synthesized by `make-bed.mjs`); `board.png` and `contact.png`. Everything
else is the template, unchanged.

The voice is synthetic, from an openly licensed text-to-speech model run locally: `VOICE.md` names it, its licence,
and how the take and its timings were made.
