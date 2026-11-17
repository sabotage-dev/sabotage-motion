# A launch video for a repo

The recipe for "make a launch video for this project": a CLI, a library, an app, anything in a repository. It is the
usual workflow (SKILL.md) with two tools in front of it, `tools/repo-scan.mjs` and `tools/shots.mjs`, and a board shape
that works for a launch. The example `examples/repo-launch/` is this recipe run on a made-up project: read it as a
reference, never copy it as a starting point (its `brand.json`, `fixture/` and shot are another project's).

## Contents
1. The order
2. Scan the project: `tools/repo-scan.mjs`
3. The kit from the scan
4. Pictures of the app: `tools/shots.mjs`
5. The board
6. Render, mix, `palette`, `check`
7. Limits

## 1. The order
0. **Start the piece from the template**, in the project: `cp -R "${CLAUDE_SKILL_DIR}/template" <project>/motion/<piece>`
   (then `chmod -R u+w` it, as SKILL.md's quick start says). Not from the example: it is a reference only. Every file
   the work makes stays inside the piece, temporary ones included (the project's `brand.json` is the one file it writes
   in the project root); never move or write a file outside the project, to `/tmp` or anywhere else.
1. **Scan** the project (`node tools/repo-scan.mjs <project>`).
2. **Write `brand.json` from what the scan found** (`--brand`), **render the kit sheet** (`node render.mjs brand`) and
   **show it** to the person, with the draft and the scan's notes. They correct it; you never guess a brand silently.
3. **Write the board**: a hook, the install in a terminal, two or three feature beats with code or screenshots in a
   frame, and an end card with the logo and the install command (section 5).
4. **Render the board sheet before rendering** (`node render.mjs board --slates`) and show it. The structure is
   cheapest to change here.
5. **Render, mix, then `palette` and `check`**, as for any piece (section 6).

**The two sheets always come before the full render**: `brand.png` (`node render.mjs brand`) and `board.png`
(`node render.mjs board --slates`), even when nobody can approve them now (the request asked for the finished file, or
the session runs on its own). Then go on, and name both sheets in your reply, so the person can look at them.

## 2. Scan the project: `tools/repo-scan.mjs`

```sh
node tools/repo-scan.mjs ../..                         # from a piece in <project>/motion/<piece>/: the project
node tools/repo-scan.mjs ../.. --brand ../../brand.json  # the same, and the draft kit in the project root
```

It reads the project's files as text and prints JSON; every value says where it came from (`file`, `line`):

| Field | Where it comes from |
|---|---|
| `name` | The README's title (its first heading, at any level, with only pictures, badges and HTML above it), else `package.json`, `pyproject.toml` or `Cargo.toml`, else the folder's name |
| `pitch` | The package metadata's description, else the README's first sentence of prose |
| `install` | The first install command in a README code block (`npm install`, `pip install`, `cargo install`, `brew install` ...; a line ending in `\` goes on to the next) that installs this package: it names the package, installs globally (`-g`, `--global`), or sits under an Install-like heading (Install, Setup, Getting started, Quick start). Else one made from the metadata (`derived: true`), so a bare `npm install` from a Development section is never taken |
| `features` | The list items under a README heading named like Features (Features, Highlights, Why ..., What it does), then the README's other section headings that are not boilerplate |
| `colors` | CSS custom properties (`--name:` a hex, `rgb()`, `hsl()` or `oklch()` value, or a `var()` of one, or its fallback (`var(--x, #hex)`) when `--x` is not declared; `via` says which) in stylesheets and pages; a Tailwind config's theme colours, read as text; a web manifest's `theme_color` |
| `fonts` | `@font-face` rules (the family; its best local file from every `src`, woff2, then woff, ttf, otf, then the rest; weight, style) and font links (a font service's `<link>` or `@import`: the families in its URL), each with the roles the project gives it: `display` (h1 to h3, `.title`, `--font-display`), `body` (body, p, `--font-body`), `mono` (code, pre, `--font-mono`) |
| `logos` | Image files that could be the logo, ranked by a score with its reasons: a logo word in the name, the project's name in it, SVG over PNG, a shallow or brand folder, the README's first picture, a page's or a manifest's icon |
| `screenshots` | Image files with a screenshot word in the name or folder, and the README's other pictures |
| `skipped` | The dependency and build folders it did not read: `node_modules`, `vendor`, `.venv`, `dist`, `build`, `out`, `target`, `.next`, `coverage`, `.git` and the like, and every hidden folder but `.github` |
| `brand` | The draft kit (`kit`), where each value came from (`from`), and what it could not decide (`notes`) |

It never runs the project's code (a Tailwind config is read as text) and never touches the network: a font link's
families come from its URL, a remote picture is left out. It writes nothing unless `--brand` names a file, and it never
overwrites one.

## 3. The kit from the scan
The draft maps colours to tokens by their names. A colour whose whole name (after a leading `--` and `color-`) is one of
a token's exact names wins; only then does a name holding one of its words count, so an earlier `--highlight` never
takes the accent from a real `--accent`. Among each, the first one found wins (stylesheets, then the Tailwind config,
then the manifest, whose `theme_color` fills `accent` only when nothing else does).

| Token | Exact names | Also a name holding |
|---|---|---|
| `bgA` | `bg`, `background` | `bg`, `background`, `canvas`, `page`, `backdrop` |
| `bgB` | `surface`, `bg-2`, `bg-alt` | `surface`, `panel`, `card`, `elevated`, `raised`; a background word with `alt`, `2`, `secondary` or `soft`; a muted word with `bg`, `background` or `surface` |
| `ink` | `text`, `fg`, `foreground` | `text`, `fg`, `foreground`, `ink`, `copy` |
| `muted` | `muted`, `text-muted` | `muted`, `subtle`, `dim`, `faint`; a text word with `secondary` |
| `accent` | `accent`, `primary`, `brand` | `accent`, `primary`, `brand`, `highlight`, `tint` |
| `accent2` | `accent-2`, `secondary` | `secondary`, `tertiary`, `link`; an accent word with `2`, `alt`, `secondary` or `tertiary` |

A name holding `border`, `ring`, `shadow`, `outline`, `divider`, `overlay`, `scrim`, `hover`, `active`, `focus`,
`disabled`, `selection` or `on` is never a token, nor is a shade of a scale (a number other than 2 or 500: `brand-100`).
With a `bgA` and no second background, `bgB` is `bgA`. A token with no name for it is left out, for the look to fill. Fonts: the family of each role
that has a local file. Logo: the top-ranked file, for both grounds.

So read the draft before you use it, and show it:

- **Colours**: is the accent the brand's, or a link colour? Does the project have a dark and a light theme (both are in
  `colors`; the first one found is in the kit)? `palette` later needs `bgA`, `bgB` and `accent` in the kit.
- **Fonts**: a face that is only a font service link has no file; the notes say so. Add a file whose licence allows
  video use, or leave the role to the look.
- **Logo**: the top candidate is not always the logo, and one file serves both grounds until you set `onDark` and
  `onLight`. Use the real file; never redraw a mark.
- Then copy `brand.json` and every file it names into the piece, keeping their paths, run `node render.mjs doctor` and
  `node render.mjs brand`, and show the brand sheet. (The example keeps its made-up project inside the piece and writes
  the kit there, so it stays self-contained; a real project's kit lives in its root.)

## 4. Pictures of the app: `tools/shots.mjs`

```sh
node tools/shots.mjs page home ../../site/index.html --viewport 390x844 --dpr 2          # assets/shots/home.png
node tools/shots.mjs seq feed http://localhost:5173/feed --viewport 390x844 --dpr 2 --dur 3 --scroll 0:1400
```

The source is a local HTML file or an app running on this machine (`localhost`, `127.0.0.1`, `[::1]`); anything else is
refused. The viewport is stated in CSS pixels, with `--dpr` device pixels to each (2 for a phone viewport the scene
draws large, so it stays sharp).

- **A page that does not move: `page`.** One full-page screenshot, its full height, with the page's CSS animations
  finished. The scene draws it and pans it, so scrolling costs one image: in `init`, `const img = new Image();
  img.src = 'assets/shots/home.png'; await img.decode();`, and in `frame(t)` draw a window of it
  (`ctx.drawImage(img, 0, y0, img.width, viewH, x, y, w, h)`) with `y0` eased over the beat. Prefer this.
- **A page that moves: `seq`.** A frame sequence in the layout `tools/frames.mjs` writes and `loadSeq` reads
  (`assets/seq/<name>/000.png ...` and its entry in `assets/seq/manifest.json`), `round(dur x fps)` frames at the
  piece's fps, scrolled from one position to the other (`--ease swift`, the default, or `linear`). Each frame is set,
  then taken: the page's clock (timers, `requestAnimationFrame`, `Date`) is run forward a frame at a time and every
  CSS animation is set to its time, so the same page gives the same frames. In the scene: `await loadSeq('feed')` in
  `init`, `ctx.drawImage(seqAt('feed', t, t0), x, y, w, h)`.
- **The memory limit.** `loadSeq` holds every frame decoded, so a sequence over 1 GB decoded (frames x width x height x
  4 bytes, in device pixels) is refused before anything is captured: lower the size (`--viewport`, `--dpr`) or the
  length (`--dur`). A 390x844 viewport at dpr 2 is 5.0 MB a frame decoded: 3 s at 30 fps holds 0.44 GB, and 8 s
  (1.18 GB) is refused; at dpr 1, 8 s holds 0.29 GB.
- There is no live screen recording. To show a real recording, cut it with `tools/frames.mjs`.

## 5. The board
A launch video is short: 12 to 20 s for social. A shape that works (the example's, 15 s):

| Beat | Length | What it shows |
|---|---|---|
| `hook` | 2 to 3 s | The pitch, from the scan, with the logo; or the pain the project removes. Open on content (the first frame is the thumbnail). |
| `install` | about 3 s | A terminal (`termSession`, `terminal` in `code.js`) typing the scan's install command, its output, a progress bar or a spinner. |
| features | 3 s each, two or three | One idea each, from the scan's features: code in a window (`codeBlock`, `drawCode`, `drawDiff`) or the app in a browser or phone frame (`drawFrame` with a shot drawn into `content`). |
| `end` | 3 s or more | The logo, the name and the install command, `hold: true`, no exit. |

Put each beat's exact copy in `on` (the install command too: `check` finds it in the terminal's boxes), keep every text
box inside the safe area (fade or lift windows in place), and give each beat a sound note. Then show the slates.

## 6. Render, mix, `palette`, `check`
As in SKILL.md's step 10: `node render.mjs check` (0 FAIL; read every WARN), `node render.mjs palette` (the kit's
background must take 15% of the pixels and its accent 0.5%, and no look more: a failure means a look's or the
template's colours took over, so fix the scene, not the kit), then `node render.mjs full --out out/<name>.mp4`,
`node tools/mix.mjs <name> --master-only` (no voice; or the voiced mix), and
`node render.mjs check --file out/<name>-final.mp4`. A screenshot is a picture, not text: `check` does not read it, so
look at the contact sheet for text in the shot that a platform's buttons would cover.

## 7. Limits
- The scan reads names, not designs: a colour named `--bg` that the project never uses still becomes `bgA`. That is why
  the draft is shown first.
- Colours in Sass variables, CSS-in-JS, design-token JSON or images are not read; add them to the kit by hand.
- `shots.mjs` takes the page as Chrome draws it at that viewport, scrolling the window (not an inner scrolling element).
  Video elements and a page's own network data are not set per frame. Timers, `requestAnimationFrame` and CSS
  animations are the same on every run; a page that reads `performance.now()` or `Date.now()` while it loads, outside a
  timer or a frame callback, can read it a millisecond apart from run to run (Playwright's clock).
