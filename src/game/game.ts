// État d'une régate : bateaux, vent, chrono, parcours, classement. Pas fixe, déterministe à graine égale.
import { D, clamp, makeRng, rrange, type Rng } from '../util/math';
import { WindField, METEO, type Meteo } from '../physics/wind';
import { waveH, WV, SEAS, setSwell } from '../physics/waves';
import { IMOCA, type BoatClass } from '../physics/classes';
import { calibration, bestConfig, type Calibration } from '../physics/model';
import { islandAt } from '../physics/world';
import { KN } from '../physics/units';
import {
  mkBoat, stepBoat, cmdHead, cmdReef, cmdKeel, cmdFoils, cmdBallast, cmdPilot, cmdPilotMode, cmdPilotTack, cmdPilotAdjust,
  config, NO_INPUT, type Boat, type BoatEvent, type StepEnv, type Obstacle, type BoatInput,
} from '../physics/boat';
import { LEVELS, mkAI, aiSteer, type AI } from '../ai/bot';
import { vmgAngles } from '../physics/polar';
import { norm } from '../util/math';
import { applyAssist, newMem, ASSISTS, type Assist, type AssistMem } from './assist';
import { crossesRay, segCross, type Course } from './course';
import { activateVenue, type Venue } from './venue';
import { Recorder } from './replay';

/** Durée du compte à rebours avant le départ (s). */
export const PRE = 60;
/** Pas de simulation fixe (s). */
export const STEP = 1 / 60;
export const TIME_SCALES = [1, 2, 5, 10, 20, 50];

export const COLS = ['#ffd23f', '#e8384f', '#3ddc97', '#b388ff', '#4cc9f0', '#ff8fab', '#f4a261', '#a3e635', '#ffffff', '#1f6feb', '#ff6a1f', '#00b3a4', '#c2185b', '#8d6e63', '#2c3e50'];
export const BOTS = ['Margot', 'Yann', 'Loïc', 'Armelle', 'Tanguy', 'Gwen', 'Erwan', 'Maëlle', 'Ronan', 'Solène', 'Malo', 'Nolwenn', 'Corentin', 'Anouk'];
/** Nombre maximal de bateaux sur l'eau. */
export const MAX_BOATS = 15;
/** Demi-longueur de la ligne de départ (m) : elle s'allonge avec le nombre de bateaux. */
export const lineHalf = (n: number) => Math.max(260, Math.min(620, 110 + 34 * n));

export type Sfx = 'tick' | 'gun' | 'finish' | 'capsize' | 'gybeWild' | 'mark' | 'winch' | 'ground' | 'event';

export type Command = 'head1' | 'head2' | 'head3' | 'head4' | 'head5' | 'reefIn' | 'reefOut' | 'keel' | 'foils' | 'ballast'
  | 'pilot' | 'pilotMode' | 'pilotTack' | 'pilotLeft' | 'pilotRight' | 'pilotLeft10' | 'pilotRight10' | 'route';

export interface GameOpts {
  mode: 'solo' | 'net';
  demo?: boolean;
  seed?: number;
  met?: number;
  bots?: number;
  lvl?: number;
  venue?: string;
  course?: string;
  /** Ciel : auto, soleil, nuageux, pluie, brume, couchant. */
  sky?: string;
  /** État de mer : auto, plate, belle, formee, grosse. */
  sea?: string;
  /** Collisions entre bateaux (par défaut oui). */
  collisions?: boolean;
  /** Événements météo pendant la course (par défaut oui). */
  events?: boolean;
  assist?: Assist;
  name?: string;
  col?: string;
  cls?: BoatClass;
  startT?: number;
  /** Rythme de base (1 = temps réel, 2 = dynamique). */
  pace?: number;
  /** En ligne : place sur la ligne, chrono de course donné par le serveur, heure du serveur (ms). */
  slot?: { i: number; n: number };
  clock?: () => number;
  remoteClock?: () => number;
}

/** État d'un bateau échangé en ligne (tableau compact). */
export const SNAP = ['x', 'y', 'h', 'v', 'heel', 'mainSheet', 'trav', 'headSheet', 'head', 'reefs', 'keel', 'foilP', 'foilS', 'awa', 'tws', 'rud', 'headPow', 'mainPow', 'knock', 'leg', 'ocs', 'twa', 'aws', 'foilLift'] as const;
const ANG = new Set(['h', 'awa', 'twa']);
interface Remote { b: Boat; buf: { t: number; s: number[] }[]; seen: number }

