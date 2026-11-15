# Code and terminal motion

`code.js` in a piece draws code being typed, a diff landing, a terminal session and the frames they sit in (a window,
a browser, a phone), and plays a key tick for the typing. Use it for a developer tool's demo or launch video, a code
explainer, a "before and after" of a fix, or any beat where the screen is a terminal or an editor. For a real app's
screen, use a screenshot or a recording instead (`references/techniques.md` section 10); for a snippet that only has to
be read, a still block of code (`type: false`) is enough.

Every helper is a pure function of `t`: typing follows a seeded cadence (no `Math.random`, no clock), so any frame
renders on its own and the same seed always types the same way. The example `examples/terminal-demo/` uses all of it.

## Contents
1. Build once, draw every frame
2. Highlighting and colours
3. Typed code: `codeBlock`, `drawCode`
4. Diffs: `diffBlock`, `drawDiff`
5. A terminal session: `termSession`, `terminal`
6. Frames: `frameLayout`, `drawFrame`
7. Boxes and `check`
8. Key ticks
9. Limits

## 1. Build once, draw every frame

Build each block in `init` (it tokenizes the code and works out when every character appears), then draw it in
`frame(t)` and report it in `boxes(t)` with the same call and `draw: false`:

```js
import { codeTheme, frameLayout, drawFrame, codeBlock, drawCode, typedTimes, keyTicks } from './code.js';
let TH, WIN, CODE;
export async function init({ ctx, style }) {
  TH = codeTheme(style);                                            // the look's or the kit's colours and mono face
  WIN = frameLayout('window', { x: 72, y: 400, w: 840, h: 560 });   // the frame's rectangles; WIN.content is inside it
  CODE = codeBlock({ src: SRC, lang: 'ts', ...WIN.content, theme: TH, size: 32, start: 0.6, type: { cps: 20, seed: 4 } });
  TL.keys = keyTicks(typedTimes(CODE));                             // for audio.js
}
export function frame(t, jit) {
  drawFrame(ctx, 'window', WIN.outer, { theme: TH, title: 'src/clock.ts' });
  drawCode(ctx, CODE, t);
  return { t, jit, use2D: true, ...bgConfig(ST, { alpha: ALPHA }), cam: [1, 0, 0, 0] };
}
export const boxes = (t) => [
  ...drawFrame(ctx, 'window', WIN.outer, { theme: TH, title: 'src/clock.ts', draw: false }),
  ...drawCode(ctx, CODE, t, { draw: false }),
];
```

Each draw call takes `{ draw, alpha, dx, dy }`: `alpha` fades the block (at 0.05 or less it reports no boxes), and
`dx`, `dy` move it with its viewport, for a window that slides or lifts. Pass the same values to the `draw: false` call,
or the boxes are not where the text is.

## 2. Highlighting and colours

`tokenize(src, lang)` gives `[{ k, s }]` (a kind and its text, `'\n'` its own token of kind `nl`); `highlight(src,
lang)` splits the same into lines. Languages: `js`, `ts` (also `javascript`, `typescript`, `jsx`, `tsx`), `python`
(`py`), `shell` (`sh`, `bash`, `zsh`, `console`), `json`, `diff`; `plain` (or none) colours nothing. Kinds: `plain`,
`kw`, `lit`, `str`, `num`, `com`, `fn`, `type`, `prop`, `punct`, `op`, `meta`, `var`, `flag`, `cmd`, `prompt`, `add`,
`del`, `hunk`, `ctx`. It is a small scanner, not a parser: a regular expression literal reads as operators, and a
shell heredoc as plain words.

