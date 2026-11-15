// The showreel's soundtrack, fully synthesized (OfflineAudioContext): drums, bass, pads, stabs, plucks, bells, risers
// and impacts on a 120 BPM grid, with no samples and no licences. main.js passes the scene's TL in, and every hit is
// scheduled from it, so each sound lands on the frame its visual event happens. The master gain drops out for a
// tenth of a second before the final impact, so the impact hits out of silence.
import { mulberry32, prog } from './lib.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export async function renderAudio({ TL, CFG, params = {}, dur = CFG.DUR, sr = 48000 }) {
  const ac = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
  const rnd = mulberry32(99);

  // ---------------------------------------------------------------- master chain
  const master = ac.createGain(); master.gain.value = 0.8;
  // build through the montage, then a true dropout (tails included) before the final impact
  master.gain.setValueAtTime(0.8, 14.0);
  master.gain.linearRampToValueAtTime(1.0, 15.86);
  master.gain.linearRampToValueAtTime(0.0, 15.905);
  master.gain.setValueAtTime(0.0, 15.995);
  master.gain.linearRampToValueAtTime(0.9, 16.0);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.14;
  master.connect(comp); comp.connect(ac.destination);

  const ir = ac.createBuffer(2, sr * 3, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * (i < sr * 0.01 ? i / (sr * 0.01) : 1);
  }
  const rev = ac.createConvolver(); rev.buffer = ir;
  const revOut = ac.createGain(); revOut.gain.value = 0.55;
  rev.connect(revOut).connect(master);

  const dly = ac.createDelay(1); dly.delayTime.value = 0.375;
  const fb = ac.createGain(); fb.gain.value = 0.38;
  const dlf = ac.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 3500;
  const dOut = ac.createGain(); dOut.gain.value = 0.4;
  dly.connect(dlf).connect(fb).connect(dly); dlf.connect(dOut).connect(master);

  const drums = ac.createGain(); drums.gain.value = 0.95; drums.connect(master);
  const music = ac.createGain(); music.gain.value = 1;
  const duck = ac.createGain(); duck.gain.value = 1;
  music.connect(duck).connect(master);
  const fx = ac.createGain(); fx.gain.value = 0.9; fx.connect(master);
  for (const k of TL.kicks) {
    duck.gain.setValueAtTime(0.32, k);
    duck.gain.setTargetAtTime(1, k + 0.02, 0.075);
  }

  const noise = ac.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }

  // ---------------------------------------------------------------- helpers
  const send = (node, dest, amt) => { const g = ac.createGain(); g.gain.value = amt; node.connect(g).connect(dest); return g; };
  const pan = (node, v) => { const p = ac.createStereoPanner(); p.pan.value = v; node.connect(p); return p; };
  function noiseSrc(t, dur) {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    s.start(t, rnd() * 1.5); s.stop(t + dur + 0.05); return s;
  }
  function adsr(g, t, a, peak, d, end = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t + a + d);
  }

  // ---------------------------------------------------------------- instruments
  function kick(t, v = 1) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ac.createGain(); adsr(g, t, 0.003, v, 0.42);
    const sh = ac.createWaveShaper();
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * 2.2); }
    sh.curve = curve;
    o.connect(sh).connect(g).connect(drums); o.start(t); o.stop(t + 0.5);
    const n = noiseSrc(t, 0.02); const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const ng = ac.createGain(); adsr(ng, t, 0.001, 0.25 * v, 0.015);
    n.connect(hp).connect(ng).connect(drums);
  }
  function clap(t, v = 0.55) {
    const n = noiseSrc(t, 0.3);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 0.9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) { g.gain.setValueAtTime(v, t + i * 0.011); g.gain.exponentialRampToValueAtTime(v * 0.2, t + i * 0.011 + 0.009); }
    g.gain.setValueAtTime(v * 0.8, t + 0.034); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    n.connect(bp).connect(g); g.connect(drums); send(g, rev, 0.35);
  }
  function hat(t, v = 0.16, open = false, p = 0) {
    const n = noiseSrc(t, open ? 0.3 : 0.08);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const g = ac.createGain(); adsr(g, t, 0.001, v, open ? 0.22 : 0.045);
    pan(n.connect(hp).connect(g), p).connect(drums);
  }
  function snare(t, v = 0.3, f = 1800) {
    const n = noiseSrc(t, 0.15);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 0.7;
    const g = ac.createGain(); adsr(g, t, 0.001, v, 0.09);
    n.connect(bp).connect(g).connect(drums);
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f / 8, t); o.frequency.exponentialRampToValueAtTime(f / 14, t + 0.06);
    const og = ac.createGain(); adsr(og, t, 0.001, v * 0.6, 0.06);
    o.connect(og).connect(drums); o.start(t); o.stop(t + 0.1);
  }
  function bass(t, midi, dur = 0.2, v = 0.34, cut = 1400) {
    const f = mtof(midi);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 7;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(220, t + dur * 0.8);
    const g = ac.createGain(); adsr(g, t, 0.005, v, dur);
    for (const det of [-8, 8]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = f / 2;
    const sg = ac.createGain(); sg.gain.value = 0.9; sub.connect(sg).connect(g);
    sub.start(t); sub.stop(t + dur + 0.05);
    lp.connect(g).connect(music);
  }
  function pad(t, notes, dur, v = 0.05, cut = 1600, att = 0.25) {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cut; lp.Q.value = 0.5;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + att);
    g.gain.setValueAtTime(v, t + dur - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.6);
    notes.forEach((m, i) => {
      for (const det of [-11, 0, 11]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det + (i - 1.5) * 2;
        pan(o, det / 14).connect(lp); o.start(t); o.stop(t + dur + 0.7);
      }
    });
    lp.connect(g); g.connect(music); send(g, rev, 0.45);
  }
  function stab(t, notes, v = 0.09, dur = 0.22, cut = 3200) {
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(cut, t); lp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const g = ac.createGain(); adsr(g, t, 0.004, v, dur);
    notes.forEach((m) => {
      for (const det of [-9, 9]) {
        const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.1);
      }
    });
    lp.connect(g); g.connect(music); send(g, rev, 0.3); send(g, dly, 0.25);
  }
  function pluck(t, midi, v = 0.08, p = 0, type = 'triangle', dur = 0.18, d = 0.3) {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = mtof(midi);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(6000, t); lp.frequency.exponentialRampToValueAtTime(700, t + dur);
    const g = ac.createGain(); adsr(g, t, 0.002, v, dur);
    const out = pan(o.connect(lp).connect(g), p);
    out.connect(fx); send(out, dly, d); send(out, rev, 0.2);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function bell(t, midi, v = 0.08, dur = 1.4, ratio = 3.5, index = 3) {
    const f = mtof(midi);
    const car = ac.createOscillator(); car.frequency.value = f;
    const mod = ac.createOscillator(); mod.frequency.value = f * ratio;
    const mg = ac.createGain(); mg.gain.setValueAtTime(f * index, t); mg.gain.exponentialRampToValueAtTime(f * 0.05, t + dur);
    mod.connect(mg).connect(car.frequency);
    const g = ac.createGain(); adsr(g, t, 0.002, v, dur);
    car.connect(g); g.connect(fx); send(g, rev, 0.5); send(g, dly, 0.2);
    car.start(t); mod.start(t); car.stop(t + dur + 0.05); mod.stop(t + dur + 0.05);
  }
  function blip(t, midi, v = 0.12, dur = 0.12, drop = 0.5, type = 'sine') {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(mtof(midi), t); o.frequency.exponentialRampToValueAtTime(mtof(midi) * drop, t + dur);
    const g = ac.createGain(); adsr(g, t, 0.002, v, dur);
    o.connect(g); g.connect(fx); send(g, rev, 0.25);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function sweep(t, f0, f1, dur, v = 0.12, type = 'sine') {
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(fx); send(g, rev, 0.2);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function whoosh(t, dur, v = 0.22, f0 = 300, f1 = 5000, p0 = -0.8, p1 = 0.8) {
    const n = noiseSrc(t, dur);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    bp.frequency.exponentialRampToValueAtTime(f0 * 1.5, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + dur * 0.65); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const pn = ac.createStereoPanner(); pn.pan.setValueAtTime(p0, t); pn.pan.linearRampToValueAtTime(p1, t + dur);
    n.connect(bp).connect(g).connect(pn); pn.connect(fx); send(pn, rev, 0.25);
  }
  function riser(t0, t1, v = 0.2) {
    const dur = t1 - t0;
    const n = noiseSrc(t0, dur);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(250, t0); bp.frequency.exponentialRampToValueAtTime(9000, t1);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t1 - 0.01); g.gain.linearRampToValueAtTime(0.0001, t1);
    n.connect(bp).connect(g); g.connect(fx); send(g, rev, 0.3);
    const o = ac.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(880, t1);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t0); lp.frequency.exponentialRampToValueAtTime(5000, t1);
    const og = ac.createGain(); og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(v * 0.25, t1 - 0.01); og.gain.linearRampToValueAtTime(0.0001, t1);
    o.connect(lp).connect(og); og.connect(fx); o.start(t0); o.stop(t1);
  }
  function impact(t, v = 1, big = false) {
    kick(t, 1.1 * v);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(big ? 70 : 60, t); o.frequency.exponentialRampToValueAtTime(big ? 26 : 32, t + (big ? 1.6 : 0.7));
    const g = ac.createGain(); adsr(g, t, 0.005, 0.7 * v, big ? 1.8 : 0.8);
    o.connect(g).connect(master); o.start(t); o.stop(t + 2);
    const n = noiseSrc(t, big ? 3 : 1.2);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = big ? 2500 : 4000;
    const ng = ac.createGain(); adsr(ng, t, 0.002, (big ? 0.32 : 0.18) * v, big ? 2.6 : 1.0);
    n.connect(hp).connect(ng); ng.connect(fx); send(ng, rev, 0.5);
    if (big) {
      const lo = noiseSrc(t, 1.5); const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      const lg = ac.createGain(); adsr(lg, t, 0.003, 0.5, 1.2);
      lo.connect(lp).connect(lg).connect(master); send(lg, rev, 0.6);
    }
  }
  function tick(t, v = 0.07, f = 3200) {
    const n = noiseSrc(t, 0.02);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 8;
    const g = ac.createGain(); adsr(g, t, 0.0005, v, 0.018);
    n.connect(bp).connect(g).connect(fx);
  }
  function bloop(t, v = 0.13, f0 = 260, f1 = 1100, dur = 0.09) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); adsr(g, t, 0.003, v, dur + 0.04);
    o.connect(g); g.connect(fx); send(g, rev, 0.3);
    o.start(t); o.stop(t + dur + 0.1);
  }

  // ---------------------------------------------------------------- harmony
  const CH = {
    Am: { pad: [57, 60, 64, 71], stab: [69, 72, 76], root: 33 },
    F: { pad: [53, 57, 60, 64], stab: [65, 69, 72], root: 29 },
    C: { pad: [55, 60, 64, 67], stab: [67, 72, 76], root: 36 },
    G: { pad: [55, 59, 62, 67], stab: [67, 71, 74], root: 31 },
    E: { pad: [52, 56, 59, 62], stab: [64, 68, 71], root: 28 },
  };
  const bars = ['Am', 'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am', 'F'];
  const chordAt = (t) => (t >= 15 && t < 16 ? CH.E : CH[bars[Math.min(9, Math.floor(t / 2))]]);

  // ---------------------------------------------------------------- arrangement
  // bar 0: intro
  pad(0, [45, 57, 64], 2.0, 0.035, 700, 1.2);
  blip(0.25, 81, 0.16, 0.14, 0.7);
  sweep(0.5, 900, 500, 0.1, 0.05);                 // squash
  sweep(0.6, 320, 1100, 0.38, 0.09, 'triangle');   // jump arc
  kick(1.0, 0.55); blip(1.0, 76, 0.12, 0.2, 0.5);
  [0, 1, 2].forEach((k) => blip(1.02 + k * 0.03, [81, 84, 88][k], 0.07, 0.1, 1.0, 'triangle'));
  blip(1.5, 69, 0.1, 0.1, 1.0, 'square');
  riser(0.9, 2.0, 0.22);
  whoosh(1.62, 0.38, 0.2, 400, 6000, -0.9, 0.9);

  // grooves: bars 1–6
  for (const k of TL.kicks) if (k < 14) kick(k, 0.95);
  for (const c of TL.claps) clap(c);
  for (const h of TL.hats) hat(h, 0.13, false, 0.2);
  for (const h of TL.hats16) hat(h, 0.05, false, -0.3);
  for (let b = 2; b < 14; b += 0.5) {
    const ch = chordAt(b);
    bass(b + 0.25, ch.root + 12, 0.2, 0.32, 1200 + 600 * Math.sin(b));
    if (Math.round(b * 2) % 4 === 3) bass(b + 0.375, ch.root + 24, 0.1, 0.18, 1800);
  }
  for (let bar = 1; bar < 7; bar++) pad(bar * 2, CH[bars[bar]].pad, 2.0, 0.04, 1500);
  for (let h = 3.75; h < 14; h += 2) hat(h, 0.1, true, 0.3);

  // 01 kinetic type
  impact(2.0, 0.8);
  stab(2.0, CH.Am.stab, 0.1);
  stab(2.5, [72, 76, 79], 0.09); kick(2.62, 0.5); blip(2.62, 57, 0.12, 0.15, 0.5);
  stab(3.0, CH.Am.stab.map((m) => m + 12), 0.08); sweep(3.0, 2000, 200, 0.2, 0.05, 'square');
  whoosh(3.45, 0.55, 0.26, 300, 7000);

  // 02 shape systems: every tile makes a sound on the wave that hits it
  const pent = [69, 72, 74, 76, 79, 81, 84, 86];
  for (let w = 0; w < TL.waves.length; w++) {
    TL.waves[w].forEach((ht, n) => {
      if (w === 1) tick(ht + 0.15, 0.05, 2400 + n * 60);
      else if (n % 2 === 0) pluck(ht, pent[(n / 2 + w * 3) % pent.length] + (w === 2 ? 12 : 0), 0.035, (rnd() - 0.5) * 1.4, 'triangle', 0.12, 0.25);
    });
  }
  for (let t = 4; t < 5.5; t += 0.125) pluck(t, CH.F.stab[Math.round(t * 8) % 3] + 12, 0.028, Math.sin(t * 9) * 0.6, 'square', 0.08, 0.3);
  riser(5.3, 6.0, 0.2); sweep(5.5, 200, 2400, 0.5, 0.06, 'sawtooth');

  // 03 particles
  impact(6.0, 0.9);
  for (let k = 0; k < 22; k++) bell(6.0 + rnd() * 0.45, 88 + Math.floor(rnd() * 8), 0.02, 0.4, 2.1, 1.5);
  whoosh(6.0, 0.9, 0.18, 200, 3000, 0.9, -0.9);
  for (let t = 6.0; t < 8.0; t += 0.0625) pluck(t, [72, 76, 79, 84, 88][Math.floor(t * 16) % 5] + (t > 7 ? 12 : 0), 0.018, Math.sin(t * 13) * 0.8, 'sine', 0.06, 0.35);
  riser(6.75, 7.2, 0.16); stab(7.2, [67, 72, 76, 79], 0.09);
  whoosh(7.45, 0.55, 0.22, 500, 8000, -0.6, 0.6);

  // 04 3D
  impact(8.0, 0.85);
  [8.0, 8.5, 9.0, 9.5].forEach((t, i) => bell(t, [79, 83, 86, 91][i], 0.07, 1.2, 3.5, 2.5));
  sweep(8.05, 90, 45, 1.2, 0.18);
  [8.2, 8.55].forEach((t) => { for (let i = 0; i < 6; i++) tick(t + 0.2 + i * 0.03, 0.03, 5000); });

  // 05 liquid
  whoosh(9.55, 0.5, 0.25, 150, 1800, 0, 0);
  for (let i = 0; i < 8; i++) bloop(9.65 + i * 0.04, 0.05, 200 + i * 30, 700 + i * 90, 0.06);
  for (let k = 0; k < 11; k++) bloop(10.02 + k * 0.025 + 0.12, 0.07, 240 + k * 40, 900 + k * 80);
  [10.5, 11.0].forEach((t) => bloop(t, 0.14, 180, 900, 0.12));
  bloop(10.5, 0.1, 300, 1500, 0.1);
  for (let k = 0; k < 10; k++) bloop(11.45 + k * 0.035, 0.07, 1200 - k * 70, 250, 0.1);

  // 06 data: one tick per 40 frames counted
  for (const [t, v] of TL.counterTicks) tick(t, 0.05, 2800 + v * 25);
  for (let i = 0; i < 24; i += 2) pluck(12.1 + i * 0.02, [57, 60, 64, 65, 69, 72][i % 6] + 12, 0.03, (i / 24 - 0.5) * 1.6, 'triangle', 0.1, 0.2);
  sweep(12.45, 400, 1600, 0.8, 0.04, 'triangle');
  whoosh(13.5, 0.5, 0.25, 6000, 200, 0.8, -0.8);

  // 07 style frames: drums + snare roll + glitch
  for (const k of TL.kicks) if (k >= 14 && k < 16) kick(k, 1);
  TL.snareRoll.forEach((t) => snare(t, 0.1 + 0.22 * prog(t, 14, 15.85), 1400 + 2600 * prog(t, 14, 15.85)));
  const cutNotes = [81, 76, 84, 72, 88, 79, 91, 69];
  TL.cuts.forEach((t, i) => {
    blip(t, cutNotes[i], 0.08, 0.06, 0.8, 'square');
    stab(t, chordAt(t).stab.map((m) => m + (i % 2) * 12), 0.07, 0.12, 5000);
    for (let g = 0; g < 3; g++) blip(t + 0.03 + g * 0.018, 96 + Math.floor(rnd() * 12), 0.025, 0.012, 1, 'square');
  });
  for (let b = 14; b < 15.75; b += 0.25) bass(b, chordAt(b).root + 12, 0.18, 0.3, 900 + (b - 14) * 1500);
  riser(14.0, 15.88, 0.3);
  // tape stop into silence
  { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(220, 15.75); o.frequency.exponentialRampToValueAtTime(30, 15.9);
    const g = ac.createGain(); g.gain.setValueAtTime(0.12, 15.75); g.gain.linearRampToValueAtTime(0.0001, 15.9);
    o.connect(g).connect(fx); o.start(15.75); o.stop(15.92); }

  // 08 mark + end card
  impact(16.0, 1.0, true);
  stab(16.0, [57, 64, 69, 72, 76], 0.12, 0.8, 4000);
  pad(16.0, [45, 57, 64, 71, 76], 2.2, 0.07, 2200, 0.05);
  pad(18.0, [41, 53, 60, 64, 67], 2.0, 0.065, 1800, 0.4);
  const markNotes = [69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
  TL.marks.forEach(([t, pan], n) => pluck(t, markNotes[n], 0.05, pan, 'triangle', 0.25, 0.3));   // a pluck per planet
  bell(17.0, 81, 0.09, 2.0, 2.0, 2); bell(17.0, 88, 0.05, 2.0, 3.0, 1.5);
  for (let i = 0; i < 9; i++) tick(17.5 + i * 0.045, 0.03, 4000 + i * 300);
  kick(18.0, 0.6);
  bell(18.0, 76, 0.05, 1.6, 2.0, 1.5);
  whoosh(18.3, 0.6, 0.1, 3000, 12000, -0.5, 0.5);
  whoosh(19.2, 0.4, 0.16, 5000, 300, 0.5, -0.5);
  blip(19.62, 81, 0.16, 0.12, 1.5, 'sine');
  blip(19.72, 93, 0.12, 0.2, 0.5, 'sine');

  const buf = await ac.startRendering();
  // peak-normalize to -1 dBFS and fade the tail (render.mjs prints the peak, RMS and a spike check after every render)
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i])); }
  const gain = 0.89 / (peak || 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const f = t < dur - 0.15 ? 1 : Math.max(0, 1 - (t - (dur - 0.15)) / 0.15);
      d[i] *= gain * f;
    }
  }
  return buf;
}
