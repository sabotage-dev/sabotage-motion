# terminal-demo

8 s, 9:16: a made-up command-line tool, `darnly`, is installed and run in a terminal in a made-up project, `mossgate`,
and the fix it makes lands as a diff. Every name in it is made up. It is built from `code.js` (`references/code.md`):

- a terminal session (`termSession`, `terminal`): a prompt from the first frame, typed commands, a progress bar, a
  spinner, output on its own clock, each step tied to the board's beats with `at`;
- a diff (`diffBlock`, `drawDiff`): the wrong line strikes through, the fixed one opens in, its code coloured as
  TypeScript;
- window frames (`drawFrame`) that lift and open in place, so no text ever leaves the safe area;
- key ticks (`typedTimes`, `keyTicks`, `keySounds`) thinned to 12 a second, under a quiet pad, a rising tone with the
  bar, a chime, a soft tick per spinner turn and a pluck per diff line (`audio.js`).

The look is `neon`, picked on purpose: dark, so code reads as code, with its bloom held low (`post`) so small type stays
sharp. Its tokens colour the code (`codeTheme`) and its mono face draws it. `boxes(t)` returns every helper's
`draw: false` call, so `check` sees the terminal and the diff as text, and leaves the frames and the cursor (`deco`)
alone.

Run from this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a
folder above this one):

```sh
node render.mjs board                                   # board.png and board.md
node render.mjs contact                                 # contact.png
node render.mjs check                                   # the source: 0 FAIL, 0 WARN
node render.mjs full --out out/terminal-demo.mp4        # the picture and its synthesized sound
node tools/mix.mjs terminal-demo --master-only          # the sound mastered to -14 LUFS
node render.mjs check --file out/terminal-demo-final.mp4   # the master: 0 FAIL, 0 WARN
```

This example's own files: `board.js`, `scene.js`, `audio.js`, `board.png` and `contact.png`. Everything else is the
template, unchanged.
