// Champ de vent : direction oscillante, risées qui dérivent avec le vent, et en météo variable
// un vent de fond qui forcit et mollit, et des grains (fortes rafales sous la pluie). Déterministe à graine égale.
import { hash } from '../util/math';

export interface Meteo {
  n: string; base: number; gust: number; amp: number;
  /** Variation du vent de fond au fil de la course (0 = stable). */
  vari?: number;
  /** Grains : grosses cellules de rafales et de pluie. */
  squalls?: boolean;
  /** Ciel par défaut. */
  sky?: string;
}
export const METEO: readonly Meteo[] = [
  { n: 'Petit temps', base: 8, gust: 0.6, amp: 0.45, sky: 'soleil' },
  { n: 'Medium', base: 14, gust: 1, amp: 1, sky: 'soleil' },
  { n: 'Brise', base: 20, gust: 1.25, amp: 1.6, sky: 'nuageux' },
  { n: 'Gros temps', base: 27, gust: 1.4, amp: 2.3, sky: 'pluie' },
  { n: 'Variable', base: 15, gust: 1.1, amp: 1.2, vari: 0.4, squalls: true, sky: 'nuageux' },
];

export interface Gust { x: number; y: number; r: number; s: number }

/** Événement météo pendant la course (temps en secondes depuis le départ). */
export type EventKind = 'bascule' | 'coup' | 'molle' | 'grain';
export interface WindEvent { kind: EventKind; t0: number; dur: number; amp: number; x: number; y: number; r: number }
export const EVENT_NAMES: Record<EventKind, string> = { bascule: 'Grosse bascule', coup: 'Coup de vent', molle: 'Molle', grain: 'Grain' };
const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

/** Taille d'une cellule de risée, d'une cellule de grain (m). */
export const GC = 1300;
const SC = 7000;

export class WindField {
  /** Événements météo de cette course (identiques chez tous les joueurs : tirés de la graine). */
  events: WindEvent[] = [];
  constructor(public readonly seed: number, public readonly met: Meteo, public readonly shifts = 1, public readonly gusts = 1) {}

  /** Intensité 0..1 d'un événement au temps t (montée et descente progressives). */
  env(e: WindEvent, t: number): number {
    if (t < e.t0 || t > e.t0 + e.dur) return 0;
    const ramp = e.kind === 'bascule' ? 50 : e.kind === 'grain' ? 0.1 : 30;
    return smooth(Math.min((t - e.t0) / ramp, (e.t0 + e.dur - t) / ramp));
  }
  /** Centre d'un grain : il dérive avec le vent (vers le sud). */
  grainCenter(e: WindEvent, t: number): { x: number; y: number } { return { x: e.x, y: e.y + this.drift * 1.1 * (t - e.t0) }; }
  /** Force d'un grain au point (0..1), estompée à son arrivée et à son départ. */
  grain(x: number, y: number, t: number): number {
    let g = 0;
    for (const e of this.events) {
      if (e.kind !== 'grain' || t < e.t0 || t > e.t0 + e.dur) continue;
      const c = this.grainCenter(e, t), d = Math.hypot(x - c.x, y - c.y);
      if (d < e.r) g = Math.max(g, (1 - (d / e.r) ** 2) * smooth(Math.min((t - e.t0) / 40, (e.t0 + e.dur - t) / 40)));
    }
    return g;
  }
  /** Événements actifs ou annoncés (dans les `ahead` secondes). */
  upcoming(t: number, ahead: number): { e: WindEvent; inS: number; left: number }[] {
    return this.events.filter(e => t < e.t0 + e.dur && t > e.t0 - ahead).map(e => ({ e, inS: e.t0 - t, left: e.t0 + e.dur - t }));
  }

