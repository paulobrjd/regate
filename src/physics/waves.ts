// Houle : somme de vagues de Gerstner. Partagée entre la physique (surf, mer qui tape) et le rendu.
// Chaque vague : amplitude (m), direction (x,z), nombre d'onde k, cambrure.
export type Wave = readonly [number, number, number, number, number];
export const WV: readonly Wave[] = [
  [0.34, 0, 1, 0.09, 0.22],
  [0.2, -0.45, 0.89, 0.14, 0.18],
  [0.12, 0.6, 0.8, 0.23, 0.16],
  [0.07, -0.8, 0.6, 0.37, 0.12],
  [0.045, 0.2, -0.98, 0.55, 0.1],
];

/** Hauteur de la mer (m) au point (x,z) en mètres monde, au temps t, pour un facteur d'amplitude amp. */
export function waveH(x: number, z: number, t: number, amp: number): number {
  let h = 0;
  for (const [A, dx, dz, k] of WV) h += A * Math.sin(k * (dx * x + dz * z) - Math.sqrt(9.8 * k) * t);
  return h * amp;
}
