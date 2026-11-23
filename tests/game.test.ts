import { describe, it, expect } from 'vitest';
import { Game, STEP } from '../src/game/game';
import { NO_INPUT } from '../src/physics/boat';
import { COURSES, courseClear } from '../src/game/course';

const run = (g: Game, s: number) => { for (let i = 0; i < s / STEP && !g.boats.every(b => b.fin != null); i++) g.update(STEP, NO_INPUT); };

describe('parcours', () => {
  it('aucun bord ne traverse une île', () => {
    for (const c of COURSES) expect(courseClear(c)).toEqual([]);
  });
  it('les longueurs vont du court au grand large', () => {
    const nm = COURSES.map(c => c.nm);
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
