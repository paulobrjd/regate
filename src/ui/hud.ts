// Tableau de bord sous le plan d'eau (DOM).
import { D, clamp, fmt, ord } from '../util/math';
import { depower } from '../physics/boat';
import { trimState } from '../game/trim';
import { MARKS } from '../game/course';
import type { Game } from '../game/game';
import { app } from '../app';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export function updateHud(g: Game | null, renderRank: () => void): void {
  if (!g) return;
  const me = g.me, t = g.t, a = Math.round(Math.abs(me.twa) / D), st = g.standings();
  $('hPos').textContent = g.demo || st.length < 2 ? '—' : ord(st.findIndex(e => e.me) + 1) + ' / ' + st.length;
  $('hSpd').textContent = me.v.toFixed(1).replace('.', ',') + ' nds';
  $('hTwa').textContent = a + '°' + (a < 32 ? ' · face au vent' : a < 60 ? ' · près' : a < 120 ? ' · travers' : ' · portant');
  const ts = trimState(me);
  $('hTrim').textContent = app.auto && me.cap <= 0 && ts.lvl < 2 ? 'Automatique' : ts.txt.replace(/  .*/, '').toLowerCase().replace(/^./, c => c.toUpperCase());
  $('stTrim').className = 'st ' + (g.demo ? '' : ['good', 'warn', 'bad'][ts.lvl]);
  const hd = Math.round(me.cap > 0 ? 90 : clamp(me.heelN, 0, 1.6) * 26);
  $('hHeel').textContent = hd + '°';
  $('hHike').textContent = me.cap > 0 ? 'dessalé' : me.hike > 0.6 ? 'au rappel' : me.hike > 0.25 ? 'en appui' : 'assis';
  $('gHeel').style.left = clamp(hd / 42 * 100, 0, 100) + '%';
  $('hAw').textContent = 'apparent ' + Math.round(Math.abs(me.awa) / D) + '° · ' + Math.round(me.aws) + ' nds';
  $('gCur').style.left = (me.sheet * 100) + '%';
  $('gOpt').style.left = clamp((me.opt0 + depower(me) - 0.1) * 100, 0, 80) + '%';
  $('hTime').textContent = g.demo ? '-0:30' : me.fin != null ? fmt(me.fin) : fmt(t);
  $('hNext').textContent = me.fin != null ? 'Terminé' : me.ocs ? 'Repasser sous la ligne' : me.leg === 0 ? 'Ligne de départ' : me.leg === 4 ? 'Ligne d\'arrivée' : MARKS[me.leg - 1].n;
  const sb = $('spiBtn');
  sb.classList.toggle('up', me.spi);
  sb.firstChild!.textContent = me.spi ? 'Affaler le spi' : 'Envoyer le spi';
  if (g.endShown && !$('ovEnd').hidden) renderRank();
}
