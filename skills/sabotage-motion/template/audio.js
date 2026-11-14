// Synthesized sound design (OfflineAudioContext): no samples, no licences, perfectly in sync,
// because every sound is scheduled from the same TL numbers the visuals use.
// Replace the example cues with your own; keep the master chain.
// main.js calls renderAudio with the SELECTED scene's TL and CFG (after that scene's init), so
// `--scene other.js` schedules other.js's cues, and a scene that exports `silent = true` never
// reaches this file. The cues at the bottom read TL fields of the EXAMPLE scene (TL.words, TL.hits,
// TL.barIn, TL.sweep, TL.out). When you replace scene.js's TL, rewrite these cues too, or Web Audio
// throws "non-finite" (render.mjs full renders audio first, so that error arrives before the long
// video render).
import { mulberry32 } from './lib.js';

export async function renderAudio({ TL, CFG, params = {}, dur = CFG.DUR, sr = 48000 }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const rnd = mulberry32(7);

  // ---- master chain: level -> gentle compressor -> tail fade (no click at the cut) -> out.
  // render.mjs prints peak / RMS / spike warnings after every audio render; adjust `level` from that.
  const level = 2.6;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.003; comp.release.value = 0.12;
  const master = ac.createGain(); master.gain.value = level;
  const endFade = ac.createGain();
  endFade.gain.setValueAtTime(1, Math.max(0, dur - 0.18)); endFade.gain.linearRampToValueAtTime(0, dur);
  master.connect(comp).connect(endFade).connect(ac.destination);
  const ir = ac.createBuffer(2, sr * 2, sr);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  const rev = ac.createConvolver(); rev.buffer = ir;
  const revGain = ac.createGain(); revGain.gain.value = 0.35; rev.connect(revGain).connect(master);
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

  // whoosh: band-passed noise sweeping in frequency
  const whoosh = (t, len, f0, f1, peak, pan = 0) => {
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
    const g = envGain(t, len * 0.6, peak, len * 0.5);
    noiseSrc(t, len).connect(bp).connect(g); out(g, 0.3, pan);
  };
  // tick: short sine blip with a fast pitch drop
  const tick = (t, f, peak) => {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const g = envGain(t, 0.002, peak, 0.12); o.connect(g); out(g, 0.2); o.start(t); o.stop(t + 0.2);
  };
  // thump: low sine kick for the bar landing
  const thump = (t, peak) => {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
    const g = envGain(t, 0.004, peak, 0.35); o.connect(g); out(g, 0.1); o.start(t); o.stop(t + 0.45);
  };
  // shimmer: a few detuned high partials, staggered, for the light sweep
  const shimmer = (t, len, peak) => {
    [1760, 2637, 3520].forEach((f, i) => {
      const ts = t + i * 0.03;
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = f * (1 + (rnd() - 0.5) * 0.004);
      const g = envGain(ts, len * 0.3, peak / (i + 1), len * 0.7);
      o.connect(g); out(g, 0.6, (i - 1) * 0.4); o.start(ts); o.stop(ts + len + 0.1);
    });
  };

  // ---- cues, straight off the visual timeline
  for (let i = 0; i < TL.words; i++) {
    const st = TL.wordsIn + i * TL.stagger;
    whoosh(st - 0.04, 0.22, 900, 3800, 0.10, -0.3 + 0.6 * (i / Math.max(1, TL.words - 1)));
    tick(TL.hits[i], 880 * Math.pow(2, (i % 5) / 12), 0.10);
  }
  thump(TL.barIn + 0.12, 0.35);
  shimmer(TL.sweep, 0.6, 0.05);
  whoosh(TL.out - 0.02, 0.4, 4500, 600, 0.16);

  return ac.startRendering();
}
