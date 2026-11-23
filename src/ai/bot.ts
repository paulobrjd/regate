// IA adverse du prototype : placement au départ, bords au près selon un angle de corrélation, spi au portant.
import { D, clamp, norm, rrange, type Rng } from '../util/math';
import { depower, type Boat, type BoatControl } from '../physics/boat';
import { objective } from '../game/course';

export interface Level { skill: [number, number]; corr: [number, number]; early: [number, number] }
export const LEVELS: readonly Level[] = [
  { skill: [0.8, 0.88], corr: [10, 22], early: [1, 4] },
  { skill: [0.88, 0.95], corr: [18, 34], early: [0, 2.5] },
  { skill: [0.95, 1], corr: [26, 42], early: [-0.3, 1.2] },
];

export interface AI { skill: number; corr: number; early: number; home: number; dir: number; err: number; back?: boolean }

export function mkAI(L: Level, home: number, rng: Rng): AI {
  return {
    skill: rrange(rng, ...L.skill), corr: rrange(rng, ...L.corr), early: rrange(rng, ...L.early),
    home, dir: rng() < 0.5 ? 1 : -1, err: rrange(rng, -0.05, 0.05),
  };
}

/** t : temps depuis le signal de départ (s) ; wd : direction du vent. */
export function aiControl(b: Boat, t: number, wd: number): BoatControl {
  const A = b.ai!;
  let h: number, off = 0;
  if (b.fin != null) return { turn: 0, sheet: 1, spi: false };
  if (t < 0) {
    const goT = Math.max(0, b.y) / 0.69 / 84 + 1.5 + A.early;
    if (-t > goT) {
      if (b.x > A.home + 110) A.dir = -1;
      if (b.x < A.home - 110) A.dir = 1;
      const ang = b.y < 90 ? 135 : b.y > 230 ? 65 : 100;
      h = wd + A.dir * ang * D; off = 0.35;
    } else h = wd + (b.x < 0 ? 1 : -1) * 46 * D;
  } else {
    let goBack = b.ocs;
    if (!goBack && b.leg === 0) {
      if (b.y < -5) { A.back = true; goBack = true; }
      else if (A.back && b.y < 30) goBack = true;
      else A.back = false;
    }
    if (goBack) h = wd + Math.PI + (b.x < 0 ? -1 : 1) * 25 * D;
    else {
      const tg = objective(b), brg = Math.atan2(tg.x - b.x, -(tg.y - b.y)), rel = norm(brg - wd);
      if (Math.abs(rel) >= 46 * D) h = brg;
      else { if (b.tack * rel < -A.corr * D) b.tack = -b.tack; h = wd + b.tack * 46 * D; }
    }
  }
  const df = norm(h - b.h), a = Math.abs(norm(b.h - wd)) / D;
  return {
    turn: Math.abs(df) < 0.03 ? 0 : clamp(df * 3, -1, 1),
    sheet: clamp(b.opt0 + off + A.err + depower(b), 0, 1),
    spi: t >= 0 && !b.ocs && a > 105,
    skill: A.skill,
  };
}
