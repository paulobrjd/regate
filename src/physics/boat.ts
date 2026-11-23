// Dynamique d'un voilier de course au large : barre, lacet, systèmes (quille pendulaire, foils, ballasts),
// manœuvres en solitaire (changement de voile, ris), énergie du skipper, pilote automatique,
// gîte, départ au lof, chavirage, surf et mer qui tape. Code pur, sans rendu.
import { clamp, norm, D, type Rng } from '../util/math';
import { KN, RHO_WATER, GRAV } from './units';
import type { BoatClass } from './classes';
import { polarSpeed } from './polar';
import {
  evalForces, controlsToTrim, idealControls, depowerFor, etaAt,
  type Calibration, type Config, type Controls,
} from './model';
import type { AI } from '../ai/bot';

export interface WakePt { x: number; y: number; t: number }
export interface Task { kind: 'head' | 'reef'; from: number; to: number; t: number; dur: number }
export type PilotMode = 'cap' | 'vent';
export interface Pilot { on: boolean; mode: PilotMode; set: number }

export interface Boat {
  id: number; name: string; col: string; cls: BoatClass;
  // état
  x: number; y: number; h: number; v: number; r: number; rud: number; heel: number; lee: number;
  ix: number; iy: number; ih: number; px: number; py: number;
  mainSheet: number; trav: number; headSheet: number;
  head: number; reefs: number; task: Task | null;
  /** Quille : -1 en grand sur bâbord .. +1 en grand sur tribord. */
  keel: number; keelT: number;
  foilP: number; foilS: number; foilPT: number; foilST: number;
  ballP: number; ballS: number; ballPT: number; ballST: number;
  energy: number;
  pilot: Pilot;
  /** Facteur de performance (IA : habileté de l'équipage virtuel). */
  perf: number;
  // incidents (s restantes)
  broach: number; knock: number; aground: number; capT: number;
  // dérivés (pour l'IHM, l'IA et le rendu)
  tws: number; twa: number; awa: number; aws: number; tack: number; lastTack: number;
  /** Vent réel moyen sur ~1 min (nds) : sert aux décisions de voilure. */
  twsAvg: number;
  target: number; heelEq: number; ideal: Controls; eff: number; headPow: number; mainPow: number;
  /** Ouverture conseillée des voiles (0..1), recalculée 4 fois par seconde. */
  depower: number; depT: number;
  foilLift: number;
  // parcours
  leg: number; ocs: boolean; fin: number | null;
  wake: WakePt[]; wt: number;
  ai: AI | null;
}

export interface BoatInput { helm: number; mainDir: number; headDir: number; travDir: number }
export const NO_INPUT: BoatInput = { helm: 0, mainDir: 0, headDir: 0, travDir: 0 };

export type BoatEvent = 'tack' | 'gybe' | 'crashGybe' | 'broach' | 'knockdown' | 'recovered' | 'aground' | 'refloat'
  | 'contactMark' | 'taskDone' | 'taskBusy';

export interface Obstacle { x: number; y: number; r: number }

export interface StepEnv {
  wd: number;
  /** Vent réel (nds) au point. */
  wind(x: number, y: number): number;
  /** Hauteur de la mer (m). */
  wave(x: number, y: number): number;
  /** Célérité de la houle dominante (m/s). */
  waveC: number;
  cal: Calibration;
  rnd: Rng;
  obstacles: readonly Obstacle[];
  ground(x: number, y: number): boolean;
  event(b: Boat, e: BoatEvent, info?: string): void;
}

export function mkBoat(cls: BoatClass, o: Partial<Boat>): Boat {
  const b: Boat = {
    id: 0, name: 'Toi', col: '#ffd23f', cls,
    x: 0, y: 300, h: Math.PI / 2, v: 2, r: 0, rud: 0, heel: 0, lee: 0,
    ix: 0, iy: 300, ih: Math.PI / 2, px: 0, py: 300,
    mainSheet: 0.4, trav: 0.5, headSheet: 0.5,
    head: 0, reefs: 0, task: null,
    keel: 0, keelT: 0, foilP: 0, foilS: 0, foilPT: 0, foilST: 0, ballP: 0, ballS: 0, ballPT: 0, ballST: 0,
    energy: 1, pilot: { on: false, mode: 'vent', set: 90 * D }, perf: 1,
    broach: 0, knock: 0, aground: 0, capT: 0,
    tws: 12, twsAvg: 0, twa: 90 * D, awa: 60 * D, aws: 15, tack: 1, lastTack: 1,
    target: 0, heelEq: 0, depower: 0, depT: 0, ideal: { mainSheet: 0.3, trav: 1, headSheet: 0.5 }, eff: 1, headPow: 1, mainPow: 1, foilLift: 0,
    leg: 0, ocs: false, fin: null, wake: [], wt: 0, ai: null,
  };
  Object.assign(b, o);
  b.ix = b.px = b.x; b.iy = b.py = b.y; b.ih = b.h;
  return b;
}

