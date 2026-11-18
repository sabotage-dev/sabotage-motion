// Synthesized sound design (OfflineAudioContext): no samples, no licences, perfectly in sync,
// because every sound is scheduled from the same TL numbers the visuals use.
// Replace the example cues with your own; keep the master chain.
// main.js calls renderAudio with the SELECTED scene's TL and CFG (after that scene's init), so
// `--scene other.js` schedules other.js's cues, and a scene that exports `silent = true` never
// reaches this file. The cues at the bottom read TL fields of the EXAMPLE scene (TL.words, TL.hits,
// TL.barIn, TL.sweep, TL.out, TL.cuts, TL.slams, TL.whipAt). `style` is the piece's resolved look and kit (looks.js):
// its sound sets the timbre (wave, pitch, bright, verb), and its motion says whether the sweep and a glitch happen.
// `energy` is the resolved energy preset (energy.js): its sound says how much there is (subtle: a soft tick per word;
// normal: whooshes on the cuts and a hit per word; extreme: impacts, a riser and a drop, each under audio_spike).
// When you replace scene.js's TL, rewrite these cues too, or Web Audio
// throws "non-finite" (render.mjs full renders audio first, so that error arrives before the long
// video render).
//
// renderBed (plan 23.9) is the bed stem: the energy's beat pattern on its grid (beat 0 at the first frame), the
// picture's full length, separate from the effects. render.mjs writes it to out/<name>.bed.wav and tools/mix.mjs mixes
// it as the bed (ducked under a voice). subtle: a soft pad, a chord a bar (silent when the board says bed: false);
// normal: a beat (kick, offbeat hats, a bass note on 1 and 3); extreme: a driving beat (kick, claps on 2 and 4,
// sixteenth hats, an eighth-note bass). Remove renderBed for a piece with no bed stem.
import { mulberry32 } from './lib.js';

const FALLBACK = { name: 'normal', bpm: 116, spb: 60 / 116, sound: { bed: 'beat', whoosh: true, hits: 'hits', riser: false }, silentBed: false };

