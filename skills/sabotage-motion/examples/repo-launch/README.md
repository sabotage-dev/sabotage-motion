# repo-launch

15 s, 9:16: a launch video for a made-up project, Snagwick, a command-line tool that finds every TODO in a codebase and
puts them on a board. It is made the way `references/launch.md` says: scan the project, write the kit from the scan, take
the app's picture, board, render, mix, then `palette` and `check`.

- **hook**: the logo springs in, the pitch rises under it;
- **install**: a terminal types the install command, a progress bar fills (`termSession`, `terminal`);
- **find**: a source file in a window, its TODO and FIXME lines lighting up (`codeBlock`, `drawCode`);
- **board**: the app's board, a full-page screenshot, panned inside a phone (`drawFrame`);
- **end**: the logo, the name and the install command, held to the last frame.

It runs at the `normal` energy (`energy: 'normal'` on the board; plan 23.9, `references/storyboard.md` section 7): a
launch for developers should read as made and cut on the beat, while the terminal and the code keep their reading time.
The board has no voice, so its beats snap to whole beats of 116 BPM (5, 6, 6, 6 and 6: 15.0 s). Inside each beat but
the end card, the picture cuts every two beats: the ground swaps between the kit's own and a tone close to it, crossed by
drifting stripes at a new angle, while the terminal, the code or the phone stays on screen; the camera pushes across
each shot and punches on each hit (`moves.js`'s rig, which keeps every text box inside the safe area); `cuts()` lists the
cuts for `check`. `audio.js` adds the bed stem (`renderBed`: a kick on every beat, an offbeat hat, a bass note on 1 and
3), which `tools/mix.mjs --master-only` lays under the effects.

## The fixture

`fixture/` is the project the video launches, kept inside the example so it is self-contained. It is made up: the name
was searched on the web first and is not a product's, and so are the project in the screenshot (`mossgate`) and the
people in it. It holds what a real repo would:

- `README.md`: the name, the pitch, an install block and a features list;
- `package.json`: the name, the description and a `bin`;
- `assets/logo.svg`: the mark (a bramble stem with its thorns on a moss-green tile), drawn for this example;
- `app/styles.css`: the app's colours as CSS custom properties, and its two faces as `@font-face` rules;
- `app/index.html`: a static page of the app's board, which `tools/shots.mjs` captures;
- `fonts/`: the two faces, Fredoka SemiBold and Inter SemiBold copied unchanged under the app's own family names
  (SIL OFL 1.1, the licence texts beside them).

The colours were picked so that the kit's `bgA`, `bgB` and `accent` are each more than 15 (CIEDE2000) from every token
of every look and of the template, so a piece in a look's colours cannot pass `palette` for this kit.

## How it was made

From this folder (Node 22 or 24, Google Chrome, ffmpeg; run `npm install` first if no `node_modules` sits in a folder
above this one):

```sh
node tools/repo-scan.mjs fixture --brand brand.json     # the scan (JSON) and the draft kit
node render.mjs doctor                                  # Chrome, WebGL2, ffmpeg, and the kit's files, colours and faces
node render.mjs brand                                   # brand.png: the kit sheet, shown before anything is animated
node tools/shots.mjs page app fixture/app/index.html --viewport 390x844 --dpr 2   # assets/shots/app.png
node render.mjs board --slates                          # board.png as slates: the board, shown before rendering
node render.mjs board                                   # board.png and board.md, from the finished scene
node render.mjs contact                                 # contact.png
node render.mjs check                                   # the source: 0 FAIL, 0 WARN
node render.mjs palette                                 # the colour match against brand.json: pass
node render.mjs full --out out/repo-launch.mp4          # the picture and its synthesized sound
node tools/mix.mjs repo-launch --master-only            # the effects over the bed stem, mastered to -14 LUFS
node render.mjs check --file out/repo-launch-final.mp4  # the master: 0 FAIL, 0 WARN
```

- **The scan** found the name in the README's heading, the pitch in `package.json`'s description, the install command
  in the README's code block, the three features, the six colours in `app/styles.css` (each mapped to a token by its
  name: `--bg`, `--surface`, `--text`, `--text-muted`, `--accent`, `--accent-2`), the two faces with their roles
  (`--font-display`, `--font-body`), and `assets/logo.svg` as the top logo candidate. `brand.json` is the draft it wrote,
  unchanged; its paths point into `fixture/`, so every file it names is already in the piece. In a real project the kit
  goes in the project's root (`--brand ../../brand.json` from a piece in `motion/<piece>/`) and the piece copies it with
  its files; here the project sits inside the piece instead.
- **The shot** is one full-page screenshot of the static page at a 390x844 viewport, 2 device pixels to each CSS pixel
  (780x4284 px). The page does not move, so the scene pans the one image rather than holding a frame sequence.
- **The kit sheet and the board** were rendered (`node render.mjs brand`, `node render.mjs board --slates`) and looked
  at before anything was animated; the committed `board.png` is the later one, from the finished scene.

Measured on an Apple-silicon Mac with Chrome 157 and ffmpeg 9 (2026-11-17, the re-cut at `normal`):

| Check | Result |
|---|---|
| `check` (the source) | 0 FAIL, 0 WARN, 10 ok; `hook_long` not checked (no voice, so no `hookMax`), `flash` not checked until it is rendered |
| `palette` | pass: the kit's `bgA` and `bgB` take 95.31% of the probe's pixels (the second ground is close enough to `bgB` to count as it), its `accent` 1.28%; the most any look takes is `paper`'s, 0.09%, and no look's accent takes any. The fonts drawn: Snagwick Display, Snagwick Text and the template's MONO |
| `check --file out/repo-launch-final.mp4` | 0 FAIL, 0 WARN, 15 ok; -13.9 LUFS, -2.4 dBTP; `flash` ok (the largest too-fast area 12,685 px, under 21,824); `audio_spike` hears the effects and the bed summed; `hook_long` and `vo_delay` not checked (no voice) |
| the energy, measured from the frames (with `energy_match`'s thresholds, `references/check.md`) | 11 declared cuts, 11 confirmed: a mean shot of 1.25 s (2.4 beats, inside normal's 2 to 3); the largest line's ink 9.8% of the height (the end card's name); median motion 3.5% of pixels a frame (normal's floor is 2%) |

`scene.js` reads the logo from `brand.json` and the screenshot from `assets/shots/app.png`, draws in the kit's colours
and faces over the `product` look (quiet post, snap entrances, no glitch), and returns every text box from `boxes(t)`,
the helpers' layout-only calls included, so `check` sees the terminal and the code as text.

This example's own files: `board.js`, `scene.js`, `audio.js`, `brand.json` (the scan's), `assets/shots/app.png` (the
shot), `fixture/`, `board.png` and `contact.png`. Everything else is the template, unchanged.