// ---------- côtés : au vent / sous le vent ----------
/** tack = +1 : bâbord amures (vent venant de bâbord), -1 : tribord amures. */
export function config(b: Boat): Config {
  const port = b.tack > 0; // le vent vient de bâbord : bâbord est au vent
  return {
    head: b.head, reefs: b.reefs,
    keelW: port ? -b.keel : b.keel,
    foilLee: port ? b.foilS : b.foilP, foilWind: port ? b.foilP : b.foilS,
    ballW: port ? b.ballP : b.ballS, ballL: port ? b.ballS : b.ballP,
  };
}

// ---------- commandes ----------
const energyK = (b: Boat) => (b.energy < 0.25 ? 1.6 : 1);

export function cmdHead(b: Boat, i: number, env?: StepEnv): boolean {
  if (i < 0 || i >= b.cls.heads.length || i === b.head) return false;
  if (b.task) { env?.event(b, 'taskBusy'); return false; }
  b.task = { kind: 'head', from: b.head, to: i, t: 0, dur: b.cls.heads[i].change * energyK(b) };
  b.energy = Math.max(0, b.energy - 0.1);
  return true;
}
export function cmdReef(b: Boat, dir: number, env?: StepEnv): boolean {
  const to = clamp(b.reefs + Math.sign(dir), 0, b.cls.reefs.length - 1);
  if (to === b.reefs) return false;
  if (b.task) { env?.event(b, 'taskBusy'); return false; }
  const dur = (to > b.reefs ? b.cls.reefs[to].time : b.cls.reefs[b.reefs].time * 0.7) * energyK(b);
  b.task = { kind: 'reef', from: b.reefs, to, t: 0, dur };
  b.energy = Math.max(0, b.energy - (to > b.reefs ? 0.07 : 0.05));
  return true;
}
/** Quille : en grand au vent, ou au centre si elle y est déjà. */
export function cmdKeel(b: Boat): void {
  const wind = b.tack > 0 ? -1 : 1;
  b.keelT = Math.abs(b.keelT - wind) < 0.05 ? 0 : wind;
}
/** Foils : sortir sous le vent et rentrer au vent ; s'ils y sont déjà, tout rentrer. */
export function cmdFoils(b: Boat): void {
  const port = b.tack > 0;
  const leeT = port ? b.foilST : b.foilPT, windT = port ? b.foilPT : b.foilST;
  const deploy = !(leeT > 0.5 && windT < 0.5);
  if (port) { b.foilST = deploy ? 1 : 0; b.foilPT = 0; } else { b.foilPT = deploy ? 1 : 0; b.foilST = 0; }
}
/** Ballast : transférer au vent s'il est sous le vent, sinon remplir / vider le ballast au vent. */
export function cmdBallast(b: Boat): void {
  const port = b.tack > 0;
  const w = port ? b.ballP : b.ballS, l = port ? b.ballS : b.ballP, wT = port ? b.ballPT : b.ballST;
  let nw: number, nl: number;
  if (l > 0.05) { nw = Math.min(1, w + l); nl = 0; }
  else if (wT > 0.5) { nw = 0; nl = 0; }
  else { nw = 1; nl = 0; }
  if (port) { b.ballPT = nw; b.ballST = nl; } else { b.ballST = nw; b.ballPT = nl; }
}
export function cmdPilot(b: Boat, wd: number): void {
  b.pilot.on = !b.pilot.on;
  if (b.pilot.on) b.pilot.set = b.pilot.mode === 'cap' ? b.h : norm(b.h - wd);
}
export function cmdPilotMode(b: Boat, wd: number): void {
  b.pilot.mode = b.pilot.mode === 'cap' ? 'vent' : 'cap';
  b.pilot.set = b.pilot.mode === 'cap' ? b.h : norm(b.h - wd);
}
/** Virement ou empannage au pilote : même angle au vent, de l'autre côté. */
export function cmdPilotTack(b: Boat, wd: number): void {
  const twa = norm(b.h - wd);
  b.pilot.on = true; b.pilot.mode = 'vent'; b.pilot.set = -twa;
}
/** Décale la consigne du pilote : deg > 0 = vers la droite (tribord), dans les deux modes. */
export function cmdPilotAdjust(b: Boat, deg: number): void {
  if (b.pilot.mode === 'cap') { b.pilot.set = norm(b.pilot.set + deg * D); return; }
  let s = norm(b.pilot.set + deg * D);
  if (Math.abs(s) < 25 * D) s = (Math.sign(b.pilot.set) || 1) * 25 * D; // le pilote refuse de mettre face au vent
  b.pilot.set = s;
}