// The master chain both renders share: level -> gentle compressor -> tail fade (no click at the cut) -> out, a reverb
// send, and the small instruments (whoosh, tick, thump, shimmer, zap, burst, tone).
function rig(ac, { sr, dur, style, seed, level, tail = 0.18, limit = false }) {
  const rnd = mulberry32(seed);
  const SND = { wave: 'sine', pitch: 1, bright: 1, verb: 0.35, ...(style ? style.sound : {}) };
  const waveGain = { sine: 1, triangle: 0.8, square: 0.4, sawtooth: 0.45 }[SND.wave] ?? 1;   // brighter waves are louder
  // render.mjs prints peak / RMS / spike warnings after every audio render; adjust `level` from that.
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = limit ? -10 : -14; comp.ratio.value = limit ? 12 : 3; comp.attack.value = limit ? 0.002 : 0.003; comp.release.value = limit ? 0.1 : 0.12;
  if (limit) comp.knee.value = 4;
  const master = ac.createGain(); master.gain.value = level;
  const endFade = ac.createGain();
  endFade.gain.setValueAtTime(1, Math.max(0, dur - tail)); endFade.gain.linearRampToValueAtTime(0, dur);
  master.connect(comp).connect(endFade).connect(ac.destination);
  const ir = ac.createBuffer(2, sr * 2, sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const rev = ac.createConvolver(); rev.buffer = ir;
  const revGain = ac.createGain(); revGain.gain.value = SND.verb; rev.connect(revGain).connect(master);
  const noise = ac.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }

  // route a node to master (panned) with a reverb send
  const out = (node, wet = 0.25, pan = 0) => {
    const p = ac.createStereoPanner(); p.pan.value = pan; node.connect(p); p.connect(master);
    const s = ac.createGain(); s.gain.value = wet; p.connect(s).connect(rev); return p;
  };
  const noiseSrc = (t, len) => { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; s.start(t, rnd()); s.stop(t + len + 0.05); return s; };
  // A GainNode sits at its intrinsic value (1.0) until its first automation event, so start it at 0:
  // otherwise a source that starts before the envelope plays a full-scale blip.
  const envGain = (t, a, peak, d) => { const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; };
  const I = {
    // whoosh: band-passed noise sweeping in frequency
    whoosh(t, len, f0, f1, peak, pan = 0) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(f0 * SND.bright, t); bp.frequency.exponentialRampToValueAtTime(f1 * SND.bright, t + len);
      const g = envGain(t, len * 0.6, peak, len * 0.5);
      noiseSrc(t, len).connect(bp).connect(g); out(g, 0.3, pan);
    },
    // tick: short blip in the look's wave with a fast pitch drop
    tick(t, f, peak) {
      const o = ac.createOscillator(); o.type = SND.wave;
      o.frequency.setValueAtTime(f * SND.pitch * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * SND.pitch, t + 0.03);
      const g = envGain(t, 0.002, peak * waveGain, 0.12); o.connect(g); out(g, 0.2); o.start(t); o.stop(t + 0.2);
    },
    // thump: low sine kick
    thump(t, peak, len = 0.35, f0 = 140, f1 = 48) {
      const o = ac.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.5);
      const g = envGain(t, 0.004, peak, len); o.connect(g); out(g, 0.1); o.start(t); o.stop(t + len + 0.1);
    },
    // shimmer: a few detuned high partials, staggered, for the light sweep
    shimmer(t, len, peak) {
      [1760, 2637, 3520].forEach((f, i) => {
        const ts = t + i * 0.03;
        const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * SND.pitch * (1 + (rnd() - 0.5) * 0.004);
        const g = envGain(ts, len * 0.3, peak / (i + 1), len * 0.7);
        o.connect(g); out(g, 0.6, (i - 1) * 0.4); o.start(ts); o.stop(ts + len + 0.1);
      });
    },
    // zap: a stepped square burst for a glitch at a cut
    zap(t, peak) {
      const o = ac.createOscillator(); o.type = 'square';
      [220, 880, 330, 660].forEach((f, i) => o.frequency.setValueAtTime(f * SND.pitch, t + i * 0.025));
      const g = envGain(t, 0.002, peak, 0.1); o.connect(g); out(g, 0.1); o.start(t); o.stop(t + 0.16);
    },
    // burst: a short band of noise (a clap, a hat, the crack of an impact)
    burst(t, len, f, q, peak, pan = 0, wet = 0.15) {
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * SND.bright; bp.Q.value = q;
      const g = envGain(t, 0.001, peak, len); noiseSrc(t, len).connect(bp).connect(g); out(g, wet, pan);
    },
    // tone: a held note with a soft attack and release (pads, bass)
    tone(t, len, f, peak, type = 'sine', att = 0.02, pan = 0, wet = 0.2, lp = 0) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ac.createGain(); g.gain.value = 0; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
      g.gain.setValueAtTime(peak, t + Math.max(att, len - att)); g.gain.linearRampToValueAtTime(0, t + len);
      let n = o;
      if (lp) { const f2 = ac.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; o.connect(f2); n = f2; }
      n.connect(g); out(g, wet, pan); o.start(t); o.stop(t + len + 0.02);
    },
  };
  return { I, SND, rnd };
}

