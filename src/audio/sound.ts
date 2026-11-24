// Sons synthétisés (Web Audio), sans fichier à télécharger :
// vent (sifflement + chant du gréement), eau le long de la coque, sifflement des appendices en vol,
// coque qui tape dans la mer, faseyement, cliquetis des winchs, bôme, corne et sifflet du comité,
// et les bateaux voisins spatialisés (on les entend passer du bon côté).
import { D, clamp, norm } from '../util/math';
import type { Game, Sfx } from '../game/game';
import { app } from '../app';

let AC: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
interface Layer { g: GainNode; fl: BiquadFilterNode; fl2?: BiquadFilterNode }
interface Loops { wind: Layer; gust: Layer; rig: { g: GainNode; o: OscillatorNode; o2: OscillatorNode }; water: Layer; foil: Layer; flap: Layer; rain: Layer }
let L: Loops | null = null;
/** Voix des bateaux voisins (spatialisées). */
const near: { g: GainNode; p: StereoPannerNode; fl: BiquadFilterNode }[] = [];
let lastHead = -1, lastMain = -1, clickAcc = 0, slapT = 0, flapT = 0;

export function unlockAudio(): void {
  try {
    const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    AC = AC || new (W.AudioContext || W.webkitAudioContext!)();
    void AC.resume();
    init();
  } catch { /* pas de son */ }
}

const out = () => master!;
const now = () => AC!.currentTime;

function init(): void {
  if (!AC || L) return;
  const ac = AC;
  master = ac.createGain(); master.gain.value = 0.9;
  // un léger compresseur pour éviter la saturation quand tout se cumule
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ac.destination);
  // bruit rose (plus naturel que le bruit blanc), 3 s en boucle
  const len = ac.sampleRate * 3; noise = ac.createBuffer(1, len, ac.sampleRate);
  const d = noise.getChannelData(0); let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; d[i] = (b0 + b1 + b2 + w * 0.04) * 2.2; }
  const loop = (type: BiquadFilterType, fr: number, q: number, type2?: BiquadFilterType, fr2?: number): Layer => {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = fr; fl.Q.value = q;
    const g = ac.createGain(); g.gain.value = 0;
    let n: AudioNode = s.connect(fl), fl2: BiquadFilterNode | undefined;
    if (type2) { fl2 = ac.createBiquadFilter(); fl2.type = type2; fl2.frequency.value = fr2!; n = n.connect(fl2); }
    n.connect(g).connect(out()); s.start(0, Math.random() * 2.5);
    return { g, fl, fl2 };
  };
  // chant du gréement : deux sinus légèrement désaccordés (battement), très bas
  const rg = ac.createGain(); rg.gain.value = 0; rg.connect(out());
  const o = ac.createOscillator(), o2 = ac.createOscillator(); o.type = o2.type = 'sine'; o.frequency.value = 180; o2.frequency.value = 183.5;
  o.connect(rg); o2.connect(rg); o.start(); o2.start();
  L = {
    wind: loop('bandpass', 600, 0.5), gust: loop('highpass', 2400, 0.7, 'lowpass', 6000),
    rig: { g: rg, o, o2 },
    water: loop('lowpass', 500, 0.7, 'highpass', 120), foil: loop('bandpass', 1800, 6), flap: loop('bandpass', 300, 1.3),
    rain: loop('highpass', 3000, 0.4),
  };
  for (let i = 0; i < 3; i++) {
    const s = ac.createBufferSource(); s.buffer = noise; s.loop = true;
    const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 700;
    const g = ac.createGain(); g.gain.value = 0; const p = ac.createStereoPanner();
    s.connect(fl).connect(g).connect(p).connect(out()); s.start(0, Math.random() * 2.5);
    near.push({ g, p, fl });
  }
}

/** Bouffée de bruit filtré (claquement, choc, éclaboussure). */
function burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass', pan = 0): void {
  if (!AC || !noise || !app.soundOn) return;
  const ac = AC, s = ac.createBufferSource(); s.buffer = noise;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
  const g = ac.createGain(), t = now(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ac.createStereoPanner(); p.pan.value = pan;
  s.connect(fl).connect(g).connect(p).connect(out()); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}
/** Son tonal (corne, sifflet, bips). */
function tone(f: number, dur: number, vol: number, type: OscillatorType = 'sine', f2?: number, vib = 0): void {
  if (!AC || !app.soundOn) return;
  const ac = AC, t = now(), o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur);
  if (vib) { const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 6; lg.gain.value = vib; lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur); }
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.06, dur / 4)); g.gain.setValueAtTime(vol, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
  o.connect(g).connect(out()); o.start(t); o.stop(t + dur + 0.02);
}
/** Corne de brume du comité : deux harmoniques graves, légèrement désaccordées. */
function horn(dur: number): void { tone(185, dur, 0.09, 'sawtooth'); tone(370.8, dur, 0.04, 'sawtooth'); tone(92.5, dur, 0.05, 'square'); }
/** Cliquet de winch. */
function click(pan = 0): void { burst(3500 + Math.random() * 800, 8, 0.025, 0.05, 'bandpass', pan); }

export function beep(f: number, d: number, vol = 0.05): void { tone(f, d, vol * 0.7, 'square'); }