/** Gouvernail commandé par le pilote (régulateur proportionnel-dérivé). */
function pilotRudder(b: Boat, wd: number): number {
  const hd = b.pilot.mode === 'cap' ? b.pilot.set : norm(wd + b.pilot.set);
  let err = norm(hd - b.h);
  // virer face au vent sans vitesse est impossible : on passe alors par l'empannage
  const twa = norm(b.h - wd), twaT = norm(hd - wd);
  const viaWind = Math.sign(twa) !== Math.sign(twaT) && Math.abs(twa) + Math.abs(twaT) < Math.PI;
  if (viaWind && b.v < 2.5 && Math.abs(err) > 0.6) err = err - Math.sign(err) * 2 * Math.PI;
  return clamp(err * 1.6 - b.r * 1.3, -0.45, 0.45);
}

const approach = (v: number, t: number, rate: number) => v + clamp(t - v, -rate, rate);

/** Un pas de simulation. */
export function stepBoat(b: Boat, dt: number, inp: BoatInput, env: StepEnv): void {
  const cls = b.cls, wd = env.wd;
  b.ix = b.x; b.iy = b.y; b.ih = b.h; b.px = b.x; b.py = b.y;
  b.wt += dt;
  for (const w of b.wake) w.t += dt;
  while (b.wake.length && b.wake[0].t > 6) b.wake.shift();

  b.tws = env.wind(b.x, b.y);
  b.twsAvg = b.twsAvg ? b.twsAvg + (b.tws - b.twsAvg) * dt / 60 : b.tws;
  const tws = b.tws * KN;
  b.twa = norm(b.h - wd);
  b.tack = b.twa >= 0 ? 1 : -1;
  if (b.energy < 1 && !b.task) b.energy = Math.min(1, b.energy + dt / 3000);

  // --- échoué ---
  if (b.aground > 0) {
    b.aground -= dt; b.v *= 1 - Math.min(1, dt * 3); b.heel += (12 * D - b.heel) * Math.min(1, dt);
    if (b.aground <= 0) {
      // dégagé : le bateau est remis cap vers le large, à quelques longueurs du rivage
      b.aground = 0;
      let best = 0, bd = -1;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        let d = 0; while (d < 400 && !env.ground(b.x + Math.sin(a) * d, b.y - Math.cos(a) * d)) d += 20;
        if (d > bd) { bd = d; best = a; }
      }
      b.h = best; b.x += Math.sin(best) * 30; b.y -= Math.cos(best) * 30; b.v = 1.5; b.r = 0;
      env.event(b, 'refloat');
    }
    return;
  }
  // --- couché ---
  if (b.knock > 0) {
    b.knock -= dt; b.v *= 1 - Math.min(1, dt * 1.5); b.heel += (78 * D - b.heel) * Math.min(1, dt * 2);
    b.mainSheet = approach(b.mainSheet, 1, dt); b.headSheet = approach(b.headSheet, 1, dt);
    b.x += -Math.sin(wd) * dt * 0.8; b.y += Math.cos(wd) * dt * 0.8;
    if (b.knock <= 0) { b.knock = 0; b.heel = 20 * D; env.event(b, 'recovered'); }
    return;
  }

  // --- barre et lacet ---
  let rudT: number;
  if (b.broach > 0) { b.broach -= dt; rudT = -b.tack * 0.45; }
  else if (b.pilot.on) rudT = pilotRudder(b, wd);
  else rudT = inp.helm * 0.42;
  b.rud = approach(b.rud, rudT, 1.5 * dt);
  const hd = b.heel / D;
  const grip = clamp(1 - (hd - 28) / 16, 0.15, 1);
  const weather = hd > 18 ? (hd - 18) * D * 0.5 : 0; // ardent : le bateau veut lofer
  const rEff = b.rud * grip - b.tack * weather * (b.broach > 0 ? 0 : 1);
  const vEff = Math.max(Math.abs(b.v), 0.7) * (b.v < -0.2 ? -1 : 1);
  let rT = vEff * Math.tan(rEff) / cls.rudLen + (b.broach > 0 ? -b.tack * 0.3 : 0);
  // à l'arrêt, le vent sur le gréement fait abattre l'étrave
  if (Math.abs(b.v) < 2) rT += b.tack * 0.08 * (1 - Math.abs(b.v) / 2) * Math.max(0, Math.cos(b.twa)) * Math.min(1, tws / 6);
  b.r += (rT - b.r) * Math.min(1, dt / 0.9);
  b.h = norm(b.h + b.r * dt);
  b.twa = norm(b.h - wd);
  b.tack = b.twa >= 0 ? 1 : -1;
  const twaDeg = Math.abs(b.twa) / D;

  // --- virement / empannage ---
  if (b.tack !== b.lastTack) {
    const gybe = twaDeg > 90;
    b.lastTack = b.tack;
    b.energy = Math.max(0, b.energy - (gybe ? 0.03 : 0.02));
    if (gybe && b.tws > 18 && b.mainSheet > 0.55 && b.fin == null) {
      b.v *= 0.7; b.broach = 4; env.event(b, 'crashGybe');
    } else env.event(b, gybe ? 'gybe' : 'tack');
  }

  // --- systèmes ---
  const kE = energyK(b);
  b.keel = approach(b.keel, b.keelT, 2 / cls.keelTime * dt);
  const fr = dt / (cls.foilTime * kE);
  const fP = approach(b.foilP, b.foilPT, fr), fS = approach(b.foilS, b.foilST, fr);
  b.energy = Math.max(0, b.energy - (Math.abs(fP - b.foilP) + Math.abs(fS - b.foilS)) * 0.03);
  b.foilP = fP; b.foilS = fS;
  const transfer = (b.ballPT - b.ballP) * (b.ballST - b.ballS) < 0;
  const br = dt / (transfer ? cls.ballastTransfer : cls.ballastFill);
  b.ballP = approach(b.ballP, b.ballPT, br); b.ballS = approach(b.ballS, b.ballST, br);

  // --- manœuvre en cours ---
  b.headPow = 1; b.mainPow = 1;
  if (b.task) {
    const T = b.task; T.t += dt; const p = clamp(T.t / T.dur, 0, 1);
    if (T.kind === 'head') {
      b.headPow = p < 0.35 ? 1 - p / 0.35 : p < 0.65 ? 0 : (p - 0.65) / 0.35;
      b.head = p < 0.5 ? T.from : T.to;
    } else {
      b.mainPow = 1 - 0.55 * Math.sin(Math.PI * p);
      b.reefs = p < 0.5 ? T.from : T.to;
    }
    if (p >= 1) { b.task = null; b.headPow = b.mainPow = 1; env.event(b, 'taskDone', T.kind); }
  }

  // --- écoutes (commande manuelle) ---
  const sr = 0.35 * dt / kE;
  b.mainSheet = clamp(b.mainSheet + inp.mainDir * sr, 0, 1);
  b.headSheet = clamp(b.headSheet + inp.headDir * sr, 0, 1);
  b.trav = clamp(b.trav + inp.travDir * 0.8 * dt, -1, 1);

  // --- forces ---
  const cfg = config(b), head = cls.heads[b.head];
  const ctl = { mainSheet: b.mainSheet, trav: b.trav, headSheet: b.headSheet };
  const f = evalForces(cls, cfg, controlsToTrim(cls, head, ctl), tws, b.twa, b.v, { headPow: b.headPow, mainPow: b.mainPow, heel: b.heel });
  b.heelEq = f.heelEq; b.aws = f.aws / KN; b.awa = f.awa; b.foilLift = f.foilLift;
  // réglage idéal : ouverture calculée voiles bordées (comme pour le calage sur la polaire)
  b.depT -= dt;
  if (b.depT <= 0) {
    b.depT = 0.25;
    const full = idealControls(cls, head, Math.abs(f.awa) / D, 0);
    b.depower = depowerFor(evalForces(cls, cfg, controlsToTrim(cls, head, full), tws, b.twa, b.v, { headPow: b.headPow, mainPow: b.mainPow }).heelEq);
  }
  b.ideal = idealControls(cls, head, Math.abs(f.awa) / D, b.depower);
  b.target = polarSpeed(cls.polar, b.tws, twaDeg);

  // gîte : relaxation vers l'équilibre ; pas d'équilibre = chavirage
  const hT = Number.isNaN(f.heelEq) ? 85 * D : f.heelEq;
  b.heel += (hT - b.heel) * Math.min(1, dt / 1.1);
  if ((Number.isNaN(f.heelEq) || b.heel > 62 * D) && b.fin == null) {
    b.capT += dt;
    if (b.capT > 1) { b.capT = 0; b.knock = 25; b.broach = 0; b.task = null; env.event(b, 'knockdown'); return; }
  } else b.capT = Math.max(0, b.capT - dt);
  if (b.heel > 42 * D && b.broach <= 0 && b.v > 3 && b.fin == null) { b.broach = 5; env.event(b, 'broach'); }

  // --- vitesse ---
  const mass = (cls.mass + cls.ballastMax * (b.ballP + b.ballS)) * 1.15;
  const eta = etaAt(env.cal, b.tws, twaDeg) * b.perf * (b.broach > 0 ? 0.35 : 1);
  const v = b.v, rudDrag = 0.5 * RHO_WATER * v * Math.abs(v) * cls.rudArea * (0.006 + 1.2 * b.rud * b.rud);
  const fx = Math.sin(b.h), fy = -Math.cos(b.h);
  const slope = (env.wave(b.x + fx * 8, b.y + fy * 8) - env.wave(b.x - fx * 8, b.y - fy * 8)) / 16;
  let waveF = -mass * GRAV * slope * 0.5;
  if (twaDeg > 100 && slope < 0 && v > 0.55 * env.waveC) waveF *= 2.2; // surf : le bateau part dans la vague
  const pound = twaDeg < 75 ? mass * GRAV * Math.max(0, slope) * 0.8 * clamp(v / 6, 0, 1.5) : 0;
  const thrust = b.fin != null ? -mass * 0.3 * Math.sign(v) * Math.min(1, Math.abs(v)) : f.drive * eta;
  const acc = (thrust - f.hull - f.induced - f.foilDrag - rudDrag - pound + waveF) / mass;
  b.v = Math.max(-0.8, b.v + acc * dt);
  b.eff = b.target > 0.5 ? clamp(b.v / KN / b.target, 0, 1.5) : 0;

  // --- déplacement (dérive vers sous le vent) ---
  b.lee = b.v > 0.3 ? f.leeway : 0;
  const cog = b.h + b.tack * b.lee;
  const slip = Math.max(0, 1 - b.v) * 0.03 * tws;
  b.x += Math.sin(cog) * b.v * dt - Math.sin(wd) * slip * dt;
  b.y += -Math.cos(cog) * b.v * dt + Math.cos(wd) * slip * dt;
  if (b.wt > 0.12 && b.v > 0.8) { b.wt = 0; b.wake.push({ x: b.x - fx * 9, y: b.y - fy * 9, t: 0 }); }

  // --- échouage, bouées ---
  if (env.ground(b.x + fx * 8, b.y + fy * 8)) {
    b.x = b.px - fx * 2; b.y = b.py - fy * 2; b.v = 0; b.aground = 15; b.task = null; env.event(b, 'aground'); return;
  }
  for (const o of env.obstacles) {
    const dx = b.x - o.x, dy = b.y - o.y, dd = Math.hypot(dx, dy), R = o.r + 7;
    if (dd < R && dd > 0) {
      b.x = o.x + dx / dd * R; b.y = o.y + dy / dd * R;
      // freine seulement si l'étrave pousse vers l'obstacle
      if (-(fx * dx + fy * dy) / dd > 0.3 && b.v > 0.5) { b.v *= 0.6; env.event(b, 'contactMark'); }
    }
  }
}
