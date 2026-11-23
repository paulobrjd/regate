// Point d'entrée : menus, entrées clavier/tactile, boucle à pas fixe (60 Hz) + rendu interpolé, accélération du temps.
import './style.css';
import { fmt, ord } from './util/math';
import { Game, PRE, STEP, TIME_SCALES, type Command } from './game/game';
import { VENUES, activateVenue } from './game/venue';
import { ASSISTS } from './game/assist';
import { Canvas2D, ZOOMS } from './render/canvas2d';
import { Scene3D } from './render/scene3d';
import { snapshot } from './render/snapshot';
import { $, updateHud } from './ui/hud';
import { unlockAudio, sfx, boom, updSound } from './audio/sound';
import { app, type View } from './app';
import { initLobby, net, assistChoice } from './ui/lobby';
import type { StartMsg, ResultRow } from './net/client';
import type { BoatInput } from './physics/boat';
import { LEVELS, mkAI } from './ai/bot';
import { newMem } from './game/assist';
import { makeRng } from './util/math';

type Hold = 'left' | 'right' | 'mainIn' | 'mainOut' | 'headIn' | 'headOut' | 'travUp' | 'travDown';
const K: Record<Hold, boolean> = { left: false, right: false, mainIn: false, mainOut: false, headIn: false, headOut: false, travUp: false, travDown: false };
const c2d = new Canvas2D($<HTMLCanvasElement>('c'));
let R3: Scene3D | null = null;
let paused = false;
const bests: Record<string, number> = (() => { try { return JSON.parse(localStorage.getItem('regate-bests') || '{}'); } catch { return {}; } })();

function fit(): void { c2d.fit(); if (R3) R3.resize(c2d.VW, c2d.VH); }
new ResizeObserver(fit).observe(c2d.cv);

