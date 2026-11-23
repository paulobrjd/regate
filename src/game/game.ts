// État d'une régate : bateaux, vent, chrono, parcours, classement. Pas fixe, déterministe à graine égale.
import { D, clamp, makeRng, rrange, type Rng } from '../util/math';
import { WindField, METEO, type Meteo } from '../physics/wind';
import { waveH } from '../physics/waves';
import { mkBoat, stepBoat, depower, type Boat, type BoatControl, type BoatEvent, type StepEnv, type Obstacle } from '../physics/boat';
import { LEVELS, mkAI, aiControl } from '../ai/bot';
import { MARKS, PIN, CMTE, MARK_R, distObj } from './course';

/** Durée du compte à rebours avant le départ (s). */
export const PRE = 30;
/** Pas de simulation fixe (s). */
export const STEP = 1 / 60;

export const COLS = ['#ffd23f', '#e8384f', '#3ddc97', '#b388ff', '#4cc9f0', '#ff8fab', '#f4a261', '#a3e635'];
export const BOTS = ['Margot', 'Yann', 'Loïc', 'Armelle', 'Tanguy'];

export type Sfx = 'tick' | 'gun' | 'finish' | 'capsize' | 'gybeWild';

export interface Input { left: boolean; right: boolean; up: boolean; down: boolean; auto: boolean }

export interface GameOpts {
  mode: 'solo' | 'net';
  demo?: boolean;
  seed?: number;
  met?: number;
  bots?: number;
  lvl?: number;
  name?: string;
  col?: string;
  /** Temps initial du chrono (s, négatif avant le départ). Par défaut -PRE. */
  startT?: number;
}

export interface Standing { name: string; col: string; me: boolean; leg: number; fin: number | null; ocs: boolean; d: number }

const OBSTACLES: Obstacle[] = [...MARKS, PIN, CMTE].map(o => ({ x: o.x, y: o.y, r: o === CMTE ? 26 : 18 }));

export class Game {
  readonly mode: 'solo' | 'net';
  readonly demo: boolean;
  readonly met: Meteo;
  readonly seed: number;
  readonly wind: WindField;
  readonly rng: Rng;
  /** Temps depuis le signal de départ (s). */
  t: number;
  /** Temps de simulation écoulé depuis la création (s), sert à la houle. */
  simT = 0;
  wd: number;
  boats: Boat[] = [];
  me: Boat;
  msg = ''; msgT = 0;
  lastT: number;
  hintSpi = false; spiWarn = 0; heelWarn = 0; shiftWarn = 0;
  endShown = false;
  /** Démo terminée : l'appelant peut en relancer une. */
  over = false;
  onSfx: (s: Sfx) => void = () => {};
  onFinish: () => void = () => {};
  private env: StepEnv;

  constructor(o: GameOpts) {
    this.mode = o.mode;
    this.demo = !!o.demo;
    this.met = METEO[o.met ?? 1];
    this.seed = o.seed ?? Math.random() * 10;
    this.rng = makeRng(this.seed * 1e6 + 1);
    this.wind = new WindField(this.seed, this.met);
    this.t = o.startT ?? -PRE;
    this.lastT = this.t - 1;
    this.wd = this.wind.dir(this.t);
    const rng = this.rng;
    const n = o.bots || 0, L = LEVELS[o.lvl ?? 1], tot = n + 1;
    for (let i = 0; i < tot; i++) {
      const x = -230 + (i + 0.5) * (460 / tot) + rrange(rng, -15, 15), dir = rng() < 0.5 ? 1 : -1;
      const y = rrange(rng, 200, 280);
      const b = mkBoat({ id: i, x, y, py: y, h: this.wd + dir * 95 * D });
      if (i === 0) { b.col = o.col || COLS[0]; b.name = o.name || 'Toi'; if (o.demo) b.ai = mkAI(L, x, rng); }
      else { b.col = COLS[i % COLS.length]; b.name = BOTS[(i - 1) % BOTS.length]; b.ai = mkAI(L, x, rng); }
      this.boats.push(b);
    }
    this.me = this.boats[0];
    // place le joueur à une position de départ tirée au sort
    const j = Math.floor(rng() * tot), b0 = this.boats[0], bj = this.boats[j];
    [b0.x, bj.x] = [bj.x, b0.x];
    if (b0.ai) b0.ai.home = b0.x;
    if (bj.ai) bj.ai.home = bj.x;
    for (const b of this.boats) { b.ix = b.x; b.iy = b.y; b.ih = b.h; }

    this.env = {
      wd: this.wd,
      wind: (x, y) => this.wind.speedAt(x, y, this.t),
      wave: (x, z) => waveH(x, z, this.simT, this.met.amp),
      rnd: this.rng,
      obstacles: OBSTACLES,
      event: (b, e) => this.boatEvent(b, e),
    };
  }

  say(m: string): void { this.msg = m; this.msgT = 2.6; }

  private isMe(b: Boat): boolean { return b === this.me && !this.demo; }

