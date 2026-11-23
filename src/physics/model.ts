// Modèle de forces d'un voilier, simplifié mais physique :
//  - voiles : portance et traînée selon l'incidence (bon réglage = bonne incidence) ;
//  - gîte : moment de gîte contre moment de redressement (forme, quille pendulaire, ballasts, foil) ;
//  - dérive : la force latérale est reprise par la quille et les safrans, au prix d'une traînée induite ;
//  - carène : frottement + résistance de vague, allégée par le foil.
// Un coefficient de calage η(vent, angle) fait coïncider la vitesse d'équilibre avec la polaire
// quand la configuration et le réglage sont optimaux ; toute erreur fait perdre de la vitesse.
import type { BoatClass, SailDef } from './classes';
import { polarSpeed, bilinear, locate } from './polar';
import { KN, RHO_AIR, RHO_WATER, GRAV } from './units';
import { clamp } from '../util/math';

const DEG = Math.PI / 180;

/** Configuration du bateau, exprimée relativement au vent (au vent / sous le vent). */
export interface Config {
  head: number;      // indice de la voile d'avant
  reefs: number;     // 0..3
  keelW: number;     // quille : -1 (sous le vent) .. 1 (au vent, en grand)
  foilLee: number;   // foil sous le vent sorti 0..1
  foilWind: number;  // foil au vent sorti 0..1
  ballW: number;     // ballast au vent 0..1
  ballL: number;     // ballast sous le vent 0..1
}

/** Réglage des voiles (angles d'écoute en degrés + vrillage 0..1). */
export interface Trim { main: number; twist: number; head: number }

/** Coefficients de portance / traînée d'une voile à une incidence alpha (°). */
export function sailCoeffs(s: SailDef, alpha: number, twist: number): { cl: number; cd: number } {
  if (alpha <= 0) return { cl: 0, cd: s.cd0 + 0.12 + Math.min(0.2, -alpha * 0.01) }; // faseye
  const clmax = s.clmax * (1 - 0.25 * twist);
  let cl: number, stall = 0;
  if (alpha <= s.aopt) cl = clmax * Math.sin(Math.PI / 2 * alpha / s.aopt);
  else { stall = clamp((alpha - s.aopt) / (90 - s.aopt), 0, 1); cl = clmax * Math.pow(1 - stall, 0.7); }
  const cd = s.cd0 + 0.07 * cl * cl + 1.1 * Math.pow(stall, 1.3);
  return { cl, cd };
}

/** Facteur de dégonflage d'une voile quand le vent apparent passe trop sur l'avant. */
export const collapse = (s: SailDef, awaDeg: number): number => clamp((awaDeg - (s.awaMin - 12)) / 12, 0, 1);

// --- conversion commandes ↔ angles ---
/** Angle de bôme (°) selon l'écoute de GV (0 bordée .. 1 choquée) et le chariot (-1 au vent .. 1 sous le vent). */
export const mainAngle = (sheet: number, trav: number): number => 80 * sheet + 8 * trav;
export const mainTwist = (sheet: number): number => clamp(sheet / 0.4, 0, 1) * 0.7;
export const headAngle = (s: SailDef, sheet: number): number => s.dmin + sheet * (s.dmax - s.dmin);

export interface Controls { mainSheet: number; trav: number; headSheet: number }

/** Réglage idéal pour un vent apparent donné ; depower 0..1 ouvre les voiles quand ça gîte trop. */
export function idealControls(cls: BoatClass, head: SailDef, awaDeg: number, depower: number): Controls {
  const k = 1 - 0.45 * depower;
  const dm = clamp(awaDeg - cls.main.aopt * k, -8, 88);
  let trav: number, mainSheet: number;
  if (dm <= 8) { trav = clamp(dm / 8, -1, 1); mainSheet = 0; }
  else { trav = 1; mainSheet = clamp((dm - 8) / 80, 0, 1); }
  const dh = clamp(awaDeg - head.aopt * k, head.dmin, head.dmax);
  return { mainSheet, trav, headSheet: (dh - head.dmin) / (head.dmax - head.dmin) };
}
export const controlsToTrim = (cls: BoatClass, head: SailDef, c: Controls): Trim =>
  ({ main: mainAngle(c.mainSheet, c.trav), twist: mainTwist(c.mainSheet), head: headAngle(head, c.headSheet) });