export interface Standing { name: string; col: string; me: boolean; leg: number; fin: number | null; ocs: boolean; d: number }

export class Game {
  readonly mode: 'solo' | 'net';
  readonly demo: boolean;
  readonly met: Meteo;
  readonly seed: number;
  readonly wind: WindField;
  readonly rng: Rng;
  readonly course: Course;
  readonly venue: Venue;
  readonly sky: string;
  /** Amplitude de la houle (météo × plan d'eau). */
  waveAmp: number;
  /** État de mer choisi (auto = selon la météo et le vent), collisions entre bateaux. */
  readonly sea: string;
  readonly collisions: boolean;
  readonly cls: BoatClass;
  readonly cal: Calibration;
  assist: Assist;
  t: number;
  simT = 0;
  wd: number;
  boats: Boat[] = [];
  me: Boat;
  msg = ''; msgT = 0;
  lastT: number;
  coachT = 0; shiftWarn = 0;
  endShown = false;
  over = false;
  timeScale = 1;
  /** Rythme de base : le temps du jeu passe `pace` fois plus vite que le temps réel (2 = dynamique). */
  pace = 2;
  onSfx: (s: Sfx) => void = () => {};
  onFinish: () => void = () => {};
  private env: StepEnv;
  private meMem: AssistMem = newMem();
  private pinch = 0;
  /** Cap conseillé (rad) par un « fantôme » qui navigue comme un champion, et son explication. */
  advice: number | null = null;
  adviceTxt = '';
  /** Route automatique : le bateau suit tout seul le cap conseillé. */
  routeAuto = false;
  private ghost: AI | null = null;
  private adviceT = 0;
  private ghostTack = 0;
  private clock?: () => number;
  private remoteClock?: () => number;
  /** Bateaux des autres joueurs (en ligne), par identifiant. */
  readonly remotes = new Map<string, Remote>();
  /** Enregistrement de la course pour le replay. */
  readonly rec = new Recorder();
  /** Largeur de la zone de départ (m, de part et d'autre de l'axe). */
  private spread = 320;
  private obstacles: Obstacle[];

