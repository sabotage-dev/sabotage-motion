---
name: sabotage-motion
description: Make motion-graphics videos in code. Kinetic typography, title and end cards, logo stings and reveals, animated captions and lower thirds, transparent overlays for existing footage, product and app promo animations, data and counter animations, and synthesized sound effects synced to the picture. A scene is a pure function of time, drawn with Canvas2D over an optional WebGL2 pass and rendered frame-exact to MP4, MOV or WebM. Use it whenever someone wants an animated video asset, a sting, an intro or outro, an end card, animated text over a clip, a short vertical social clip or a website loop whose content is graphics and type rather than filmed people. Not for photoreal people or scenes, and not for in-app UI animation.
---

# sabotage-motion

This is a placeholder from the first build phases: the engine template, the storyboard and the voice
tools are in place with their tests, and the full skill text (workflow, storyboard, voice cues, mix, checks, craft notes and
references) arrives in phase P4.

Until then, the template works on its own:

```sh
cp -R "${CLAUDE_SKILL_DIR}/template" motion/<piece>
cd motion/<piece> && npm install
node render.mjs doctor                 # Chrome, WebGL2, ffmpeg and fonts
node render.mjs stills 0.5,1.5,2.5     # style frames in stills/
node render.mjs full --out out/<piece>.mp4
```

The storyboard and the voice path (phase P1) work from the piece's folder too:

```sh
node render.mjs board --slates         # board.png + board.md from board.js, before anything is animated
node tools/cues.mjs                    # cues.js and vo.wav from a take (take.json + take-raw.wav)
```

The scene contract is at the top of `template/scene.js`, the board format at the top of
`template/board.js`, every render mode and option at the top of `template/render.mjs`, and each tool's
options at the top of its file in `template/tools/`.
