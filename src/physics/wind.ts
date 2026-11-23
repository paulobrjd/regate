// Champ de vent : direction oscillante + risées qui dérivent avec le vent. Déterministe à graine égale.
import { hash } from '../util/math';

export interface Meteo { n: string; base: number; gust: number; amp: number }
export const METEO: readonly Meteo[] = [
  { n: 'Petit temps', base: 8, gust: 0.6, amp: 0.45 },
  { n: 'Medium', base: 14, gust: 1, amp: 1 },
  { n: 'Brise', base: 20, gust: 1.25, amp: 1.6 },
  { n: 'Gros temps', base: 27, gust: 1.4, amp: 2.3 },
];

export interface Gust { x: number; y: number; r: number; s: number }

/** Taille d'une cellule de risée (m). */
export const GC = 1300;

export class WindField {
  constructor(public readonly seed: number, public readonly met: Meteo) {}

  /** Vitesse de dérive des risées (m/s) : elles avancent avec le vent. */
  get drift(): number { return this.met.base * 0.514444 * 0.8; }

  /** Direction du vent (rad, 0 = vent venant du nord, c.-à-d. de -y) au temps t (s depuis le départ). */
  dir(t: number): number {
    const s = this.seed;
    // bascules oscillantes : grande période (~9 min) et petite (~2 min)
    return 0.12 * Math.sin(t * 0.0115 + s) + 0.06 * Math.sin(t * 0.047 + s * 2);
  }

  gustCell(i: number, j: number): Gust | null {
    const s = this.seed, h = hash(i + s * 13.1, j - s * 7.7);
    if (h < 0.5) return null;
    return {
      x: i * GC + hash(j + 3.1, i + s) * GC * 0.6,
      y: j * GC + hash(i * 1.7, j * 2.3 + s) * GC * 0.6,
      r: 350 + h * 450,
      s: 2.5 + (h - 0.5) * 10,
    };
  }

  eachGust(x0: number, y0: number, x1: number, y1: number, t: number, fn: (x: number, y: number, r: number, s: number) => void): void {
    const dy = t * this.drift;
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
