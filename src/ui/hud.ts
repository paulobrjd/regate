// Tableau de bord sous le plan d'eau (DOM).
import { D, clamp, fmt, ord } from '../util/math';
import { KN } from '../physics/units';
import { config } from '../physics/boat';
import { bestConfig } from '../physics/model';
import type { Game } from '../game/game';

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const n1 = (v: number) => v.toFixed(1).replace('.', ',');
const fmtDist = (m: number) => m < 1852 ? Math.round(m / 10) * 10 + ' m' : n1(m / 1852) + ' milles';
const set = (id: string, s: string) => { const e = $(id); if (e.textContent !== s) e.textContent = s; };

export function updateHud(g: Game | null, renderRank: () => void): void {
  if (!g) return;
  const b = g.me, st = g.standings(), c = g.course, N = c.marks.length, cls = b.cls;
  const pos = st.findIndex(e => e.me);
  set('hPos', g.demo || st.length < 2 ? '—' : ord(pos + 1) + ' / ' + st.length);
  set('hGap', g.demo || pos < 1 ? ' ' : 'à ' + fmtDist(st[pos].d - st[0].d) + ' du 1er');
  const kn = b.v / KN, eff = Math.round(b.eff * 100);
  set('hSpd', n1(Math.max(0, kn)) + ' nds');
  set('hPol', 'polaire ' + n1(b.target) + ' · ' + eff + ' %');
  $('stSpd').className = 'st ' + (g.demo ? '' : eff > 95 ? 'good' : eff > 80 ? 'warn' : 'bad');
  const a = Math.round(Math.abs(b.twa) / D);
  set('hTw', Math.round(b.tws) + ' nds · ' + a + '°' + (a < 35 ? ' face au vent' : a < 65 ? ' près' : a < 115 ? ' travers' : ' portant'));
  set('hAw', 'apparent ' + Math.round(b.aws) + ' nds · ' + Math.round(Math.abs(b.awa) / D) + '°');
  const hd = Math.round(b.heel / D), cfg = config(b);
  set('hHeel', hd + '°');
  $('gHeel').style.left = clamp(Math.abs(hd) / 45 * 100, 0, 100) + '%';
  $('stHeel').className = 'st ' + (g.demo ? '' : hd > 32 ? 'bad' : hd > 25 ? 'warn' : '');
  const kw = Math.round(cfg.keelW * cls.keelMax);
  set('hKeel', 'quille ' + (Math.abs(kw) < 2 ? 'au centre' : Math.abs(kw) + '° ' + (kw > 0 ? 'au vent' : 'SOUS LE VENT')));
  const head = cls.heads[b.head];
  set('hSail', head.id + (b.reefs ? ' · ' + b.reefs + ' ris' : ' · GV haute'));
  const best = bestConfig(g.cal, Math.max(b.twsAvg, b.tws - 3), a);
  const tip = b.task ? (b.task.kind === 'head' ? '→ ' + cls.heads[b.task.to].id + ' en cours' : 'ris en cours')
    : best.head !== b.head || best.reefs !== b.reefs ? 'conseil : ' + cls.heads[best.head].id + (best.reefs ? ' · ' + best.reefs + ' ris' : '') : 'bonne voilure';
  set('hSailTip', tip);
  $('stSail').className = 'st ' + (g.demo || g.assist.sails ? '' : best.head !== b.head || best.reefs !== b.reefs ? 'warn' : 'good');
  set('hSys', 'foil ' + (cfg.foilLee > 0.95 ? 'sorti' : cfg.foilLee > 0.05 ? Math.round(cfg.foilLee * 100) + ' %' : 'rentré') + (cfg.foilWind > 0.05 ? ' (au vent sorti !)' : ''));
  set('hSys2', 'ballast au vent ' + Math.round(cfg.ballW * 100) + ' %' + (cfg.ballL > 0.05 ? ' · sous le vent ' + Math.round(cfg.ballL * 100) + ' %' : ''));
  const en = Math.round(b.energy * 100);
  set('hEn', en + ' %'); $('gEn').style.left = en + '%';
  $('stEn').className = 'st ' + (g.demo ? '' : en < 20 ? 'bad' : en < 40 ? 'warn' : '');
  const p = b.pilot;
  set('hPilot', !p.on ? 'débrayé' : p.mode === 'cap' ? 'cap ' + String(Math.round(((p.set / D) % 360 + 360) % 360)).padStart(3, '0') + '°' : 'vent ' + Math.round(Math.abs(p.set) / D) + '° ' + (p.set >= 0 ? 'bâbord' : 'tribord'));
  set('hPilot2', p.on ? '← → : ±1° · Maj : ±10°' : 'tu barres');
  set('hTime', g.demo ? '-1:00' : b.fin != null ? fmt(b.fin) : fmt(g.t));
  set('hScale', g.timeScale > 1 ? 'temps accéléré ×' + g.timeScale : g.pace >= 3 ? 'rythme arcade' : g.pace > 1 ? 'rythme dynamique' : 'temps réel');
  const next = b.fin != null ? 'Terminé' : b.ocs ? 'Repasser sous la ligne' : b.leg === 0 ? 'Ligne de départ' : b.leg > N ? 'Ligne d\'arrivée' : c.marks[b.leg - 1].name;
  set('hNext', next);
  const m = b.leg >= 1 && b.leg <= N ? c.marks[b.leg - 1] : null;
  set('hNext2', m ? fmtDist(Math.hypot(m.x - b.x, m.y - b.y)) + ' · à laisser à ' + (m.side === 'port' ? 'bâbord' : 'tribord') : c.name + ' · ' + n1(c.nm) + ' milles');
  document.querySelectorAll<HTMLElement>('[data-cmd^=head]').forEach(el => el.classList.toggle('on', +el.dataset.cmd!.slice(4) - 1 === (b.task?.kind === 'head' ? b.task.to : b.head)));
  const pb = document.querySelector<HTMLElement>('[data-cmd=pilot]'); if (pb) { pb.classList.toggle('on', p.on); pb.firstChild!.textContent = p.on ? 'Débrayer' : 'Engager'; }
  if (g.endShown && !$('ovEnd').hidden) renderRank();
}
