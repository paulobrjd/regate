// Parcours : ligne de départ/arrivée et trois bouées (unités jeu : 10 unités = 1 m).
import { clamp } from '../util/math';

export interface Mark { x: number; y: number; n: string }
export const MARKS: readonly Mark[] = [
  { x: 80, y: -2000, n: 'Bouée 1 (au vent)' },
  { x: -880, y: -1150, n: 'Bouée 2 (dégagement)' },
  { x: 10, y: -380, n: 'Bouée 3 (sous le vent)' },
];
export const PIN = { x: -130, y: 0 };
export const CMTE = { x: 130, y: 0 };
/** Rayon de validation d'une bouée. */
export const MARK_R = 85;

interface Legged { x: number; y: number; leg: number; ocs: boolean }

export function objective(b: Legged, exact?: boolean): { x: number; y: number } {
  if (b.leg === 0 || b.ocs) return { x: exact ? 0 : clamp(b.x, -100, 100), y: exact ? 0 : -40 };
  if (b.leg <= 3) { const m = MARKS[b.leg - 1]; return exact ? m : { x: m.x + 40, y: m.y }; }
  return { x: exact ? 0 : clamp(b.x, -90, 90), y: exact ? 0 : 50 };
}
export function distObj(b: Legged): number {
  const o = objective(b, true);
  return Math.hypot(o.x - b.x, o.y - b.y);
}