export async function renderAudio({ TL, CFG, params = {}, dur = CFG.DUR, sr = 48000, style = null, energy = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const E = energy || FALLBACK, S = E.sound;
  const motion = (style && style.motion) || { sweep: true, glitch: false };
  const { I } = rig(ac, { sr, dur, style, seed: 7, level: 2.6 });

  // ---- cues, straight off the visual timeline
  if (E.name === 'extreme') {
    // impacts on the slams and the stack, a short whoosh into each cut, a riser into the whip and a drop on the out
    for (const t of TL.slams || []) { I.thump(t, 0.34, 0.3, 120, 40); I.burst(t, 0.09, 1800, 0.9, 0.16); I.tick(t, 660, 0.06); }
    if (TL.stackAt != null) { I.thump(TL.stackAt, 0.36, 0.4, 110, 38); I.burst(TL.stackAt, 0.12, 1400, 0.8, 0.18); }
    for (const t of TL.cuts || []) I.whoosh(t - 0.05, 0.1, 2400, 5200, 0.05, (Math.round(t * 10) % 2) * 0.6 - 0.3);
    if (TL.whipAt != null) {
      I.whoosh(TL.whipAt - 0.6, 0.62, 400, 6000, 0.12);   // the riser into the whip
      I.whoosh(TL.whipAt, 0.24, 5000, 500, 0.2);         // the whip
      I.thump(TL.out, 0.32, 0.5, 90, 34);                 // the drop
    }
  } else {
    const soft = E.name === 'subtle';
    for (let i = 0; i < TL.words; i++) {
      const st = TL.wordsIn + i * TL.stagger;
      if (!soft) I.whoosh(st - 0.04, 0.22, 900, 3800, 0.10, -0.3 + 0.6 * (i / Math.max(1, TL.words - 1)));
      I.tick(TL.hits[i], 880 * Math.pow(2, (i % 5) / 12), soft ? 0.06 : 0.10);
    }
    I.thump(TL.barIn + 0.12, soft ? 0.2 : 0.35);
    if (S.whoosh) for (const t of (TL.cuts || []).filter((x) => x < TL.out - 0.01)) I.whoosh(t - 0.06, 0.24, 1200, 4200, 0.09);
    if (motion.sweep !== false) I.shimmer(TL.sweep, 0.6, 0.05);
    I.whoosh(TL.out - 0.02, 0.4, 4500, 600, soft ? 0.1 : 0.16);
  }
  if (motion.glitch) {
    if (E.name === 'extreme') for (const g of TL.glitches || []) I.zap(g.t, 0.04);
    else I.zap(TL.out - 0.01, 0.05);
  }
  return ac.startRendering();
}

// The bed stem (plan 23.9): the energy's pattern on its beat grid, from beat 0 at the first frame to the picture's end.
export async function renderBed({ CFG, dur = CFG.DUR, sr = 48000, style = null, energy = null }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const E = energy || FALLBACK;
  if (E.silentBed) return ac.startRendering();                   // the board's bed: false, at subtle: silence
  // at full level, like a music track (the mixer brings it down: x0.22 under a voice, x0.5 with the effects alone)
  const { I, SND } = rig(ac, { sr, dur, style, seed: 11, level: 4.2, tail: 0.03, limit: true });
  const spb = E.spb, beats = Math.ceil(dur / spb), root = 55 * SND.pitch, kind = E.sound.bed;
  const chords = [[1, 1.5, 2, 2.52], [0.89, 1.335, 1.78, 2.245], [0.75, 1.125, 1.5, 1.888], [0.84, 1.26, 1.68, 2.0]];
  for (let b = 0; b < beats; b++) {
    const t = b * spb, bar = Math.floor(b / 4), inBar = b % 4;
    if (kind === 'pad') {
      // a chord a bar, soft attack and release, low in level
      if (inBar === 0) for (const k of chords[bar % chords.length]) I.tone(t, Math.min(4 * spb, dur - t) + 0.05, root * 4 * k, 0.035, 'triangle', 0.4, (k - 1.6) * 0.4, 0.45, 1800);
      continue;
    }
    I.thump(t, kind === 'drive' ? 0.42 : 0.34, 0.28, 120, 42);   // kick on every beat
    if (kind === 'beat') {
      I.burst(t + spb / 2, 0.035, 7000, 1.2, 0.06, 0.25, 0.05);   // a closed hat on the offbeat
      if (inBar === 0 || inBar === 2) I.tone(t, spb * 0.9, root * (chords[bar % chords.length][0]), 0.12, 'triangle', 0.01, 0, 0.05, 600);
    } else {
      if (inBar === 1 || inBar === 3) I.burst(t, 0.12, 1500, 0.7, 0.2, 0, 0.2);   // a clap on 2 and 4
      for (let k = 0; k < 4; k++) I.burst(t + (k * spb) / 4, 0.025, 8000, 1.4, k % 2 ? 0.035 : 0.055, k % 2 ? 0.3 : -0.3, 0.04);   // sixteenth hats
      for (let k = 0; k < 2; k++) I.tone(t + (k * spb) / 2, spb * 0.45, root * chords[bar % chords.length][0] * (k ? 2 : 1), 0.11, 'sawtooth', 0.005, 0, 0.03, 900);
    }
  }
  return ac.startRendering();
}
