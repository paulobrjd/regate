// Plan d'eau : îles (décor, échouage, obstacles pour l'IA). Coordonnées en mètres, nord = -y.
export interface Island {
  name: string; x: number; y: number; r: number; h: number; seed: number; lighthouse?: boolean;
  /** Décor : nombre de maisons du village, clocher, port. */
  village?: number; church?: boolean; harbour?: boolean;
}

/** Îles du plan d'eau courant (changent avec le plan d'eau : voir game/venue.ts). */
export let ISLANDS: Island[] = [];
export function setIslands(list: Island[]): void { ISLANDS = list; }

/** Rayon du rivage (m) dans la direction th (rad) : contour irrégulier, partagé par la physique et le rendu. */
export function shoreR(isl: Island, th: number): number {
  const s = isl.seed;
  return isl.r * (1 + 0.12 * Math.sin(3 * th + s) + 0.07 * Math.sin(5 * th + 2 * s) + 0.04 * Math.sin(9 * th + 3 * s));
}

/** Altitude du terrain (m) : th direction (rad), rho ∈ [0,1] du sommet au rivage. */
export function islandHeight(isl: Island, th: number, rho: number): number {
  const bump = Math.sin(th * 4 + isl.seed * 3) * 0.1 + Math.sin(th * 7 + isl.seed) * 0.06;
  const hills = 0.18 * Math.sin(th * 3 + isl.seed * 5) * Math.sin(rho * 6 + isl.seed) + 0.08 * Math.sin(th * 11 + rho * 9);
  return rho > 1 ? -2.5 : isl.h * 1.7 * Math.pow(1 - rho * rho, 0.6) * (1 + bump + hills) + 0.8;
}

/** Île sur laquelle se trouve le point (avec une marge en m), ou null. */
export function islandAt(x: number, y: number, margin = 0): Island | null {
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dy = y - isl.y, d = Math.hypot(dx, dy);
    if (d > isl.r * 1.25 + margin) continue;
    if (d < shoreR(isl, Math.atan2(dy, dx)) + margin) return isl;
  }
  return null;
}

/** Distance (m) jusqu'à la première île sur la route (x,y)→ cap h, ou Infinity. */
export function islandAhead(x: number, y: number, h: number, len: number, margin: number): number {
  const fx = Math.sin(h), fy = -Math.cos(h);
  for (let d = 0; d <= len; d += 60) if (islandAt(x + fx * d, y + fy * d, margin)) return d;
  return Infinity;
}
