// Replay : la course est enregistrée (états compacts de tous les bateaux, plusieurs fois par seconde),
// puis rejouée à n'importe quelle vitesse, en avant comme en arrière. Export de la trace en GPX.
import { SNAP, applySnap, snapOf, type Game } from './game';
import type { Boat } from '../physics/boat';

const KK = () => SNAP.length; // calculé à la demande (import circulaire avec game.ts)

interface Frame { t: number; simT: number; s: Float32Array }

export class Recorder {
  frames: Frame[] = [];
  boats: { id: number; name: string; col: string }[] = [];
  private next = -Infinity;
  private done = false;

  capture(g: Game): void {
    if (this.done || g.t < -25) return;
    const dt = g.course.nm > 10 ? 1 : 0.35; // longs parcours : moins d'images, même mémoire
    if (g.t < this.next) return;
    this.next = g.t + dt;
    if (!this.boats.length || this.boats.length !== g.boats.length) this.boats = g.boats.map(b => ({ id: b.id, name: b.name, col: b.col }));
    const K = KK(), s = new Float32Array(this.boats.length * K).fill(NaN);
    this.boats.forEach((bi, i) => { const b = g.boats.find(x => x.id === bi.id); if (b) s.set(snapOf(b), i * K); });
    this.frames.push({ t: g.t, simT: g.simT, s });
    // on arrête 40 s après que tout le monde a fini (ou après mon arrivée si la course traîne)
    const me = g.me;
    if (g.boats.every(b => b.fin != null) && g.t > Math.max(...g.boats.map(b => b.fin!)) + 40) this.done = true;
    if (me.fin != null && g.t > me.fin + 600) this.done = true;
  }

  get t0(): number { return this.frames[0]?.t ?? 0; }
  get t1(): number { return this.frames[this.frames.length - 1]?.t ?? 0; }

  /** Indice de la dernière image avant t (recherche dichotomique). */
  private at(t: number): number {
    let lo = 0, hi = this.frames.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (this.frames[m].t <= t) lo = m; else hi = m - 1; }
    return lo;
  }

  /** Place tous les bateaux du jeu à l'instant t du replay. */
  apply(g: Game, t: number, dt: number, fins: Map<number, number | null>): void {
    if (this.frames.length < 2) return;
    const K = KK();
    const i = this.at(t), A = this.frames[i], B = this.frames[Math.min(i + 1, this.frames.length - 1)];
    const f = B.t > A.t ? Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t))) : 0;
    g.t = t; g.simT = A.simT + (B.simT - A.simT) * f; g.wd = g.wind.dir(t);
    this.boats.forEach((bi, k) => {
      const b = g.boats.find(x => x.id === bi.id); if (!b) return;
      const a = A.s.subarray(k * K, k * K + K), c = B.s.subarray(k * K, k * K + K);
      if (Number.isNaN(a[0])) { b.v = 0; return; }
      const jump = Math.abs(dt) > 3; // grand saut dans la barre de temps : on repart sans sillage
      if (jump) b.wake.length = 0;
      applySnap(b, a, Number.isNaN(c[0]) ? a : c, f, Math.abs(dt));
      if (jump || dt < 0) { b.ix = b.x; b.iy = b.y; b.ih = b.h; }
      const fin = fins.get(b.id);
      b.fin = fin != null && t >= fin ? fin : null;
    });
  }

  /** Trace GPX de tous les bateaux (coordonnées fictives au large de la Bretagne). */
  gpx(g: Game): string {
    const K = KK(), LAT0 = 47.6, LON0 = -3.6, mLat = 111320, mLon = 111320 * Math.cos(LAT0 * Math.PI / 180);
    const start = Date.UTC(2026, 5, 21, 12, 0, 0);
    const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
    const trk = this.boats.map((bi, k) => {
      const pts = this.frames.filter((_, i) => i % 2 === 0).map(fr => {
        const x = fr.s[k * K], y = fr.s[k * K + 1], v = fr.s[k * K + 3];
        if (Number.isNaN(x)) return '';
        const lat = LAT0 - y / mLat, lon = LON0 + x / mLon;
        return `<trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><time>${new Date(start + fr.t * 1000).toISOString()}</time><extensions><speed>${v.toFixed(2)}</speed></extensions></trkpt>`;
      }).join('');
      return `<trk><name>${esc(bi.name)}</name><trkseg>${pts}</trkseg></trk>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Régate au large" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${esc(g.venue.name + ' · ' + g.course.name)}</name></metadata>\n${trk}\n</gpx>\n`;
  }
}

/** Bateau le plus intéressant à filmer : la tête de course, ou un duel serré. */
export function tvSubject(g: Game, boats: Boat[]): Boat {
  const st = g.standings(), lead = boats.find(b => b.name === st[0]?.name) ?? boats[0];
  let best = lead, bd = Infinity;
  for (const a of boats) for (const c of boats) if (a !== c && a.fin == null && c.fin == null) {
    const d = Math.hypot(a.x - c.x, a.y - c.y); if (d < bd && d < 120) { bd = d; best = a; }
  }
  return best;
}
