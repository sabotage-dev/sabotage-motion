// THE STORYBOARD of the repo-launch example: 15 s, 9:16, a launch video for a made-up project, Snagwick (fixture/),
// built the way references/launch.md says: a hook, the install in a terminal, two feature beats (code in a window, the
// app's screenshot in a phone), and an end card with the logo and the install command. Silent of voice: the sound is
// the typing, the beats landing and the end card, over the energy's bed. The copy comes from the scan of fixture/ (its pitch, install command
// and features); the project and every name in it are made up. The field reference is in the template's board.js.
export const BOARD = {
  title: 'Snagwick: a launch video',
  target: 'tiktok',
  // normal: a launch for developers should read as made, cut on the beat, without shouting (extreme would slam the
  // pitch; the terminal and the code need their reading time). A silent board, so each beat snaps to whole beats of
  // 116 BPM: 5, 6, 6, 6 and 6 (15.0 s).
  energy: 'normal',
  beats: [
    { id: 'hook', dur: 2.4, on: ['Your TODOs,', 'on one board.'],
      look: 'the logo springs in on the brand ground, the two lines of the pitch rise under it',
      sfx: 'a soft whoosh into a pop as the logo lands, a tick per line' },
    { id: 'install', dur: 3.0, on: ['Install it.', 'npm install -g snagwick'],
      look: 'a terminal fades up in place, the install command is typed, a progress bar fills, the install lands',
      sfx: 'a key tick per typed character (at most 12 a second), a rising tone under the bar, a chime when it lands' },
    { id: 'find', dur: 3.2, on: ['It finds every TODO.', 'TODO(ana): rate-limit failed logins'],
      look: 'a source file in a window; each TODO and FIXME line lights up in turn',
      sfx: 'a pluck as each line lights up' },
    { id: 'board', dur: 3.2, on: ['Sorted on one board.'],
      look: 'the app, a full-page screenshot in a phone, pans down the board',
      sfx: 'a whoosh as the phone rises, a soft swell under the pan' },
    { id: 'end', dur: 3.2, on: ['Snagwick', 'npm install -g snagwick'], hold: true,
      look: 'end card: the logo, the name, the install command in a pill; holds to the last frame',
      sfx: 'a low hit and a shimmer as the card lands' },
  ],
};