  constructor(o: GameOpts) {
    this.mode = o.mode;
    this.demo = !!o.demo;
    this.met = METEO[o.met ?? 1];
    this.seed = o.seed ?? Math.random() * 10;
    this.rng = makeRng(this.seed * 1e6 + 1);
    const vc = activateVenue(o.venue ?? 'baie');
    this.venue = vc.venue;
    {
      const base = vc.courses.find(c => c.id === o.course) ?? vc.courses[0], nb = o.slot ? o.slot.n : Math.min(MAX_BOATS, (o.bots || 0) + 1), hw = lineHalf(nb);
      this.course = { ...base, pin: { x: -hw, y: 0 }, cmte: { x: hw, y: 0 } };
      this.spread = hw * 1.25;
    }
    this.wind = new WindField(this.seed, this.met, this.venue.shifts, this.venue.gusts);
    if (o.events !== false) {
      // durée de course estimée (≈ 11 nds de moyenne), centre et étendue du parcours
      const pts = [{ x: 0, y: 0 }, ...this.course.marks], cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      const span = Math.max(1500, ...pts.map(p => Math.hypot(p.x - cx, p.y - cy) * 2));
      this.wind.planEvents(this.course.nm * 1852 / 5.6, { x: cx, y: cy }, span, makeRng(this.seed * 1e6 + 77));
    }
    this.sea = o.sea && SEAS[o.sea] ? o.sea : 'auto';
    this.collisions = o.collisions ?? true;
    setSwell(this.venue.swell ?? 0);
    this.waveAmp = this.seaAmp(o.startT ?? -PRE);
    this.sky = o.sky && o.sky !== 'auto' ? o.sky : (this.met.sky ?? 'soleil');
    this.cls = o.cls ?? IMOCA;
    this.cal = calibration(this.cls);
    this.assist = o.assist ?? ASSISTS.equipier.a;
    this.t = o.startT ?? -PRE;
    this.pace = o.pace ?? 3;
    this.lastT = this.t - 1;
    this.wd = this.wind.dir(this.t);
    const rng = this.rng, c = this.course;
    this.obstacles = [...c.marks.filter(m => m.island == null).map(m => ({ x: m.x, y: m.y, r: m.r })), { ...c.pin, r: 3 }, { ...c.cmte, r: 12 }];
    const n = Math.min(MAX_BOATS - 1, o.bots || 0), L = LEVELS[o.lvl ?? 1], tot = n + 1, sp = this.spread;
    for (let i = 0; i < tot; i++) {
      const x = -sp + (i + 0.5) * (2 * sp / tot) + rrange(rng, -15, 15), dir = rng() < 0.5 ? 1 : -1;
      const y = rrange(rng, 280, 420);
      const b = mkBoat(this.cls, { id: i, x, y, h: this.wd + dir * 95 * D, v: 3 });
      b.tack = b.lastTack = dir;
      if (i === 0) {
        b.col = o.col || COLS[0]; b.name = o.name || 'Toi';
        if (o.demo) { b.ai = mkAI(L, x, rng, newMem()); b.perf = rrange(rng, ...L.perf); }
      } else {
        b.col = COLS[i % COLS.length]; b.name = BOTS[(i - 1) % BOTS.length];
        b.ai = mkAI(L, x, rng, newMem()); b.perf = rrange(rng, ...L.perf);
      }
      this.boats.push(b);
    }
    this.me = this.boats[0];
    const j = Math.floor(rng() * tot), b0 = this.boats[0], bj = this.boats[j];
    [b0.x, bj.x] = [bj.x, b0.x];
    if (b0.ai) b0.ai.home = b0.x;
    if (bj.ai) bj.ai.home = bj.x;
    if (o.slot) { // en ligne : chacun sa place sur la ligne
      const { i, n } = o.slot, dir = i % 2 ? 1 : -1;
      b0.x = -sp + (i + 0.5) * (2 * sp / Math.max(1, n)); b0.y = 300 + (i % 3) * 45; b0.h = this.wd + dir * 95 * D; b0.tack = b0.lastTack = dir;
    }
    this.clock = o.clock; this.remoteClock = o.remoteClock;
    // configuration initiale raisonnable (puis l'assistance ou le joueur prend la main)
    for (const b of this.boats) {
      b.ix = b.px = b.x; b.iy = b.py = b.y;
      applyAssist(b, { sheets: true, systems: true, sails: false }, this.cal, newMem(), 0, 10);
      b.keel = b.keelT; b.foilP = b.foilPT; b.foilS = b.foilST; b.ballP = b.ballPT; b.ballS = b.ballST;
      if (b === this.me && !this.demo) b.pilot.on = false;
    }
    const k = WV[0][3];
    this.env = {
      wd: this.wd,
      wind: (x, y) => this.wind.speedAt(x, y, this.t),
      wave: (x, y) => waveH(x, y, this.simT, this.waveAmp),
      waveC: Math.sqrt(9.8 / k),
      cal: this.cal,
      rnd: this.rng,
      obstacles: this.obstacles,
      ground: (x, y) => !!islandAt(x, y),
      event: (b, e, info) => this.boatEvent(b, e, info),
    };
  }

  say(m: string, force = true): void { if (force || this.msgT <= 0) { this.msg = m; this.msgT = 3; } }

  private isMe(b: Boat): boolean { return b === this.me && !this.demo; }

  private boatEvent(b: Boat, e: BoatEvent, info?: string): void {
    if (!this.isMe(b)) return;
    switch (e) {
      case 'contactMark': this.say('Contact avec une bouée !', false); break;
      case 'knockdown': this.say('Couché ! Le bateau s\'est couché sur l\'eau'); this.onSfx('capsize'); this.timeScale = 1; break;
      case 'recovered': this.say('Le bateau se redresse, repars !'); break;
      case 'broach': this.say('Départ au lof ! Choque, prends un ris'); this.onSfx('gybeWild'); this.timeScale = 1; break;
      case 'crashGybe': this.say('Empannage sauvage ! Borde la GV avant d\'empanner'); this.onSfx('gybeWild'); this.timeScale = 1; break;
      case 'aground': this.say('Échoué ! Attends que le bateau se dégage'); this.onSfx('ground'); this.timeScale = 1; break;
      case 'refloat': this.say('Le bateau est dégagé'); break;
      case 'tack': case 'gybe': {
        const a = this.assist;
        const todo = [!a.systems ? 'quille (K), foils (F), ballast (B)' : '', !a.sheets ? 'écoutes' : ''].filter(Boolean).join(', ');
        this.say((e === 'tack' ? 'Virement de bord' : 'Empannage') + (todo ? ' : pense à ' + todo : ''));
        this.onSfx('winch'); break;
      }
      case 'taskDone': this.say(info === 'head' ? 'Voile d\'avant envoyée : ' + this.cls.heads[b.head].name : 'Ris : ' + (b.reefs ? b.reefs + ' ris pris' : 'grand-voile haute')); this.onSfx('winch'); break;
      case 'taskBusy': this.say('Une manœuvre est déjà en cours'); break;
    }
  }

