// Modèle de bateau du prototype : vent apparent, réglage, gîte/rappel, dessalage, surf, dérive.
// Code pur : aucune dépendance au rendu. Les effets (messages, sons) passent par env.event().
import { D, clamp, norm, type Rng } from '../util/math';
import { polar } from './polar';
import type { AI } from '../ai/bot';

export interface WakePt { x: number; y: number; t: number }

export interface Boat {
  id: number;
  x: number; y: number; py: number; h: number; v: number;
  /** État précédent (pour l'interpolation du rendu). */
  ix: number; iy: number; ih: number;
  sheet: number; spi: boolean; spiT: number;
  leg: number; ocs: boolean; fin: number | null;
  wake: WakePt[]; wt: number;
  twa: number; awa: number; aws: number; wk: number;
  opt: number; opt0: number; eff: number;
  tack: number; col: string; name: string; ai: AI | null;
  heelN: number; hike: number; cap: number; capT: number; rud: number; surf: number;
  lastSide: number;
}

export interface BoatControl {
  turn: number;
  /** Consigne absolue d'écoute (auto / IA), ou null pour la commande manuelle via sheetDir. */
  sheet: number | null;
  sheetDir?: number;
  spi?: boolean;
  skill?: number;
}

export type BoatEvent = 'capsize' | 'righted' | 'gybeWild' | 'gybeHard' | 'contactMark';

export interface Obstacle { x: number; y: number; r: number }

export interface StepEnv {
  /** Direction du vent réel (rad). */
  wd: number;
  /** Force du vent réel (nds) au point. */
  wind(x: number, y: number): number;
  /** Hauteur de la mer, coordonnées monde 3D (m) — la physique passe (x*0.1, y*0.1). */
  wave(x: number, z: number): number;
  rnd: Rng;
  obstacles: readonly Obstacle[];
  event(b: Boat, e: BoatEvent): void;
}

export function mkBoat(o: Partial<Boat>): Boat {
  return Object.assign({
    id: 0, x: 0, y: 250, py: 250, h: 90 * D, v: 1.5, ix: 0, iy: 250, ih: 90 * D,
    sheet: 0.6, spi: false, spiT: 0, leg: 0, ocs: false, fin: null, wake: [], wt: 0,
    twa: 90 * D, opt: 0.4, eff: 1, wk: 12, tack: 1, col: '#ffd23f', name: 'Toi', ai: null,
    heelN: 0, hike: 0, cap: 0, capT: 0, rud: 0, aws: 12, awa: 90 * D, opt0: 0.4, surf: 0, lastSide: 0,
  } satisfies Boat, o);
}

/** Choque supplémentaire conseillé quand ça gîte trop. */
export const depower = (b: Boat): number => clamp(((b.heelN || 0) - 0.5) * 1.7, 0, 0.6);

