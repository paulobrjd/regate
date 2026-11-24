import { describe, it, expect } from 'vitest';
import { IMOCA } from '../src/physics/classes';
import { polarSpeed, vmgAngles } from '../src/physics/polar';
import { calibration, bestConfig, equilibriumSpeed } from '../src/physics/model';
import { mkBoat, stepBoat, cmdHead, cmdPilotTack, NO_INPUT, type Boat, type StepEnv } from '../src/physics/boat';
import { applyAssist, newMem } from '../src/game/assist';
import { KN } from '../src/physics/units';
import { norm, makeRng, D } from '../src/util/math';

const cal = calibration(IMOCA);

/** Plan d'eau d'essai : vent constant venant du nord, mer plate. */
function env(tws: number, events: string[] = []): StepEnv {
  return {
    wd: 0, wind: () => tws, wave: () => 0, waveC: 10, cal, rnd: makeRng(1), obstacles: [], ground: () => false,
    event: (_b, e) => { events.push(e); },
  };
}
/** Bateau au pilote (angle au vent), réglé par l'assistance complète sauf ce qu'on bloque. */
function boatAt(twaDeg: number, tws: number): Boat {
  const b = mkBoat(IMOCA, { x: 0, y: 0, h: twaDeg * D, v: polarSpeed(IMOCA.polar, tws, twaDeg) * KN });
  b.pilot = { on: true, mode: 'vent', set: twaDeg * D };
  b.tack = b.lastTack = Math.sign(twaDeg) || 1;
  const c = bestConfig(cal, tws, Math.abs(twaDeg));
  b.head = c.head; b.reefs = c.reefs;
  return b;
}
function run(b: Boat, e: StepEnv, s: number, opts: { assist?: boolean; sails?: boolean; onStep?: (b: Boat) => void } = {}): void {
  const mem = newMem();
  for (let i = 0; i < s * 60; i++) {
    if (opts.assist !== false) applyAssist(b, { sheets: true, systems: true, sails: !!opts.sails }, cal, mem, i / 60, 1 / 60);
    stepBoat(b, 1 / 60, NO_INPUT, e);
    opts.onStep?.(b);
  }
}
const kn = (b: Boat) => b.v / KN;

describe('polaires', () => {
  it('interpole entre les points de la table', () => {
    expect(polarSpeed(IMOCA.polar, 12, 90)).toBeCloseTo(18);
    expect(polarSpeed(IMOCA.polar, 13, 90)).toBeCloseTo(19.5);
    expect(polarSpeed(IMOCA.polar, 12, -90)).toBeCloseTo(18);
    expect(polarSpeed(IMOCA.polar, 3, 90)).toBeCloseTo(9.5 / 2);
  });
  it('donne des angles de VMG réalistes pour un IMOCA', () => {
    const a = vmgAngles(IMOCA.polar, 14);
    expect(a.up).toBeGreaterThan(40); expect(a.up).toBeLessThan(55);
    expect(a.down).toBeGreaterThan(130); expect(a.down).toBeLessThan(165);
  });
});

describe('modèle de forces calé sur la polaire', () => {
  it('la vitesse d\'équilibre avec la bonne voilure colle à la polaire (±3 %)', () => {
    for (const tws of [8, 12, 16, 20, 25]) for (const twa of [45, 60, 90, 120, 150]) {
      const v = equilibriumSpeed(IMOCA, bestConfig(cal, tws, twa), tws, twa) / KN, p = polarSpeed(IMOCA.polar, tws, twa);
      expect(Math.abs(v / p - 1), `${tws} nds, ${twa}° : ${v.toFixed(1)} au lieu de ${p}`).toBeLessThan(0.03);
    }
  });
  it('le tableau de croisement des voiles est cohérent', () => {
    const id = (tws: number, twa: number) => IMOCA.heads[bestConfig(cal, tws, twa).head].id;
    expect(id(8, 45)).toBe('J1');
    expect(['J2', 'J3']).toContain(id(30, 45));
    expect(id(12, 150)).toBe('A3');
    expect(['C0', 'J1']).toContain(id(12, 110));
    expect(bestConfig(cal, 25, 45).reefs).toBeGreaterThanOrEqual(2);
    expect(bestConfig(cal, 8, 45).reefs).toBe(0);
    expect(bestConfig(cal, 14, 90).foilLee).toBe(1);
  });
  it('une mauvaise voile fait perdre beaucoup de vitesse', () => {
    const good = bestConfig(cal, 14, 50), bad = { ...good, head: 4 }; // gennaker au près
    expect(equilibriumSpeed(IMOCA, bad, 14, 50)).toBeLessThan(equilibriumSpeed(IMOCA, good, 14, 50) * 0.7);
  });
});