  /** Commande ponctuelle du joueur. */
  command(c: Command): void {
    const b = this.me;
    if (b.fin != null || this.demo) return;
    const env = this.env;
    switch (c) {
      case 'head1': case 'head2': case 'head3': case 'head4': case 'head5': {
        const i = +c.slice(4) - 1;
        if (i === b.head && !b.task) { this.say(this.cls.heads[i].name + ' déjà envoyé'); break; }
        if (cmdHead(b, i, env)) this.say('Changement de voile : ' + this.cls.heads[i].name + ' (' + Math.round(b.task!.dur) + ' s)');
        break;
      }
      case 'reefIn': if (cmdReef(b, 1, env)) this.say('Prise du ' + (b.reefs + 1) + (b.reefs ? 'e' : 'er') + ' ris (' + Math.round(b.task!.dur) + ' s)'); else if (!b.task) this.say('Déjà au 3e ris'); break;
      case 'reefOut': if (cmdReef(b, -1, env)) this.say('Largage d\'un ris (' + Math.round(b.task!.dur) + ' s)'); else if (!b.task) this.say('Grand-voile déjà haute'); break;
      case 'keel': cmdKeel(b); this.say(b.keelT === 0 ? 'Quille au centre' : 'Quille au vent'); break;
      case 'foils': cmdFoils(b); this.say(b.foilPT + b.foilST > 0 ? 'Foil sous le vent : on le sort' : 'Foils rentrés'); break;
      case 'ballast': cmdBallast(b); this.say(b.ballPT + b.ballST > 0 ? 'Ballast au vent : pompe en route' : 'On vide les ballasts'); break;
      case 'pilot': cmdPilot(b, this.wd); this.say(b.pilot.on ? 'Pilote engagé' : 'Pilote débrayé : à toi la barre'); break;
      case 'pilotMode': cmdPilotMode(b, this.wd); this.say('Pilote : mode ' + (b.pilot.mode === 'cap' ? 'cap compas' : 'angle au vent')); break;
      case 'pilotTack': this.routeAuto = false; cmdPilotTack(b, this.wd); this.say(Math.abs(b.twa) < 90 * D ? 'Virement de bord au pilote' : 'Empannage au pilote'); break;
      case 'pilotLeft': cmdPilotAdjust(b, -1); break;
      case 'pilotRight': cmdPilotAdjust(b, 1); break;
      case 'pilotLeft10': cmdPilotAdjust(b, -10); break;
      case 'pilotRight10': cmdPilotAdjust(b, 10); break;
      case 'route': this.routeAuto = !this.routeAuto; this.say(this.routeAuto ? 'Route auto : le bateau suit la flèche verte' : 'Route auto coupée : à toi la barre'); break;
    }
  }

  /** Avance la simulation d'un pas fixe. */
  update(dt: number, input: BoatInput): void {
    this.simT += dt;
    this.t = this.clock ? this.clock() : this.t + dt;
    const t = this.t;
    this.wd = this.wind.dir(t);
    this.env.wd = this.wd;
    // la mer suit le vent (lentement) : elle grossit quand ça forcit, se calme quand ça mollit
    this.waveAmp += (this.seaAmp(t) - this.waveAmp) * Math.min(1, dt / 40);
    if (!this.demo && t < 0 && t > -10.5 && Math.ceil(t) !== Math.ceil(this.lastT)) this.onSfx('tick');
    if (this.lastT < 0 && t >= 0) {
      for (const b of this.boats) if (b.y < 0) { b.ocs = true; b.leg = 0; }
      if (!this.demo) { this.onSfx('gun'); this.say(this.me.ocs ? 'Départ anticipé ! Repasse sous la ligne' : 'Partez !'); }
    }
    this.lastT = t;
    const rnow = this.remoteClock ? this.remoteClock() - 200 : 0; // on affiche les autres avec 200 ms de retard (interpolation)
    for (const b of this.boats) {
      if (b.remote) { this.updateRemote(b, rnow, dt); continue; }
      let inp = NO_INPUT;
      if (b.ai) {
        aiSteer(b, this.course, t, this.wd);
        applyAssist(b, { sheets: true, systems: true, sails: true }, this.cal, b.ai.mem, this.simT, dt, b.ai.err);
      } else if (b.fin == null) {
        if (b === this.me && !this.demo) this.updateAdvice(b, dt);
        if (this.routeAuto && this.advice != null) {
          if (input.helm) { this.routeAuto = false; this.say('Route auto coupée : à toi la barre'); }
          else { b.pilot.on = true; b.pilot.mode = 'cap'; b.pilot.set = this.advice; }
        }
        inp = this.routeAuto ? { ...input, helm: 0 } : this.assist.helm ? this.assistedHelm(b, input, dt) : input;
        b.safe = !!this.assist.safe;
        applyAssist(b, this.assist, this.cal, this.meMem, this.simT, dt);
        if (this.assist.sails) b.energy = 1; // manœuvres automatiques : le skipper ne s'épuise pas
        if (this.assist.helm && b.task) b.task.t += dt * 4; // Débutant : manœuvres express
      } else b.pilot = { on: true, mode: 'cap', set: this.wd + Math.PI / 2 };
      stepBoat(b, dt, inp, this.env);
      this.progress(b);
    }
    this.collide();
    if (!this.demo) this.rec.capture(this);
    if (this.isMe(this.me)) this.coach(this.me, dt);
    this.autoSlow();
    if (this.demo && (this.boats.every(b => b.fin != null) || t > 1500)) this.over = true;
    if (!this.demo) this.announceEvents();
    if (this.msgT > 0) this.msgT -= dt;
  }

