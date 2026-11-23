// Assistances : l'« équipier virtuel » qui règle les écoutes, la quille, les foils, les ballasts,
// et choisit voiles et ris. Les IA l'utilisent en entier ; le joueur choisit ce qu'il délègue.
import { clamp, D } from '../util/math';
import { bestConfig, type Calibration } from '../physics/model';
import { cmdHead, cmdReef, type Boat } from '../physics/boat';

export interface Assist { sheets: boolean; systems: boolean; sails: boolean }
export const ASSISTS: Record<string, { label: string; a: Assist }> = {
  debutant: { label: 'Débutant : tout est automatique sauf la barre', a: { sheets: true, systems: true, sails: true } },
  equipier: { label: 'Équipier : tu règles les écoutes, tu choisis voiles et ris', a: { sheets: false, systems: true, sails: false } },
  skipper: { label: 'Skipper : tout à la main (quille, foils, ballasts…)', a: { sheets: false, systems: false, sails: false } },
};

export interface AssistMem { headSince: number; headWant: number; reefSince: number; reefWant: number; sysT: number }
export const newMem = (): AssistMem => ({ headSince: 0, headWant: -1, reefSince: 0, reefWant: -1, sysT: 0 });

/** err : erreur de réglage (IA moins douées), en fraction d'écoute. */
export function applyAssist(b: Boat, a: Assist, cal: Calibration, mem: AssistMem, t: number, dt: number, err = 0): void {
  const cfg = bestConfig(cal, b.tws, Math.abs(b.twa) / D);
  if (a.sheets && b.knock <= 0) {
    const r = 0.35 * dt;
    b.mainSheet += clamp(clamp(b.ideal.mainSheet + err, 0, 1) - b.mainSheet, -r, r);
    b.headSheet += clamp(clamp(b.ideal.headSheet + err, 0, 1) - b.headSheet, -r, r);
    b.trav += clamp(b.ideal.trav - b.trav, -0.8 * dt, 0.8 * dt);
  }
  if (a.systems) {
    mem.sysT -= dt;
    if (mem.sysT <= 0) {
      mem.sysT = 2;
      const port = b.tack > 0;
      // quille au vent (valeur absolue : bâbord = -1)
      b.keelT = (port ? -1 : 1) * cfg.keelW;
      if (port) { b.foilST = cfg.foilLee; b.foilPT = 0; } else { b.foilPT = cfg.foilLee; b.foilST = 0; }
      if (port) { b.ballPT = cfg.ballW; b.ballST = 0; } else { b.ballST = cfg.ballW; b.ballPT = 0; }
    }
  }
  if (a.sails && !b.task && b.knock <= 0 && b.aground <= 0) {
    // voiles et ris : on décide sur le vent moyen, pas sur chaque risée
    const cfg = bestConfig(cal, Math.max(b.twsAvg, b.tws - 3), Math.abs(b.twa) / D);
    if (cfg.head !== mem.headWant) { mem.headWant = cfg.head; mem.headSince = t; }
    if (cfg.reefs !== mem.reefWant) { mem.reefWant = cfg.reefs; mem.reefSince = t; }
    if (cfg.head !== b.head && t - mem.headSince > 12) cmdHead(b, cfg.head);
    else if (cfg.reefs !== b.reefs && t - mem.reefSince > 10) cmdReef(b, cfg.reefs - b.reefs);
  }
}
