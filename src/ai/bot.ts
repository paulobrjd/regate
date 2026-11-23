// IA adverse : placement et départ, bords au près et au portant aux angles de VMG de la polaire,
// virement sur bascule, contournement des bouées par l'extérieur, évitement des îles.
import { D, clamp, norm, rrange, type Rng } from '../util/math';
import { vmgAngles } from '../physics/polar';
import { KN } from '../physics/units';
import { islandAhead } from '../physics/world';
import type { Boat } from '../physics/boat';
import type { Course } from '../game/course';
import type { AssistMem } from '../game/assist';

export interface Level { perf: [number, number]; corr: [number, number]; early: [number, number]; err: number }
export const LEVELS: readonly Level[] = [
  { perf: [0.86, 0.91], corr: [8, 16], early: [4, 12], err: 0.08 },
  { perf: [0.91, 0.96], corr: [14, 24], early: [1, 6], err: 0.04 },
  { perf: [0.96, 1], corr: [20, 32], early: [-1, 3], err: 0.015 },
];

export interface AI {
  corr: number; early: number; home: number; dir: number; err: number;
  wpi: number; legSeen: number; lastTack: number; back: boolean; mem: AssistMem;
  /** Point de sortie de la marque qu'on vient de passer (on finit le contournement avant de filer). */
  exit: { x: number; y: number } | null;
  /** Amure visée (+1 bâbord, -1 tribord) : on la garde pendant que le bateau vire. */
  k: number;
}

export function mkAI(L: Level, home: number, rng: Rng, mem: AssistMem): AI {
  return {
    corr: rrange(rng, ...L.corr), early: rrange(rng, ...L.early), home,
    dir: rng() < 0.5 ? 1 : -1, err: rrange(rng, -L.err, L.err), wpi: 0, legSeen: -1, lastTack: -1e9, back: false, mem, exit: null, k: 0,
  };
}

const angCache = new Map<number, { up: number; down: number; vmgUp: number }>();
function angles(b: Boat): { up: number; down: number; vmgUp: number } {
  const k = Math.round(b.tws);
  let a = angCache.get(k);
  if (!a) { a = vmgAngles(b.cls.polar, k); angCache.set(k, a); }
  return a;
}

/** Point visé : sous-point de passage de la prochaine bouée, ou la ligne d'arrivée. */
export function aiTarget(b: Boat, c: Course): { x: number; y: number } {
  const A = b.ai!;
  if (b.leg !== A.legSeen) {
    const prev = b.leg - 2 >= 0 && b.leg - 2 < c.marks.length ? c.marks[b.leg - 2] : null;
    A.exit = prev && A.legSeen === b.leg - 1 ? prev.wp[2] : null;
    A.legSeen = b.leg; A.wpi = 0;
  }
  if (A.exit) {
    const isl = b.leg - 2 >= 0 && c.marks[b.leg - 2].island != null;
    if (Math.hypot(A.exit.x - b.x, A.exit.y - b.y) < (isl ? 300 : 45)) A.exit = null; else return A.exit;
  }
  if (b.leg >= 1 && b.leg <= c.marks.length) {
    const m = c.marks[b.leg - 1];
    // approche, puis point extérieur jusqu'à ce que le passage soit validé (le point de sortie vient après)
    let w = m.wp[A.wpi];
    while (A.wpi < 1 && Math.hypot(w.x - b.x, w.y - b.y) < (m.island != null ? 300 : 45)) w = m.wp[++A.wpi];
    return w;
  }
  // arrivée : si on est déjà passé sous la ligne sans la couper (hors bouées), on remonte d'abord
  if (b.y > 0) return { x: clamp(b.x, -120, 120), y: -150 };
  return { x: clamp(b.x * 0.5, -120, 120), y: 120 };
}

