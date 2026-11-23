import { describe, it, expect } from 'vitest';
import { Game, STEP, type Input } from '../src/game/game';
import { WindField, METEO } from '../src/physics/wind';
import { polar } from '../src/physics/polar';
import { norm, makeRng } from '../src/util/math';

const idle: Input = { left: false, right: false, up: false, down: false, auto: true };
const run = (g: Game, seconds: number, input = idle) => { for (let i = 0; i < seconds / STEP; i++) g.update(STEP, input); };

describe('outils', () => {
  it('norm ramène dans [-π, π[', () => {
    expect(norm(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(norm(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
  });
  it('le générateur à graine est reproductible', () => {
    const a = makeRng(42), b = makeRng(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});

describe('polaire du prototype', () => {
  it('vitesse nulle face au vent, maximale au travers / grand largue', () => {
    expect(polar(20)).toBe(0);
    expect(polar(45)).toBeCloseTo(0.72);
    expect(polar(100)).toBeCloseTo(1);
    expect(polar(180)).toBeCloseTo(0.76);
  });
});

describe('vent', () => {
  it('est déterministe et jamais inférieur au vent de base', () => {
    const a = new WindField(3.3, METEO[1]), b = new WindField(3.3, METEO[1]);
    for (let i = 0; i < 50; i++) {
      const x = i * 97 - 2000, y = i * -53, t = i * 3;
      expect(a.speedAt(x, y, t)).toBe(b.speedAt(x, y, t));
      expect(a.speedAt(x, y, t)).toBeGreaterThanOrEqual(METEO[1].base);
    }
    expect(a.dir(10)).toBe(b.dir(10));
  });
});

describe('simulation', () => {
  it('même graine, mêmes commandes → même course', () => {
    const g1 = new Game({ mode: 'solo', seed: 4.2, bots: 3 }), g2 = new Game({ mode: 'solo', seed: 4.2, bots: 3 });
    run(g1, 60); run(g2, 60);
    for (let i = 0; i < g1.boats.length; i++) {
      expect(g1.boats[i].x).toBe(g2.boats[i].x);
      expect(g1.boats[i].y).toBe(g2.boats[i].y);
      expect(g1.boats[i].v).toBe(g2.boats[i].v);
    }
  });

  it('le bateau prend de la vitesse au travers avec le réglage auto', () => {
    const g = new Game({ mode: 'solo', seed: 1, bots: 0 });
    run(g, 20);
    expect(g.me.v).toBeGreaterThan(3);
  });

  it('les IA terminent la course (échelle compressée du prototype : ≈ 1 à 2 min)', () => {
    const g = new Game({ mode: 'solo', seed: 2.5, bots: 4, lvl: 2, met: 1 });
    run(g, 30 + 300);
    const fin = g.boats.filter(b => b.ai && b.fin != null);
    expect(fin.length).toBeGreaterThanOrEqual(3);
    for (const b of fin) expect(b.fin!).toBeGreaterThan(45);
    const st = g.standings();
    expect(st[0].fin).not.toBeNull();
  });
});
