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
