// Champ de vent : direction oscillante + risées qui dérivent avec le vent. Déterministe à graine égale.
import { hash } from '../util/math';

export interface Meteo { n: string; base: number; gust: number; amp: number }
export const METEO: readonly Meteo[] = [
  { n: 'Petit temps', base: 7, gust: 0.6, amp: 0.45 },
  { n: 'Medium', base: 12, gust: 1, amp: 1 },
  { n: 'Brise', base: 18, gust: 1.35, amp: 1.7 },
];

export interface Gust { x: number; y: number; r: number; s: number }

/** Taille d'une cellule de risée (unités jeu). */
export const GC = 440;
/** Vitesse de dérive des risées (unités jeu / s). */
const DRIFT = 45;

export class WindField {
  constructor(public readonly seed: number, public readonly met: Meteo) {}

  /** Direction du vent (rad, 0 = vent venant du nord, c.-à-d. de -y) au temps t (s depuis le départ). */
  dir(t: number): number {
    const s = this.seed;
    return 0.16 * Math.sin(t * 0.045 + s) + 0.07 * Math.sin(t * 0.17 + s * 2);
  }

  gustCell(i: number, j: number): Gust | null {
    const s = this.seed, h = hash(i + s * 13.1, j - s * 7.7);
    if (h < 0.5) return null;
    return {
      x: i * GC + hash(j + 3.1, i + s) * GC * 0.6,
      y: j * GC + hash(i * 1.7, j * 2.3 + s) * GC * 0.6,
      r: 150 + h * 170,
      s: 2.5 + (h - 0.5) * 10,
    };
  }

  eachGust(x0: number, y0: number, x1: number, y1: number, t: number, fn: (x: number, y: number, r: number, s: number) => void): void {
    const dy = t * DRIFT;
    const i0 = Math.floor(x0 / GC) - 1, i1 = Math.floor(x1 / GC) + 1;
    const j0 = Math.floor((y0 - dy) / GC) - 1, j1 = Math.floor((y1 - dy) / GC) + 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const g = this.gustCell(i, j);
      if (g) fn(g.x, g.y + dy, g.r, g.s);
    }
  }

  /** Force du vent réel (nœuds) au point (x,y) au temps t. */
  speedAt(x: number, y: number, t: number): number {
    const M = this.met;
    let k = M.base;
    this.eachGust(x, y, x, y, t, (gx, gy, r, s) => {
      const d = Math.hypot(x - gx, y - gy);
      if (d < r) k += s * M.gust * (1 - (d / r) ** 2);
    });
    return k;
  }
}