  /** Le fantôme calcule le meilleur cap à partir de la position du joueur (4 fois par seconde). */
  private updateAdvice(b: Boat, dt: number): void {
    this.adviceT -= dt;
    if (this.adviceT > 0 && this.advice != null) return;
    this.adviceT = 0.25;
    if (!this.ghost) { this.ghost = mkAI(LEVELS[2], b.x, makeRng(99), newMem()); this.ghost.corr = 22; this.ghost.early = 1; }
    const A = this.ghost;
    // si le joueur a viré de lui-même, le fantôme accepte son choix
    if (b.tack !== this.ghostTack) { this.ghostTack = b.tack; if (!this.routeAuto) { A.k = b.tack; A.lastTack = this.t; } }
    const ghost = { ...b, pilot: { ...b.pilot }, ai: A };
    aiSteer(ghost, this.course, this.t, this.wd);
    const h = ghost.pilot.set;
    this.advice = h;
    const twaA = norm(h - this.wd), d = norm(h - b.h) / D;
    if (Math.sign(twaA) !== Math.sign(b.twa) && Math.abs(d) > 25) this.adviceTxt = Math.abs(twaA) < 90 * D ? 'Vire de bord (Espace)' : 'Empanne (Espace)';
    else if (Math.abs(d) < 8) this.adviceTxt = 'Bon cap, tout droit';
    else this.adviceTxt = (d < 0 ? '◀ Tourne à gauche ' : 'Tourne à droite ▶ ') + Math.round(Math.abs(d)) + '°';
  }

  /** Choisir un cap (boussole, clic sur la carte) : le pilote s'en charge, sans jamais se mettre face au vent. */
  steerTo(heading: number): void {
    const b = this.me; if (b.fin != null || this.demo) return;
    this.routeAuto = false;
    const up = vmgAngles(this.cls.polar, Math.round(b.tws)).up * D;
    let twa = norm(heading - this.wd);
    if (Math.abs(twa) < up) twa = (Math.sign(twa) || b.tack) * up;
    b.pilot.on = true;
    if (this.assist.helm) { b.pilot.mode = 'vent'; b.pilot.set = twa; }
    else { b.pilot.mode = 'cap'; b.pilot.set = norm(this.wd + twa); }
  }

  /**
   * Barre assistée : ← → font tourner la consigne d'angle au vent (vitesse constante à l'écran).
   * On ne peut pas lofer plus haut que l'angle de près optimal : insister fait virer de bord.
   * Passer le vent arrière fait empanner tout seul.
   */
  private assistedHelm(b: Boat, input: BoatInput, dt: number): BoatInput {
    const p = b.pilot;
    if (!p.on || p.mode !== 'vent') { p.on = true; p.mode = 'vent'; p.set = Math.abs(b.twa) < 40 * D ? Math.sign(b.twa || 1) * 45 * D : b.twa; }
    const up = vmgAngles(this.cls.polar, Math.round(b.tws)).up * D;
    if (input.helm) {
      let s = norm(p.set + input.helm * (45 / this.pace) * D * dt);
      if (Math.abs(s) < up) {
        s = Math.sign(p.set || 1) * up;
        this.pinch += dt / this.pace;
        if (this.pinch > 0.3) { s = -s; this.pinch = -0.6; this.say('Virement de bord !'); }
      } else if (this.pinch > 0) this.pinch = 0;
      p.set = s;
    } else if (this.pinch > 0) this.pinch = 0; else this.pinch = Math.min(0, this.pinch + dt / this.pace);
    return { ...input, helm: 0 };
  }

