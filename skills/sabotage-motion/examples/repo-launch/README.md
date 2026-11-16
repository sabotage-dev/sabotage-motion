# repo-launch

15 s, 9:16: a launch video for a made-up project, Snagwick, a command-line tool that finds every TODO in a codebase and
puts them on a board. It is made the way `references/launch.md` says: scan the project, write the kit from the scan, take
the app's picture, board, render, mix, then `palette` and `check`.

- **hook**: the logo springs in, the pitch rises under it;
- **install**: a terminal types the install command, a progress bar fills (`termSession`, `terminal`);
- **find**: a source file in a window, its TODO and FIXME lines lighting up (`codeBlock`, `drawCode`);
- **board**: the app's board, a full-page screenshot, panned inside a phone (`drawFrame`);
- **end**: the logo, the name and the install command, held to the last frame.

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
node tools/shots.mjs page app fixture/app/index.html --viewport 390x844 --dpr 2   # assets/shots/app.png
node render.mjs board                                   # board.png and board.md
node render.mjs contact                                 # contact.png
node render.mjs check                                   # the source: 0 FAIL, 0 WARN
node render.mjs palette                                 # the colour match against brand.json: pass
node render.mjs full --out out/repo-launch.mp4          # the picture and its synthesized sound
node tools/mix.mjs repo-launch --master-only            # the sound mastered to -14 LUFS
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
- **The board** was shown as slates (`node render.mjs board --slates`) before anything was animated.

`scene.js` reads the logo from `brand.json` and the screenshot from `assets/shots/app.png`, draws in the kit's colours
and faces over the `product` look (quiet post, snap entrances, no glitch), and returns every text box from `boxes(t)`,
the helpers' layout-only calls included, so `check` sees the terminal and the code as text.

This example's own files: `board.js`, `scene.js`, `audio.js`, `brand.json` (the scan's), `assets/shots/app.png` (the
shot), `fixture/`, `board.png` and `contact.png`. Everything else is the template, unchanged.
