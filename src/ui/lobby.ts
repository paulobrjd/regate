// Écran « Avec mes potes » : connexion, salons, réglages de l'hôte, lancement.
import { Net, type RoomInfo, type StartMsg } from '../net/client';
import { VENUES, activateVenue } from '../game/venue';
import { METEO } from '../physics/wind';
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
    if (r) { lastCode = r.code; joining = ''; $('netJoin').textContent = 'Rejoindre'; jmsg(''); }
    const was = $('netLobby').hidden;
    $('netHome').hidden = !!r; $('netLobby').hidden = !r;
    if (!r) return;
    if (was) $('netLobby').scrollIntoView({ block: 'nearest' });
    $('netRoomCode').textContent = r.permanent ? (r.name ?? 'Le Grand Large') : r.code + (r.public ? ' (public)' : '');
    $('netCopy').hidden = !!r.permanent;
    { const { venue, courses } = activateVenue(r.settings.venue), c = courses.find(x => x.id === r.settings.course);
      const sky: Record<string, string> = { soleil: 'grand soleil', nuageux: 'nuageux', pluie: 'pluie', brume: 'brume', couchant: 'coucher de soleil', nuit: 'de nuit' };
      $('netNext').hidden = !r.permanent;
      $('netNext').textContent = (r.phase === 'race' ? 'Course en cours : ' : 'Prochaine course : ') + venue.name + ' · ' + (c?.name ?? '') + ' · ' + METEO[r.settings.met].n + (sky[r.settings.sky] ? ' · ' + sky[r.settings.sky] : ''); }
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
    $('netStart').hidden = !(host || r.permanent) || r.phase === 'race';
    $('netStart').textContent = r.permanent ? 'Partir maintenant' : 'Lancer la course';
    $('netAbort').hidden = !host || r.phase !== 'race' || !!r.permanent;
    for (const id of ['nVenue', 'nCourse', 'nMet', 'nSky', 'nPace', 'nSea', 'nNoColl']) (sel(id).closest('label') as HTMLElement).style.display = r.permanent ? 'none' : '';
    $('netCodeLbl').textContent = r.permanent ? 'Partie ouverte : ' : 'Code du salon : ';
    hint(r);
    if (r.permanent) { msg(r.players.length + ' marin' + (r.players.length > 1 ? 's' : '') + ' au ponton du Grand Large · ping ' + net.ping_ms + ' ms'); return; }
    $('netHint').textContent = r.phase === 'race' ? (host ? 'Course en cours. Tes potes peuvent encore la rejoindre avec le code.' : 'Course en cours…') : host
      ? (r.players.length < 2 ? 'Envoie le code (ou le lien) à tes potes. Tu peux aussi lancer seul pour essayer.' : 'Tout le monde est là ? Lance la course : le départ est donné 1 minute de jeu plus tard.')
      : 'L\'hôte règle la course et la lance.';
    msg(r.players.length + ' marin' + (r.players.length > 1 ? 's' : '') + ' dans le salon · ping ' + net.ping_ms + ' ms');
  };
  /** Compte à rebours du départ automatique de la partie ouverte. */
  function hint(r: RoomInfo): void {
    if (!r.permanent) return;
    if (r.phase === 'race') { $('netHint').textContent = 'Une course est en cours : tu la rejoins directement en partant de la ligne. Ou attends la suivante ici.'; return; }
    const s = r.autoAt ? Math.max(0, Math.ceil((r.autoAt - net.serverNow()) / 1000)) : 0;
    $('netHint').textContent = r.autoAt ? 'Départ automatique dans ' + s + ' s (le temps que d\'autres arrivent). Tu peux aussi partir maintenant.' : 'Le départ est donné tout seul dès qu\'il y a du monde.';
  }
  setInterval(() => { if (net.room?.permanent && !$('netLobby').hidden) hint(net.room); }, 1000);
  net.onRoom = r => { if (!h.isRacing()) render(r); else if (r) render(r); };
  net.onRooms = list => {
    const open = list.find(r => r.permanent);
    if (open) $('netOpenInfo').textContent = open.players
      ? open.players + ' marin' + (open.players > 1 ? 's' : '') + ' en ce moment · ' + (open.phase === 'race' ? 'course en cours, rejoins-la !' : 'départ bientôt')
      : 'Partie ouverte à tous, toujours là : entre directement';
    list = list.filter(r => !r.permanent);
    const ul = $('netRooms');
    ul.innerHTML = list.length ? list.map(r => `<li data-code="${r.code}" style="cursor:pointer"><span class="dot" style="background:#3ddc97"></span><span></span><span class="note">${r.players} joueur${r.players > 1 ? 's' : ''} · ${r.phase === 'race' ? 'en course' : 'au ponton'}</span></li>`).join('') : '<li class="note">Aucun salon public pour l\'instant : crée le tien !</li>';
    [...ul.querySelectorAll<HTMLElement>('li[data-code]')].forEach((li, i) => { li.children[1].textContent = list[i].name; li.onclick = async () => { if (await ensure()) net.send({ type: 'join', code: li.dataset.code }); }; });
  };
  const jmsg = (t: string, kind = '') => { const e = $('netJoinMsg'); e.textContent = t; e.className = 'note ' + kind; };
  let joining = '', lastCode = '';
  net.onError = m => { msg(m); jmsg(m, 'err'); joining = ''; $('netJoin').textContent = 'Rejoindre'; };
  // coupure (téléphone en veille, réseau) : on se reconnecte et on revient dans le salon
  net.onClose = async () => {
    const code = lastCode; render(null);
    if (!code) { msg('Connexion perdue. Réessaie dans un instant.'); return; }
    msg('Connexion perdue : reconnexion…');
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 1500 + i * 1500));
      try { await net.connect(name()); net.send({ type: 'join', code }); return; } catch { /* on réessaie */ }
    }
    msg('Impossible de se reconnecter. Recharge la page et rejoins le salon avec son code (' + code + ').');
  };
  const join = async () => {
    const c = $<HTMLInputElement>('netCode').value.toUpperCase().replace(/[^A-Z]/g, '');
    $<HTMLInputElement>('netCode').value = c;
    if (c.length !== 4) { jmsg('Le code fait 4 lettres (par exemple ABCD).', 'err'); return; }
    if (joining === c) return;
    joining = c; $('netJoin').textContent = 'Connexion…'; jmsg('Connexion au salon ' + c + '…');
    if (await ensure()) net.send({ type: 'join', code: c });
    else { joining = ''; $('netJoin').textContent = 'Rejoindre'; jmsg('Serveur injoignable : attends une minute (il se réveille) puis réessaie.', 'err'); }
    setTimeout(() => { if (joining === c) { joining = ''; $('netJoin').textContent = 'Rejoindre'; if (!net.room) jmsg('Pas de réponse du serveur. Réessaie.', 'err'); } }, 10000);
  };
  net.onStart = m => h.onStart(m);
  setInterval(() => { if (net.connected) { net.ping(); if (!net.room) net.send({ type: 'list' }); } }, 2000);

  $('netOpen').onclick = async () => { if (await ensure()) net.send({ type: 'open' }); };
  $('netCreate').onclick = async () => { if (await ensure()) net.send({ type: 'create', public: false }); };
  $('netQuick').onclick = async () => { if (await ensure()) net.send({ type: 'quick' }); };
  $('netJoin').onclick = join;
  $('netCode').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void join(); } });
  // dès que les 4 lettres sont tapées, on rejoint
  $('netCode').addEventListener('input', () => { const c = $<HTMLInputElement>('netCode').value.replace(/[^a-zA-Z]/g, ''); if (c.length === 4) void join(); else jmsg(''); });
  $('netLeave').onclick = () => { lastCode = ''; net.send({ type: 'leave' }); net.room = null; render(null); net.send({ type: 'list' }); };
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
  const openTab = async () => {
    // l'onglet se connecte tout de suite pour afficher qui est au Grand Large
    if (await ensure() && invite && !net.room) net.send({ type: 'join', code: invite.toUpperCase() });
  };
  if (invite) $<HTMLInputElement>('netCode').value = invite.toUpperCase();
  return { openTab };
}

export const assistChoice = () => ASSISTS[sel('nAssist').value]?.a ?? ASSISTS.debutant.a;
