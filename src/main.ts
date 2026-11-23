// Point d'entrée : menus, entrées clavier/tactile, boucle à pas fixe (60 Hz) + rendu interpolé.
import './style.css';
import { fmt, ord } from './util/math';
import { Game, PRE, STEP, type Input } from './game/game';
import { Canvas2D } from './render/canvas2d';
import { Scene3D } from './render/scene3d';
import { snapshot } from './render/snapshot';
import { $, updateHud } from './ui/hud';
import { unlockAudio, sfx, boom, updSound } from './audio/sound';
import { app, type View } from './app';

const K: Input = { left: false, right: false, up: false, down: false, auto: false };
const c2d = new Canvas2D($<HTMLCanvasElement>('c'));
let R3: Scene3D | null = null;

try { app.best = parseFloat(localStorage.getItem('regate-best') || '') || null; } catch { /* */ }

function fit(): void { c2d.fit(); if (R3) R3.resize(c2d.VW, c2d.VH); }
new ResizeObserver(fit).observe(c2d.cv);

// ---------- partie ----------
function start(g: Game): void {
  app.g = g;
  g.onSfx = sfx;
  g.onFinish = finishMe;
  c2d.resetCam(g.me.x, g.me.y - 80);
  acc = 0;
}
function demo(): void { start(new Game({ mode: 'solo', demo: true, bots: 4, lvl: 2, startT: PRE - 2 })); }
function startSolo(): void {
  unlockAudio();
  start(new Game({ mode: 'solo', bots: +$<HTMLSelectElement>('nBots').value, lvl: +$<HTMLSelectElement>('lvl').value, met: +$<HTMLSelectElement>('met').value }));
  $('ovStart').hidden = true; $('ovEnd').hidden = true;
}
function menu(): void { $('ovEnd').hidden = true; $('ovStart').hidden = false; demo(); }

function finishMe(): void {
  const g = app.g;
  setTimeout(() => { if (!app.g || app.g !== g || g.demo || g.me.fin == null) return; showEnd(g); }, 1100);
}
function showEnd(g: Game): void {
  const t = g.me.fin!, st = g.standings(), pos = st.findIndex(e => e.me) + 1;
  $('endTitle').textContent = pos === 1 && st.length > 1 ? 'Victoire !' : 'Arrivée !';
  $('endTime').textContent = fmt(t);
  let line = st.length > 1 ? ord(pos) + ' sur ' + st.length + '. ' : '';
  if (g.mode === 'solo') {
    const best = app.best, rec = best === null || t < best;
    line += rec ? (best === null ? 'Premier temps enregistré.' : 'Nouveau record ! Ancien : ' + fmt(best)) : 'Ton record : ' + fmt(best!);
    if (rec) { app.best = t; try { localStorage.setItem('regate-best', String(t)); } catch { /* */ } }
  }
  $('endBest').textContent = line;
  g.endShown = true; renderRank(); $('ovEnd').hidden = false; $('againBtn').focus();
}
function renderRank(): void {
  const g = app.g; if (!g) return;
  const st = g.standings(), ol = $('endRank');
  ol.innerHTML = st.map(e => `<li class="${e.me ? 'me' : ''}"><span></span><span class="dot"></span><span></span><span></span></li>`).join('');
  [...ol.children].forEach((li, i) => {
    const e = st[i], c = li.children as HTMLCollectionOf<HTMLElement>;
    c[0].textContent = ord(i + 1); c[1].style.background = e.col;
    c[2].textContent = e.name + (e.me ? ' (toi)' : '');
    c[3].textContent = e.fin != null ? fmt(e.fin) : e.ocs ? 'départ anticipé' : 'en course';
  });
}

// ---------- vues ----------
const VIEWS: View[] = ['pov', 'chase', 'top'], VLBL: Record<View, string> = { pov: 'cockpit', chase: 'poursuite', top: 'vue du ciel' };
function setView(v: View): void {
  app.view = v; try { localStorage.setItem('regate-view', v); } catch { /* */ }
  $('viewBtn').textContent = 'Vue : ' + VLBL[v] + ' (V)';
  $('gl').style.visibility = v === 'top' ? 'hidden' : 'visible';
}
function nextView(): void { const L = R3 ? VIEWS : ['top' as View]; setView(L[(L.indexOf(app.view) + 1) % L.length]); }
function setSnd(v: boolean): void { app.soundOn = v; try { localStorage.setItem('regate-snd', v ? '1' : '0'); } catch { /* */ } $('sndBtn').textContent = 'Son : ' + (v ? 'oui' : 'non') + ' (M)'; }
function setAuto(v: boolean): void { app.auto = K.auto = v; $<HTMLInputElement>('autoChk').checked = v; $('autoBtn').textContent = 'Réglage auto : ' + (v ? 'oui' : 'non'); }

