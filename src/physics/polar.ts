// Polaire simplifiée du prototype : fraction de la vitesse max selon l'angle au vent réel (degrés).
export function polar(a: number): number {
  if (a < 32) return 0;
  if (a < 45) return ((a - 32) / 13) * 0.72;
  if (a < 100) return 0.72 + ((a - 45) / 55) * 0.28;
  return 1 - ((a - 100) / 80) * 0.24;
}
