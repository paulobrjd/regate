// Polaires : tables vitesse (nds) selon l'angle au vent réel (°) et la force du vent réel (nds), interpolées.
export interface PolarTable {
  /** Forces de vent réel (nds), croissantes. */
  tws: number[];
  /** Angles au vent réel (°), croissants, de 0 à 180. */
  twa: number[];
  /** v[iTwa][iTws] : vitesse cible (nds). */
  v: number[][];
}

/** Indice et fraction pour interpoler x dans une liste croissante (bornée). */
export function locate(xs: readonly number[], x: number): [number, number] {
  const n = xs.length;
  if (x <= xs[0]) return [0, 0];
  if (x >= xs[n - 1]) return [n - 2, 1];
  let i = 0;
  while (x > xs[i + 1]) i++;
  return [i, (x - xs[i]) / (xs[i + 1] - xs[i])];
}

/** Interpolation bilinéaire dans une grille g[iTwa][iTws]. */
export function bilinear(twaGrid: readonly number[], twsGrid: readonly number[], g: readonly (readonly number[])[], twaDeg: number, tws: number): number {
  const [i, fi] = locate(twaGrid, twaDeg), [j, fj] = locate(twsGrid, tws);
  const a = g[i][j] * (1 - fj) + g[i][j + 1] * fj;
  const b = g[i + 1][j] * (1 - fj) + g[i + 1][j + 1] * fj;
  return a * (1 - fi) + b * fi;
}

/** Vitesse cible (nds) pour un vent réel tws (nds) et un angle twa (°, signe ignoré). */
export function polarSpeed(p: PolarTable, tws: number, twaDeg: number): number {
  const a = Math.min(180, Math.abs(twaDeg));
  const t0 = p.tws[0];
  // sous le premier vent de la table : vitesse proportionnelle au vent
  if (tws < t0) return bilinear(p.twa, p.tws, p.v, a, t0) * Math.max(0, tws) / t0;
  return bilinear(p.twa, p.tws, p.v, a, tws);
}

/** Meilleurs angles de VMG au près et au portant pour un vent donné. */
export function vmgAngles(p: PolarTable, tws: number): { up: number; down: number; vmgUp: number; vmgDown: number } {
  let up = 45, down = 150, vu = 0, vd = 0;
  for (let a = 30; a <= 180; a += 0.5) {
    const v = polarSpeed(p, tws, a), vmg = v * Math.cos(a * Math.PI / 180);
    if (vmg > vu) { vu = vmg; up = a; }
    if (-vmg > vd) { vd = -vmg; down = a; }
  }
  return { up, down, vmgUp: vu, vmgDown: vd };
}
