// Sons synthétisés (Web Audio) : bips du comité, vent, eau, faseyement.
import { D, clamp } from '../util/math';
import type { Game, Sfx } from '../game/game';
import { app } from '../app';

let AC: AudioContext | null = null;
let SND: { wind: Layer; water: Layer; flap: Layer } | null = null;
interface Layer { g: GainNode; fl: BiquadFilterNode }

export function unlockAudio(): void {
  try {
    const W = window as unknown as { AudioContext: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    AC = AC || new (W.AudioContext || W.webkitAudioContext!)();
    void AC.resume();
    initSound();
  } catch { /* pas de son */ }
}

export function beep(f: number, d: number, vol = 0.05): void {
  if (!AC || !app.soundOn) return;
  try {
    const o = AC.createOscillator(), g = AC.createGain();
    o.frequency.value = f; o.type = 'square'; g.gain.value = vol;
    g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + d);
    o.connect(g).connect(AC.destination); o.start(); o.stop(AC.currentTime + d);
  } catch { /* */ }
}

export function sfx(s: Sfx): void {
  switch (s) {
    case 'tick': beep(660, 0.15); break;
    case 'gun': beep(440, 0.9, 0.07); break;
    case 'finish': beep(880, 0.5, 0.06); break;
    case 'capsize': beep(120, 0.6, 0.05); break;
    case 'gybeWild': beep(100, 0.6, 0.06); break;
  }
}

/** Claquement de bôme au virement (gybe = empannage). */
export const boom = (gybe: boolean): void => beep(gybe ? 70 : 120, gybe ? 0.25 : 0.12, gybe ? 0.08 : 0.04);

function initSound(): void {
  if (!AC || SND) return;
  try {
    const ac = AC;
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const mk = (type: BiquadFilterType, fr: number, q: number): Layer => {
      const s = ac.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.value = fr; fl.Q.value = q;
      const g = ac.createGain(); g.gain.value = 0;
      s.connect(fl).connect(g).connect(ac.destination); s.start(0, Math.random() * 1.9);
      return { g, fl };
    };
    SND = { wind: mk('bandpass', 700, 0.7), water: mk('lowpass', 420, 0.6), flap: mk('bandpass', 260, 1.6) };
  } catch { SND = null; }
}

export function updSound(g: Game | null, rt: number): void {
  if (!SND || !AC || !g) return;
  const me = g.me, on = app.soundOn && !g.demo && document.visibilityState !== 'hidden', tt = AC.currentTime;
  const aws = me.aws || 12;
  SND.wind.g.gain.setTargetAtTime(on ? clamp(aws / 26, 0, 1) * 0.07 : 0, tt, 0.4);
  SND.wind.fl.frequency.setTargetAtTime(450 + aws * 28, tt, 0.6);
  SND.water.g.gain.setTargetAtTime(on ? clamp(me.v / 7, 0, 1.2) * 0.11 : 0, tt, 0.3);
  const lu = on && me.cap <= 0 && (Math.abs(me.twa) < 32 * D || me.sheet - (me.opt0 ?? 0.4) > 0.13);
  SND.flap.g.gain.setTargetAtTime(lu ? (0.5 + 0.5 * Math.sin(rt * 60)) * 0.07 : 0, tt, 0.015);
}
