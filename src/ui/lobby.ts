// Écran « Avec mes potes » : connexion, salons, réglages de l'hôte, lancement.
import { Net, type RoomInfo, type StartMsg } from '../net/client';
import { VENUES, activateVenue } from '../game/venue';
import { ASSISTS } from '../game/assist';
import { $ } from './hud';

const sel = (id: string) => $<HTMLSelectElement>(id);
export const net = new Net();

export interface LobbyHooks { onStart(m: StartMsg): void; isRacing(): boolean }

export function initLobby(h: LobbyHooks): { openTab(): void } {
  const msg = (t: string) => { $('netMsg').textContent = t; };
  try { $<HTMLInputElement>('pseudo').value = localStorage.getItem('regate-pseudo') || ''; } catch { /* */ }
  sel('nVenue').innerHTML = VENUES.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
  sel('nAssist').innerHTML = Object.entries(ASSISTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
  sel('nAssist').value = 'debutant';
  const fillCourses = (venue: string, course?: string) => {
    const { courses } = activateVenue(venue);
    sel('nCourse').innerHTML = courses.map(c => `<option value="${c.id}">${c.name} · ${c.nm.toFixed(1).replace('.', ',')} M</option>`).join('');
    if (course && courses.some(c => c.id === course)) sel('nCourse').value = course;
  };
  fillCourses('baie');

  const name = () => {
    const n = ($<HTMLInputElement>('pseudo').value.trim() || 'Marin').slice(0, 14);
    try { localStorage.setItem('regate-pseudo', n); } catch { /* */ }
    return n;
  };
  const ensure = async (): Promise<boolean> => {
    if (net.connected) { net.send({ type: 'hello', name: name() }); return true; }
    msg('Connexion au serveur…');
    try { await net.connect(name()); msg('Connecté. Crée un salon, ou rejoins celui d\'un pote avec son code.'); net.send({ type: 'list' }); return true; }
    catch {
      msg('Impossible de joindre le serveur. Le jeu en ligne ne marche pas depuis la page claude.ai : ouvre le jeu sur ton site (bouton ci-dessous). Si tu y es déjà, le serveur se réveille : attends une minute et réessaie.');
      $('netSite').hidden = location.hostname === 'regate-au-large.onrender.com';
      return false;
    }
  };

  const isHost = () => !!net.room && net.room.host === net.id;
  const render = (r: RoomInfo | null) => {
    $('netHome').hidden = !!r; $('netLobby').hidden = !r;
    if (!r) return;
    $('netRoomCode').textContent = r.code + (r.public ? ' (public)' : '');
    const ul = $('netPlayers');
    ul.innerHTML = r.players.map(() => '<li><span class="dot"></span><span></span><span class="note"></span></li>').join('');
    [...ul.children].forEach((li, i) => {
      const p = r.players[i], c = li.children as HTMLCollectionOf<HTMLElement>;
      c[0].style.background = p.col; c[1].textContent = p.name + (p.id === net.id ? ' (toi)' : '');
      c[2].textContent = p.id === r.host ? 'hôte' : '';
    });
    const host = isHost();
    for (const id of ['nVenue', 'nCourse', 'nMet', 'nSky', 'nPace', 'nSea']) sel(id).disabled = !host;
    $<HTMLInputElement>('nNoColl').disabled = !host;
    const st = r.settings;
    sel('nVenue').value = st.venue; fillCourses(st.venue, st.course); sel('nMet').value = String(st.met); sel('nSky').value = st.sky; sel('nPace').value = String(st.pace); sel('nSea').value = st.sea ?? 'auto'; $<HTMLInputElement>('nNoColl').checked = st.collisions === false;
    $('netStart').hidden = !host || r.phase === 'race';
    $('netAbort').hidden = !host || r.phase !== 'race';
    $('netHint').textContent = r.phase === 'race' ? (host ? 'Course en cours. Tes potes peuvent encore la rejoindre avec le code.' : 'Course en cours…') : host
      ? (r.players.length < 2 ? 'Envoie le code (ou le lien) à tes potes. Tu peux aussi lancer seul pour essayer.' : 'Tout le monde est là ? Lance la course : le départ est donné 1 minute de jeu plus tard.')
      : 'L\'hôte règle la course et la lance.';
    msg(r.players.length + ' marin' + (r.players.length > 1 ? 's' : '') + ' dans le salon · ping ' + net.ping_ms + ' ms');
  };
  net.onRoom = r => { if (!h.isRacing()) render(r); else if (r) render(r); };
  net.onRooms = list => {
    const ul = $('netRooms');
    ul.innerHTML = list.length ? list.map(r => `<li data-code="${r.code}" style="cursor:pointer"><span class="dot" style="background:#3ddc97"></span><span></span><span class="note">${r.players} joueur${r.players > 1 ? 's' : ''} · ${r.phase === 'race' ? 'en course' : 'au ponton'}</span></li>`).join('') : '<li class="note">Aucun salon public pour l\'instant : crée le tien !</li>';
    [...ul.querySelectorAll<HTMLElement>('li[data-code]')].forEach((li, i) => { li.children[1].textContent = list[i].name; li.onclick = async () => { if (await ensure()) net.send({ type: 'join', code: li.dataset.code }); }; });
  };
  net.onError = m => msg(m);
  net.onClose = () => { msg('Connexion perdue. Réessaie dans un instant.'); render(null); };
  net.onStart = m => h.onStart(m);
  setInterval(() => { if (net.connected) { net.ping(); if (!net.room) net.send({ type: 'list' }); } }, 2000);

  $('netCreate').onclick = async () => { if (await ensure()) net.send({ type: 'create', public: false }); };
  $('netQuick').onclick = async () => { if (await ensure()) net.send({ type: 'quick' }); };
  $('netJoin').onclick = async () => { const c = $<HTMLInputElement>('netCode').value.trim().toUpperCase(); if (c.length === 4 && await ensure()) net.send({ type: 'join', code: c }); else if (c.length !== 4) msg('Le code fait 4 lettres.'); };
  $('netLeave').onclick = () => { net.send({ type: 'leave' }); net.room = null; render(null); net.send({ type: 'list' }); };
  $('netStart').onclick = () => net.send({ type: 'start' });
  $('netAbort').onclick = () => net.send({ type: 'abort' });
  $('netCopy').onclick = async () => {
    const url = location.origin + location.pathname + '?salon=' + (net.room?.code ?? '');
    try { await navigator.clipboard.writeText(url); $('netCopy').textContent = 'Lien copié !'; } catch { $('netCopy').textContent = url; }
    setTimeout(() => { $('netCopy').textContent = 'Copier le lien'; }, 2500);
  };
  const pushSettings = () => { if (isHost()) net.send({ type: 'settings', settings: { venue: sel('nVenue').value, course: sel('nCourse').value, met: +sel('nMet').value, sky: sel('nSky').value, pace: +sel('nPace').value, sea: sel('nSea').value, collisions: !$<HTMLInputElement>('nNoColl').checked } }); };
  sel('nVenue').onchange = () => { fillCourses(sel('nVenue').value); pushSettings(); };
  for (const id of ['nCourse', 'nMet', 'nSky', 'nPace', 'nSea']) sel(id).onchange = pushSettings;
  $('nNoColl').onchange = pushSettings;

  // lien d'invitation : ?salon=ABCD
  const invite = new URLSearchParams(location.search).get('salon');
  const openTab = async () => { if (await ensure() && invite && !net.room) net.send({ type: 'join', code: invite.toUpperCase() }); };
  if (invite) $<HTMLInputElement>('netCode').value = invite.toUpperCase();
  return { openTab };
}

export const assistChoice = () => ASSISTS[sel('nAssist').value]?.a ?? ASSISTS.debutant.a;
