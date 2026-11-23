// Plan d'eau : îles (décor, échouage, obstacles pour l'IA). Coordonnées en mètres, nord = -y.
export interface Island { name: string; x: number; y: number; r: number; h: number; seed: number; lighthouse?: boolean }

export const ISLANDS: readonly Island[] = [
  { name: 'Île Verte', x: -4200, y: -7500, r: 900, h: 70, seed: 1.3 },
  { name: 'Île du Phare', x: 3500, y: -11000, r: 700, h: 55, seed: 2.7, lighthouse: true },
  { name: 'Rocher du Nord', x: -2000, y: -37000, r: 450, h: 35, seed: 4.1, lighthouse: true },
  { name: 'Les Moines', x: 5200, y: -2500, r: 380, h: 25, seed: 5.9 },
  { name: 'Île Longue', x: -6500, y: 1500, r: 1300, h: 90, seed: 7.2 },
  { name: 'Île aux Oiseaux', x: 7000, y: -17000, r: 1000, h: 80, seed: 8.8 },
  { name: 'Grand Banc', x: -7500, y: -22000, r: 1500, h: 110, seed: 3.3 },
];

/** Rayon du rivage (m) dans la direction th (rad) : contour irrégulier, partagé par la physique et le rendu. */
export function shoreR(isl: Island, th: number): number {
  const s = isl.seed;
  return isl.r * (1 + 0.12 * Math.sin(3 * th + s) + 0.07 * Math.sin(5 * th + 2 * s) + 0.04 * Math.sin(9 * th + 3 * s));
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
