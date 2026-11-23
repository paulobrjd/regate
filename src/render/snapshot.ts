// Interpolation entre deux pas de simulation, pour un rendu fluide quel que soit le rafraîchissement de l'écran.
import { norm } from '../util/math';
import type { Boat } from '../physics/boat';
import type { Game } from '../game/game';

export function snapshot(g: Game, alpha: number): { boats: Boat[]; me: Boat } {
  let me = g.me;
  const boats = g.boats.map(b => {
    const s: Boat = { ...b, x: b.ix + (b.x - b.ix) * alpha, y: b.iy + (b.y - b.iy) * alpha, h: norm(b.ih + norm(b.h - b.ih) * alpha) };
    if (b === g.me) me = s;
    return s;
  });
  return { boats, me };
}
