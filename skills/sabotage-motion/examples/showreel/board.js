// THE STORYBOARD of the showreel example: a 20 s, 16:9, 60 fps reel of what the engine can draw, cut to a 120 BPM
// grid (a beat is 0.5 s, a bar 2 s). Silent beats only: the music is synthesized in audio.js from the scene's TL.
// The reel is locked to that grid, so this board mirrors its sections rather than driving them: scene.js checks
// the windows below against the grid at load and says which beat moved. Studio name and mark are fictional.
export const BOARD = {
  title: 'Showreel',
  target: 'youtube',
  beats: [
    { id: 'intro', dur: 2, on: ['MOTION REEL 2026'],
      look: 'a dot pops, squashes, jumps and lands; three shapes burst out and stretch into bands',
      sfx: 'a blip, a squash, a rising arc, a riser into the downbeat' },
    { id: 'kinetic', dur: 2, on: ['EMOTION'],
      look: 'MOTION rises letter by letter, an E drops in to make EMOTION, the frame inverts; slices whip out',
      sfx: 'the groove starts: kick, clap, hats, bass; stabs on the word changes' },
    { id: 'shapes', dur: 2, on: [],
      look: 'a grid of tiles morphs shape in three waves; one tile zooms to fill the frame',
      sfx: 'a pluck or a tick for every tile a wave reaches' },
    { id: 'particles', dur: 2, on: ['FLOW'],
      look: '22,000 particles burst into a spiral galaxy, settle into the word FLOW, then wrap onto a sphere',
      sfx: 'an impact, sparkling bells, a fast pluck run' },
    { id: 'sdf', dur: 2, on: ['SDF', 'SMOOTH UNION'],
      look: 'a raymarched blob morphs sphere, torus, twisted box, octahedron, with callouts drawing in',
      sfx: 'a bell on each morph, a sub sweep' },
    { id: 'liquid', dur: 2, on: ['LIQUID'],
      look: 'liquid floods up and splits into metaballs; LIQUID bobs inside them, then sinks',
      sfx: 'bloops as the blobs rise, split and drain' },
    { id: 'data', dur: 2, on: ['FRAMES RENDERED', 'MADE WITH CODE'],
      look: 'bars spring up, a line chart draws, an odometer rolls to 1,200, three rings fill',
      sfx: 'a tick for every 40 frames counted' },
    { id: 'montage', dur: 2, on: ['I MAKE PIXELS MOVE WITH NOTHING BUT CODE'],
      look: 'eight hard cuts, a quarter-second each, one word and one look per cut',
      sfx: 'a snare roll building, a glitch blip per cut, a tape stop into silence', sfxHit: true },
    { id: 'lockup', dur: 4, on: ['ORRERY', 'motion studio'],
      look: 'impact; the orrery mark draws its orbits and its planets pop in; the wordmark rises; a glint; it all pops out',
      sfx: 'a big impact, plucks as the planets land, bells, a last blip' },
  ],
};
