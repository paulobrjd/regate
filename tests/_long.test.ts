import { it } from 'vitest';
import { Game, STEP } from '../src/game/game';
import { NO_INPUT } from '../src/physics/boat';
it('long', () => {
  for (const [course, met] of [['iles', 1], ['large', 2], ['triangle', 3], ['banane', 0]] as const) {
    const g = new Game({ mode: 'solo', demo: true, seed: 7.7, bots: 4, lvl: 1, course, met });
    let ground = 0, knock = 0;
    g.onSfx = () => {};
    const orig = (g as any).boatEvent.bind(g);
    (g as any).env.event = (b: any, e: string, i: string) => { if (e === 'aground') ground++; if (e === 'knockdown') knock++; orig(b, e, i); };
    while (g.t < 26000 && !g.boats.every(b => b.fin != null)) g.update(STEP, NO_INPUT);
    console.log(course, 'met', met, 'fins', g.boats.map(b => b.fin == null ? 'NON' : (b.fin / 60).toFixed(0) + ' min').join(', '), 'échouages', ground, 'chavirages', knock);
  }
}, 300000);
