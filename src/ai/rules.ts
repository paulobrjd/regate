// Règles de course simplifiées (RRS) et anticipation des collisions.
//  - règle 10 : bâbord amures s'écarte de tribord amures ;
//  - règle 11 : même amure, en recouvrement : le bateau au vent s'écarte du bateau sous le vent ;
//  - règle 12 : même amure, sans recouvrement : le bateau en route libre derrière s'écarte de celui devant ;
//  - règle 18 : dans la zone de 3 longueurs d'une bouée, le bateau extérieur laisse la place au bateau intérieur ;
//  - règle 14 : même prioritaire, on évite le contact s'il devient inévitable.
import { D, clamp, norm } from '../util/math';
import { KN } from '../physics/units';
import { polarSpeed } from '../physics/polar';
import type { Boat } from '../physics/boat';
import type { Course } from '../game/course';

export const LOA = 18.3;
/** Interrupteur (comparaisons dans les tests). */
export const RULES = { on: true };
export const ZONE = 3 * LOA;

export type Reason = 'tribord' | 'sousLeVent' | 'devant' | 'bouee';
export const REASON_TXT: Record<Reason, string> = {
  tribord: 'tribord amures prioritaire',
  sousLeVent: 'le bateau sous le vent est prioritaire',
  devant: 'le bateau devant est prioritaire',
  bouee: 'le bateau à l\'intérieur a droit à la place à la bouée',
};

/** La marque que le bateau est en train d'aller contourner (bouée seulement), ou null. */
function markOf(b: Boat, c: Course): { x: number; y: number } | null {
  if (b.leg < 1 || b.leg > c.marks.length || b.ocs) return null;
  const m = c.marks[b.leg - 1];
  return m.island == null ? m : null;
}

/**
 * Qui doit s'écarter entre a et b ? Renvoie le bateau qui doit céder le passage et la raison.
 * wd : direction d'où vient le vent.
 */
export function giveWay(a: Boat, b: Boat, wd: number, c: Course): { who: Boat; why: Reason } {
  // même verdict quel que soit le bateau qui pose la question
  if (a.id > b.id) return giveWay(b, a, wd, c);
  // règle 18 : place à la bouée (même marque, les deux dans la zone)
  const ma = markOf(a, c), mb = markOf(b, c);
  if (ma && ma === mb) {
    const da = Math.hypot(a.x - ma.x, a.y - ma.y), db = Math.hypot(b.x - mb.x, b.y - mb.y);
    if (da < ZONE && db < ZONE) return { who: da > db ? a : b, why: 'bouee' };
  }
  // règle 10 : amures opposées (tack = +1 : bâbord amures)
  if (a.tack !== b.tack) return { who: a.tack > 0 ? a : b, why: 'tribord' };
  // même amure : recouvrement ?
  const fx = Math.sin(a.h), fy = -Math.cos(a.h), dx = b.x - a.x, dy = b.y - a.y;
  const along = dx * fx + dy * fy;
  if (Math.abs(along) < LOA) {
    // règle 11 : le plus au vent s'écarte (le vent vient de la direction wd)
    const ux = Math.sin(wd), uy = -Math.cos(wd);
    return { who: dx * ux + dy * uy > 0 ? b : a, why: 'sousLeVent' };
  }
  // règle 12 : celui de derrière s'écarte
  return { who: along > 0 ? a : b, why: 'devant' };
}

/** Point de rapprochement maximal entre deux bateaux (vitesses constantes), horizon H secondes. */
export function cpa(ax: number, ay: number, avx: number, avy: number, bx: number, by: number, bvx: number, bvy: number, H: number): { d: number; t: number } {
  const px = bx - ax, py = by - ay, wx = bvx - avx, wy = bvy - avy, w2 = wx * wx + wy * wy;
  const t = w2 < 1e-6 ? 0 : clamp(-(px * wx + py * wy) / w2, 0, H);
  return { d: Math.hypot(px + wx * t, py + wy * t), t };
}

