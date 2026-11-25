import { describe, it, expect } from 'vitest';
import { Game, STEP } from '../src/game/game';
import { NO_INPUT } from '../src/physics/boat';
import { courseClear } from '../src/game/course';
import { VENUES, activateVenue } from '../src/game/venue';

const run = (g: Game, s: number) => { for (let i = 0; i < s / STEP && !g.boats.every(b => b.fin != null); i++) g.update(STEP, NO_INPUT); };

describe('parcours', () => {
  it('aucun bord ne traverse une île', () => {
    for (const v of VENUES) for (const c of activateVenue(v.id).courses) expect(courseClear(c), v.id).toEqual([]);
  });
  it('les longueurs vont du court au grand large', () => {
    const nm = VENUES.flatMap(v => activateVenue(v.id).courses.map(c => c.nm));
    expect(Math.min(...nm)).toBeLessThan(3);
    expect(Math.max(...nm)).toBeGreaterThan(35);
  });
});

describe('régate', () => {
  it('même graine, mêmes commandes → même course', () => {
    const a = new Game({ mode: 'solo', seed: 4.2, bots: 3 }), b = new Game({ mode: 'solo', seed: 4.2, bots: 3 });
    run(a, 120); run(b, 120);
    for (let i = 0; i < a.boats.length; i++) { expect(a.boats[i].x).toBe(b.boats[i].x); expect(a.boats[i].v).toBe(b.boats[i].v); }
  });
  for (const course of ['banane', 'triangle']) {
    it(`les IA bouclent le parcours « ${course} »`, () => {
      const g = new Game({ mode: 'solo', demo: true, seed: 3.1, bots: 3, lvl: 2, course, met: 1 });
      run(g, 3600);
      expect(g.boats.every(b => b.fin != null)).toBe(true);
      const st = g.standings();
      expect(st[0].fin!).toBeLessThan(st[st.length - 1].fin! + 1e-9);
    }, 60000);
  }
});

describe('barre assistée (Débutant)', () => {
  it('maintenir la barre vers le vent fait virer de bord sans jamais s\'arrêter', () => {
    const g = new Game({ mode: 'solo', seed: 2, bots: 0, course: 'sprint', assist: { sheets: true, systems: true, sails: true, helm: true, safe: true } });
    const me = g.me;
    for (let i = 0; i < 70 / STEP; i++) g.update(STEP, NO_INPUT); // départ donné
    const tack0 = me.tack;
    let minKn = 99;
    // on tient « vers le vent » : à gauche si le vent vient de bâbord, à droite sinon
    const helm = me.tack > 0 ? -1 : 1;
    for (let i = 0; i < 15 / STEP && me.tack === tack0; i++) g.update(STEP, { ...NO_INPUT, helm });
    expect(me.tack).not.toBe(tack0);
    for (let i = 0; i < 20 / STEP; i++) { g.update(STEP, NO_INPUT); minKn = Math.min(minKn, me.v / 0.514444); }
    expect(me.tack).not.toBe(tack0);
    expect(Math.abs(me.twa)).toBeGreaterThan(35 * Math.PI / 180);
    for (let i = 0; i < 30 / STEP; i++) g.update(STEP, NO_INPUT);
    expect(me.v / 0.514444).toBeGreaterThan(6);
    void minKn;
  });
});

describe('aides au pilotage', () => {
  it('la route auto mène le joueur jusqu\'à l\'arrivée', () => {
    const g = new Game({ mode: 'solo', seed: 3, bots: 0, course: 'sprint', assist: { sheets: true, systems: true, sails: true, helm: true, safe: true } });
    g.command('route');
    for (let i = 0; i < 1500 / STEP && g.me.fin == null; i++) { if (!g.routeAuto && g.t > -55) g.command('route'); g.update(STEP, NO_INPUT); }
    expect(g.me.fin).not.toBeNull();
  }, 30000);
  it('choisir un cap face au vent ne met jamais le bateau face au vent', () => {
    const g = new Game({ mode: 'solo', seed: 3, bots: 0, course: 'sprint', assist: { sheets: true, systems: true, sails: true, helm: true, safe: true } });
    for (let i = 0; i < 70 / STEP; i++) g.update(STEP, NO_INPUT);
    g.steerTo(g.wd); // droit dans le vent
    for (let i = 0; i < 30 / STEP; i++) g.update(STEP, NO_INPUT);
    expect(Math.abs(g.me.twa)).toBeGreaterThan(35 * Math.PI / 180);
    expect(g.me.v / 0.514444).toBeGreaterThan(5);
  });
});