export interface Forces {
  aws: number; awa: number;       // vent apparent (m/s, rad signé)
  drive: number; side: number;    // forces aéro brutes, sans gîte (N)
  heelMoment: number;             // moment de gîte à gîte nulle (N·m)
  heelEq: number;                 // gîte d'équilibre (rad), NaN si chavirage
  foilLift: number; disp: number; // portance du foil (N), déplacement effectif (kg)
  leeway: number;                 // dérive (rad, positive vers sous le vent)
  hull: number; induced: number; foilDrag: number; // traînées (N)
  mainCl: number; headCl: number; alphaMain: number; alphaHead: number;
}

export interface EvalOpts {
  /** Facteurs de puissance pendant une manœuvre (changement de voile, prise de ris). */
  headPow?: number; mainPow?: number;
  /** Gîte réelle du bateau (rad), utilisée pour les pertes ; sinon la gîte d'équilibre. */
  heel?: number;
}

/** Moment de redressement (N·m) à la gîte phi (rad, positive sous le vent). */
export function rightingMoment(cls: BoatClass, cfg: Config, phi: number, disp: number, foilLift: number): number {
  const keel = cfg.keelW * cls.keelMax * DEG;
  const form = disp * GRAV * cls.gm * Math.sin(phi) * Math.max(0.15, 1 - (phi / (80 * DEG)) ** 2);
  const bulb = cls.bulb * GRAV * cls.keelDepth * Math.sin(keel + phi);
  const ball = cls.ballastMax * GRAV * (cfg.ballW - cfg.ballL) * cls.ballastY * Math.cos(phi);
  // le foil sous le vent ne redresse que s'il est bien immergé : son effet s'estompe quand le bateau est à plat
  const foil = foilLift * cls.foilLever * Math.cos(phi) * clamp((phi + 3 * DEG) / (15 * DEG), 0, 1);
  return form + bulb + ball + foil;
}

/** Résistance de carène (N). */
export function hullDrag(cls: BoatClass, V: number, disp: number, heel: number): number {
  const v = Math.abs(V), S = cls.wetted * Math.pow(disp / cls.mass, 2 / 3);
  const Rf = 0.5 * RHO_WATER * S * v * v * cls.cf;
  const x = v / Math.sqrt(GRAV * cls.lwl) / 0.55;
  const Rw = disp * GRAV * cls.waveA * x ** 4 / (1 + x ** 4); // bosse de vague puis plateau (planing)
  const hd = heel / DEG;
  // au-delà de ~27 nds : ventilation des appendices, embruns (croît très vite)
  const Rhs = 400 * (v / 14) ** 6;
  return (Rf + Rw + Rhs) * (1 + 0.45 * Math.max(0, hd - 22) / 15) * Math.sign(V || 1);
}

