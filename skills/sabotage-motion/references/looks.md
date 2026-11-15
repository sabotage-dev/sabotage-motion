# Looks and brand kits: a style on purpose, the kit, the brand sheet, the colour match

A piece's style is its colours, fonts, background, post settings, motion vocabulary and sound timbre. It comes from
three layers and the command line, resolved by `looks.js` before the scene's `init` and handed to it as
`init({ style })` (and to `audio.js` as `renderAudio({ style })`):

1. the **template's own style** (`TEMPLATE` in `looks.js`), what the title card drew before looks existed;
2. a **look**: one of eight named starting points, picked with `--param look=<name>`, `CFG.LOOK = '<name>'` in the
   scene, or `brand.json`'s `look` (in that order);
3. a **brand kit**: `brand.json` in the piece, which overrides the look's colours and fonts;
4. then **`--param`**: `--param bgA=#hex` (any token) and `--param bg=<shader id>` win over everything.

So the precedence for every value is `--param` over `brand.json` over the look over the template.

## Contents
1. The style
2. The eight looks
3. Picking a look
4. Look fonts
5. The brand kit (`brand.json`)
6. The brand sheet (`render.mjs brand`)
7. The colour match (`render.mjs palette`)
8. What the render records

## 1. The style
| Part | What it holds | How a scene uses it |
|---|---|---|
| `tokens` | `bgA`, `bgB` (the background pair), `ink` (text), `muted` (secondary text, rules), `accent`, `accent2`, each `#RRGGBB` | `style.tokens.ink` as a fill; `rgba(style.tokens.accent, 0.5)` from `lib.js` |
| `fonts` | `display`, `body`, `mono`: `{ family, file? }` | `ctx.font = fontStr(style, 'display', 120)` (from `looks.js`) |
| `bg` | The background shader id: `none`, `gradient`, `paper`, `grid`, `crt`, `mesh`. Never a colour | `return { t, jit, use2D: true, ...bgConfig(style, { alpha }), cam }` from `frame()`: the shader's colours come from the tokens |
| `bgParams` | The shader's numbers: `drift` (gradient, mesh), `glow` and `line` (grid: which token draws its lines), `lines` and `flicker` (crt) | read by `bgConfig` |
| `post` | `bloom`, `thr`, `ca`, `grain`, `vig`, `scan` (CRT scanlines over the whole frame) | spread into `post(t)`'s return, then add your own accents |
| `motion` | `enter` (`spring`, `snap`, `anticip`, `step`), `stagger` (s), `sweep` (a light sweep is allowed), `glitch` (a glitch at cuts is allowed), `exit` (`whip`, or `cut` for hard cuts) | the template's `enterK`/`exitK` in `scene.js` show one way |
| `sound` | `wave` (an oscillator type), `pitch`, `bright` (multipliers on tones and noise bands), `verb` (reverb send) | the template's `audio.js` reads them |
| `sources` | Where each token, font role and `bg` came from: `template`, `look`, `brand` or `param` | for the brand sheet and debugging |

The template's `scene.js` and `audio.js` read every part, so `--param look=neon` on a fresh copy already shows the
look. A scene you write from scratch should read the style the same way instead of hard-coding colours and faces:
then a kit or a look changes the piece without code.

## 2. The eight looks
| Look | For | `bg` | Display / body | Motion | Look fonts to copy |
|---|---|---|---|---|---|
| `product` | clean light UI, crisp and quiet | `gradient` | BODY / BODY | snap, 50 ms stagger, no sweep, no glitch | none |
| `neon` | dark, glow, a glitch at cuts | `grid` | DISPLAY / BODY | snap, a sweep, a glitch at cuts | none |
| `paper` | warm texture, serif, gentle springs | `paper` | SERIF / HAND | spring, 90 ms stagger, no glitch | `fraunces-latin-800-normal.woff2`, `caveat-latin-700-normal.woff2` |
| `editorial` | bold serif, black and white, one accent | `gradient` | SERIF / BODY | snap, hard cuts | `fraunces-latin-800-normal.woff2` |
| `retro-crt` | scanlines and phosphor glow | `crt` | MONO / MONO | stepped entrances, a glitch at cuts, hard cuts | none |
| `brutalist` | condensed type, primaries, snaps | `none` | CONDENSED / MONO | snap, 30 ms stagger, hard cuts | `anton-latin-400-normal.woff2` |
| `gradient` | soft mesh colour, rounded sans | `mesh` | ROUNDED / ROUNDED | anticip, a sweep | `fredoka-latin-600-normal.woff2` |
| `mono` | high-contrast black and white | `gradient` | DISPLAY / MONO | snap, a sweep | none |

`docs/media/looks.png` in the repo shows the template's title card in each (`scripts/looks-sheet.mjs` makes it, and
each card passes `check` with no FAIL and no WARN). DISPLAY (Archivo Black), BODY (Inter SemiBold) and MONO
(JetBrains Mono) are the template's own faces, declared in `index.html`.

## 3. Picking a look
- **With a brand kit, use it.** The kit's colours and fonts win over any look; a look then only supplies what the
  kit leaves out (the shader, post, motion, sound, and any token or font role the kit does not give).
- **Without one, pick a look on purpose, and say which and why**: "editorial, because the brief is a news-style
  quote card: serif, one red accent, hard cuts". Match the vocabulary to the subject (warm and human: `paper`, no
  glitch; tech and night: `neon` or `retro-crt`; a product UI: `product`).
