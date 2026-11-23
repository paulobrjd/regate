// Outils mathématiques partagés (purs, sans rendu).
export const D = Math.PI / 180;
export const TAU = Math.PI * 2;

/** Ramène un angle dans [-π, π[. */
export const norm = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** Bruit pseudo-aléatoire déterministe dans [0,1[ à partir de deux entiers. */
export const hash = (i: number, j: number): number => {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export const hashStr = (s: string): number => {
  let h = 7;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 100003;
  return h;
};

/** Générateur pseudo-aléatoire à graine (mulberry32) : même graine, même suite. */
export type Rng = () => number;
export function makeRng(seed: number): Rng {
  let a = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const rrange = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);

export const ord = (n: number): string => (n === 1 ? '1er' : n + 'e');

/** Format de chrono : -0:30 avant le départ, m:ss.s ensuite. */
export const fmt = (t: number): string => {
  if (t < 0) return '-0:' + String(Math.ceil(-t - 1e-9)).padStart(2, '0');
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
};
