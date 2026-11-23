// Diagnostic du réglage de voile, partagé par le panneau de réglage et le tableau de bord.
import { D, clamp } from '../util/math';
import { depower, type Boat } from '../physics/boat';

export interface TrimState { tgt: number; d: number; ad: number; txt: string; col: string; lvl: 0 | 1 | 2 }

export function trimState(me: Boat): TrimState {
  const tgt = clamp(me.opt0 + depower(me), 0, 1), d = me.sheet - tgt, ad = Math.abs(d);
  let txt: string, col: string, lvl: 0 | 1 | 2;
  if (me.cap > 0) { txt = 'DESSALÉ'; col = '#e8384f'; lvl = 2; }
  else if (Math.abs(me.twa) < 32 * D) { txt = 'FACE AU VENT · ABATS'; col = '#e8384f'; lvl = 2; }
  else if (me.heelN > 0.85 && d < 0.1) { txt = 'CHOQUE ▼  ça gîte trop'; col = '#f4a261'; lvl = 1; }
  else if (d > 0.13) { txt = 'BORDE ▲'; col = ad > 0.25 ? '#e8384f' : '#f4a261'; lvl = ad > 0.25 ? 2 : 1; }
  else if (d < -0.13) { txt = 'CHOQUE ▼'; col = ad > 0.25 ? '#e8384f' : '#f4a261'; lvl = ad > 0.25 ? 2 : 1; }
  else if (ad > 0.06) { txt = d > 0 ? 'Borde un poil' : 'Choque un poil'; col = '#c5e86c'; lvl = 0; }
  else { txt = 'RÉGLAGE PARFAIT'; col = '#3ddc97'; lvl = 0; }
  return { tgt, d, ad, txt, col, lvl };
}
