# caption-clip

A clip with speech comes back with word-by-word captions inside the platform's safe area, its sound levelled and
mastered, and checked like any other piece (`references/delivery.md`, "Caption a clip"). The clip here is a made-up
screen recording of a made-up phone app, 540x960 at 30 fps, 15 s, with no person in it: a 9:16 clip smaller than the
`tiktok` target, so its safe area is the target's scaled by 0.5.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one):

```sh
node tools/clip.mjs prepare clip.mp4 --transcript transcript.json   # clip.js, vo.wav and the cues, on the clip's clock
node render.mjs check --scene caption.js --alpha                     # the captions, as an overlay: 0 FAIL, 0 WARN
node render.mjs video --scene caption.js --alpha --out out/caption-clip.mov   # the captions with alpha, on the clip's clock
node tools/clip.mjs composite caption-clip                           # laid over the clip: out/caption-clip.mp4 and its record
node tools/mix.mjs caption-clip --no-sfx                             # the clip's own sound, mastered to -14 LUFS
node render.mjs check --file out/caption-clip-final.mp4              # the master: 0 FAIL, 0 WARN
```

The captions use the default style for the `normal` energy (`pop`: the spoken word pops in the accent);
`--param style=karaoke` (or `boxed`, `minimal`) on the overlay render picks another, and `--param emphasis=stutters,smear`
marks words.

## How the clip and its transcript were made

Both are made in code, so the example carries no footage and no third-party licence beyond the voice's:

- **The picture** is `screen.js`, a scene drawn by the engine: a made-up motion-blur app ("Smearly") whose preview
  ball jumps in steps until the cursor switches motion blur on, timed to the voice.
- **The sound** is the `explainer-beat` example's voice, a synthetic take from an openly licensed text-to-speech model
  (Kokoro-82M, Apache License 2.0): `VOICE.md` and `LICENSE-voice.txt` travel with it. It starts 0.5 s into the clip.
- **The transcript** (`transcript.json`, the generic words format) is that take's own word timings (the model
  predicts them as it speaks; `VOICE.md`), moved 0.5 s later. No speech recognition was run. With whisper.cpp
  installed, `whisper-cli -m <model> -f clip.wav -oj -ml 1 -sow` gives a transcript `tools/clip.mjs` reads the same way;
  an SRT or WebVTT file works too, with each phrase's words spread by length and marked estimated.

`node make-clip.mjs` made them: it renders `screen.js` to `out/screen.mp4`, lays the voice under it into
`out/source.mp4` (H.264 CRF 30 and AAC 96 kb/s mono, to keep the committed clip small, about 280 KB), and writes
`transcript.json`. Then `node tools/clip.mjs prepare out/source.mp4 --transcript transcript.json --board --title
"Smearly: why fast motion stutters"` copied it to `clip.mp4` and wrote `clip.js`, the cues and the one-beat `board.js`.

This example's own files: `screen.js` and `make-clip.mjs`; the clip (`clip.mp4`) and what prepare made from it
(`clip.js`, `cues.js`, `cues.json`, `board.js`; `vo.wav` is made by prepare and not committed); `transcript.json`;
the voice's `VOICE.md` and `LICENSE-voice.txt`; `board.png` (the board sheet of `caption.js`) and `contact.png` (12
frames of the master). Everything else is the template, unchanged, `caption.js` included.
