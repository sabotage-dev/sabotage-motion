// fixture-clean's soundtrack: one short tick per TL.hits entry, nothing else, so the tests can find
// each cue in the WAV. It throws without TL.hits, the way a real audio.js fails on the wrong TL.
console.log('fixture: audio.js evaluated');

export async function renderAudio({ TL, CFG, dur = CFG.DUR, sr = 48000 }) {
  console.log('fixture: renderAudio called');
  if (!TL || !Array.isArray(TL.hits)) throw new Error('fixture audio.js: TL.hits missing');
  console.log(`fixture: cues ${JSON.stringify(TL.hits)}`);
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  for (const t of TL.hits) {
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = 880;
    const g = ac.createGain(); g.gain.value = 0;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.1);
  }
  return ac.startRendering();
}
