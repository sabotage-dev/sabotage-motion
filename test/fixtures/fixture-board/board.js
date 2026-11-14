// fixture-board: the five-beat board from plan section 16 (cold / hook / mid / save / end), with
// delivery tags: an opening tag on "save" and a closing tag on its line, which is the last voiced line.
export const BOARD = {
  title: 'Fixture board',
  target: 'tiktok',
  wps: 3.0,
  hookMax: 4.0,
  beats: [
    { id: 'cold', dur: 1.0, on: ['COLD OPEN'], look: 'a flat colour card', sfx: null },
    { id: 'hook', vo: 'Stop pasting the same prompt.', on: ['Stop pasting'], look: 'the words slam in', sfx: 'a hit on the first word', sfxHit: true, hook: true },
    { id: 'mid', dur: 1.5, on: ['THE FIX'], look: 'a held card between the lines', sfx: 'a low swell' },
    { id: 'save', vo: '[curious] Save it as a skill instead. [chuckles]', on: ['SKILL.md'], look: 'a file icon drops in', sfx: 'a tick per letter' },
    { id: 'end', dur: 2.5, on: ['example.com'], look: 'end card, holds to the last frame', hold: true },
  ],
};