describe('dynamique du bateau', () => {
  it('au pilote, réglé, le bateau atteint sa polaire (±7 %)', () => {
    for (const [tws, twa] of [[14, 50], [14, 100], [14, 145], [20, 60]]) {
      const b = boatAt(twa, tws); run(b, env(tws), 90);
      expect(Math.abs(kn(b) / polarSpeed(IMOCA.polar, tws, twa) - 1), `${tws} nds ${twa}° → ${kn(b).toFixed(1)}`).toBeLessThan(0.07);
    }
  });
  it('un virement fait perdre de la vitesse, puis le bateau relance', () => {
    const b = boatAt(48, 14), e = env(14); run(b, e, 60);
    const v0 = kn(b); let vmin = v0;
    cmdPilotTack(b, 0);
    run(b, e, 40, { onStep: x => { vmin = Math.min(vmin, kn(x)); } });
    expect(b.twa).toBeLessThan(0);
    expect(vmin).toBeLessThan(v0 * 0.75);
    run(b, e, 60);
    expect(kn(b)).toBeGreaterThan(v0 * 0.9);
  });
  it('quille sous le vent après un virement : plus de gîte, moins de vitesse', () => {
    const ref = boatAt(50, 18), bad = boatAt(50, 18), e = env(18);
    run(ref, e, 60); run(bad, e, 5);
    bad.keel = bad.keelT = 1; // le vent vient de bâbord : tribord est sous le vent
    run(bad, e, 55, { assist: false });
    expect(bad.heel).toBeGreaterThan(ref.heel + 5 * D);
    expect(kn(bad)).toBeLessThan(kn(ref) * 0.95);
  });
  it('sans foil, l\'IMOCA va moins vite au travers dans la brise', () => {
    const ref = boatAt(95, 16), nf = boatAt(95, 16), e = env(16);
    run(ref, e, 60); run(nf, e, 2);
    nf.foilP = nf.foilS = nf.foilPT = nf.foilST = 0;
    run(nf, e, 60, { onStep: x => { x.foilST = x.foilS = 0; } });
    expect(kn(nf)).toBeLessThan(kn(ref) * 0.95);
  });
  it('une écoute trop bordée au portant ralentit', () => {
    const ref = boatAt(120, 14), ov = boatAt(120, 14), e = env(14);
    run(ref, e, 60); run(ov, e, 60, { onStep: x => { x.mainSheet = x.headSheet = 0.05; } });
    expect(kn(ov)).toBeLessThan(kn(ref) * 0.85);
  });
  it('un changement de voile prend du temps et coûte de la vitesse', () => {
    const b = boatAt(100, 12), e = env(12); run(b, e, 60);
    const v0 = kn(b), from = b.head;
    expect(cmdHead(b, from === 3 ? 0 : 3)).toBe(true);
    let vmin = v0; run(b, e, 20, { onStep: x => { vmin = Math.min(vmin, kn(x)); } });
    expect(b.task).not.toBeNull();
    expect(vmin).toBeLessThan(v0 * 0.92);
    expect(b.energy).toBeLessThan(1);
    run(b, e, 60);
    expect(b.task).toBeNull();
  });
  it('trop de toile au reaching dans le gros temps : départ au lof ou chavirage', () => {
    const b = boatAt(100, 28), ev: string[] = [], e = env(28, ev);
    b.head = 4; b.reefs = 0; b.keel = b.keelT = 0;
    const mem = newMem();
    run(b, e, 30, { assist: false, onStep: x => applyAssist(x, { sheets: true, systems: false, sails: false }, cal, mem, 0, 1 / 60) });
    expect(ev.some(x => x === 'broach' || x === 'knockdown')).toBe(true);
  });
  it('face au vent, le bateau s\'arrête, puis abat', () => {
    const b = boatAt(5, 14); b.pilot.on = false; b.v = 5 * KN;
    const e = env(14); run(b, e, 10, { assist: false });
    expect(Math.abs(kn(b))).toBeLessThan(1.6);
    run(b, e, 60, { assist: false });
    expect(Math.abs(norm(b.h))).toBeGreaterThan(30 * D);
  });
});

import { WindField, METEO } from '../src/physics/wind';
describe('événements météo', () => {
  const plan = (seed: number) => { const w = new WindField(seed, METEO[1]); w.planEvents(1800, { x: 0, y: -1500 }, 3000, makeRng(seed * 7)); return w; };
  it('même graine, mêmes événements (en ligne, tout le monde vit la même course)', () => {
    expect(JSON.stringify(plan(4.4).events)).toBe(JSON.stringify(plan(4.4).events));
    expect(plan(4.4).events.length).toBeGreaterThanOrEqual(3);
  });
  it('coup de vent : le vent forcit ; molle : il tombe ; bascule : il tourne ; grain : rafale sur place', () => {
    const kinds = new Set<string>();
    for (let s = 1; s < 30; s++) {
      const w = plan(s); w.events.forEach(e => kinds.add(e.kind));
      for (const e of w.events) {
        const mid = e.t0 + e.dur / 2, before = e.t0 - 5;
        if (e.kind === 'coup') expect(w.base(mid)).toBeGreaterThan(w.base(before) * 1.3);
        if (e.kind === 'molle') expect(w.base(mid)).toBeLessThan(w.base(before) * 0.7);
        if (e.kind === 'bascule') { const calm = new WindField(s, METEO[1]); expect(Math.abs(w.dir(mid) - calm.dir(mid))).toBeGreaterThan(0.25); }
        if (e.kind === 'grain') { const c = w.grainCenter(e, mid); expect(w.speedAt(c.x, c.y, mid) - new WindField(s, METEO[1]).speedAt(c.x, c.y, mid)).toBeGreaterThan(9); }
      }
    }
    expect(kinds.size).toBe(4);
  });
});