- **Do not reuse the same palette from piece to piece.** The template's own dark palette is a fallback, not a
  house style; a run of pieces in it reads as one template. Start from a look, then make it the piece's own: change
  the accent, a font, the shader, with `--param` first and in code once it is settled.

## 4. Look fonts
The four look faces live once in `${CLAUDE_SKILL_DIR}/looks/fonts/`, each with its SIL OFL text, not in the
template (the examples do not each carry a copy): SERIF (Fraunces 800), CONDENSED (Anton), ROUNDED (Fredoka
SemiBold) and HAND (Caveat Bold), Latin subsets, 104 KB together. Copy only the files the piece's look uses into
the piece's `fonts/`, with their licence texts:

```sh
cd motion/<piece>
for f in $(node --input-type=module -e "import { lookFiles } from './looks.js'; console.log(lookFiles('paper').join(' '))"); do
  cp "${CLAUDE_SKILL_DIR}/looks/fonts/$f" fonts/
done
```

The harness registers them with `FontFace` from `fonts/` before `init` and adds their families to `CFG.FONTS`, so a
missing one fails the render with the file to copy (and `check` reports it under `fonts`; `doctor` names it too).

## 5. The brand kit (`brand.json`)
A project's brand as files: it lives in the project root, and each piece keeps its own copy of it and of every file
it names (paths are relative to `brand.json`), so the piece still re-renders on its own.

```json
{
  "name": "Fernway",
  "look": "paper",
  "colors": { "bgA": "#0F2A2E", "bgB": "#173A3F", "ink": "#F4EFE3", "muted": "#9FB5B0", "accent": "#F2A93B", "accent2": "#7FD1B9" },
  "fonts": {
    "display": { "family": "Fernway Display", "file": "fonts/fernway-display.woff2" },
    "body": { "family": "Fernway Text", "file": "fonts/fernway-text.woff2" }
  },
  "logo": { "onDark": "logo/fernway-on-dark.svg", "onLight": "logo/fernway-on-light.svg" }
}
```

- `name` is required. `look` (optional) is the base look the kit builds on; `CFG.LOOK` and `--param look` still
  pick another.
- `colors` takes the six tokens, `#RRGGBB` or `#RGB`; any it leaves out come from the look or the template.
- `fonts` takes `display`, `body` and `mono`, each `{ family, file }`. Give the kit's own family names (not
  DISPLAY, BODY, MONO, a look font's or a CSS generic). A font that is not the project's own needs a licence that
  allows video use.
- `logo` takes `onDark` (the file to use on a dark ground) and `onLight`. Use the real logo files and reveal them;
  never redraw a brand mark.
- **Brand notes** (tone, do and don't, what the live site ships) stay prose in the project's CLAUDE.md; tokens and
  files go here. When a kit disagrees with what the live product ships, the shipped one wins: say so.

When a piece is created: `cp brand.json` and every file it names into the piece (keeping their paths), run
`node render.mjs doctor` (it checks that every file exists, every colour parses and every face loads), then the
brand sheet.

## 6. The brand sheet (`render.mjs brand`)
`node render.mjs brand [--out brand.png]` draws the style in effect on one sheet: the six tokens as swatches with
their hex and source, a specimen line in each font role, and the kit's logo on its darkest and its lightest of
`bgA`, `bgB` and `ink`. Show it to the person to approve before anything is animated; a wrong colour or a fallback
font is cheap to fix here. Without `brand.json` it shows the look's (or the template's) style. `brand.png` is a
review sheet: it is ignored by git and left out of the source hash.

## 7. The colour match (`render.mjs palette`)
`node render.mjs palette [--brand brand.json] [--json]` measures whether a piece is in its kit's colours:

- it renders check's probe frames (half size, one subframe, grain off), every frame, and counts every pixel by its
  exact colour;
- each colour goes to the nearest colour (CIEDE2000) among the kit's tokens, the template's and every look's
  default tokens, the earlier on a tie (the kit first); a colour more than 10 from all of them is no one's. No
  clustering, no sampling: the same piece gives the same numbers every run;
- the kit's `bgA` and `bgB` together must take at least 15% of the pixels and its `accent` at least 0.5%, and no
  look's defaults (nor the template's) may take more than either, role by role: no other `bgA` and `bgB` more than
  the kit's, no other `accent` more than the kit's.

It prints the coverage of each token, each look's share, the font families the scene drew, and the four rules, and
exits 1 when one fails (2 when there is no kit, or the kit gives no `bgA`, `bgB` or `accent`). `--brand` reads
another kit file without rendering with it. Run it after the board is animated and before the final render, and fix
a failure in the scene (a hard-coded colour, a look's accent left in), not in the kit.

## 8. What the render records
`video` and `full` add to `out/<name>.mp4.render.json`: `look` (or null), `brand` (the kit's name, or null),
`tokens` (the resolved colour tokens) and `fonts_used`: the font families in effect at every `fillText` and
`strokeText` the scene made (in `init`, `frame` and `drawHud`, on any canvas), parsed from `ctx.font`. Setting
`ctx.font` only to measure or lay out text (as `captions(..., { draw: false })` does) is not a draw and is not
recorded, so `fonts_used` says which faces are actually on screen.