/** Toutes les forces pour un vent réel (tws m/s, twa rad signé) et une vitesse V (m/s). */
export function evalForces(cls: BoatClass, cfg: Config, trim: Trim, tws: number, twa: number, V: number, o: EvalOpts = {}): Forces {
  // vent apparent (repère bateau : x vers l'avant, y vers le côté d'où vient le vent)
  const wx = tws * Math.cos(twa) + V, wy = tws * Math.sin(Math.abs(twa));
  const aws = Math.hypot(wx, wy), awaAbs = Math.atan2(wy, wx), awaDeg = awaAbs / DEG;
  const head = cls.heads[cfg.head], R = cls.reefs[cfg.reefs];
  // voiles
  const aM = awaDeg - trim.main, aH = awaDeg - trim.head;
  const cM = sailCoeffs(cls.main, aM, trim.twist), cH = sailCoeffs(head, aH, 0);
  const col = collapse(head, awaDeg);
  const q = 0.5 * RHO_AIR * aws * aws;
  const AM = cls.main.area * R.area * (o.mainPow ?? 1), AH = head.area * (o.headPow ?? 1);
  const clH = cH.cl * col, cdH = cH.cd * col + (1 - col) * 0.25;
  const sa = Math.sin(awaAbs), ca = Math.cos(awaAbs);
  const dM = q * AM * (cM.cl * sa - cM.cd * ca), sM = q * AM * (cM.cl * ca + cM.cd * sa);
  const dH = q * AH * (clH * sa - cdH * ca), sH = q * AH * (clH * ca + cdH * sa);
  // fardage de la coque et du gréement (dans l'axe du vent apparent)
  const windage = q * cls.windage;
  const drive = dM + dH - windage * ca, side = sM + sH + windage * sa * 0.5;
  const heelMoment = sM * cls.main.ce * R.ce * (1 - 0.15 * trim.twist) + sH * head.ce;
  // foil
  const v = Math.max(0, V), m0 = cls.mass + cls.ballastMax * (cfg.ballW + cfg.ballL);
  const foilLift = Math.min(0.5 * RHO_WATER * v * v * cls.foilArea * cls.foilCl * cfg.foilLee, 0.55 * m0 * GRAV);
  const disp = Math.max(0.4 * m0, m0 - foilLift / GRAV);
  // gîte d'équilibre : moment de gîte (∝ cos³φ) = moment de redressement
  let heelEq: number;
  {
    const g = (phi: number) => heelMoment * Math.cos(phi) ** 3 - rightingMoment(cls, cfg, phi, disp, foilLift);
    let lo = -70 * DEG, hi = 85 * DEG;
    if (g(hi) > 0) heelEq = NaN; // couché : pas d'équilibre
    else if (g(lo) < 0) heelEq = lo;
    else { for (let i = 0; i < 15; i++) { const mid = (lo + hi) / 2; if (g(mid) > 0) lo = mid; else hi = mid; } heelEq = (lo + hi) / 2; }
  }
  const phi = o.heel ?? (Number.isNaN(heelEq) ? 80 * DEG : heelEq), c2 = Math.cos(phi) ** 2;
  // dérive et traînée induite
  const lat = cls.latArea + cls.foilArea * cfg.foilLee * 0.6, vv = Math.max(v, 0.8);
  const Fs = side * c2;
  const need = Fs / (0.5 * RHO_WATER * vv * vv * lat * 4.5);
  const leeway = clamp(need, 0, 0.3);
  const induced = Fs * leeway * 0.5;
  // foils
  const clUsed = cfg.foilLee > 0 ? foilLift / Math.max(1, 0.5 * RHO_WATER * v * v * cls.foilArea) : 0;
  const foilDrag = 0.5 * RHO_WATER * v * v * cls.foilArea * (0.012 * (cfg.foilLee + cfg.foilWind) + clUsed * clUsed / (Math.PI * 5) * cfg.foilLee);
  return {
    aws, awa: Math.sign(twa || 1) * awaAbs, drive: drive * c2, side, heelMoment, heelEq, foilLift, disp, leeway,
    hull: hullDrag(cls, V, disp, Math.abs(phi)), induced, foilDrag,
    mainCl: cM.cl, headCl: clH, alphaMain: aM, alphaHead: aH,
  };
}

/** Taux d'ouverture conseillé selon la gîte d'équilibre voiles bordées. */
export const depowerFor = (heelEq: number): number => Number.isNaN(heelEq) ? 1 : clamp((heelEq / DEG - 20) / 14, 0, 1);

/** Forces avec réglage idéal (et ouverture automatique si ça gîte trop). */
export function evalIdeal(cls: BoatClass, cfg: Config, tws: number, twa: number, V: number): { f: Forces; ctl: Controls } {
  const head = cls.heads[cfg.head];
  const awa0 = Math.atan2(tws * Math.sin(Math.abs(twa)), tws * Math.cos(twa) + V) / DEG;
  let ctl = idealControls(cls, head, awa0, 0);
  let f = evalForces(cls, cfg, controlsToTrim(cls, head, ctl), tws, twa, V);
  const d = depowerFor(f.heelEq);
  if (d > 0) { ctl = idealControls(cls, head, awa0, d); f = evalForces(cls, cfg, controlsToTrim(cls, head, ctl), tws, twa, V); }
  return { f, ctl };
}

/** Bilan des forces longitudinales (N), drive multiplié par eta. */
export const netForce = (f: Forces, eta: number): number => f.drive * eta - f.hull - f.induced - f.foilDrag;

// ---------- calage sur la polaire ----------
export interface Calibration {
  cls: BoatClass;
  tws: number[]; twa: number[];
  /** η[iTwa][iTws] */
  eta: number[][];
  /** Meilleure configuration [iTwa][iTws]. */
  best: Config[][];
}

/** Configurations essayées pour le calage (la quille et les ballasts toujours au vent ou au centre). */
function candidates(cls: BoatClass): Config[] {
  const out: Config[] = [];
  for (let head = 0; head < cls.heads.length; head++)
    for (let reefs = 0; reefs < cls.reefs.length; reefs++)
      for (const keelW of [0.4, 1])
        for (const foilLee of [0, 1])
          for (const ballW of [0, 1])
            out.push({ head, reefs, keelW, foilLee, foilWind: 0, ballW, ballL: 0 });
  return out;
}

