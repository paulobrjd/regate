// Parcours : ligne de départ/arrivée, bouées et îles à contourner. Mètres, vent venant du nord (-y).
import { islandAt, ISLANDS, shoreR } from '../physics/world';

export type Side = 'port' | 'stbd';
export interface Pt { x: number; y: number }

export interface MarkDef { x: number; y: number; name: string; side: Side; island?: number }

export interface Mark extends MarkDef {
  /** Directions du bord d'arrivée et du bord suivant. */
  dirIn: Pt; dirOut: Pt;
  /** Demi-droite de contrôle : le bateau doit la franchir pour valider le passage. */
  out: Pt; rayStart: number; rayLen: number;
  /** Points de passage de l'IA : approche, extérieur, sortie. */
  wp: Pt[];
  /** Rayon physique (m) si bouée. */
  r: number;
}

export interface Course {
  id: string; name: string; desc: string;
  /** Longueur théorique (milles). */
  nm: number;
  marks: Mark[];
  pin: Pt; cmte: Pt;
}

export const PIN: Pt = { x: -260, y: 0 };
export const CMTE: Pt = { x: 260, y: 0 };
const BUOY_R = 3, MARK_CLEAR = 70;

const unit = (x: number, y: number): Pt => { const d = Math.hypot(x, y) || 1; return { x: x / d, y: y / d }; };
/** Perpendiculaire droite d'une direction (x vers l'est, y vers le sud). */
const right = (d: Pt): Pt => ({ x: -d.y, y: d.x });
const left = (d: Pt): Pt => ({ x: d.y, y: -d.x });

function build(id: string, name: string, desc: string, defs: MarkDef[]): Course {
  const marks: Mark[] = [];
  const pts: Pt[] = [{ x: 0, y: 0 }, ...defs, { x: 0, y: 0 }];
  let len = 0;
  defs.forEach((m, i) => {
    const prev = pts[i], next = pts[i + 2];
    const dirIn = unit(m.x - prev.x, m.y - prev.y), dirOut = unit(next.x - m.x, next.y - m.y);
    const perp = (d: Pt) => (m.side === 'port' ? right(d) : left(d));
    const bx = dirIn.x - dirOut.x, by = dirIn.y - dirOut.y;
    const out = Math.hypot(bx, by) > 0.3 ? unit(bx, by) : perp(unit(dirIn.x + dirOut.x, dirIn.y + dirOut.y));
    const isl = m.island != null ? ISLANDS[m.island] : null;
    const rad = isl ? shoreR(isl, Math.atan2(out.y, out.x)) : 0;
    const clear = isl ? rad * 0.25 + 450 : MARK_CLEAR;
    const base = isl ? rad : 0;
    const at = (d: Pt, k: number): Pt => {
      const th = Math.atan2(d.y, d.x), r0 = isl ? shoreR(isl, th) : 0;
      return { x: m.x + d.x * (r0 + k), y: m.y + d.y * (r0 + k) };
    };
    const wp = [at(perp(dirIn), clear), at(out, clear), at(perp(dirOut), clear)];
    marks.push({ ...m, dirIn, dirOut, out, rayStart: base, rayLen: base + (isl ? 4000 : 1500), wp, r: isl ? 0 : BUOY_R });
    len += Math.hypot(m.x - prev.x, m.y - prev.y);
  });
  const last = defs[defs.length - 1];
  len += Math.hypot(last.x, last.y);
  return { id, name, desc, nm: Math.round(len / 1852 * 10) / 10, marks, pin: PIN, cmte: CMTE };
}

export const COURSES: readonly Course[] = [
  build('banane', 'Banane courte', 'Un bord de près jusqu\'à la bouée au vent, puis retour au portant.', [
    { x: 0, y: -1850, name: 'Bouée au vent', side: 'port' },
  ]),
  build('triangle', 'Triangle', 'Près, travers, largue : le parcours olympique.', [
    { x: 0, y: -3000, name: 'Bouée 1 (au vent)', side: 'port' },
    { x: -2300, y: -1600, name: 'Bouée 2 (dégagement)', side: 'port' },
    { x: 0, y: -450, name: 'Bouée 3 (sous le vent)', side: 'port' },
  ]),
  build('banane2', 'Banane deux tours', 'Deux allers-retours entre la bouée au vent et la bouée sous le vent.', [
    { x: 0, y: -2600, name: 'Bouée au vent', side: 'port' },
    { x: 0, y: -380, name: 'Bouée sous le vent', side: 'port' },
    { x: 0, y: -2600, name: 'Bouée au vent (2e tour)', side: 'port' },
  ]),
  build('iles', 'Tour des îles', 'Côtier : laisse l\'Île Verte puis l\'Île du Phare à tribord.', [
    { x: ISLANDS[0].x, y: ISLANDS[0].y, name: 'Île Verte', side: 'stbd', island: 0 },
    { x: ISLANDS[1].x, y: ISLANDS[1].y, name: 'Île du Phare', side: 'stbd', island: 1 },
  ]),
  build('large', 'Raid du Rocher du Nord', 'Grand large : remonte au Rocher du Nord, laisse-le à tribord et redescends.', [
    { x: ISLANDS[2].x, y: ISLANDS[2].y, name: 'Rocher du Nord', side: 'stbd', island: 2 },
  ]),
];

/** Le segment p→q coupe-t-il la demi-droite de contrôle de la bouée ? */
export function crossesRay(m: Mark, p: Pt, q: Pt): boolean {
  const ax = m.x + m.out.x * m.rayStart, ay = m.y + m.out.y * m.rayStart;
  const bx = m.x + m.out.x * m.rayLen, by = m.y + m.out.y * m.rayLen;
  return segCross(p, q, { x: ax, y: ay }, { x: bx, y: by });
}

export function segCross(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  const d = (u: Pt, v: Pt, w: Pt) => (v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x);
  const d1 = d(a, b, p), d2 = d(a, b, q), d3 = d(p, q, a), d4 = d(p, q, b);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

/** Vérifie qu'aucun bord du parcours (entre points de passage) ne traverse une île. */
export function courseClear(c: Course): string[] {
  const bad: string[] = [];
  const path: Pt[] = [{ x: 0, y: -50 }];
  for (const m of c.marks) path.push(...m.wp);
  path.push({ x: 0, y: 50 });
  for (let i = 0; i + 1 < path.length; i++) {
    const p = path[i], q = path[i + 1], n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 50);
    for (let k = 0; k <= n; k++) {
      const isl = islandAt(p.x + (q.x - p.x) * k / n, p.y + (q.y - p.y) * k / n, 100);
      if (isl) { bad.push(`${c.id} : segment ${i} touche ${isl.name}`); break; }
    }
  }
  return bad;
}
