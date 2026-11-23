// Classes de bateaux. Pour l'instant : l'IMOCA 60 à foils (Vendée Globe, Route du Rhum).
// Le moteur est générique : une autre classe = une autre fiche.
import type { PolarTable } from './polar';

export interface SailDef {
  id: string;
  /** Nom affiché. */
  name: string;
  area: number; // m²
  /** Coefficient de portance maximal et incidence optimale (°). */
  clmax: number; aopt: number;
  /** Traînée de profil. */
  cd0: number;
  /** Hauteur du centre de poussée au-dessus de l'eau (m). */
  ce: number;
  /** Angle d'écoute (° par rapport à l'axe) écoute bordée / choquée en grand. */
  dmin: number; dmax: number;
  /** En dessous de cet angle de vent apparent (°), la voile se dégonfle. */
  awaMin: number;
  /** Durée d'un changement vers cette voile (s, en solitaire, énergie pleine). */
  change: number;
  /** Couleur (voiles de portant). */
  color?: string;
}

export interface BoatClass {
  id: string; name: string;
  loa: number; beam: number; lwl: number;
  /** Déplacement lège (kg), dont le bulbe. */
  mass: number;
  bulb: number; keelDepth: number; keelMax: number; keelTime: number;
  /** Hauteur métacentrique de forme (m). */
  gm: number;
  ballastMax: number; ballastY: number; ballastFill: number; ballastTransfer: number;
  foilArea: number; foilCl: number; foilLever: number; foilTime: number;
  /** Surface latérale anti-dérive (quille + safrans) (m²). */
  latArea: number;
  /** Surface de fardage (m², coefficient de traînée inclus). */
  windage: number;
  wetted: number; cf: number; waveA: number;
  rudLen: number; rudArea: number;
  main: SailDef;
  /** Ris : facteur de surface et de hauteur du centre de poussée, durée pour prendre ce ris. */
  reefs: { area: number; ce: number; time: number }[];
  heads: SailDef[];
  polar: PolarTable;
  /** Dimensions pour le rendu. */
  mastH: number; boomL: number;
}

// Polaire approximative d'un IMOCA à foils de dernière génération (nds).
const TWS = [6, 8, 10, 12, 14, 16, 20, 25, 30];
const TWA = [0, 30, 38, 45, 52, 60, 75, 90, 110, 120, 135, 150, 165, 180];
const V: number[][] = [
  /*   0 */[0, 0, 0, 0, 0, 0, 0, 0, 0],
  /*  30 */[2.2, 3.0, 3.6, 4.0, 4.3, 4.5, 4.7, 4.8, 4.6],
  /*  38 */[4.6, 6.0, 7.0, 7.7, 8.2, 8.5, 8.9, 9.0, 8.7],
  /*  45 */[6.0, 7.6, 8.8, 9.6, 10.2, 10.6, 11.0, 11.2, 10.8],
  /*  52 */[7.0, 8.8, 10.0, 11.0, 11.8, 12.4, 13.0, 13.2, 12.8],
  /*  60 */[7.8, 9.8, 11.4, 12.8, 14.0, 15.0, 16.0, 16.4, 16.0],
  /*  75 */[9.0, 11.4, 13.6, 16.0, 18.4, 20.2, 22.0, 22.5, 22.0],
  /*  90 */[9.5, 12.0, 14.8, 18.0, 21.0, 23.2, 25.5, 26.5, 26.0],
  /* 110 */[9.6, 12.4, 15.6, 19.0, 22.0, 24.4, 27.0, 28.5, 28.0],
  /* 120 */[9.2, 12.0, 15.2, 18.6, 21.6, 24.0, 27.0, 28.5, 28.5],
  /* 135 */[8.2, 10.8, 13.6, 16.6, 19.4, 22.0, 25.0, 27.0, 27.5],
  /* 150 */[6.8, 9.0, 11.4, 14.0, 16.6, 19.0, 22.0, 24.5, 25.5],
  /* 165 */[4.8, 6.3, 7.9, 9.6, 11.3, 13.0, 16.0, 19.0, 20.5],
  /* 180 */[3.9, 5.1, 6.4, 7.7, 9.0, 10.4, 13.0, 16.0, 17.5],
];

export const IMOCA: BoatClass = {
  id: 'imoca', name: 'IMOCA 60',
  loa: 18.28, beam: 5.6, lwl: 17.5,
  mass: 8000, bulb: 3300, keelDepth: 4.6, keelMax: 38, keelTime: 12,
  gm: 2.0,
  ballastMax: 1300, ballastY: 2.5, ballastFill: 50, ballastTransfer: 30,
  foilArea: 1.1, foilCl: 0.38, foilLever: 3.4, foilTime: 10,
  latArea: 3.2,
  windage: 9,
  wetted: 32, cf: 0.0036, waveA: 0.10,
  rudLen: 7.5, rudArea: 0.6,
  main: { id: 'GV', name: 'Grand-voile', area: 150, clmax: 1.4, aopt: 16, cd0: 0.05, ce: 11.5, dmin: -8, dmax: 88, awaMin: 0, change: 0 },
  reefs: [
    { area: 1, ce: 1, time: 0 },
    { area: 0.82, ce: 0.93, time: 60 },
    { area: 0.65, ce: 0.86, time: 60 },
    { area: 0.48, ce: 0.78, time: 70 },
  ],
  heads: [
    { id: 'J1', name: 'J1 (grand foc)', area: 100, clmax: 1.35, aopt: 17, cd0: 0.04, ce: 9, dmin: 9, dmax: 42, awaMin: 18, change: 50 },
    { id: 'J2', name: 'J2 (foc moyen)', area: 75, clmax: 1.32, aopt: 17, cd0: 0.04, ce: 8.2, dmin: 9, dmax: 42, awaMin: 18, change: 50 },
    { id: 'J3', name: 'J3 (trinquette)', area: 45, clmax: 1.28, aopt: 17, cd0: 0.04, ce: 6.8, dmin: 10, dmax: 42, awaMin: 18, change: 45 },
    { id: 'C0', name: 'Code 0', area: 185, clmax: 1.25, aopt: 20, cd0: 0.05, ce: 10.5, dmin: 14, dmax: 65, awaMin: 32, change: 60, color: '#e9eef2' },
    { id: 'A3', name: 'Gennaker A3', area: 290, clmax: 1.5, aopt: 26, cd0: 0.08, ce: 12.5, dmin: 22, dmax: 115, awaMin: 58, change: 75, color: '#ff6a1f' },
  ],
  polar: { tws: TWS, twa: TWA, v: V },
  mastH: 29, boomL: 7.2,
};
