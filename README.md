# sabotage-motion

Motion graphics for short-form video, written in code by your coding agent.

A Claude Code skill. The agent writes a scene as a pure function of time, `frame(t)`, drawn with Canvas2D over an
optional WebGL2 pass (bloom, grain, shader backgrounds, real motion blur). Headless Chrome renders every frame
exactly and pipes it to ffmpeg. Sound effects are synthesized in code on the same timeline, so they land on the
frame. No React, no framework, no render service: Node, Chrome and ffmpeg.

Planned for v1:

- **Storyboard.** One `board.js` per piece: each beat's voice line, on-screen copy, visual note and sound cue. A
  board sheet shows a panel per beat, first as slates and then as real frames, and a slate scene gives you an
  animatic with the real voice before anything is animated.
- **Voice-driven timing.** Word or character timings from a TTS take or a transcript become cue points, so cuts
  land on the words. A hook-length check is optional.
- **Captions.** Word-by-word captions from the same timings.
- **Mix and master.** Voice, an optional music bed ducked under it, and the synthesized effects, mastered to
  -14 LUFS for social.
- **Footage.** Screen recordings and clips as frame sequences, so they stay frame-exact.
- **`check`.** Measured checks before you post: size, fps and frame count, loudness and true peak, stretches where
  nothing moves, an empty first frame, and text outside the platform's safe zones.
- **Transparent output.** ProRes 4444 or WebM with alpha, for overlays on other footage.

## Status

Planning. Nothing is built yet. The v1 build plan is [docs/PLAN.md](docs/PLAN.md) and is under review.

## License

MIT, copyright Sabotage Development LLC. See [LICENSE](LICENSE).