/** Un pas de simulation pour un bateau. */
export function stepBoat(b: Boat, dt: number, c: BoatControl, env: StepEnv): void {
  b.wt += dt;
  for (const w of b.wake) w.t += dt;
  while (b.wake.length && b.wake[0].t > 2.6) b.wake.shift();
  const wd = env.wd;

  if (b.cap > 0) {
    b.cap -= dt;
    b.v *= 1 - Math.min(1, dt * 2.5);
    b.heelN += (2.3 - b.heelN) * Math.min(1, dt * 3);
    b.spi = false;
    b.spiT = Math.max(0, b.spiT - dt);
    b.rud *= 0.9;
    b.py = b.y;
    b.x += -Math.sin(wd) * dt * 6;
    b.y += Math.cos(wd) * dt * 6;
    if (b.cap <= 0) { b.cap = 0; b.heelN = 0.2; b.v = 0.5; b.capT = 0; env.event(b, 'righted'); }
    return;
  }

  b.rud += ((c.turn || 0) - b.rud) * Math.min(1, dt * 6);
  b.h = norm(b.h + c.turn * 1.25 * (0.4 + 0.6 * Math.min(b.v / 4, 1)) * dt);
  b.twa = norm(b.h - wd);
  const a = Math.abs(b.twa) / D;
  b.wk = env.wind(b.x, b.y);

  // vent apparent
  const ax = -Math.sin(wd) * b.wk - Math.sin(b.h) * b.v, ay = Math.cos(wd) * b.wk + Math.cos(b.h) * b.v;
  b.aws = Math.hypot(ax, ay);
  b.awa = norm(b.h - Math.atan2(-ax, ay));
  const aa = Math.abs(b.awa) / D, side = b.awa >= 0 ? 1 : -1;

  // empannage
  if (b.lastSide && side !== b.lastSide && a > 100 && b.fin == null) {
    const risky = b.wk > 14.5 && b.sheet > 0.55, ch = b.ai ? 0.5 * (1 - (c.skill || 1)) : 0.45;
    if (risky && env.rnd() < ch) {
      b.lastSide = side; b.cap = 7; b.capT = 0; b.spi = false;
      env.event(b, 'gybeWild');
      return;
    }
    b.v *= risky ? 0.75 : 0.93;
    if (risky) env.event(b, 'gybeHard');
  }
  b.lastSide = side;

  // réglage
  b.opt0 = b.opt = clamp((aa - 22) / 150, 0, 1);
  if (c.sheet != null) b.sheet += (c.sheet - b.sheet) * Math.min(1, dt * 3);
  else b.sheet = clamp(b.sheet + (c.sheetDir || 0) * 0.55 * dt, 0, 1);
  if (c.spi !== undefined) b.spi = c.spi;
  b.spiT = clamp(b.spiT + (b.spi ? 1 : -1) * dt / 1.4, 0, 1);
  const d = b.sheet - b.opt0;
  b.eff = (a < 32 ? 0 : Math.max(0.15, 1 - (d * 2.4) ** 2)) * (c.skill || 1);

  // gîte, rappel, dessalage
  const pw = Math.pow(b.aws / 15, 1.5)
    * (aa < 25 ? 0.3 : aa < 95 ? Math.sin(aa * D) : 1 - (aa - 95) / 85 * 0.7)
    * (1 - 0.8 * Math.max(0, d))
    * (1 + 0.25 * b.spiT * (aa > 70 && aa < 130 ? 1 : 0));
  b.hike += (clamp((pw - 0.25) / 0.6, 0, 1) - b.hike) * Math.min(1, dt * 1.5);
  b.heelN += (Math.max(0, pw - b.hike * 0.6) - b.heelN) * Math.min(1, dt * 2.5);
  const over = Math.max(0, b.heelN - 0.75);
  if (b.heelN > 1.15 && b.fin == null) {
    b.capT += dt;
    if (b.capT > 1.1) { b.cap = 7; b.capT = 0; b.spi = false; env.event(b, 'capsize'); }
  } else b.capT = Math.max(0, b.capT - dt);

  // surf dans les vagues au portant, mer qui tape au près
  const fx = Math.sin(b.h), fy = -Math.cos(b.h);
  const slope = (env.wave((b.x + fx * 20) * 0.1, (b.y + fy * 20) * 0.1) - env.wave((b.x - fx * 20) * 0.1, (b.y - fy * 20) * 0.1)) / 4;
  b.surf = a > 110 ? clamp(-slope * 12, 0, 1.4) * b.wk / 12 : 0;
  const sp = a >= 95 ? 1 + 0.35 * b.spiT * clamp((a - 95) / 45, 0, 1) : a < 80 ? 1 - 0.45 * b.spiT : 1;
  const pound = a < 70 ? 1 - clamp(slope * 6, 0, 0.15) : 1;
  const tgt = b.fin != null ? 0 : (polar(a) * b.wk * 0.55 * b.eff * sp + b.surf) * (1 - clamp(over * 1.1, 0, 0.6)) * pound;
  b.v += (tgt - b.v) * dt * (tgt > b.v ? 0.5 : 0.8);
  if (c.turn) b.v *= 1 - 0.06 * dt * Math.abs(c.turn);

  // dérive
  const lw = (aa < 70 ? 0.07 : 0.02) * b.v * 20 * dt * side;
  b.py = b.y;
  b.x += fx * b.v * 20 * dt + Math.cos(b.h) * lw;
  b.y += fy * b.v * 20 * dt + Math.sin(b.h) * lw;
  if (b.wt > 0.07 && b.v > 0.4) { b.wt = 0; b.wake.push({ x: b.x - fx * 20, y: b.y - fy * 20, t: 0 }); }

  // obstacles (bouées, bateau comité)
  for (const o of env.obstacles) {
    const dd = Math.hypot(b.x - o.x, b.y - o.y);
    if (dd < o.r && dd > 0) {
      b.x = o.x + (b.x - o.x) / dd * o.r;
      b.y = o.y + (b.y - o.y) / dd * o.r;
      b.v *= 0.4;
      env.event(b, 'contactMark');
    }
  }
}
