# Assets

Every binary file in this repository, with where it came from and its licence. The asset inventory
test (`test/assets.test.mjs`) fails on a binary file that is not listed here and on a listed file that
is missing. A path in the licence column is relative to the piece the file belongs to (the template, or an
example), except `LICENSE`, which is this repository's own licence at its root.

| File | Source | Licence |
|---|---|---|
| `skills/sabotage-motion/template/fonts/archivo-black-latin-400-normal.woff2` | Archivo Black 400, Latin subset, from the `@fontsource/archivo-black` 5.3.0 npm package (upstream: github.com/Omnibus-Type/ArchivoBlack) | SIL OFL 1.1, `fonts/OFL-ArchivoBlack.txt` |
| `skills/sabotage-motion/template/fonts/inter-latin-600-normal.woff2` | Inter 600 (SemiBold), Latin subset, from the `@fontsource/inter` 5.3.0 npm package (upstream: github.com/rsms/inter) | SIL OFL 1.1, `fonts/OFL-Inter.txt` |
| `skills/sabotage-motion/template/fonts/jetbrains-mono-latin-500-normal.woff2` | JetBrains Mono 500 (Medium), Latin subset, from the `@fontsource/jetbrains-mono` 5.3.0 npm package (upstream: github.com/JetBrains/JetBrainsMono) | SIL OFL 1.1, `fonts/OFL-JetBrainsMono.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/archivo-black-latin-400-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-ArchivoBlack.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/inter-latin-600-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-Inter.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/jetbrains-mono-latin-500-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-JetBrainsMono.txt` |
| `skills/sabotage-motion/examples/explainer-beat/fonts/archivo-black-latin-400-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-ArchivoBlack.txt` |
| `skills/sabotage-motion/examples/explainer-beat/fonts/inter-latin-600-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-Inter.txt` |
| `skills/sabotage-motion/examples/explainer-beat/fonts/jetbrains-mono-latin-500-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-JetBrainsMono.txt` |
| `skills/sabotage-motion/examples/lower-third/fonts/archivo-black-latin-400-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-ArchivoBlack.txt` |
| `skills/sabotage-motion/examples/lower-third/fonts/inter-latin-600-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-Inter.txt` |
| `skills/sabotage-motion/examples/lower-third/fonts/jetbrains-mono-latin-500-normal.woff2` | A copy of the template's file of the same name (same source) | SIL OFL 1.1, `fonts/OFL-JetBrainsMono.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/anton-latin-400-normal.woff2` | Anton 400, Latin subset, from the `@fontsource/anton` 5.3.0 npm package (upstream: github.com/googlefonts/AntonFont); stands in for the condensed black system face the reel was first drawn with | SIL OFL 1.1, `fonts/OFL-Anton.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/bodoni-moda-latin-400-italic.woff2` | Bodoni Moda 400 Italic, Latin subset, from the `@fontsource/bodoni-moda` 5.3.0 npm package (upstream: github.com/indestructible-type/Bodoni); stands in for a Didone italic system face | SIL OFL 1.1, `fonts/OFL-BodoniModa.txt` |
| `skills/sabotage-motion/examples/showreel/fonts/jost-latin-700-normal.woff2` | Jost 700 (Bold), Latin subset, from the `@fontsource/jost` 5.3.0 npm package (upstream: github.com/indestructible-type/Jost); stands in for a geometric sans system face | SIL OFL 1.1, `fonts/OFL-Jost.txt` |
| `skills/sabotage-motion/examples/showreel/contact.png` | Rendered by this repo from the showreel's own scene (`node render.mjs contact` in the example's folder): a review sheet of its frames | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/showreel/board.png` | Rendered by this repo from the showreel's own scene and board (`node render.mjs board` in the example's folder): its board sheet | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/explainer-beat/contact.png` | Rendered by this repo from the explainer's own scene (`node render.mjs contact` in the example's folder): a review sheet of its frames | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/explainer-beat/board.png` | Rendered by this repo from the explainer's own scene and board (`node render.mjs board` in the example's folder): its board sheet | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/lower-third/contact.png` | Rendered by this repo from the lower third's own scene (`node render.mjs contact` in the example's folder): a review sheet of its frames | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/lower-third/board.png` | Rendered by this repo from the lower third's own scene and board (`node render.mjs board` in the example's folder): its board sheet | MIT (this repo's own work), `LICENSE` |
| `skills/sabotage-motion/examples/explainer-beat/take-raw.wav` | The example's voice: synthesized with the Kokoro-82M v1.0 text-to-speech model, voice `af_heart`, from the board's lines, run locally (`VOICE.md` says how). Not a recording of any person | Apache License 2.0, `LICENSE-voice.txt` (the model's licence, huggingface.co/hexgrad/Kokoro-82M) |
| `skills/sabotage-motion/examples/explainer-beat/bed.mp3` | The example's music bed, synthesized from code by `examples/explainer-beat/make-bed.mjs` in this repo (no samples, no recordings) | MIT (this repo's own work), `LICENSE` |
| `docs/media/hero.gif` | Eight seconds (2 s to 10 s) of the showreel example, cut by `node scripts/readme-media.mjs hero` from that example's own render (`node render.mjs video` in its folder) | MIT (this repo's own work), `LICENSE` |
| `docs/media/plumtrail-1.gif` | A GIF of the master a fresh Claude Code session made with this skill (0.1.0) from the README's "One prompt, three results" request, cut by `node scripts/readme-media.mjs tile`; its type is the template's bundled fonts (SIL OFL 1.1) | MIT (made for this repo), `LICENSE` |
| `docs/media/plumtrail-2.gif` | As `plumtrail-1.gif`, from the second session | MIT (made for this repo), `LICENSE` |
| `docs/media/plumtrail-3.gif` | As `plumtrail-1.gif`, from the third session | MIT (made for this repo), `LICENSE` |