// ---------- menus ----------
const sel = (id: string) => $<HTMLSelectElement>(id);
sel('venue').innerHTML = VENUES.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
const fillCourses = () => {
  const { courses } = activateVenue(sel('venue').value), cur = sel('course').value;
  sel('course').innerHTML = courses.map(c => `<option value="${c.id}">${c.name} · ${c.nm.toFixed(1).replace('.', ',')} milles</option>`).join('');
  if (courses.some(c => c.id === cur)) sel('course').value = cur;
};
sel('assist').innerHTML = Object.entries(ASSISTS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
const prefs = (() => { try { return JSON.parse(localStorage.getItem('regate-prefs') || '{}'); } catch { return {}; } })();
if (prefs.venue) sel('venue').value = prefs.venue;
fillCourses();
for (const k of ['course', 'met', 'nBots', 'lvl', 'assist', 'pace', 'sky']) if (prefs[k] != null) sel(k).value = prefs[k];
if (!prefs.assist) sel('assist').value = 'debutant';
if (!prefs.course) sel('course').value = 'sprint';
const descCourse = () => {
  const { venue, courses } = activateVenue(sel('venue').value), c = courses.find(x => x.id === sel('course').value) ?? courses[0], key = venue.id + ':' + c.id;
  $('courseDesc').textContent = venue.desc + ' ' + c.desc + (bests[key] ? ' Ton record : ' + fmt(bests[key]) + '.' : '');
};
sel('course').addEventListener('change', descCourse);
sel('venue').addEventListener('change', () => { fillCourses(); descCourse(); });
descCourse();

// ---------- partie ----------
function start(g: Game): void {
  app.g = g; g.onSfx = sfx; g.onFinish = finishMe;
  // on masque les commandes que l'assistance fait à ta place
  const a = g.assist, cl = document.body.classList;
  cl.toggle('auto-sheets', a.sheets); cl.toggle('auto-systems', a.systems); cl.toggle('auto-sails', a.sails);
  cl.toggle('beginner', a.sheets && a.systems && a.sails);
  c2d.resetCam(g.me.x, g.me.y - 80); acc = 0; paused = false;
}
function demo(): void {
  const v = VENUES[Math.floor(Math.random() * VENUES.length)], { courses } = activateVenue(v.id);
  start(new Game({ mode: 'solo', demo: true, bots: 4, lvl: 2, venue: v.id, course: courses[0].id, startT: 20 }));
}
function startSolo(): void {
  unlockAudio();
  const p = { venue: sel('venue').value, sky: sel('sky').value, course: sel('course').value, met: sel('met').value, nBots: sel('nBots').value, lvl: sel('lvl').value, assist: sel('assist').value, pace: sel('pace').value };
  try { localStorage.setItem('regate-prefs', JSON.stringify(p)); } catch { /* */ }
  start(new Game({ mode: 'solo', bots: +p.nBots, lvl: +p.lvl, met: +p.met, venue: p.venue, sky: p.sky, course: p.course, assist: ASSISTS[p.assist].a, pace: +p.pace }));
  $('ovStart').hidden = true; $('ovEnd').hidden = true; $('resumeBtn').hidden = true;
}
function menu(): void {
  $('ovEnd').hidden = true; $('ovStart').hidden = false;
  const g = app.g;
  if (g && !g.demo && g.me.fin == null) { paused = g.mode !== 'net'; $('resumeBtn').hidden = false; } // en ligne, la course continue
  else { demo(); $('resumeBtn').hidden = true; }
  descCourse();
}
function resume(): void { paused = false; $('ovStart').hidden = true; $('resumeBtn').hidden = true; }

function finishMe(): void {
  const g = app.g;
  if (g && g.mode === 'net') net.send({ type: 'finish' }); // le chrono officiel est celui du serveur
  setTimeout(() => { if (!app.g || app.g !== g || g.demo || g.me.fin == null) return; showEnd(g); }, 1500);
}
function showEnd(g: Game): void {
  if (g.mode === 'net') { showNetEnd(g); return; }
  const t = g.me.fin!, st = g.standings(), pos = st.findIndex(e => e.me) + 1, id = g.venue.id + ':' + g.course.id;
  $('endTitle').textContent = pos === 1 && st.length > 1 ? 'Victoire !' : 'Arrivée !';
  $('endTime').textContent = fmt(t);
  let line = (st.length > 1 ? ord(pos) + ' sur ' + st.length + '. ' : '') + g.course.name + '. ';
  const best = bests[id] ?? null, rec = best === null || t < best;
  line += rec ? (best === null ? 'Premier temps enregistré.' : 'Nouveau record ! Ancien : ' + fmt(best)) : 'Ton record : ' + fmt(best!);
  if (rec) { bests[id] = t; try { localStorage.setItem('regate-bests', JSON.stringify(bests)); } catch { /* */ } }
  $('endBest').textContent = line;
  g.endShown = true; renderRank(); $('ovEnd').hidden = false; $('againBtn').focus();
}
// ---------- en ligne ----------
let lastResults: ResultRow[] = [];
function startNet(m: StartMsg): void {
  unlockAudio();
  const players = m.players, i = Math.max(0, players.findIndex(p => p.id === net.id)), meP = players[i], st = m.settings;
  const clock = () => (net.serverNow() - m.gunAt) * st.pace / 1000;
  const g = new Game({ mode: 'net', seed: m.seed, venue: st.venue, course: st.course, met: st.met, sky: st.sky, pace: st.pace, bots: 0,
    name: meP?.name, col: meP?.col, assist: assistChoice(), slot: { i, n: players.length }, clock, remoteClock: () => net.serverNow(), startT: clock() });
  for (const p of players) if (p.id !== net.id) g.addRemote(p.id, p.name, p.col);
  lastResults = [];
  start(g);
  $('ovStart').hidden = true; $('ovEnd').hidden = true; $('resumeBtn').hidden = true;
  g.say('Course en ligne : ' + players.length + ' bateau' + (players.length > 1 ? 'x' : '') + ' · départ dans ' + Math.round(-g.t) + ' s');
}
function showNetEnd(g: Game): void {
  const mine = lastResults.find(r => r.id === net.id), t = mine?.fin ?? g.me.fin;
  const pos = lastResults.findIndex(r => r.id === net.id) + 1;
  $('endTitle').textContent = pos === 1 && lastResults.length > 1 ? 'Victoire !' : 'Arrivée !';
  $('endTime').textContent = t != null ? fmt(t) : '—';
  $('endBest').textContent = (pos ? ord(pos) + ' sur ' + lastResults.length + ' · ' : '') + g.course.name + ' · chrono officiel du serveur';
  $('againBtn').textContent = 'Retour au salon';
  g.endShown = true; renderRank(); $('ovEnd').hidden = false;
}
function renderNetRank(): void {
  const ol = $('endRank');
  ol.innerHTML = lastResults.map(e => `<li class="${e.id === net.id ? 'me' : ''}"><span></span><span class="dot"></span><span></span><span></span></li>`).join('');
  [...ol.children].forEach((li, i) => {
    const e = lastResults[i], c = li.children as HTMLCollectionOf<HTMLElement>;
    c[0].textContent = ord(i + 1); c[1].style.background = e.col;
    c[2].textContent = e.name + (e.id === net.id ? ' (toi)' : '');
    c[3].textContent = e.fin != null ? fmt(e.fin) : e.ocs ? 'départ anticipé' : 'en course';
  });
}
net.onStates = (t, boats) => { const g = app.g; if (g && g.mode === 'net') g.pushStates(t, boats, net.id); };
net.onResults = (list, final) => {
  lastResults = list;
  const g = app.g; if (!g || g.mode !== 'net') return;
  for (const r of list) g.setRemoteFin(r.id, r.fin);
  if (final && !g.endShown) showNetEnd(g);
  else if (g.endShown) renderNetRank();
};
const lobby = initLobby({ onStart: startNet, isRacing: () => !!app.g && app.g.mode === 'net' && app.g.me.fin == null });
{ const prev = net.onRoom; net.onRoom = r => { prev(r); const g = app.g; if (g && g.mode === 'net' && r) for (const id of [...g.remotes.keys()]) if (!r.players.some(p => p.id === id)) g.removeRemote(id); }; }
let netSendT = 0;

function renderRank(): void {
  const g = app.g; if (!g) return;
  if (g.mode === 'net' && lastResults.length) { renderNetRank(); return; }
  const st = g.standings(), ol = $('endRank');
  ol.innerHTML = st.map(e => `<li class="${e.me ? 'me' : ''}"><span></span><span class="dot"></span><span></span><span></span></li>`).join('');
  [...ol.children].forEach((li, i) => {
    const e = st[i], c = li.children as HTMLCollectionOf<HTMLElement>;
    c[0].textContent = ord(i + 1); c[1].style.background = e.col;
    c[2].textContent = e.name + (e.me ? ' (toi)' : '');
    c[3].textContent = e.fin != null ? fmt(e.fin) : e.ocs ? 'départ anticipé' : 'en course';
  });
}

// ---------- vues, son, temps ----------
const VIEWS: View[] = ['pov', 'chase', 'top'], VLBL: Record<View, string> = { pov: 'cockpit', chase: 'poursuite', top: 'carte' };
function setView(v: View): void {
  app.view = v; try { localStorage.setItem('regate-view', v); } catch { /* */ }
  $('viewBtn').firstChild!.textContent = 'Vue : ' + VLBL[v];
  $('gl').style.visibility = v === 'top' ? 'hidden' : 'visible';
}
function nextView(): void { const L = R3 ? VIEWS : ['top' as View]; setView(L[(L.indexOf(app.view) + 1) % L.length]); }
function setSnd(v: boolean): void { app.soundOn = v; try { localStorage.setItem('regate-snd', v ? '1' : '0'); } catch { /* */ } $('sndBtn').firstChild!.textContent = 'Son : ' + (v ? 'oui' : 'non'); }
function zoom(d: number): void { c2d.zoomI = Math.max(0, Math.min(ZOOMS.length - 1, c2d.zoomI + d)); if (app.view !== 'top') setView('top'); }
function timeScale(d: number): void {
  const g = app.g; if (!g || g.demo || g.mode !== 'solo') return;
  const i = Math.max(0, Math.min(TIME_SCALES.length - 1, TIME_SCALES.indexOf(g.timeScale) + d));
  g.timeScale = TIME_SCALES[i]; g.say(g.timeScale > 1 ? 'Temps accéléré ×' + g.timeScale : 'Vitesse normale');
}
$('viewBtn').addEventListener('click', nextView);
$('viewBtn2').addEventListener('click', nextView);
// plein écran : API du navigateur, sinon le jeu occupe toute la fenêtre
function setFsLabel(): void {
  const on = !!document.fullscreenElement || $('game').classList.contains('pseudo-fs');
  $('fsBtn').textContent = on ? '✕ Quitter le plein écran' : '⛶ Plein écran';
  document.body.classList.toggle('fs-open', on);
  setTimeout(fit, 50);
}
function toggleFs(): void {
  const el = $('game');
  if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
  if (el.classList.contains('pseudo-fs')) { el.classList.remove('pseudo-fs'); setFsLabel(); return; }
  const req = el.requestFullscreen?.bind(el);
  if (req) req().catch(() => { el.classList.add('pseudo-fs'); setFsLabel(); });
  else { el.classList.add('pseudo-fs'); setFsLabel(); }
}
$('fsBtn').addEventListener('click', toggleFs);
document.addEventListener('fullscreenchange', setFsLabel);
$('zoomBtn').addEventListener('click', () => zoom(c2d.zoomI >= ZOOMS.length - 1 ? -ZOOMS.length : 1));
$('timeBtn').addEventListener('click', () => timeScale(app.g && app.g.timeScale >= 50 ? -9 : 1));
$('sndBtn').addEventListener('click', () => { unlockAudio(); setSnd(!app.soundOn); });
try { setSnd(localStorage.getItem('regate-snd') !== '0'); } catch { /* */ }
try { R3 = new Scene3D($<HTMLCanvasElement>('gl')); R3.onBoom = boom; } catch (e) { console.error(e); R3 = null; }
{
  let v: string | null = null; try { v = localStorage.getItem('regate-view'); } catch { /* */ }
  setView(R3 ? (VIEWS.includes(v as View) ? v as View : 'chase') : 'top');
}
c2d.cv.addEventListener('wheel', e => { if (app.view === 'top') { e.preventDefault(); zoom(e.deltaY < 0 ? 1 : -1); } }, { passive: false });

function tab(isNet: boolean): void {
  $('tSolo').classList.toggle('on', !isNet); $('tNet').classList.toggle('on', isNet);
  $('pSolo').hidden = isNet; $('pNet').hidden = !isNet;
  if (isNet) lobby.openTab();
}
if (new URLSearchParams(location.search).get('salon')) tab(true); // lien d'invitation
$('tSolo').addEventListener('click', () => tab(false));
$('tNet').addEventListener('click', () => tab(true));
$('goBtn').addEventListener('click', startSolo);
$('resumeBtn').addEventListener('click', resume);
$('againBtn').addEventListener('click', () => {
  if (app.g && app.g.mode === 'net') { $('againBtn').textContent = 'Nouvelle régate'; menu(); tab(true); } else startSolo();
});
$('menuBtn').addEventListener('click', menu);

// ---------- entrées ----------
const playing = () => !!app.g && !app.g.demo && $('ovStart').hidden && !paused;
const cmd = (c: Command) => { if (playing()) { unlockAudio(); app.g!.command(c); } };
document.querySelectorAll<HTMLElement>('[data-cmd]').forEach(b => b.addEventListener('click', () => cmd(b.dataset.cmd as Command)));

/** Barre : avec le pilote engagé, ← → décalent la consigne au lieu de barrer. */
function steer(dir: number, big: boolean): boolean {
  const g = app.g; if (!g || !g.me.pilot.on) return false;
  g.command(dir < 0 ? (big ? 'pilotLeft10' : 'pilotLeft') : (big ? 'pilotRight10' : 'pilotRight'));
  return true;
}
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  const key = e.key.toLowerCase();
  if (e.code === 'Escape') { if ($('game').classList.contains('pseudo-fs')) { toggleFs(); return; } if (playing()) menu(); else if (paused) resume(); return; }
  if (e.code === 'KeyC' && !e.repeat) { nextView(); return; }
  if (key === 'm' && !e.repeat) { unlockAudio(); setSnd(!app.soundOn); return; }
  if (key === 'h' && !e.repeat) { const d = $<HTMLDetailsElement>('help'); d.open = !d.open; return; }
  if (key === '+' || key === '=' || e.code === 'NumpadAdd') { zoom(1); return; }
  if (key === '-' || e.code === 'NumpadSubtract') { zoom(-1); return; }
  if (!playing()) return;
  let handled = true;
  if (e.code === 'ArrowLeft' || key === 'q') { if (!steer(-1, e.shiftKey)) K.left = true; }
  else if (e.code === 'ArrowRight' || key === 'd') { if (!steer(1, e.shiftKey)) K.right = true; }
  else if (e.code === 'ArrowUp' || key === 'z') { if (e.shiftKey) K.headIn = true; else K.mainIn = true; }
  else if (e.code === 'ArrowDown' || key === 's') { if (e.shiftKey) K.headOut = true; else K.mainOut = true; }
  else if (key === 'w') K.travUp = true;
  else if (key === 'x') K.travDown = true;
  else if (e.repeat) handled = false;
  else if (/^(Digit|Numpad)[1-5]$/.test(e.code)) cmd(('head' + e.code.slice(-1)) as Command);
  else if (key === 'p') cmd('reefIn');
  else if (key === 'o') cmd('reefOut');
  else if (key === 'k') cmd('keel');
  else if (key === 'f') cmd('foils');
  else if (key === 'b') cmd('ballast');
  else if (key === 'a') cmd(e.shiftKey ? 'pilotMode' : 'pilot');
  else if (e.code === 'Space') cmd('pilotTack');
  else if (key === 't') timeScale(e.shiftKey ? -1 : 1);
  else if (key === 'g') cmd('route');
  else handled = false;
  if (handled) e.preventDefault();
});
addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  if (e.code === 'ArrowLeft' || key === 'q') K.left = false;
  if (e.code === 'ArrowRight' || key === 'd') K.right = false;
  if (e.code === 'ArrowUp' || key === 'z') K.mainIn = K.headIn = false;
  if (e.code === 'ArrowDown' || key === 's') K.mainOut = K.headOut = false;
  if (key === 'w') K.travUp = false;
  if (key === 'x') K.travDown = false;
  if (e.key === 'Shift') { if (K.headIn) { K.headIn = false; K.mainIn = true; } if (K.headOut) { K.headOut = false; K.mainOut = true; } }
});
addEventListener('blur', () => { for (const k in K) K[k as Hold] = false; });
document.querySelectorAll<HTMLElement>('[data-k]').forEach(b => {
  const k = b.dataset.k as Hold;
  let rep = 0;
  const on = (e: PointerEvent) => {
    e.preventDefault(); b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch { /* */ }
    if ((k === 'left' || k === 'right') && steer(k === 'left' ? -1 : 1, false)) { rep = window.setInterval(() => steer(k === 'left' ? -1 : 1, false), 150); return; }
    K[k] = true;
  };
  const off = () => { K[k] = false; b.classList.remove('on'); clearInterval(rep); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
});
const input = (): BoatInput => ({
  helm: (K.left ? -1 : 0) + (K.right ? 1 : 0),
  mainDir: (K.mainOut ? 1 : 0) - (K.mainIn ? 1 : 0),
  headDir: (K.headOut ? 1 : 0) - (K.headIn ? 1 : 0),
  travDir: (K.travDown ? 1 : 0) - (K.travUp ? 1 : 0),
});

// ---------- pilotage à la souris / au doigt ----------
// boussole : clic ou glisser pour choisir le cap ; en vue carte, clic sur l'eau = cap vers ce point
function pointerSteer(e: PointerEvent): boolean {
  const g = app.g; if (!g || !playing()) return false;
  const r = c2d.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, ring = c2d.ring;
  const dx = x - ring.x, dy = y - ring.y;
  if (dx * dx + dy * dy < ring.r * ring.r) {
    if (dx * dx + dy * dy < 14 * 14) return true; // clic au centre : rien
    unlockAudio(); g.steerTo(g.me.h + Math.atan2(dy, dx) + Math.PI / 2); return true;
  }
  if (app.view === 'top') {
    const wx = c2d.cam.x + (x - c2d.VW / 2) / c2d.zoom, wy = c2d.cam.y + (y - c2d.VH / 2) / c2d.zoom;
    unlockAudio(); g.steerTo(Math.atan2(wx - g.me.x, -(wy - g.me.y))); return true;
  }
  return false;
}
let ringDrag = false;
$('game').addEventListener('pointerdown', e => {
  if ((e.target as HTMLElement).closest('.ov, button')) return;
  if (pointerSteer(e)) { ringDrag = true; e.preventDefault(); e.stopPropagation(); }
}, { capture: true });
$('game').addEventListener('pointermove', e => { if (ringDrag) { pointerSteer(e); e.stopPropagation(); } }, { capture: true });
addEventListener('pointerup', () => { ringDrag = false; });

// ---------- boucle : simulation à pas fixe, rendu interpolé ----------
let last = performance.now(), hudT = 0, acc = 0;
function draw(g: Game, dt: number, alpha: number): void {
  const { boats, me } = snapshot(g, alpha);
  const rt = (g.simT - STEP + alpha * STEP) / (g.demo ? 2 : g.pace);
  c2d.rt = rt;
  if (app.view !== 'top' && R3) {
    c2d.clear();
    try { R3.render(g, boats, me, dt, rt, app.view); } catch (e) { console.error(e); R3 = null; setView('top'); }
    if (!g.demo && R3) { const r3 = R3; c2d.drawHUD(g, boats, me, null, (x, y, z) => r3.project(x, y, z, c2d.VW, c2d.VH)); }
  } else {
    const toS = c2d.drawTop(g, boats, me);
    if (!g.demo) c2d.drawHUD(g, boats, me, toS);
  }
}
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const g = app.g;
  if (g) {
    if (!paused) {
      acc += dt * g.timeScale * (g.demo ? 2 : g.pace);
      const inp = input(), t0 = performance.now();
      while (acc >= STEP) {
        g.update(STEP, inp); acc -= STEP;
        if (performance.now() - t0 > 40) { acc = 0; break; } // machine trop lente pour cette accélération
      }
    }
    if (g.over) demo();
    else draw(g, dt, paused ? 1 : acc / STEP);
  }
  // en ligne : ma position part au serveur 10 fois par seconde
  if (g && g.mode === 'net' && net.connected) {
    netSendT -= dt;
    if (netSendT <= 0) { netSendT = 0.1; net.send({ type: 'state', s: g.snapshotMe(), leg: g.me.leg, d: Math.round(g.remaining(g.me)), ocs: g.me.ocs }); }
  }
  updSound(app.g, app.g ? app.g.simT : 0);
  hudT -= dt; if (hudT <= 0) { updateHud(app.g, renderRank); hudT = 0.1; $('timeBtn').firstChild!.textContent = 'Temps ×' + (app.g?.timeScale ?? 1); }
  requestAnimationFrame(loop);
}

// accès pour les tests automatisés (Playwright)
(window as unknown as { __regate: unknown }).__regate = {
  app, setView, startSolo, K, c2d,
  /** Oriente la caméra (tests). */
  lookAt(yaw: number, pitch = 0) { if (R3) { R3.look.yaw = yaw; R3.look.pitch = pitch; R3.look.idle = -1e9; } },
  /** Confie le bateau du joueur à une IA (tests). */
  autopilot() { const g = app.g; if (g) { g.me.ai = mkAI(LEVELS[2], g.me.x, makeRng(5), newMem()); g.me.perf = 1; } },
  /** Avance la simulation de n secondes d'un coup (tests). */
  advance(n: number) { const g = app.g; if (g) for (let i = 0; i < n / STEP && !g.over; i++) g.update(STEP, input()); },
};

void PRE;
fit(); demo(); updateHud(app.g, renderRank); requestAnimationFrame(loop);