  /** Amplitude de houle visée : état de mer choisi, ou selon la météo et la force du vent du moment. */
  private seaAmp(t: number): number {
    const k = SEAS[this.sea]?.k, v = this.venue.waves;
    if (k != null) return k * (this.venue.id === 'lac' ? Math.min(1, k) : 1);
    return this.met.amp * v * Math.pow(Math.max(0.3, this.wind.base(t) / this.met.base), 1.6);
  }

  private announced = new Set<string>();
  /** Annonce les événements météo : 25 s avant, puis à leur arrivée. */
  private announceEvents(): void {
    const t = this.t, b = this.me, D2 = 180 / Math.PI;
    for (const e of this.wind.events) {
      const id = e.kind + e.t0;
      if (t > e.t0 - 25 && t < e.t0 && !this.announced.has(id + 'a')) {
        this.announced.add(id + 'a');
        const pre: Record<string, string> = {
          grain: 'Un grain noir approche par le nord : rafales et pluie dans 25 s',
          coup: 'Le ciel se charge : un coup de vent arrive',
          molle: 'Ça mollit au loin : la brise va tomber',
          bascule: 'Le vent s\'apprête à tourner ' + (e.amp > 0 ? 'vers la droite' : 'vers la gauche'),
        };
        this.say('⚠ ' + pre[e.kind]); this.onSfx('event'); this.timeScale = 1;
      }
      if (t >= e.t0 && t < e.t0 + 5 && !this.announced.has(id + 'b')) {
        this.announced.add(id + 'b');
        const deg = Math.round(Math.abs(e.amp) * D2), base = Math.round(this.wind.met.base);
        const now: Record<string, string> = {
          grain: 'GRAIN ! Rafales à plus de ' + (Math.round(b.tws) + 10) + ' nœuds : choque dans les rafales',
          coup: 'COUP DE VENT : ça monte à ' + Math.round(base * (1 + e.amp)) + ' nœuds, réduis la toile',
          molle: 'MOLLE : le vent tombe vers ' + Math.round(base * (1 - e.amp)) + ' nœuds, cherche les risées',
          bascule: 'BASCULE de ' + deg + '° ' + (e.amp > 0 ? 'à droite' : 'à gauche') + ' : regarde la flèche verte, il faut peut-être virer',
        };
        this.say(now[e.kind]); this.onSfx('event');
      }
    }
  }

  /** Repasse en temps réel près des moments importants. */
  private autoSlow(): void {
    if (this.timeScale === 1) return;
    const me = this.me, t = this.t;
    if (t < 0 && t > -12) this.timeScale = 1;
    const m = me.leg >= 1 && me.leg <= this.course.marks.length ? this.course.marks[me.leg - 1] : null;
    if (m && Math.hypot(me.x - m.x, me.y - m.y) < (m.island != null ? 1400 : 350)) this.timeScale = 1;
    if (me.leg > this.course.marks.length && me.y > -400) this.timeScale = 1;
  }

  /** Conseils au skipper (selon ce qu'il règle lui-même). */
  private coach(b: Boat, dt: number): void {
    this.coachT -= dt;
    if (this.coachT > 0 || this.msgT > 0.5 || b.knock > 0 || b.aground > 0 || this.t < -50) return;
    const a = this.assist, cfg = config(b), best = bestFor(this, b), hd = b.heel / D;
    let m = '';
    if (hd > 32) m = 'Ça gîte trop : choque la GV, descends le chariot ou prends un ris';
    else if (!a.systems && cfg.keelW < -0.2) m = 'Quille sous le vent ! Bascule-la au vent (K)';
    else if (!a.systems && cfg.ballL > 0.3) m = 'Ballast sous le vent : transfère-le au vent (B)';
    else if (!a.systems && cfg.foilWind > 0.5) m = 'Foil au vent sorti : il freine (F)';
    else if (!a.systems && best && best.foilLee > 0.5 && cfg.foilLee < 0.3 && b.v > 6) m = 'Sors le foil sous le vent pour soulager le bateau (F)';
    else if (!a.systems && cfg.keelW < 0.3 && b.tws > 9 && Math.abs(b.twa) < 130 * D) m = 'Bascule la quille au vent pour redresser (K)';
    else if (!a.sails && best && best.head !== b.head && !b.task) m = 'Voile conseillée : ' + this.cls.heads[best.head].name + ' (touche ' + (best.head + 1) + ')';
    else if (!a.sails && best && best.reefs > b.reefs && !b.task) m = 'Trop de toile : prends un ris (P)';
    else if (!a.sails && best && best.reefs < b.reefs && !b.task) m = 'Tu peux larguer un ris (O)';
    else if (b.energy < 0.2) m = 'Tu es épuisé : les manœuvres sont plus lentes';
    if (m) { this.say(m); this.coachT = 9; } else this.coachT = 2;
  }