  /** Tire les événements d'une course : nombre selon sa durée, types variés, grains qui traversent le parcours. */
  planEvents(raceSeconds: number, center: { x: number; y: number }, span: number, rnd: () => number): void {
    const n = Math.max(1, Math.min(6, Math.round(raceSeconds / 260)));
    const kinds: EventKind[] = ['bascule', 'coup', 'molle', 'grain'];
    let t = 50 + rnd() * 60;
    for (let i = 0; i < n && t < raceSeconds * 0.85; i++) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const dur = kind === 'bascule' ? 200 + rnd() * 200 : kind === 'grain' ? 220 + rnd() * 80 : 100 + rnd() * 120;
      const amp = kind === 'bascule' ? (rnd() < 0.5 ? -1 : 1) * (0.26 + rnd() * 0.26) : kind === 'coup' ? 0.4 + rnd() * 0.3 : kind === 'molle' ? 0.4 + rnd() * 0.2 : 1;
      const r = Math.max(900, span * 0.45);
      // le grain part au nord et passe sur le parcours au milieu de sa durée
      const x = center.x + (rnd() - 0.5) * span * 0.8, y = center.y - this.drift * 1.1 * dur / 2;
      this.events.push({ kind, t0: t, dur, amp, x, y, r });
      t += dur + 60 + rnd() * Math.max(60, raceSeconds / n - dur);
    }
  }

  /** Vitesse de dérive des risées (m/s) : elles avancent avec le vent. */
  get drift(): number { return this.met.base * 0.514444 * 0.8; }

  /** Direction du vent (rad, 0 = vent venant du nord, c.-à-d. de -y) au temps t (s depuis le départ). */
  dir(t: number): number {
    const s = this.seed, k = this.shifts;
    // bascules oscillantes : grande période (~9 min) et petite (~2 min) ; en météo variable, une bascule persistante
    const pers = this.met.vari ? 0.12 * Math.sin(t * 0.0021 + s * 3) : 0;
    let ev = 0;
    for (const e of this.events) if (e.kind === 'bascule') ev += e.amp * this.env(e, t);
    return k * (0.12 * Math.sin(t * 0.0115 + s) + 0.06 * Math.sin(t * 0.047 + s * 2)) + pers + ev;
  }

  /** Vent de fond (nds) : constant, ou qui forcit et mollit en météo variable. */
  base(t: number): number {
    const v = this.met.vari ?? 0, s = this.seed;
    let k = 1;
    for (const e of this.events) { if (e.kind === 'coup') k *= 1 + e.amp * this.env(e, t); else if (e.kind === 'molle') k *= 1 - e.amp * this.env(e, t); }
    return k * this.met.base * (1 + v * (0.65 * Math.sin(t * 0.0026 + s * 1.7) + 0.35 * Math.sin(t * 0.0093 + s * 4.1)));
  }

  gustCell(i: number, j: number): Gust | null {
    const s = this.seed, h = hash(i + s * 13.1, j - s * 7.7);
    if (h < 0.5) return null;
    return {
      x: i * GC + hash(j + 3.1, i + s) * GC * 0.6,
      y: j * GC + hash(i * 1.7, j * 2.3 + s) * GC * 0.6,
      r: 350 + h * 450,
      s: (2.5 + (h - 0.5) * 10) * this.gusts,
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

  /** Grain le plus proche : intensité 0..1 au point (pluie, rafale). */
  squall(x: number, y: number, t: number): number {
    const gr = this.events.length ? this.grain(x, y, t) : 0;
    if (!this.met.squalls) return gr;
    const s = this.seed, dy = t * this.drift * 0.9;
    const i0 = Math.floor(x / SC), j0 = Math.floor((y - dy) / SC);
    let best = 0;
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const h = hash(i * 3.3 + s * 5.1, j * 1.9 - s * 2.3);
      if (h < 0.55) continue;
      const cx = i * SC + hash(j + 7.7, i + s) * SC * 0.7, cy = j * SC + hash(i * 2.1, j + s * 3) * SC * 0.7 + dy;
      const r = 1400 + h * 1200, d = Math.hypot(x - cx, y - cy);
      if (d < r) best = Math.max(best, 1 - (d / r) ** 2);
    }
    return Math.max(best, gr);
  }

  /** Force du vent réel (nds) au point (x,y) au temps t. */
  speedAt(x: number, y: number, t: number): number {
    const M = this.met;
    let k = this.base(t);
    this.eachGust(x, y, x, y, t, (gx, gy, r, s) => {
      const d = Math.hypot(x - gx, y - gy);
      if (d < r) k += s * M.gust * (1 - (d / r) ** 2);
    });
    if (M.squalls) k += 11 * this.squall(x, y, t);
    else if (this.events.length) k += 12 * this.grain(x, y, t);
    return k;
  }
}
