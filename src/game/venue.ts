// Plans d'eau : chacun a ses îles, ses parcours, sa houle, son vent et son décor.
import { setIslands, type Island } from '../physics/world';
import { build, type Course, type CourseDef } from './course';

export interface Venue {
  id: string; name: string; desc: string;
  islands: Island[];
  courses: (I: Island[]) => CourseDef[];
  /** Facteur de houle, d'amplitude des bascules, de force des risées. */
  waves: number; shifts: number; gusts: number;
  /** Direction de la houle par rapport au vent (rad) : une mer croisée est plus réaliste. */
  swell?: number;
  /** Couleur de l'eau profonde (r,g,b). */
  water: [number, number, number];
  decor: { windFarm?: boolean; cargo?: boolean; dolphins?: boolean; mountains?: boolean; spectators?: boolean };
}

const I = (name: string, x: number, y: number, r: number, h: number, seed: number, more: Partial<Island> = {}): Island => ({ name, x, y, r, h, seed, ...more });

export const VENUES: Venue[] = [
  {
    id: 'baie', name: 'Baie des Îles', desc: 'Un grand plan d\'eau ouvert sur le large, semé d\'îles habitées.',
    islands: [
      I('Île Verte', -4200, -7500, 900, 70, 1.3, { village: 22 }),
      I('Île du Phare', 3500, -11000, 700, 55, 2.7, { lighthouse: true, village: 20 }),
      I('Rocher du Nord', -2000, -37000, 450, 35, 4.1, { lighthouse: true }),
      I('Les Moines', 5200, -2500, 380, 25, 5.9, { village: 6 }),
      I('Île Longue', -6500, 1500, 1300, 90, 7.2, { village: 45, church: true, harbour: true }),
      I('Île aux Oiseaux', 7000, -17000, 1000, 80, 8.8, { village: 18 }),
      I('Grand Banc', -7500, -22000, 1500, 110, 3.3),
    ],
    courses: I => [
      ['sprint', 'Sprint', 'Un mille au près, demi-tour, retour à fond au portant. Court et intense.', [{ x: 0, y: -950, name: 'Bouée au vent', side: 'port' }]],
      ['banane', 'Banane courte', 'Un bord de près jusqu\'à la bouée au vent, puis retour au portant.', [{ x: 0, y: -1850, name: 'Bouée au vent', side: 'port' }]],
      ['triangle', 'Triangle', 'Près, travers, largue : le parcours olympique.', [
        { x: 0, y: -3000, name: 'Bouée 1 (au vent)', side: 'port' }, { x: -2300, y: -1600, name: 'Bouée 2 (dégagement)', side: 'port' }, { x: 0, y: -450, name: 'Bouée 3 (sous le vent)', side: 'port' }]],
      ['banane2', 'Banane deux tours', 'Deux allers-retours entre la bouée au vent et la bouée sous le vent.', [
        { x: 0, y: -2600, name: 'Bouée au vent', side: 'port' }, { x: 0, y: -380, name: 'Bouée sous le vent', side: 'port' }, { x: 0, y: -2600, name: 'Bouée au vent (2e tour)', side: 'port' }]],
      ['iles', 'Tour des îles', 'Côtier : laisse l\'Île Verte puis l\'Île du Phare à tribord.', [
        { x: I[0].x, y: I[0].y, name: 'Île Verte', side: 'stbd', island: 0 }, { x: I[1].x, y: I[1].y, name: 'Île du Phare', side: 'stbd', island: 1 }]],
      ['zigzag', 'Zigzag des balises', 'Quatre balises en quinconce à laisser alternativement à bâbord et à tribord : virements et empannages à la chaîne.', [
        { x: 350, y: -850, name: 'Balise 1', side: 'port' }, { x: -350, y: -1750, name: 'Balise 2', side: 'stbd' },
        { x: 350, y: -2650, name: 'Balise 3', side: 'port' }, { x: -350, y: -3550, name: 'Balise 4', side: 'stbd' }]],
      ['huit', 'Le Huit', 'Deux bouées à tourner en sens contraire : le parcours dessine un 8 sur l\'eau.', [
        { x: -750, y: -1700, name: 'Bouée Ouest', side: 'port' }, { x: 750, y: -1700, name: 'Bouée Est', side: 'stbd' }]],
      ['moines', 'Tour des Moines', 'Va enrouler l\'îlot des Moines, ses maisons et ses rochers, laisse-le à tribord.', [
        { x: I[3].x, y: I[3].y, name: 'Les Moines', side: 'stbd', island: 3 }]],
      ['phare', 'Aller-retour au Phare', 'Un long bord jusqu\'à l\'Île du Phare, que tu laisses à tribord, puis retour au portant.', [
        { x: I[1].x, y: I[1].y, name: 'Île du Phare', side: 'stbd', island: 1 }]],
      ['large', 'Raid du Rocher du Nord', 'Grand large : remonte au Rocher du Nord, laisse-le à tribord et redescends.', [
        { x: I[2].x, y: I[2].y, name: 'Rocher du Nord', side: 'stbd', island: 2 }]],
    ],
    waves: 1, shifts: 1, gusts: 1, swell: -0.45, water: [0.02, 0.17, 0.28],
    decor: { windFarm: true, cargo: true, dolphins: true, spectators: true },
  },
  {
    id: 'corsaires', name: 'Île aux Corsaires', desc: 'Une grande île sauvage, son port et son phare : on en fait le tour.',
    islands: [
      I('Île aux Corsaires', 0, -6000, 2600, 110, 3.7, { lighthouse: true, village: 60, church: true, harbour: true }),
      I('Les Chiens', -3600, -1400, 200, 14, 6.1),
      I('Roc du Nord', 2600, -12600, 260, 18, 4.4),
    ],
    courses: I => [
      ['tour', 'Tour de l\'île', 'Le grand classique : fais le tour complet de l\'île en la laissant à tribord.', [
        { x: -4900, y: -6000, name: 'Bouée de la pointe Ouest', side: 'stbd' }, { x: 0, y: -11500, name: 'Bouée du Nord', side: 'stbd' }, { x: 4900, y: -6000, name: 'Bouée de la pointe Est', side: 'stbd' }]],
      ['chiens', 'Tour des Chiens', 'Un aller-retour court autour des rochers des Chiens.', [
        { x: I[1].x, y: I[1].y, name: 'Les Chiens', side: 'port', island: 1 }]],
      ['pointe', 'Pointe Ouest et retour', 'Remonte jusqu\'à la bouée de la pointe Ouest, au pied des falaises, et redescends.', [
        { x: -4900, y: -6000, name: 'Bouée de la pointe Ouest', side: 'stbd' }]],
      ['crique', 'Triangle de la crique', 'Un triangle serré au pied des falaises, sous le vent de l\'île.', [
        { x: 0, y: -1900, name: 'Bouée de la crique', side: 'port' }, { x: -2000, y: -900, name: 'Bouée Ouest', side: 'port' }, { x: 0, y: -350, name: 'Bouée du port', side: 'port' }]],
    ],
    waves: 1.25, shifts: 1.2, gusts: 1.1, swell: 0.7, water: [0.02, 0.15, 0.25],
    decor: { cargo: true, dolphins: true, spectators: true },
  },
  {
    id: 'archipel', name: 'Archipel des Fous', desc: 'Une dizaine d\'îlots et de cailloux : un slalom où il faut bien choisir sa route.',
    islands: [
      I('Îlot de la Porte', -1600, -2300, 280, 22, 1.9),
      I('Le Grand Fou', 1400, -3300, 340, 28, 2.2, { village: 5 }),
      I('Les Moutons', -1250, -5000, 260, 18, 5.1),
      I('Phare des Fous', 1600, -6300, 400, 34, 7.7, { lighthouse: true }),
      I('La Baleine', -150, -7900, 320, 22, 3.9),
      I('Île du Bout', 900, -10000, 480, 40, 8.3, { village: 14 }),
      I('Le Cormoran', 3800, -5600, 200, 12, 4.8),
      I('La Pierre Noire', -3600, -6500, 230, 15, 6.6),
      I('Le Chapeau', 2300, -8500, 180, 11, 2.8),
    ],
    courses: I => [
      ['slalom', 'Slalom de l\'archipel', 'Passe les portes entre les îlots, contourne l\'Île du Bout et reviens par l\'ouest.', [
        { x: 0, y: -2800, name: 'Porte des Fous', side: 'port' }, { x: 0, y: -6500, name: 'Porte du Phare', side: 'port' },
        { x: I[5].x, y: I[5].y, name: 'Île du Bout', side: 'port', island: 5 }, { x: -2500, y: -5800, name: 'Bouée de la Pierre Noire', side: 'port' }]],
      ['fous', 'Tour du Phare des Fous', 'Slalome entre les îlots jusqu\'au Phare des Fous, laisse-le à bâbord et reviens.', [
        { x: 0, y: -2800, name: 'Porte des Fous', side: 'port' }, { x: I[3].x, y: I[3].y, name: 'Phare des Fous', side: 'port', island: 3 }]],
      ['chenal', 'Le chenal', 'Remonte le chenal jusqu\'à la Porte des Fous et redescends.', [{ x: 0, y: -2900, name: 'Porte des Fous', side: 'port' }]],
    ],
    waves: 0.7, shifts: 1.3, gusts: 1.2, swell: 0.25, water: [0.02, 0.2, 0.3],
    decor: { dolphins: true, spectators: true, cargo: true },
  },
  {
    id: 'lac', name: 'Lac des Cimes', desc: 'Un lac de montagne : eau plate, sommets enneigés, vent capricieux qui tourne sans arrêt.',
    islands: [
      I('Île aux Chalets', -1900, -3100, 360, 45, 2.4, { village: 12, church: true }),
      I('Le Rocher Blanc', 2300, -5300, 500, 70, 5.5),
    ],
    courses: I => [
      ['sprint-lac', 'Sprint du lac', 'Un mille au près et retour, sur une eau plate comme un miroir.', [{ x: 0, y: -1000, name: 'Bouée au vent', side: 'port' }]],
      ['chalets', 'Tour de l\'île aux Chalets', 'Fais le tour de l\'île aux Chalets, son clocher et ses maisons de bois.', [
        { x: I[0].x, y: I[0].y, name: 'Île aux Chalets', side: 'port', island: 0 }]],
      ['rocher', 'Le Rocher Blanc', 'Va chercher le grand Rocher Blanc au pied des sommets, laisse-le à tribord.', [
        { x: I[1].x, y: I[1].y, name: 'Le Rocher Blanc', side: 'stbd', island: 1 }]],
      ['triangle-lac', 'Triangle du lac', 'Un triangle au pied des montagnes : guette les risées qui tombent des sommets.', [
        { x: 0, y: -2400, name: 'Bouée 1 (au vent)', side: 'port' }, { x: -1600, y: -1200, name: 'Bouée 2', side: 'port' }, { x: 0, y: -350, name: 'Bouée 3', side: 'port' }]],
    ],
    waves: 0.12, shifts: 2.2, gusts: 1.35, water: [0.03, 0.18, 0.2],
    decor: { mountains: true, spectators: true },
  },
];

const cache = new Map<string, Course[]>();
/** Active un plan d'eau (îles pour la physique) et renvoie ses parcours. */
export function activateVenue(id: string): { venue: Venue; courses: Course[] } {
  const venue = VENUES.find(v => v.id === id) ?? VENUES[0];
  setIslands(venue.islands);
  let courses = cache.get(venue.id);
  if (!courses) { courses = venue.courses(venue.islands).map(([cid, n, d, m]) => build(cid, n, d, m)); cache.set(venue.id, courses); }
  return { venue, courses };
}