/** Choisit le cap (consigne du pilote, mode cap). t : temps depuis le départ (s). */
export function aiSteer(b: Boat, c: Course, t: number, wd: number): void {
  const A = b.ai!, ang = angles(b), up = ang.up * D, down = ang.down * D;
  let h: number;
  if (b.fin != null) { h = b.h; b.pilot = { on: true, mode: 'cap', set: wd + Math.PI / 2 }; return; }
  if (t < 0) {
    const vmg = Math.max(1.5, ang.vmgUp * KN * 0.8);
    const goT = Math.max(0, b.y) / vmg + 6 + A.early;
    if (-t > goT) {
      if (b.x > A.home + 180) A.dir = -1;
      if (b.x < A.home - 180) A.dir = 1;
      const a = b.y < 120 ? 140 : b.y > 420 ? 70 : 100;
      h = wd + A.dir * a * D;
      A.lastTack = t;
    } else {
      // approche au près : on choisit l'amure une fois, puis on la garde
      if (t - A.lastTack > 1) { A.lastTack = 1e9; A.dir = b.x < 0 ? 1 : -1; }
      h = wd + A.dir * up;
    }
  } else {
    let goBack = b.ocs;
    if (!goBack && b.leg === 0) {
      if (b.y < -20) { A.back = true; goBack = true; } else if (A.back && b.y < 40) goBack = true; else A.back = false;
    }
    if (goBack) h = wd + Math.PI + (b.x < 0 ? -1 : 1) * 35 * D;
    else if (b.leg === 0) h = wd + b.tack * up;
    else {
      const tg = aiTarget(b, c), brg = Math.atan2(tg.x - b.x, -(tg.y - b.y)), rel = norm(brg - wd);
      const dT = Math.hypot(tg.x - b.x, tg.y - b.y);
      const close = (b.leg > c.marks.length && dT < 700) || dT < 250;
      if (A.lastTack > t) A.lastTack = t - 30;
      const canTack = t - A.lastTack > 25;
      const tack = b.tack;
      // couloir : sur les longs bords, on ne s'écarte pas de plus de ~1,5 km de la route directe
      const corr = Math.min(A.corr, Math.atan(1500 / Math.max(1, dT)) / D + 4) * D;
      if (!A.k) A.k = tack;
      const pickTack = (ang: number, relX: number): number => {
        let k = A.k;
        if (canTack && k * relX < -corr) k = -k;
        // évitement des îles : on ne prend pas l'amure qui mène sur une île si l'autre est dégagée
        const dK = islandAhead(b.x, b.y, wd + k * ang, 1500, 220), dO = islandAhead(b.x, b.y, wd - k * ang, 1500, 220);
        if (dK < 1500 && dO > dK && (canTack || dK < 500 || k !== A.k)) k = -k;
        if (k !== A.k) { A.lastTack = t; A.k = k; }
        return k;
      };
      if (Math.abs(rel) < up) {
        h = wd + pickTack(up, rel) * up;
      } else if (Math.abs(rel) > down && !close) {
        h = wd + pickTack(down, -norm(rel - Math.PI)) * down;
      } else {
        h = brg;
        const d = islandAhead(b.x, b.y, h, 900, 220);
        if (d < 900) { const l = islandAhead(b.x, b.y, h - 0.5, 900, 220), r = islandAhead(b.x, b.y, h + 0.5, 900, 220); h += r >= l ? 0.5 : -0.5; }
      }
    }
  }
  // dernier recours : si le cap mène sur une île, on prend le cap navigable dégagé le plus proche
  if (t >= 0 && islandAhead(b.x, b.y, h, 600, 150) < 600) {
    for (let j = 1; j <= 14; j++) {
      const c1 = h + j * 12 * D, c2 = h - j * 12 * D;
      const ok = (c: number) => Math.abs(norm(c - wd)) >= up * 0.95 && islandAhead(b.x, b.y, c, 700, 150) === Infinity;
      if (ok(c1)) { h = c1; break; }
      if (ok(c2)) { h = c2; break; }
    }
  }
  b.pilot.on = true; b.pilot.mode = 'cap'; b.pilot.set = norm(h);
}