  private progress(b: Boat): void {
    const t = this.t, me = this.isMe(b), c = this.course, N = c.marks.length;
    if (t < 0 || b.fin != null) return;
    const p = { x: b.px, y: b.py }, q = { x: b.x, y: b.y };
    const onLine = segCross(p, q, c.pin, c.cmte);
    if (b.ocs) { if (b.y > 10) { b.ocs = false; if (me) this.say('C\'est bon, tu peux prendre le départ !'); } return; }
    if (b.leg === 0) {
      if (onLine && b.y < b.py) { b.leg = 1; if (me) this.say('Bon départ ! Cap sur : ' + c.marks[0].name); }
      else if (b.py > 0 && b.y <= 0 && me) this.say('Passe entre le bateau comité et la bouée jaune !');
    } else if (b.leg <= N) {
      const m = c.marks[b.leg - 1];
      if (crossesRay(m, p, q)) {
        b.leg++;
        if (me) { this.onSfx('mark'); this.say(b.leg > N ? 'Dernier bord : cap sur l\'arrivée !' : m.name + ' passée ! Cap sur : ' + c.marks[b.leg - 1].name); }
      }
    } else if (onLine && b.y > b.py) {
      b.fin = t; b.leg = N + 2;
      if (me) { this.onSfx('finish'); this.timeScale = 1; this.onFinish(); }
    }
  }

  private collide(): void {
    if (!this.collisions) return;
    const L = this.boats, R = 16;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d < R && d > 0 && a.fin == null && b.fin == null) {
        // un bateau distant ne bouge pas ici (sa position vient du réseau) : l'autre recule de tout l'écart
        const pa = b.remote ? R - d : a.remote ? 0 : (R - d) / 2, pb = a.remote ? R - d : b.remote ? 0 : (R - d) / 2;
        a.x -= dx / d * pa; a.y -= dy / d * pa; b.x += dx / d * pb; b.y += dy / d * pb;
        // choc : on ne freine que si les bateaux se rapprochent
        const rv = (Math.sin(b.h) * b.v - Math.sin(a.h) * a.v) * dx + (-Math.cos(b.h) * b.v + Math.cos(a.h) * a.v) * dy;
        if (rv < -0.5 * d) {
          a.v *= 0.8; b.v *= 0.8;
          if ((a === this.me || b === this.me) && this.msgT < 1) this.say('Collision !');
        }
      }
    }
  }

  // ---------- en ligne ----------
  /** État compact de mon bateau, à envoyer au serveur. */
  snapshotMe(): number[] { return snapOf(this.me); }
  addRemote(id: string, name: string, col: string): void {
    if (this.remotes.has(id)) return;
    const b = mkBoat(this.cls, { id: 100 + this.remotes.size, name, col, x: 0, y: 400, v: 0 });
    b.remote = true; b.pilot.on = false;
    this.boats.push(b);
    this.remotes.set(id, { b, buf: [], seen: Date.now() });
  }
  removeRemote(id: string): void {
    const r = this.remotes.get(id); if (!r) return;
    this.boats.splice(this.boats.indexOf(r.b), 1); this.remotes.delete(id);
  }
  /** Positions reçues du serveur (t : heure du serveur). */
  pushStates(t: number, boats: { id: string; s: number[]; fin: number | null }[], myId: string): void {
    for (const st of boats) {
      if (st.id === myId) continue;
      const r = this.remotes.get(st.id); if (!r) continue;
      r.buf.push({ t, s: st.s }); if (r.buf.length > 30) r.buf.shift();
      r.seen = Date.now();
      if (st.fin != null) r.b.fin = st.fin;
    }
  }
  setRemoteFin(id: string, fin: number | null): void { const r = this.remotes.get(id); if (r && fin != null) r.b.fin = fin; }

  /** Interpolation d'un bateau distant entre deux positions reçues. */
  private updateRemote(b: Boat, rnow: number, dt: number): void {
    const r = [...this.remotes.values()].find(x => x.b === b); if (!r || !r.buf.length) return;
    let A = r.buf[0], B = r.buf[r.buf.length - 1];
    for (let i = 0; i + 1 < r.buf.length; i++) if (r.buf[i].t <= rnow && r.buf[i + 1].t >= rnow) { A = r.buf[i]; B = r.buf[i + 1]; break; }
    const f = B.t > A.t ? clamp((rnow - A.t) / (B.t - A.t), 0, 1.5) : 1;
    applySnap(b, A.s, B.s, f, dt);
  }

  /** Distance restante (m) jusqu'à l'arrivée en suivant le parcours. */
  remaining(b: { x: number; y: number; leg: number; ocs: boolean }): number {
    const c = this.course, N = c.marks.length;
    if (b.leg === 0 || b.ocs) {
      let d = Math.hypot(b.x, b.y), px = 0, py = 0;
      for (const m of c.marks) { d += Math.hypot(m.x - px, m.y - py); px = m.x; py = m.y; }
      return d + Math.hypot(px, py);
    }
    if (b.leg > N) return Math.hypot(b.x - clamp(b.x, c.pin.x, c.cmte.x), b.y);
    let d = Math.hypot(c.marks[b.leg - 1].x - b.x, c.marks[b.leg - 1].y - b.y);
    for (let i = b.leg; i < N; i++) d += Math.hypot(c.marks[i].x - c.marks[i - 1].x, c.marks[i].y - c.marks[i - 1].y);
    const l = c.marks[N - 1];
    return d + Math.hypot(l.x, l.y);
  }

  standings(): Standing[] {
    const L: Standing[] = this.boats.map(b => ({ name: b.name, col: b.col, me: b === this.me, leg: b.leg, fin: b.fin, ocs: b.ocs, d: this.remaining(b) }));
    const sc = (e: Standing) => e.fin != null ? 1e12 - e.fin * 1000 : (e.ocs ? -1e9 : 0) - e.d;
    return L.sort((a, b) => sc(b) - sc(a));
  }

  /** Vitesse sur l'eau du joueur en nœuds (raccourci IHM). */
  get meKn(): number { return this.me.v / KN; }
}