const vel = (b: Boat) => ({ x: Math.sin(b.h) * Math.max(0.5, b.v), y: -Math.cos(b.h) * Math.max(0.5, b.v) });

export interface Threat { o: Boat; d: number; t: number; mine: boolean; why: Reason }

/** Menaces de collision pour b sur sa route actuelle (horizon 30 s). */
export function threats(b: Boat, others: Boat[], wd: number, c: Course, H = 30, safe = 2.2 * LOA): Threat[] {
  const out: Threat[] = [], vb = vel(b);
  for (const o of others) {
    if (o === b || o.fin != null || o.knock > 0 || o.aground > 0) continue;
    if (Math.abs(o.x - b.x) > 450 || Math.abs(o.y - b.y) > 450) continue;
    const vo = vel(o), r = cpa(b.x, b.y, vb.x, vb.y, o.x, o.y, vo.x, vo.y, H);
    if (r.d < safe) { const g = giveWay(b, o, wd, c); out.push({ o, d: r.d, t: r.t, mine: g.who === b, why: g.why }); }
  }
  return out;
}

/**
 * Corrige le cap voulu h pour éviter les autres bateaux.
 * S'il doit céder le passage, le bateau change de cap tôt et franchement (de préférence en abattant pour passer
 * derrière) ; s'il est prioritaire, il tient son cap et n'évite qu'au dernier moment (règle 14).
 */
export function avoid(b: Boat, others: Boat[], h: number, wd: number, c: Course, up: number): { h: number; hail: Threat | null; brake: boolean } {
  // près d'une bouée tout le monde manœuvre : anticipation courte et marge plus serrée ; au large, on voit loin
  const mk = markOf(b, c), nearMark = !!mk && Math.hypot(b.x - mk.x, b.y - mk.y) < 180;
  const H = nearMark ? 25 : 40, safe = (nearMark ? 2 : 2.4) * LOA;
  const cur = threats(b, others, wd, c, H, safe);
  let hail: Threat | null = null;
  // je dois m'écarter, ou l'autre ne s'écarte pas et le contact est proche
  const act = cur.filter(x => x.mine ? x.t < (nearMark ? 20 : 32) : x.t < 8 && x.d < LOA * 1.4);
  for (const x of cur) if (!x.mine && x.t < 15 && (!hail || x.t < hail.t)) hail = x;
  if (!act.length) return { h, hail, brake: false };
  const twa0 = norm(h - wd), side = Math.sign(twa0) || 1;
  const cands: number[] = [];
  for (let dd = 0; dd <= 70; dd += 7) for (const s of dd ? [1, -1] : [1]) cands.push(h + s * dd * D);
  let best = h, bestScore = -Infinity, bestD = 0;
  const tws = b.tws;
  for (const hc of cands) {
    const twa = norm(hc - wd);
    if (Math.abs(twa) < up * 0.92) continue;           // pas face au vent
    if (Math.sign(twa) !== side && Math.abs(twa) < 150 * D) continue; // pas de virement improvisé
    const vt = polarSpeed(b.cls.polar, tws, Math.abs(twa) / D) * KN, v = 0.5 * (Math.max(0.5, b.v) + vt);
    const vx = Math.sin(hc) * v, vy = -Math.cos(hc) * v;
    let minD = Infinity;
    for (const x of act) { const vo = vel(x.o); minD = Math.min(minD, cpa(b.x, b.y, vx, vy, x.o.x, x.o.y, vo.x, vo.y, H).d); }
    // dégagé et proche du cap voulu ; on préfère abattre (passer derrière) plutôt que lofer
    const off = Math.abs(norm(hc - h)), bearAway = Math.abs(twa) > Math.abs(twa0) ? 0.15 : 0;
    const score = (minD >= safe ? 10 : minD / safe * 10) - off * 2 + bearAway;
    if (score > bestScore) { bestScore = score; best = hc; bestD = minD; }
  }
  // aucune route ne dégage assez et le contact approche : on choque pour ralentir
  const brake = bestD < LOA * 1.4 && act.some(x => x.t < 12);
  return { h: best, hail, brake };
}