  private boatEvent(b: Boat, e: BoatEvent): void {
    if (e === 'contactMark') { if (b === this.me) this.say('Contact ! Attention aux obstacles'); return; }
    if (!this.isMe(b)) return;
    switch (e) {
      case 'capsize': this.say('Dessalé ! Choque dans les risées'); this.onSfx('capsize'); break;
      case 'gybeWild': this.say('Empannage sauvage ! Borde avant d\'empanner'); this.onSfx('gybeWild'); break;
      case 'gybeHard': this.say('Empannage musclé : borde avant d\'empanner'); break;
      case 'righted': this.say('Bateau redressé, repars !'); break;
    }
  }

  /** Avance la simulation d'un pas fixe. */
  update(dt: number, input: Input): void {
    this.simT += dt;
    this.t += dt;
    const t = this.t;
    this.wd = this.wind.dir(t);
    this.env.wd = this.wd;
    if (!this.demo && t < 0 && t > -5.5 && Math.ceil(t) !== Math.ceil(this.lastT)) this.onSfx('tick');
    if (this.lastT < 0 && t >= 0) {
      for (const b of this.boats) if (b.y < 0) { b.ocs = true; b.leg = 0; }
      if (!this.demo) { this.onSfx('gun'); this.say(this.me.ocs ? 'Départ anticipé ! Repasse sous la ligne' : 'Partez !'); }
    }
    this.lastT = t;
    for (const b of this.boats) {
      b.ix = b.x; b.iy = b.y; b.ih = b.h;
      let c: BoatControl;
      if (b.ai) c = aiControl(b, t, this.wd);
      else if (b.fin != null) c = { turn: 0, sheet: 1 };
      else c = {
        turn: (input.left ? -1 : 0) + (input.right ? 1 : 0),
        sheet: input.auto ? clamp(b.opt0 + depower(b), 0, 1) : null,
        sheetDir: (input.down ? 1 : 0) - (input.up ? 1 : 0),
      };
      const capBefore = b.cap > 0;
      stepBoat(b, dt, c, this.env);
      if (capBefore || b.cap > 0) continue; // pas de contrôle de parcours pendant un dessalage
      if (this.isMe(b)) this.coach(b);
      this.course(b);
    }
    this.collide();
    if (this.demo && this.boats.every(b => b.fin != null || t > 400)) this.over = true;
    if (this.msgT > 0) this.msgT -= dt;
  }

  /** Conseils au joueur. */
  private coach(b: Boat): void {
    const a = Math.abs(b.twa) / D;
    if (b.heelN > 0.85 && this.simT > this.heelWarn) { this.heelWarn = this.simT + 5; this.say('Ça gîte trop : choque la voile !'); }
    if (a < 80 && b.spiT > 0.5 && this.simT > this.spiWarn) { this.spiWarn = this.simT + 4; this.say('Le spi te freine : affale-le (Espace)'); }
    if (!this.hintSpi && this.t > 0 && a > 110 && b.spiT < 0.1 && !b.spi) { this.hintSpi = true; this.say('Au portant : envoie le spi (Espace) !'); }
  }

  private course(b: Boat): void {
    const t = this.t, me = b === this.me;
    if (t < 0 || b.fin != null) return;
    if (b.ocs) { if (b.y > 8) { b.ocs = false; if (me) this.say('C\'est bon, tu peux prendre le départ !'); } return; }
    if (b.leg === 0) {
      if (b.py > 0 && b.y <= 0) {
        if (Math.abs(b.x) <= 130) { b.leg = 1; if (me) this.say('Bon départ ! Cap sur la bouée 1'); }
        else if (me) this.say('Passe entre le bateau comité et la bouée jaune !');
      }
    } else if (b.leg <= 3) {
      const m = MARKS[b.leg - 1];
      if (Math.hypot(b.x - m.x, b.y - m.y) < MARK_R) { b.leg++; if (me) this.say(b.leg === 4 ? 'Dernier bord : l\'arrivée !' : 'Bouée passée !'); }
    } else if (b.leg === 4 && b.py < 0 && b.y >= 0 && Math.abs(b.x) <= 130) {
      b.fin = t; b.leg = 5;
      if (me) { this.onSfx('finish'); this.onFinish(); }
    }
  }

  private collide(): void {
    const L = this.boats;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < 24 && d > 0 && a.fin == null && b.fin == null) {
        const p = (24 - d) / 2;
        a.x -= dx / d * p; a.y -= dy / d * p; b.x += dx / d * p; b.y += dy / d * p;
        a.v *= 0.97; b.v *= 0.97;
        if ((a === this.me || b === this.me) && this.msgT < 1) this.say('Collision !');
      }
    }
  }

  standings(): Standing[] {
    const L: Standing[] = this.boats.map(b => ({ name: b.name, col: b.col, me: b === this.me, leg: b.leg, fin: b.fin, ocs: b.ocs, d: distObj(b) }));
    const sc = (e: Standing) => e.fin != null ? 1e9 - e.fin * 1000 : (e.ocs ? -1e6 : 0) + e.leg * 1e5 - e.d;
    return L.sort((a, b) => sc(b) - sc(a));
  }
}
