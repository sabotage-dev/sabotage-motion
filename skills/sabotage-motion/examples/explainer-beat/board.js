// THE STORYBOARD of the explainer-beat example: a made-up three-beat explainer (why fast motion stutters, and
// how motion blur fixes it), voiced, then an end card. Built the way the skill teaches (SKILL.md, "Workflow"):
// this board first, the board sheet, a voice take (take.json + take-raw.wav, see VOICE.md), tools/cues.mjs for
// the cues, then the scene beat by beat. Plain data that imports nothing; the field reference is in the
// template's board.js.
export const BOARD = {
  title: 'Why fast motion stutters',
  target: 'tiktok',
  wps: 2.8,                 // the estimate's speaking rate, before the take existed
  hookMax: 4.0,             // the hook's last word must end within the first 4 s
  beats: [
    { id: 'hook', vo: 'Fast motion in a video stutters for one simple reason.', on: ['stutters'],
      look: 'a ball crosses the frame in hard, visible steps; STUTTERS slams in above it',
      sfx: 'a tick on every step', hook: true },
    { id: 'frames', vo: 'Every frame freezes a single instant, so moving things jump from spot to spot.',
      on: ['1 frame', '1 instant'],
      look: 'the steps freeze into a row of ghost balls, one per frame, with frame numbers under them',
      sfx: 'a soft click as each ghost lands' },
    { id: 'blur', vo: 'Blend eight instants into each frame, and those jumps smear into motion.', gapBefore: 0.35,
      on: ['8 instants', 'per frame'],
      look: 'eight faint copies fan out inside one frame, then the ball moves again, smeared by real motion blur',
      sfx: 'a whoosh as the ball smears across' },
    { id: 'end', dur: 2.0, on: ['motion blur'], look: 'end card: the words land and hold to the last frame',
      sfx: 'a low thump as the card lands', hold: true },
  ],
};