export function sfx(s: Sfx): void {
  switch (s) {
    case 'tick': tone(1250, 0.12, 0.04, 'sine'); break; // bip du chrono
    case 'gun': horn(1.4); break; // départ : coup de corne
    case 'finish': horn(0.5); setTimeout(() => horn(0.5), 650); break;
    case 'capsize': burst(180, 0.7, 1.4, 0.25, 'lowpass'); burst(600, 1, 0.9, 0.12); break;
    case 'gybeWild': burst(140, 1, 0.35, 0.35, 'lowpass'); burst(900, 2, 0.15, 0.12); break;
    case 'mark': tone(2600, 0.25, 0.04, 'sine', 2300, 40); setTimeout(() => tone(2600, 0.3, 0.04, 'sine', 2300, 40), 300); break; // sifflet
    case 'winch': for (let i = 0; i < 10; i++) setTimeout(() => click(), i * 45 + Math.random() * 10); break;
    case 'ground': burst(90, 0.8, 1.2, 0.35, 'lowpass'); burst(400, 1, 0.6, 0.15); break;
  }
}

/** Claquement de bôme au virement / à l'empannage : choc sourd + claquement de toile. */
export const boom = (gybe: boolean): void => { burst(gybe ? 110 : 160, 1.2, gybe ? 0.45 : 0.25, gybe ? 0.32 : 0.16, 'lowpass'); burst(700, 1.5, 0.12, gybe ? 0.1 : 0.05); };

const set = (p: AudioParam, v: number, tc: number) => p.setTargetAtTime(v, now(), tc);

export function updSound(g: Game | null, rt: number, dt = 1 / 60): void {
  if (!L || !AC || !g) return;
  const me = g.me, on = app.soundOn && !g.demo && document.visibilityState !== 'hidden' ? 1 : 0;
  const aws = me.aws || 0, kn = Math.max(0, me.v) / 0.514444, vol = app.soundOn ? 1 : 0;
  master!.gain.setTargetAtTime(vol * 0.9, now(), 0.1);
  // vent : grave et large, plus un sifflement aigu au-delà de 18 nœuds apparents
  set(L.wind.g.gain, on * clamp(aws / 30, 0.05, 1.1) * 0.12, 0.5);
  set(L.wind.fl.frequency, 300 + aws * 18 + Math.sin(rt * 0.7) * 60, 0.6);
  set(L.gust.g.gain, on * clamp((aws - 16) / 20, 0, 1) * 0.05 * (0.7 + 0.3 * Math.sin(rt * 1.3)), 0.4);
  set(L.rig.g.gain, on * clamp((aws - 20) / 15, 0, 1) * 0.012, 0.8);
  set(L.rig.o.frequency, 150 + aws * 2.5, 1); set(L.rig.o2.frequency, 153 + aws * 2.6, 1);
  // eau le long de la coque ; le sifflement des appendices quand le foil porte
  set(L.water.g.gain, on * clamp(kn / 18, 0.03, 1.2) * 0.2, 0.3);
  set(L.water.fl.frequency, 280 + kn * 45, 0.5);
  const fly = clamp(me.foilLift / (9.81 * me.cls.mass) * 3, 0, 1);
  set(L.foil.g.gain, on * fly * clamp((kn - 12) / 10, 0, 1) * 0.035, 0.5);
  set(L.foil.fl.frequency, 900 + kn * 55, 0.4);
  // pluie
  set(L.rain.g.gain, on * clamp(g.wind.squall(me.x, me.y, g.t) + (g.sky === 'pluie' ? 0.7 : 0), 0, 1) * 0.06, 1);
  // faseyement : claquements en rafale quand une voile bat
  const luff = me.knock > 0 ? 1 : clamp(Math.max((18 * D - Math.abs(me.awa)) / (10 * D), (me.mainSheet - me.ideal.mainSheet - 0.12) * 5, (me.headSheet - me.ideal.headSheet - 0.15) * 5, 1 - me.headPow), 0, 1);
  set(L.flap.g.gain, on * luff * (0.6 + 0.4 * Math.sin(rt * 35)) * 0.06, 0.02);
  if (on && luff > 0.3) { flapT -= dt; if (flapT <= 0) { flapT = 0.12 + Math.random() * 0.25 / (0.5 + aws / 20); burst(350 + Math.random() * 300, 1.5, 0.07, 0.12 * luff); } }
  // coque qui tape : quand l'étrave retombe dans un creux au près, ou au planing dans la mer formée
  slapT -= dt;
  if (on && slapT <= 0 && kn > 8 && Math.abs(me.twa) < 100 * D && g.waveAmp > 0.4 && Math.random() < dt * (0.6 + kn / 20) * g.waveAmp) {
    burst(120 + Math.random() * 60, 1, 0.3, 0.15 * clamp(kn / 18, 0.5, 1.4) * g.waveAmp, 'lowpass');
    burst(1500, 1, 0.25, 0.04); slapT = 0.4;
  }
  // winchs : cliquetis proportionnel à la vitesse à laquelle on borde
  if (lastHead >= 0) {
    const rate = Math.max(0, lastHead - me.headSheet) + Math.max(0, lastMain - me.mainSheet);
    clickAcc += rate * 260;
    while (clickAcc > 1) { clickAcc -= 1; if (on) click((me.twa >= 0 ? 1 : -1) * 0.4); }
  }
  lastHead = me.headSheet; lastMain = me.mainSheet;
  // bateaux voisins : souffle d'étrave spatialisé
  const others = g.boats.filter(b => b !== me).map(b => ({ b, d: Math.hypot(b.x - me.x, b.y - me.y) })).sort((a, c) => a.d - c.d);
  near.forEach((n, i) => {
    const o = others[i];
    if (!o || o.d > 220 || !on) { set(n.g.gain, 0, 0.3); return; }
    const rel = norm(Math.atan2(o.b.x - me.x, -(o.b.y - me.y)) - me.h);
    set(n.p.pan, clamp(Math.sin(rel), -1, 1), 0.2);
    set(n.g.gain, clamp(1 - o.d / 220, 0, 1) ** 2 * clamp(o.b.v / 8, 0.2, 1.3) * 0.12, 0.3);
    set(n.fl.frequency, 400 + o.b.v * 50, 0.3);
  });
}