$('viewBtn').addEventListener('click', nextView);
$('sndBtn').addEventListener('click', () => { unlockAudio(); setSnd(!app.soundOn); });
try { setSnd(localStorage.getItem('regate-snd') !== '0'); } catch { /* */ }
try { R3 = new Scene3D($<HTMLCanvasElement>('gl')); R3.onBoom = boom; } catch (e) { console.error(e); R3 = null; }
{
  let v: string | null = null; try { v = localStorage.getItem('regate-view'); } catch { /* */ }
  setView(R3 ? (VIEWS.includes(v as View) ? v as View : 'pov') : 'top');
  if (!R3) $('viewBtn').hidden = true;
}

// ---------- menus ----------
function tab(isNet: boolean): void {
  $('tSolo').classList.toggle('on', !isNet); $('tNet').classList.toggle('on', isNet);
  $('pSolo').hidden = isNet; $('pNet').hidden = !isNet;
}
$('tSolo').addEventListener('click', () => tab(false));
$('tNet').addEventListener('click', () => tab(true));
$('goBtn').addEventListener('click', startSolo);
$('againBtn').addEventListener('click', startSolo);
$('menuBtn').addEventListener('click', menu);
$('autoChk').addEventListener('change', e => setAuto((e.target as HTMLInputElement).checked));
$('autoBtn').addEventListener('click', () => setAuto(!app.auto));
const toggleSpi = () => { const g = app.g; if (g && !g.demo && g.me.fin == null) g.me.spi = !g.me.spi; };
$('spiBtn').addEventListener('click', toggleSpi);

// ---------- entrées ----------
type Dir = 'left' | 'right' | 'up' | 'down';
const playing = () => !!app.g && !app.g.demo && $('ovStart').hidden;
const MAP: Record<string, Dir> = { ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', KeyZ: 'up', ArrowDown: 'down', KeyS: 'down' };
addEventListener('keydown', e => {
  if ((e.target as HTMLElement).tagName === 'INPUT') return;
  const k = MAP[e.code]; if (k && playing()) { K[k] = true; e.preventDefault(); }
  if ((e.code === 'Space' || e.code === 'KeyE') && playing()) { e.preventDefault(); if (!e.repeat) toggleSpi(); }
  if (e.code === 'KeyR' && playing() && app.g!.mode === 'solo') startSolo();
  if (e.code === 'KeyV' && !e.repeat) nextView();
  if (e.code === 'KeyM' && !e.repeat) { unlockAudio(); setSnd(!app.soundOn); }
});
addEventListener('keyup', e => { const k = MAP[e.code]; if (k) K[k] = false; });
addEventListener('blur', () => { K.left = K.right = K.up = K.down = false; });
document.querySelectorAll<HTMLElement>('[data-k]').forEach(b => {
  const k = b.dataset.k as Dir;
  const on = (e: PointerEvent) => { e.preventDefault(); K[k] = true; b.classList.add('on'); try { b.setPointerCapture(e.pointerId); } catch { /* */ } };
  const off = () => { K[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
});

// ---------- boucle : simulation à pas fixe, rendu interpolé ----------
let last = performance.now(), hudT = 0, acc = 0;
function draw(g: Game, dt: number, alpha: number): void {
  const { boats, me } = snapshot(g, alpha);
  const rt = g.simT - STEP + alpha * STEP;
  c2d.rt = rt;
  if (app.view !== 'top' && R3) {
    c2d.clear();
    try { R3.render(g, boats, me, dt, rt, app.view); } catch (e) { console.error(e); R3 = null; setView('top'); }
    if (!g.demo) c2d.drawHUD(g, boats, me, null);
  } else {
    const o = c2d.drawTop(g, boats, me);
    if (!g.demo) c2d.drawHUD(g, boats, me, o);
  }
}
function loop(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const g = app.g;
  if (g) {
    acc += dt;
    while (acc >= STEP) { g.update(STEP, K); acc -= STEP; }
    if (g.over) demo();
    else draw(g, dt, acc / STEP);
  }
  updSound(app.g, app.g ? app.g.simT : 0);
  hudT -= dt; if (hudT <= 0) { updateHud(app.g, renderRank); hudT = 0.1; }
  requestAnimationFrame(loop);
}

// accès pour les tests automatisés (Playwright)
(window as unknown as { __regate: unknown }).__regate = {
  app, setView, startSolo, K,
  /** Avance la simulation de n secondes d'un coup (tests). */
  advance(n: number) { const g = app.g; if (g) for (let i = 0; i < n / STEP && !g.over; i++) g.update(STEP, K); },
};

fit(); demo(); updateHud(app.g, renderRank); requestAnimationFrame(loop);