`codeTheme(style)` turns the piece's style (its look, or `brand.json`) into colours: keywords and shell commands take
`accent`, strings, variables and the prompt `accent2`, comments `muted`, text the `ink`, and the rest mixes of them.
Added lines take whichever of `accent` and `accent2` is nearer green, removed lines the other. The panel is `bgA`
mixed 6% toward the `ink`, and every colour moves toward the `ink` until it reads at 3:1 or more on it
(`CODE_CONTRAST`), so a light look gets a light editor and a dark look a dark one. The mono face is the style's
`mono` role (`MONO` by default), the frames' titles its `body`. Override any colour or face:
`codeTheme(style, { kw: '#hex', surface: '#hex', family: 'Kit Mono' })`.

## 3. Typed code: `codeBlock`, `drawCode`

```js
codeBlock({ src, lang, x, y, w, h, theme, size: 32, lineH: 1.45, pad, numbers: true, start: 0, shown: 0,
            type: { cps: 22, jitter: 0.35, seed: 1, linePause: 0.16, spacePause: 0.02 } | false,
            cursor: 'block' | 'bar' | false, blink: 1.0, highlight: [{ lines: [a, b], from, to }],
            focus: [{ lines: [a, b], from, to, dim: 0.3 }], follow: true, margin: 1, scrollDur: 0.35,
            scroll: [{ at, top, dur }], id: 'code' })
```

- **Typing.** From `start`, one character every `1/cps` s, each gap varied by up to `jitter` (seeded by `seed`), plus
  `linePause` after a newline and `spacePause` after a space. The indentation after a newline arrives with it, as an
  editor indents for you. `type: false` shows the whole block from the start. `shown: n` puts the first n lines
  there before typing starts (a file being edited), and typing goes on from line n + 1.
- **The cursor** is solid while keys come and for 0.5 s after the last one (`CURSOR_SOLID`), then blinks every `blink`
  seconds; a prompt that has not been typed into blinks from t = 0, on first.
- **Line highlight and focus.** `highlight` lays a band of the accent behind lines a to b (numbered from 1) from
  `from` to `to`; `focus` dims every other line to `dim`. Both fade in and out over 0.25 s. A line dimmed to 0.05 or
  less reports no box.
- **Scrolling.** The view follows the cursor down, keeping `margin` rows under it, each move eased over `scrollDur`.
  `scroll: [{ at, top, dur }]` instead moves it so line `top` is the first row at each `at`.
- **No wrapping.** A line wider than the viewport is cut at its edge. Size the font so the longest line fits:
  `fitSize(ctx, theme.family, cols, width, { max, min })`.

`codeAt(block, t)` is the state without a canvas: `{ typed, total, done, line, col, cursor, scroll, rows, lines }`.

## 4. Diffs: `diffBlock`, `drawDiff`

```js
diffBlock({ src /* a unified diff */, lang: 'ts', x, y, w, h, theme, size, lineH, pad, start: 0, step: 0.3,
            grow: 0.25, hunks: true, follow: true, margin: 0, scrollDur: 0.35, id: 'diff' })
```

The context and the removed lines show from the start, as the file was. From `start`, the changes land in order,
`step` seconds apart: a removed line takes the removed colour, its `-` and a strike-through; an added line opens over
`grow` seconds, pushing the lines under it down, with its `+`. `lang` colours the code inside the lines. File headers
(`diff`, `index`, `---`, `+++`) are left out: put the file's name in the frame's title. Hunk headers show unless
`hunks: false`. When a change lands below the view, it scrolls. `diffAt(block, t)` is the state: `{ landed, changes,
scroll, rows: [{ kind, text, open, mark }] }`.

## 5. A terminal session: `termSession`, `terminal`

```js
termSession({ x, y, w, h, theme, size, lineH, pad, prompt: '$ ', lang: 'shell', start: 0, type: { cps, seed },
  cursor: 'block', blink: 1.0, end: true, scrollDur: 0.12, id: 'term', steps: [
    { cmd: 'mycli init', pause: 0.3, enter: 0.15, at },        // typed after `pause` (or at `at`), then Enter
    { out: 'a line' | ['line', ...], every: 0.06, after: 0, at, kind: 'plain' },
    { spin: 'reading files', dur: 1.2, done: '+ read 6 files', fps: 10, frames: ['|', '/', '-', '\\'], kind, doneKind },
    { bar: 'fetching', dur: 1.4, width: 16, done: '+ fetched', kind, doneKind },
    { wait: 0.5 } ] })
```