const MAX_HEEL = 30 * DEG;

/**
 * Pour chaque point de la polaire, choisit la configuration qui maximise le rapport
 * poussée / traînée à la vitesse cible, puis calcule η pour que la poussée équilibre la traînée.
 */
export function calibrate(cls: BoatClass): Calibration {
  const P = cls.polar, cands = candidates(cls);
  const eta: number[][] = [], best: Config[][] = [];
  for (let i = 0; i < P.twa.length; i++) {
    eta.push([]); best.push([]);
    const twaDeg = Math.max(P.twa[i], 30), twa = twaDeg * DEG;
    for (let j = 0; j < P.tws.length; j++) {
      const tws = P.tws[j] * KN, V = Math.max(0.5, polarSpeed(P, P.tws[j], twaDeg) * KN);
      let bR = -Infinity, bC = cands[0], bF: Forces | null = null;
      for (const c of cands) {
        const { f } = evalIdeal(cls, c, tws, twa, V);
        if (Number.isNaN(f.heelEq) || f.heelEq > MAX_HEEL || f.drive <= 0) continue;
        // la configuration la plus rapide : celle qui garde le plus de poussée nette à la vitesse cible
        const r = f.drive - (f.hull + f.induced + f.foilDrag);
        if (r > bR) { bR = r; bC = c; bF = f; }
      }
      best[i].push(bC);
      eta[i].push(bF ? clamp((bF.hull + bF.induced + bF.foilDrag) / bF.drive, 0.25, 4) : 1);
    }
  }
  // angles trop près du vent pour un équilibre : on reprend la ligne de 38°
  const i38 = P.twa.indexOf(38);
  for (let i = 0; i < i38; i++) { eta[i] = eta[i38].slice(); best[i] = best[i38].slice(); }
  return { cls, tws: P.tws, twa: P.twa, eta, best };
}

const cache = new Map<string, Calibration>();
export function calibration(cls: BoatClass): Calibration {
  let c = cache.get(cls.id);
  if (!c) { c = calibrate(cls); cache.set(cls.id, c); }
  return c;
}

export const etaAt = (cal: Calibration, twsKn: number, twaDeg: number): number =>
  bilinear(cal.twa, cal.tws, cal.eta, Math.min(180, Math.abs(twaDeg)), twsKn);

const bestCache = new Map<string, Config>();
/**
 * Configuration conseillée : parmi les configurations des 4 points de grille voisins,
 * celle qui a le meilleur rapport poussée / traînée au vent réel (mis en cache par nœud et par 2°).
 */
export function bestConfig(cal: Calibration, twsKn: number, twaDeg: number): Config {
  const a = Math.min(180, Math.max(30, Math.round(Math.abs(twaDeg) / 2) * 2)), w = Math.max(2, Math.round(twsKn));
  const key = cal.cls.id + ':' + w + ':' + a;
  let c = bestCache.get(key);
  if (c) return c;
  const [i] = locate(cal.twa, a), [j] = locate(cal.tws, w);
  const cands = [cal.best[i][j], cal.best[i + 1][j], cal.best[i][j + 1], cal.best[i + 1][j + 1]];
  const tws = w * KN, twa = a * DEG, V = Math.max(0.5, polarSpeed(cal.cls.polar, w, a) * KN);
  let bR = -Infinity;
  c = cands[0];
  for (const cand of cands) {
    const { f } = evalIdeal(cal.cls, cand, tws, twa, V);
    if (Number.isNaN(f.heelEq) || f.heelEq > MAX_HEEL + 4 * DEG || f.drive <= 0) continue;
    const r = f.drive * etaAt(cal, w, a) - (f.hull + f.induced + f.foilDrag);
    if (r > bR) { bR = r; c = cand; }
  }
  bestCache.set(key, c);
  return c;
}

/** Vitesse d'équilibre (m/s) en eau plate pour une configuration et un réglage idéal. */
export function equilibriumSpeed(cls: BoatClass, cfg: Config, twsKn: number, twaDeg: number, eta?: number): number {
  const cal = calibration(cls), e = eta ?? etaAt(cal, twsKn, twaDeg);
  const tws = twsKn * KN, twa = twaDeg * DEG;
  const net = (V: number) => netForce(evalIdeal(cls, cfg, tws, twa, V).f, e);
  let lo = 0.05, hi = 22;
  if (net(lo) <= 0) return 0;
  if (net(hi) > 0) return hi;
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (net(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