/** Configuration conseillée pour le vent local du bateau. */
const bestFor = (g: Game, b: Boat) => bestConfig(g.cal, Math.max(b.twsAvg, b.tws - 3), Math.abs(b.twa) / D);

/** Pose un bateau entre deux états compacts (f ∈ [0,1]) et fait avancer son sillage. */
export function applySnap(b: Boat, A: ArrayLike<number>, B: ArrayLike<number>, f: number, dt: number): void {
  b.ix = b.x; b.iy = b.y; b.ih = b.h; b.px = b.x; b.py = b.y;
  const o = b as unknown as Record<string, number | boolean>;
  SNAP.forEach((k, i) => {
    const a = A[i] ?? 0, c = B[i] ?? a;
    let v = ANG.has(k) ? a + norm(c - a) * f : a + (c - a) * f;
    if (k === 'head' || k === 'reefs' || k === 'leg') v = Math.round(f < 0.5 ? a : c);
    if (k === 'ocs') o[k] = (f < 0.5 ? a : c) > 0.5;
    else if (k === 'knock') o[k] = (f < 0.5 ? a : c) > 0.5 ? 1 : 0;
    else o[k] = v;
  });
  b.tack = b.twa >= 0 ? 1 : -1;
  b.ideal = { mainSheet: b.mainSheet, trav: b.trav, headSheet: b.headSheet };
  b.wt += dt;
  for (const w of b.wake) w.t += dt;
  while (b.wake.length && b.wake[0].t > 6) b.wake.shift();
  if (b.wt > 0.1 && b.v > 0.8) {
    b.wt = 0; const fx = Math.sin(b.h), fy = -Math.cos(b.h), sx = -fy * 2.2, sy = fx * 2.2;
    b.wake.push({ x: b.x - fx * 9 + sx, y: b.y - fy * 9 + sy, t: 0 }, { x: b.x - fx * 9 - sx, y: b.y - fy * 9 - sy, t: 0 });
  }
}

/** État compact d'un bateau. */
export function snapOf(boat: Boat): number[] {
  const b = boat as unknown as Record<string, number | boolean>;
  return SNAP.map(k => { const v = b[k]; return typeof v === 'boolean' ? (v ? 1 : 0) : k === 'knock' ? ((v as number) > 0 ? 1 : 0) : Math.round((v as number) * 1000) / 1000; });
}
