// THE STORYBOARD: one piece's beats, in order (plan section 6). The scene builds its timeline from it
// (beatWindow, boardDur in lib.js), slate.js draws a placeholder card per beat, `node render.mjs board`
// prints a sheet of them, and tools/cues.mjs times the voiced beats from a take. Keep this file plain
// data that imports nothing: the browser and the Node tools both load it.
//
// A beat has either vo (a voice line) or dur (seconds, for a silent beat). Silent beats may lead, sit
// between voiced beats, or trail. A voiced example:
//   { id: 'hook', vo: 'Stop pasting the same instructions into your agent.', on: ['Stop pasting'],
//     look: 'one word slams in on black', sfx: 'whoosh into a hit', hook: true },
//   { id: 'save', vo: '[curious] Save them as a skill instead.', anchor: 'Save them', gapBefore: 0.6,
//     on: ['SKILL.md'], look: 'a file icon drops in, its name types on', sfx: 'tick per letter' },
//   { id: 'end', dur: 2.5, on: ['example.com'], look: 'end card, holds to the last frame', hold: true },
//
// Beat fields:
//   id         unique; not TAKE, VO_OFFSET or DUR
//   vo | dur   the voice line, or the length of a silent beat in seconds
//   on         the on-screen copy, a list of strings
//   look       the visual note; sfx the sound note (null = silence on purpose; sfxHit: true asks for a
//              transient rather than any sound)
//   anchor     the phrase in vo whose first word cues the beat. Default: the line's first four words.
//   occurrence which occurrence of the anchor in the whole take (default: the next one after the
//              previous beat's anchor)
//   gapBefore  seconds of silence tools/cues.mjs opens in the voice before the anchor
//   hook       the beat the hook gate measures (default: the first voiced beat)
//   hold       a deliberate hold (an end card); key: seconds into the beat the board sheet shows
//              (default: 60% of the way through)
// A [...] span in vo ([curious], [short pause], [chuckles]) is a delivery tag: it goes to the TTS as
// written and shows on the board sheet, but it is never a word, an anchor or a caption.
//
// Board fields: title, target (a safezones.json entry: sets the slate's size and safe area), wps
// (speaking rate for the estimate before a take exists, default 3.0), hookMax (the hook's last word
// must end before this picture time), lead (0.10 s: a voiced beat opens this long before its anchor)
// and tail (0.40 s: the last voiced beat closes this long after its last word).
// energy: subtle, normal or extreme (plan 23.9, energy.js): how much the piece moves. Name it on every
// board, and say which you chose and why; subtle is a choice, not the default (--param energy= overrides
// it for a render). bpm: the piece's own tempo, within 10% of its energy's (84, 116 or 136 BPM). bed:
// false makes the bed stem silent (subtle only). A board with no voice snaps each beat's dur to a whole
// number of musical beats at its tempo once an energy is chosen anywhere (here, --param energy= or
// CFG.ENERGY): the nearest, at least one, never shorter than its copy needs to be read. A voiced board
// never snaps: the voice sets every window.
//
// This template's board is the example scene: a silent title card of about 3 s in two beats, at normal.
export const BOARD = {
  title: 'Make it move',
  target: 'tiktok',
  energy: 'normal',   // a title card that should read as made: bigger type, cuts on the beat; subtle for a quiet brand
  beats: [
    { id: 'title', dur: 2.6, on: ['Make it move', 'rendered from code, frame by frame'],
      look: 'title words land one by one on the beat, the accent bar snaps in, the ground cuts on the beat grid',
      sfx: 'a whoosh and a hit per word, a thump under the bar, whooshes on the cuts' },
    { id: 'out', dur: 0.55, on: [], look: 'everything leaves at the cut', sfx: 'a falling whoosh' },
  ],
};
