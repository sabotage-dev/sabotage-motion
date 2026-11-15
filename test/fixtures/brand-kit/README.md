# Fixture brand kit: Quillfen

A made-up brand (the name was searched first and is not a product's), used by the brand-kit tests
(`test/looks.test.mjs`) and by the fresh-session test of plan 23.2, which hands a session this folder's files and a
brief that does not mention them.

- `brand.json`: the kit. Its `bgA`, `bgB` and `accent` are each more than 15 (CIEDE2000) from every token of every
  look in `looks.js` and of the template's own palette (a test keeps it so), so a piece in the template's colours or
  a look's cannot pass `node render.mjs palette` for it.
- `fonts/quillfen-display.woff2` is Fraunces 800 and `fonts/quillfen-text.woff2` is Fredoka 600, the look faces of the
  same names in `skills/sabotage-motion/looks/fonts/`, copied unchanged under the kit's own family names (SIL OFL 1.1,
  the licence texts beside them). `mono` is left to the look or the template.
- `logo/`: the mark, a quill nib in a ring, drawn for this repo as SVG, for dark and for light grounds.

To use it in a piece: copy `brand.json` and every file it names into the piece folder, keeping their paths.
