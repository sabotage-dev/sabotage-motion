// THE STORYBOARD of the lower-third example: a 5 s name strap for 16:9 footage, rendered with a transparent
// background (--alpha) to lay over someone else's video. Silent: the sound belongs to the edit it goes into, so
// every beat's sound note is null (silence on purpose). The name and role are made up; pass your own with
// --param name=... --param role=... The field reference is in the template's board.js.
export const BOARD = {
  title: 'Lower third: a name strap',
  target: 'youtube',
  beats: [
    { id: 'in', dur: 0.9, on: [],
      look: 'an accent bar grows, a dark plate wipes right out of it, the name rises into the plate, the role tracks in',
      sfx: null },
    { id: 'read', dur: 3.1, on: ['Rowan Vale', 'Sound designer'],
      look: 'holds to be read; a hairline under the role draws itself across, slowly', sfx: null, hold: true },
    { id: 'out', dur: 1.0, on: [],
      look: 'the role fades, the name drops behind the plate edge, the plate wipes back into the bar, the bar retracts',
      sfx: null },
  ],
};
