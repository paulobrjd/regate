// État global de l'application (préférences et partie en cours).
import type { Game } from './game/game';

export type View = 'pov' | 'chase' | 'tv' | 'top';

export const app = {
  g: null as Game | null,
  view: 'pov' as View,
  auto: false,
  soundOn: true,
  best: null as number | null,
};