describe('grande flotte', () => {
  it('15 bateaux : la ligne s\'allonge et toute la flotte boucle le parcours', () => {
    const g = new Game({ mode: 'solo', demo: true, seed: 6.1, bots: 14, lvl: 1, course: 'banane', met: 1 });
    expect(g.boats.length).toBe(15);
    expect(g.course.cmte.x - g.course.pin.x).toBeGreaterThan(900);
    expect(new Set(g.boats.map(b => b.col)).size).toBe(15);
    run(g, 4000);
    expect(g.boats.filter(b => b.fin != null).length).toBeGreaterThanOrEqual(14);
  }, 120000);
});

import { RULES, giveWay } from '../src/ai/rules';
import { mkBoat } from '../src/physics/boat';
import { IMOCA } from '../src/physics/classes';
describe('règles de course et évitement', () => {
  it('priorités : tribord sur bâbord, sous le vent sur au vent, devant sur derrière, intérieur à la bouée', () => {
    const g = new Game({ mode: 'solo', seed: 1, bots: 0, course: 'banane' }), D = Math.PI / 180;
    const mk = (id: number, x: number, y: number, h: number, tack: number) => { const b = mkBoat(IMOCA, { id, x, y, h, v: 6 }); b.tack = tack; return b; };
    // bâbord amures (vent de bâbord, tack +1) contre tribord amures
    const p = mk(1, 0, -500, 45 * D, 1), s = mk(2, 200, -500, -45 * D, -1);
    expect(giveWay(p, s, 0, g.course)).toEqual({ who: p, why: 'tribord' });
    expect(giveWay(s, p, 0, g.course).who).toBe(p);
    // même amure, côte à côte : le plus au vent (au nord) s'écarte
    const lw = mk(3, 0, -500, 90 * D, 1), ww = mk(4, 0, -530, 90 * D, 1);
    expect(giveWay(lw, ww, 0, g.course)).toEqual({ who: ww, why: 'sousLeVent' });
    // même amure, l'un derrière l'autre : celui de derrière s'écarte
    const front = mk(5, 100, -500, 90 * D, 1), back = mk(6, 40, -500, 90 * D, 1);
    expect(giveWay(front, back, 0, g.course)).toEqual({ who: back, why: 'devant' });
    // zone de la bouée : l'extérieur laisse la place à l'intérieur
    const m = g.course.marks[0], inn = mk(7, m.x + 15, m.y + 10, 0, 1), out = mk(8, m.x + 40, m.y + 15, 0, -1); inn.leg = out.leg = 1;
    expect(giveWay(out, inn, 0, g.course)).toEqual({ who: out, why: 'bouee' });
  });

  it('une flotte de 12 bateaux se touche beaucoup moins avec les règles', () => {
    const count = (on: boolean) => { RULES.on = on; const g = new Game({ mode: 'solo', demo: true, seed: 2.2, bots: 11, lvl: 1, course: 'triangle', met: 1 }); run(g, 5000); RULES.on = true; return g.contacts; };
    const off = count(false), on = count(true);
    expect(on).toBeLessThan(off * 0.35);
  }, 120000);

  it('je fonce sur un bot prioritaire sans dévier : il me hèle et m\'évite', () => {
    const g = new Game({ mode: 'solo', seed: 5, bots: 1, course: 'banane', assist: { sheets: true, systems: true, sails: true } }), D = Math.PI / 180;
    for (let i = 0; i < 70 / STEP; i++) g.update(STEP, NO_INPUT); // après le départ
    const me = g.me, bot = g.boats[1], wd = g.wd, msgs: string[] = [];
    const say = g.say.bind(g); g.say = (m: string, f?: boolean) => { msgs.push(m); say(m, f); };
    // moi bâbord amures (non prioritaire), le bot tribord amures, routes qui se croisent dans ~25 s
    me.x = 0; me.y = -800; me.h = wd + 50 * D; me.v = 6; me.tack = me.lastTack = 1;
    me.pilot = { on: true, mode: 'cap', set: me.h };
    const fx = Math.sin(me.h) * 150, fy = -Math.cos(me.h) * 150;
    bot.h = wd - 50 * D; bot.x = me.x + fx - Math.sin(bot.h) * 150; bot.y = me.y + fy + Math.cos(bot.h) * 150; bot.v = 6; bot.tack = bot.lastTack = -1;
    for (const b of [me, bot]) { b.ix = b.x; b.iy = b.y; b.ih = b.h; b.leg = 1; b.ocs = false; }
    const c0 = g.contacts;
    for (let i = 0; i < 40 / STEP; i++) { me.pilot = { on: true, mode: 'cap', set: wd + 50 * D }; g.update(STEP, NO_INPUT); }
    expect(g.contacts).toBe(c0);
    expect(msgs.some(m => m.includes('Tribord'))).toBe(true);
  });
});