A row per command or line of output, each step starting when the one before is done, or at its `at` (picture time) if
that is later: tie the steps to the board's beats with `at: beatWindow('run')[0] + 0.1`. The session opens on a prompt
that is there from the first frame, and (with `end: true`) ends on a fresh one. Commands are coloured as shell; `kind`
and `doneKind` take any theme kind for output (`add` for a success line, `del` for an error, `com` for a quiet one). The
spinner turns ASCII frames at `fps`; the bar is drawn as rectangles, its percentage eased. When the rows outgrow the
viewport the view scrolls so the newest row is the last. `termAt(session, t)` is the state: `{ rows, scroll, typing,
cursor, cursorRow, fill }`.

## 6. Frames: `frameLayout`, `drawFrame`

Generic shapes, with no product's marks or trade dress: a **window** (a title bar with three dots in the theme's border
colour and a centred title), a **browser** (back and forward chevrons and an address field) and a **phone** (a rounded
body, a small round camera, a status row with a time and a battery drawn as shapes). `frameLayout(kind, rect, o)` gives
`{ outer, bar, content, radius }` without a canvas (a phone also `screen`); put the code, the terminal or a screenshot in
`content`. `drawFrame(ctx, kind, rect, { theme, title, url, time: '12:00', alpha, dx, dy, shadow: true, id })` draws
the frame and its surface and returns its boxes, all `deco`; the array carries `.layout`. Do not draw a real browser's
or phone maker's look, and never a real product's logo in the frame.

## 7. Boxes and `check`

The `draw: false` call returns the boxes of the text visible at `t`, one per visible line, in design pixels:

- cut to the block's viewport (a line half scrolled out reports the half that shows);
- a line scrolled out entirely is left out;
- every line of a block has `group` set to the block's `id`, so `text_overlap` never reads a block's own lines as
  overlapping each other (give two blocks two ids);
- the cursor's box and every box `drawFrame` returns are `deco`, so `text_safe` and `text_overlap` leave the chrome
  alone: a frame, its title or a phone over the code is not an overlap;
- the box's text is the line as it shows (a typed prefix; a removed line with its `-`), so the board's `on` copy can
  name a command or a line of code and `board_copy_*` find it.

Keep every block inside the target's safe area, as any text: on `tiktok-ad` a window under the button column has to
stop at x 780 below y 840. A window that slides in from off screen carries its text out of the safe area while it
moves; fade it in place, or keep its rows empty until it lands.

## 8. Key ticks

`typedTimes(block)` lists the key presses of a code block or a session (`{ t, key: 'char' | 'space' | 'enter' }`):
typed characters and Enter, never output, indentation or lines that were already there. Merge the lists of every block
that types, then thin them with `keyTicks(list)` to at most `KEY_MAX` (12) a second in any second, at least 1/12 s
apart (`keyTicks(list, { max })` for another ceiling): fast typing would otherwise turn into noise. Put the result in
`TL`, and in `audio.js` play it with `keySounds(ac, dest, TL.keys, { seed, level: 0.18, style })`: a short band-passed
noise click each, Enter lower, varied by the seed, in the look's timbre. Nothing ticks while nothing types.

## 9. Limits

- The grid is monospace: one advance per character, measured once from the mono face. Keep code to Latin text; a CJK
  character or an emoji takes two cells and breaks it.
- The bundled faces are Latin subsets. Box drawing, braille spinners and check marks fall back to a system font, so
  the spinner is ASCII and the bar is rectangles; use `+` or `ok` where a terminal would print a check mark.
- No line wraps. Fit the size to the longest line.
- Show the project's own tool, commands and output. For a demo with no project behind it, make the names up (search
  them first, so they are not a real tool's) rather than show someone else's product, its output or its logo.
