// Rendu 2D : vue du ciel (tactique, avec zoom) et surimpressions (instruments, réglage, classement, carte).
import { D, TAU, clamp, hash, norm, fmt } from '../util/math';
import { ISLANDS, shoreR } from '../physics/world';
import { vmgAngles, polarSpeed } from '../physics/polar';
import { headAngle, mainAngle } from '../physics/model';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';
import { app } from '../app';

export type ToScreen = (x: number, y: number) => [number, number];
export const ZOOMS = [0.08, 0.25, 0.7, 1.6, 3.5];
const fmtDist = (m: number) => m < 1852 ? Math.round(m / 10) * 10 + ' m' : (m / 1852).toFixed(m < 18520 ? 1 : 0).replace('.', ',') + ' M';

export class Canvas2D {
  readonly ctx: CanvasRenderingContext2D;
  DPR = 1; VW = 800; VH = 500;
  cam = { x: 0, y: 150 };
  zoomI = 3;
  /** Boussole cliquable (coordonnées écran). */
  ring = { x: -999, y: -999, r: 0 };
  rt = 0;

  constructor(readonly cv: HTMLCanvasElement) { this.ctx = cv.getContext('2d')!; }

  get zoom(): number { return ZOOMS[this.zoomI]; }
  fit(): void {
    const r = this.cv.getBoundingClientRect();
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.VW = r.width; this.VH = r.height;
    this.cv.width = Math.round(this.VW * this.DPR); this.cv.height = Math.round(this.VH * this.DPR);
  }
  resetCam(x: number, y: number): void { this.cam = { x, y }; }
  clear(): void { this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0); this.ctx.clearRect(0, 0, this.VW, this.VH); }

  private rrect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }
  private panel(x: number, y: number, w: number, h: number, r = 12, a = 0.62): void {
    this.ctx.fillStyle = `rgba(4,30,50,${a})`; this.rrect(x, y, w, h, r); this.ctx.fill();
  }

  /** Bateau en mètres (repère monde déjà appliqué). k : facteur d'agrandissement si zoom faible. */
  private drawBoat(b: Boat, k: number, isMe: boolean): void {
    const ctx = this.ctx, z = this.zoom;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.h); ctx.scale(k, k);
    const hull = () => { ctx.beginPath(); ctx.moveTo(-1, -9.1); ctx.quadraticCurveTo(-2.9, -6, -2.8, 0); ctx.lineTo(-2.5, 9.1); ctx.lineTo(2.5, 9.1); ctx.lineTo(2.8, 0); ctx.quadraticCurveTo(2.9, -6, 1, -9.1); ctx.closePath(); };
    ctx.save(); ctx.translate(1, 1.6); hull(); ctx.fillStyle = 'rgba(0,20,40,.3)'; ctx.fill(); ctx.restore();
    hull(); ctx.fillStyle = '#f3f6f8'; ctx.fill(); ctx.lineWidth = (isMe ? 2.5 : 1.2) / z / k; ctx.strokeStyle = isMe ? '#fff' : '#0a3550'; ctx.stroke();
    ctx.fillStyle = b.col; ctx.fillRect(-2.6, 2, 5.2, 1.4);
    ctx.fillStyle = '#33464f'; ctx.fillRect(-1.2, 0.5, 2.4, 3.8);
    const tack = b.twa >= 0 ? 1 : -1;
    // foils sortis
    ctx.strokeStyle = '#1f2a30'; ctx.lineWidth = 0.35;
    if (b.foilP > 0.05) { ctx.beginPath(); ctx.moveTo(-2.7, -2); ctx.lineTo(-2.7 - 3 * b.foilP, -1.6); ctx.stroke(); }
    if (b.foilS > 0.05) { ctx.beginPath(); ctx.moveTo(2.7, -2); ctx.lineTo(2.7 + 3 * b.foilS, -1.6); ctx.stroke(); }
    // grand-voile (bôme) et voile d'avant
    const lee = tack, mA = clamp(mainAngle(b.mainSheet, b.trav), -6, 85) * D, mz = -1.5;
    const aa = Math.abs(b.awa) / D, mf = b.knock > 0 || aa < mainAngle(b.mainSheet, b.trav) + 2;
    const camb = mf ? Math.sin(this.rt * 30 + b.x) * 0.6 : 1.1;
    ctx.beginPath(); ctx.moveTo(0, mz);
    const bx = lee * Math.sin(mA) * 7.2, by = mz + Math.cos(mA) * 7.2;
    ctx.quadraticCurveTo(bx / 2 + lee * Math.cos(mA) * camb, (mz + by) / 2 - Math.sin(mA) * camb, bx, by); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.strokeStyle = '#5f7f93'; ctx.lineWidth = 0.15; ctx.stroke();
    ctx.strokeStyle = '#1b2328'; ctx.lineWidth = 0.35; ctx.beginPath(); ctx.moveTo(0, mz); ctx.lineTo(bx, by); ctx.stroke();
    if (b.headPow > 0.05) {
      const s = b.cls.heads[b.head], hA = headAngle(s, b.headSheet) * D, gen = s.id === 'A3' || s.id === 'C0';
      const tz = gen ? -11.4 : -9, len = (gen ? (s.id === 'A3' ? 13 : 10) : 7) * b.headPow;
      const cx = lee * Math.sin(hA) * len, cy = tz + Math.cos(hA) * len, bel = s.id === 'A3' ? 4 : 1.2;
      ctx.beginPath(); ctx.moveTo(0, tz); ctx.quadraticCurveTo(cx / 2 + lee * Math.cos(hA) * bel, (tz + cy) / 2 - Math.sin(hA) * bel, cx, cy); ctx.lineTo(0, tz);
      ctx.fillStyle = s.color ? s.color : 'rgba(255,255,255,.9)'; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(10,40,60,.5)'; ctx.lineWidth = 0.12; ctx.stroke();
    }
    ctx.fillStyle = '#1b2328'; ctx.beginPath(); ctx.arc(0, mz, 0.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  /** Vue du ciel. Renvoie la projection monde → écran. */
  drawTop(g: Game, boats: Boat[], me: Boat): ToScreen {
    const ctx = this.ctx, w = this.VW, h = this.VH, z = this.zoom, cam = this.cam, anim = this.rt;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    const lead = Math.min(w, h) * 0.18 / z;
    const cx = me.x + Math.sin(me.h) * Math.min(lead, me.v * 6), cy = me.y - Math.cos(me.h) * Math.min(lead, me.v * 6);
    cam.x += (cx - cam.x) * 0.06; cam.y += (cy - cam.y) * 0.06;
    const toS: ToScreen = (x, y) => [w / 2 + (x - cam.x) * z, h / 2 + (y - cam.y) * z];
    const vx0 = cam.x - w / 2 / z, vy0 = cam.y - h / 2 / z, vx1 = cam.x + w / 2 / z, vy1 = cam.y + h / 2 / z;
    const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#1077b0'); bg.addColorStop(1, '#0a4d7a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-cam.x, -cam.y);
    const px = 1 / z; // un pixel en mètres
    // risées
    g.wind.eachGust(vx0 - 900, vy0 - 900, vx1 + 900, vy1 + 900, g.t, (gx, gy, r, s) => {
      const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      rg.addColorStop(0, `rgba(3,28,52,${0.1 + s * 0.035})`); rg.addColorStop(1, 'rgba(3,28,52,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill();
    });
    // rides de vent (densité constante à l'écran)
    const C = 78 * px, x0 = Math.floor(vx0 / C) - 1, x1 = Math.ceil(vx1 / C) + 1, y0 = Math.floor(vy0 / C) - 1, y1 = Math.ceil(vy1 / C) + 1;
    const wx = -Math.sin(g.wd), wy = Math.cos(g.wd);
    ctx.lineWidth = 1.6 * px; ctx.lineCap = 'round';
    if ((x1 - x0) * (y1 - y0) < 6000) for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const r1 = hash(i, j), r2 = hash(j, i), ph = (anim * 0.35 + r1) % 1, d = ph * 60 * px, qx = i * C + r2 * C + wx * d, qy = j * C + r1 * C + wy * d;
      ctx.strokeStyle = `rgba(220,240,255,${Math.sin(ph * Math.PI) * 0.38})`;
      ctx.save(); ctx.translate(qx, qy); ctx.rotate(g.wd); ctx.beginPath(); ctx.moveTo(-8 * px, 0); ctx.quadraticCurveTo(0, -4 * px, 8 * px, 0); ctx.stroke(); ctx.restore();
    }
    // îles
    for (const isl of ISLANDS) {
      if (isl.x + isl.r * 1.3 < vx0 || isl.x - isl.r * 1.3 > vx1 || isl.y + isl.r * 1.3 < vy0 || isl.y - isl.r * 1.3 > vy1) continue;
      const path = (k: number) => { ctx.beginPath(); for (let a = 0; a <= 64; a++) { const th = a / 64 * TAU, R = shoreR(isl, th) * k; const X = isl.x + Math.cos(th) * R, Y = isl.y + Math.sin(th) * R; if (a) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); } ctx.closePath(); };
      path(1.12); ctx.fillStyle = 'rgba(120,200,210,.35)'; ctx.fill();
      path(1); ctx.fillStyle = '#e3d6ae'; ctx.fill();
      path(0.9); ctx.fillStyle = '#5f8456'; ctx.fill();
      path(0.45); ctx.fillStyle = '#46653f'; ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `700 ${14 * px}px Barlow,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(isl.name, isl.x, isl.y);
    }
    // parcours
    const c = g.course, N = c.marks.length;
    ctx.setLineDash([8 * px, 8 * px]); ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.moveTo(0, 0); for (const m of c.marks) ctx.lineTo(m.x, m.y); ctx.lineTo(0, 0); ctx.stroke(); ctx.setLineDash([]);
    // laylines vers la prochaine marque (au près / au portant)
    const nm = me.leg >= 1 && me.leg <= N && !me.ocs ? c.marks[me.leg - 1] : null;
    if (nm && !g.demo) {
      const ang = vmgAngles(me.cls.polar, Math.round(me.tws));
      const rel = norm(Math.atan2(nm.x - me.x, -(nm.y - me.y)) - g.wd), L = 6000;
      const draw = (a: number) => { for (const s of [-1, 1]) { const hh = g.wd + s * a * D; ctx.beginPath(); ctx.moveTo(nm.x, nm.y); ctx.lineTo(nm.x - Math.sin(hh) * L, nm.y + Math.cos(hh) * L); ctx.stroke(); } };
      ctx.strokeStyle = 'rgba(255,214,120,.5)'; ctx.lineWidth = 1.5 * px; ctx.setLineDash([3 * px, 6 * px]);
      if (Math.abs(rel) < ang.up * D + 0.1) draw(ang.up); else if (Math.abs(rel) > ang.down * D - 0.1) draw(ang.down);
      ctx.setLineDash([]);
    }
    // ligne de départ / arrivée
    const lineHot = me.leg === 0 || me.leg > N || me.ocs;
    ctx.strokeStyle = lineHot ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2 * px; ctx.setLineDash([10 * px, 8 * px]);
    ctx.beginPath(); ctx.moveTo(c.pin.x, c.pin.y); ctx.lineTo(c.cmte.x, c.cmte.y); ctx.stroke(); ctx.setLineDash([]);
    if (lineHot) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = `800 ${15 * px}px "Barlow Condensed",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(me.leg > N ? 'ARRIVÉE ↓' : 'DÉPART ↑', 0, me.leg > N ? -14 * px : 16 * px);
    }
    const mk = (x: number, y: number, col: string, label: string, hot: boolean) => {
      const r = Math.max(3, 6 * px);
      if (hot) { const p = (anim * 1.2) % 1; ctx.strokeStyle = `rgba(255,255,255,${1 - p})`; ctx.lineWidth = 2 * px; ctx.beginPath(); ctx.arc(x, y, r + (6 + p * 50) * px, 0, TAU); ctx.stroke(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.strokeStyle = '#7a2a08'; ctx.lineWidth = 1 * px; ctx.stroke();
      if (label) { ctx.fillStyle = '#fff'; ctx.font = `800 ${13 * px}px "Barlow Condensed",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y - r - 9 * px); }
    };
    mk(c.pin.x, c.pin.y, '#ffc93c', '', false);
    ctx.save(); ctx.translate(c.cmte.x + 5, c.cmte.y); const ks = Math.max(1, 10 * px / 3);
    ctx.scale(ks, ks); ctx.fillStyle = '#eef3f6'; ctx.fillRect(-2.5, -8, 5, 16); ctx.fillStyle = g.t < 0 ? '#3d7bd9' : '#ff6a1f'; ctx.fillRect(0, -6, 2.5, 2); ctx.restore();
    c.marks.forEach((m, i) => {
      const hot = me.leg === i + 1 && !me.ocs && !g.demo;
      const lbl = (m.side === 'port' ? '◀ ' : '') + (i + 1) + (m.side === 'stbd' ? ' ▶' : '');
      if (m.island == null) mk(m.x, m.y, '#ff6a1f', lbl, hot);
      else if (hot) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 6 * px]); ctx.beginPath(); ctx.moveTo(m.x + m.out.x * m.rayStart, m.y + m.out.y * m.rayStart); ctx.lineTo(m.x + m.out.x * m.rayLen, m.y + m.out.y * m.rayLen); ctx.stroke(); ctx.setLineDash([]); }
    });
    // sillages et bateaux
    ctx.fillStyle = '#fff';
    for (const b of boats) for (const p of b.wake) { ctx.globalAlpha = (1 - p.t / 6) * 0.4; ctx.beginPath(); ctx.arc(p.x, p.y, 1 + p.t * 0.8, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
    const k = Math.max(1, 40 * px / 18.3);
    for (const b of boats) if (b !== me) this.drawBoat(b, k, false);
    this.drawBoat(me, k, !g.demo);
    ctx.restore();
    // étiquettes en pixels
    ctx.font = '600 12px Barlow,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const b of boats) {
      const label = b === me ? (g.demo ? '' : 'Toi') : b.name; if (!label) continue;
      const [sx, sy] = toS(b.x, b.y), wl = ctx.measureText(label).width + 10;
      ctx.fillStyle = 'rgba(4,30,50,.55)'; this.rrect(sx - wl / 2, sy + 14 * k * z / k + 12, wl, 17, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, sx, sy + 14 * k * z / k + 14);
    }
    return toS;
  }

  private drawTrim(me: Boat, auto: boolean, w: number, h: number): void {
    const ctx = this.ctx, anim = this.rt;
    const narrow = w < 900, pw = Math.min(430, w - 24 - (narrow ? 190 : 0)), px = narrow ? 12 : (w - pw) / 2, ph = 124, py = h - ph - 12;
    this.panel(px, py, pw, ph, 16, 0.74);
    const x0 = px + 96, x1 = px + pw - 16, bw = x1 - x0, X = (v: number) => x0 + clamp(v, 0, 1) * bw;
    const row = (y: number, name: string, cur: number, tgt: number, keys: string) => {
      const d = cur - tgt, ad = Math.abs(d), col = ad < 0.05 ? '#3ddc97' : ad < 0.13 ? '#c5e86c' : ad < 0.25 ? '#f4a261' : '#e8384f';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '800 17px "Barlow Condensed",sans-serif'; ctx.fillStyle = col; ctx.fillText(name, px + 14, y + 6);
      ctx.font = '600 10px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(keys, px + 14, y + 21);
      ctx.fillStyle = 'rgba(255,255,255,.16)'; this.rrect(x0, y, bw, 12, 6); ctx.fill();
      ctx.fillStyle = 'rgba(61,220,151,.28)'; this.rrect(X(tgt - 0.13), y, X(tgt + 0.13) - X(tgt - 0.13), 12, 6); ctx.fill();
      ctx.fillStyle = '#3ddc97'; this.rrect(X(tgt - 0.05), y, X(tgt + 0.05) - X(tgt - 0.05), 12, 6); ctx.fill();
      const cx = X(cur);
      if (ad > 0.13 && !auto) { const dir = d > 0 ? -1 : 1; ctx.fillStyle = 'rgba(255,255,255,.85)'; for (let i = 0; i < 3; i++) { const ax = cx + dir * (14 + i * 10 + ((anim * 30) % 10)); if ((dir < 0 && ax < X(tgt)) || (dir > 0 && ax > X(tgt))) continue; ctx.beginPath(); ctx.moveTo(ax + dir * 5, y + 6); ctx.lineTo(ax - dir * 2, y + 1); ctx.lineTo(ax - dir * 2, y + 11); ctx.fill(); } }
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 2, y - 5, 4, 22);
    };
    ctx.textAlign = 'right'; ctx.font = '600 11px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(auto ? 'écoutes automatiques' : '◀ bordé · choqué ▶', x1, py + 14);
    const ef = Math.round(me.eff * 100);
    ctx.textAlign = 'left'; ctx.font = '800 15px "Barlow Condensed",sans-serif'; ctx.fillStyle = ef > 95 ? '#3ddc97' : ef > 80 ? '#f4a261' : '#e8384f';
    ctx.fillText('Polaire ' + ef + ' %', px + 14, py + 14);
    row(py + 28, 'Grand-voile', me.mainSheet, me.ideal.mainSheet, '↑ ↓');
    row(py + 60, me.cls.heads[me.head].id + ' · voile d\'avant', me.headSheet, me.ideal.headSheet, 'Maj + ↑ ↓');
    // chariot
    const ty = py + 96;
    ctx.font = '600 11px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'left'; ctx.fillText('Chariot (W/X)', px + 14, ty + 6);
    const tx0 = x0, tw = Math.min(140, bw * 0.4), T = (v: number) => tx0 + (v + 1) / 2 * tw;
    ctx.fillStyle = 'rgba(255,255,255,.16)'; this.rrect(tx0, ty, tw, 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(61,220,151,.6)'; ctx.fillRect(T(me.ideal.trav) - 3, ty, 6, 10);
    ctx.fillStyle = '#fff'; ctx.fillRect(T(me.trav) - 2, ty - 3, 4, 16);
    // penons
    const d = me.headSheet - me.ideal.headSheet, wb = d > 0.06, lb = d < -0.06, yx = tx0 + tw + 16;
    if (x1 - yx > 150) {
      const yarn = (x: number, y: number, col: string, bad: boolean, ph: number) => { ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); for (let i = 1; i <= 6; i++) ctx.lineTo(x + i * 3.4, y + (bad ? Math.sin(ph + i * 0.9) * 4 - i * 0.9 : Math.sin(ph * 0.5 + i) * 0.6)); ctx.stroke(); };
      yarn(yx, ty + 5, '#e8384f', wb, anim * 14); yarn(yx + 30, ty + 5, '#3ddc97', lb, anim * 14 + 2);
      ctx.fillStyle = wb ? '#ffb3bd' : lb ? '#b6f5d9' : 'rgba(255,255,255,.7)'; ctx.font = '600 11px Barlow,sans-serif';
      ctx.fillText(wb ? 'penon au vent se lève : borde' : lb ? 'penon sous le vent décroche : choque' : 'penons : ça file', yx + 60, ty + 6);
    }
  }

  /** Traits de vitesse sur les bords de l'écran, au-delà de ~14 nœuds. */
  private speedLines(me: Boat, w: number, h: number): void {
    const kn = me.v / 0.514444, a = clamp((kn - 9) / 16, 0, 1) * 0.42;
    if (a <= 0) return;
    const ctx = this.ctx, cx = w / 2, cy = h * 0.45, R = Math.hypot(w, h) / 2;
    ctx.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const ang = hash(i, 3) * TAU, sp = 0.6 + hash(i, 7) * 0.8;
      const ph = (this.rt * sp * (0.6 + kn / 25) + hash(i, 11)) % 1;
      const r0 = R * (0.55 + ph * 0.5), r1 = r0 + R * (0.06 + kn / 400);
      ctx.strokeStyle = `rgba(235,245,255,${a * Math.sin(ph * Math.PI)})`; ctx.lineWidth = 1.5 + hash(i, 5) * 1.5;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0); ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); ctx.stroke();
    }
  }

  /**
   * Boussole tactile, bateau vers le haut : zone interdite face au vent (rouge), vitesse possible
   * selon la direction (courbe verte), bouée (orange), cap conseillé (flèche verte), consigne (blanc).
   * Un clic dessus choisit le cap.
   */
  private compass(g: Game, me: Boat, w: number, h: number): void {
    const ctx = this.ctx, R = w < 640 ? 60 : 76, cx = w - R - 24, cy = h - R - 24, wd = g.wd;
    this.ring = { x: cx, y: cy, r: R + 16 };
    const sa = (H: number) => H - me.h - Math.PI / 2; // cap monde → angle écran
    const tws = Math.max(4, Math.round(me.tws)), ang = vmgAngles(me.cls.polar, tws);
    ctx.save();
    ctx.fillStyle = 'rgba(4,30,50,.68)'; ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, TAU); ctx.fill();
    // zone interdite
    ctx.fillStyle = 'rgba(232,56,79,.4)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, sa(wd - ang.up * D), sa(wd + ang.up * D)); ctx.closePath(); ctx.fill();
    // courbe des vitesses
    let vmax = 1; for (let a = 0; a <= 180; a += 5) vmax = Math.max(vmax, polarSpeed(me.cls.polar, tws, a));
    ctx.beginPath();
    for (let a = -180; a <= 180; a += 4) {
      const v = Math.abs(a) < ang.up ? 0 : polarSpeed(me.cls.polar, tws, Math.abs(a)) / vmax, r = R * (0.18 + 0.82 * v), q = sa(wd + a * D);
      const X = cx + Math.cos(q) * r, Y = cy + Math.sin(q) * r; if (a === -180) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.closePath(); ctx.fillStyle = 'rgba(61,220,151,.16)'; ctx.fill(); ctx.strokeStyle = 'rgba(61,220,151,.7)'; ctx.lineWidth = 1.5; ctx.stroke();
    // graduations
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
    for (let k = 0; k < 12; k++) { const q = sa(k * Math.PI / 6); ctx.beginPath(); ctx.moveTo(cx + Math.cos(q) * (R + 4), cy + Math.sin(q) * (R + 4)); ctx.lineTo(cx + Math.cos(q) * (R + 11), cy + Math.sin(q) * (R + 11)); ctx.stroke(); }
    const rim = (H: number, rr: number) => [cx + Math.cos(sa(H)) * rr, cy + Math.sin(sa(H)) * rr];
    // vent : flèche qui entre par le bord
    { const [x1, y1] = rim(wd, R + 14), [x2, y2] = rim(wd, R - 8), q = Math.atan2(y2 - y1, x2 - x1);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x2 + Math.cos(q) * 6, y2 + Math.sin(q) * 6); ctx.lineTo(x2 + Math.cos(q + 2.5) * 8, y2 + Math.sin(q + 2.5) * 8); ctx.lineTo(x2 + Math.cos(q - 2.5) * 8, y2 + Math.sin(q - 2.5) * 8); ctx.fill(); }
    // bouée visée
    const c = g.course, N = c.marks.length, tm = me.leg >= 1 && me.leg <= N && !me.ocs ? c.marks[me.leg - 1] : { x: 0, y: me.leg > N ? 60 : -60 };
    { const brg = Math.atan2(tm.x - me.x, -(tm.y - me.y)), [x, y] = rim(brg, R + 8); ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.arc(x, y, 6, 0, TAU); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
    // consigne (pilote)
    if (me.pilot.on && !g.routeAuto) {
      const H = me.pilot.mode === 'cap' ? me.pilot.set : wd + me.pilot.set, [x, y] = rim(H, R + 8);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.stroke();
    }
    // cap conseillé
    if (g.advice != null) {
      const q = sa(g.advice), pul = 0.75 + 0.25 * Math.sin(this.rt * 6);
      ctx.strokeStyle = `rgba(80,255,150,${pul})`; ctx.lineWidth = 3; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(q) * (R - 4), cy + Math.sin(q) * (R - 4)); ctx.stroke(); ctx.setLineDash([]);
      const tx = cx + Math.cos(q) * (R + 2), ty = cy + Math.sin(q) * (R + 2);
      ctx.fillStyle = `rgba(80,255,150,${pul})`; ctx.beginPath(); ctx.moveTo(tx + Math.cos(q) * 10, ty + Math.sin(q) * 10); ctx.lineTo(tx + Math.cos(q + 2.2) * 9, ty + Math.sin(q + 2.2) * 9); ctx.lineTo(tx + Math.cos(q - 2.2) * 9, ty + Math.sin(q - 2.2) * 9); ctx.fill();
    }
    // le bateau au centre, étrave vers le haut
    ctx.fillStyle = me.col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy - 15); ctx.quadraticCurveTo(cx + 7, cy - 6, cx + 6, cy + 11); ctx.lineTo(cx - 6, cy + 11); ctx.quadraticCurveTo(cx - 7, cy - 6, cx, cy - 15); ctx.fill(); ctx.stroke();
    // conseil et route auto
    const txt = g.routeAuto ? 'ROUTE AUTO · G pour reprendre la barre' : g.adviceTxt;
    if (txt) {
      ctx.font = '800 17px "Barlow Condensed",sans-serif'; const tw = Math.min(w - 40, ctx.measureText(txt).width + 26);
      const bx = Math.min(w - 12 - tw, cx + R + 16 - tw), by = cy - R - 16 - 66;
      ctx.fillStyle = g.routeAuto ? 'rgba(255,106,31,.9)' : 'rgba(4,30,50,.75)'; this.rrect(bx, by, tw, 30, 15); ctx.fill();
      ctx.fillStyle = g.routeAuto ? '#fff' : /Vire|Empanne/.test(txt) ? '#ffd23f' : '#6dffaa'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, bx + tw / 2, by + 16, tw - 12);
      ctx.font = '600 11px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.textAlign = 'right';
      ctx.fillText('clique sur la boussole pour choisir ton cap', cx + R + 16, by + 44);
    }
    ctx.restore();
  }

  /** Grand compteur de vitesse. */
  private speedo(me: Boat, w: number, h: number): void {
    const ctx = this.ctx, kn = Math.max(0, me.v / 0.514444), x = 16, y = h - (w < 640 ? 230 : 104);
    const fly = me.foilLift / (9.81 * me.cls.mass) > 0.22;
    this.panel(x, y, 150, 90, 14, 0.62);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = kn > 25 ? '#ffd23f' : '#fff'; ctx.font = '800 54px "Barlow Condensed",sans-serif';
    const txt = kn.toFixed(1).replace('.', ','); ctx.fillText(txt, x + 12, y + 54);
    const tw = ctx.measureText(txt).width;
    ctx.font = '700 15px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText('nds', x + 16 + tw, y + 52);
    const p = clamp(me.eff, 0, 1.2) / 1.2;
    ctx.fillStyle = 'rgba(255,255,255,.16)'; this.rrect(x + 12, y + 64, 126, 8, 4); ctx.fill();
    ctx.fillStyle = me.eff > 0.95 ? '#3ddc97' : me.eff > 0.8 ? '#f4a261' : '#e8384f'; this.rrect(x + 12, y + 64, 126 * p, 8, 4); ctx.fill();
    ctx.font = '600 11px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText('polaire ' + Math.round(me.eff * 100) + ' %', x + 12, y + 86);
    if (fly) {
      const pul = 0.75 + 0.25 * Math.sin(this.rt * 8);
      ctx.fillStyle = `rgba(255,106,31,${pul})`; this.rrect(x + 92, y + 74, 50, 16, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '800 12px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('EN VOL', x + 117, y + 86);
    }
  }

  /** Surimpressions de jeu. toS : projection de la vue du ciel (null en 3D). */
  drawHUD(g: Game, boats: Boat[], me: Boat, toS: ToScreen | null): void {
    const ctx = this.ctx, w = this.VW, h = this.VH, t = g.t, c = g.course, N = c.marks.length;
    const tgm = me.leg >= 1 && me.leg <= N && !me.ocs ? c.marks[me.leg - 1] : null;
    const tg = tgm ? { x: tgm.x, y: tgm.y } : { x: 0, y: 0 };
    const dist = Math.hypot(tg.x - me.x, tg.y - me.y);
    const lbl = me.ocs || me.leg === 0 ? 'Ligne de départ' : me.leg > N ? 'Arrivée' : tgm!.name;
    const side = tgm ? (tgm.side === 'port' ? 'à laisser à bâbord' : 'à laisser à tribord') : '';
    if (!toS && t >= 0 && me.fin == null) {
      const bc = w < 520 ? Math.max(w / 2, 216) : w / 2;
      const rel = norm(Math.atan2(tg.x - me.x, -(tg.y - me.y)) - me.h);
      this.panel(bc - 140, 14, 280, 50, 14, 0.6);
      ctx.save(); ctx.translate(bc - 112, 39); ctx.rotate(rel); ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 8); ctx.lineTo(0, 3); ctx.lineTo(-10, 8); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '800 18px "Barlow Condensed",sans-serif';
      ctx.fillText(lbl + ' · ' + fmtDist(dist), bc - 90, 31);
      ctx.font = '600 12px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      const dg = Math.round(rel / D);
      ctx.fillText((Math.abs(dg) < 6 ? 'droit devant' : Math.abs(dg) + '° à ' + (dg < 0 ? 'gauche' : 'droite')) + (side ? ' · ' + side : ''), bc - 90, 50);
    }
    if (toS && me.fin == null) {
      const [sx, sy] = toS(tg.x, tg.y), m = 34;
      if (sx < m || sx > w - m || sy < m || sy > h - m) {
        const ang = Math.atan2(sy - h / 2, sx - w / 2), k = Math.min((w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
        const ax = w / 2 + Math.cos(ang) * k, ay = h / 2 + Math.sin(ang) * k;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-3, 0); ctx.lineTo(-8, 10); ctx.fill(); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.font = '600 13px Barlow,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(lbl + ' · ' + fmtDist(dist), clamp(ax - Math.cos(ang) * 60, 70, w - 70), clamp(ay - Math.sin(ang) * 24, 14, h - 14));
      }
    }
    // girouette : vent réel (blanc) et apparent (orange)
    ctx.save(); ctx.translate(48, 48); this.ctx.fillStyle = 'rgba(4,30,50,.55)'; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
    ctx.rotate(toS ? g.wd : g.wd - me.h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 14); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(-7, 10); ctx.lineTo(7, 10); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(48, 48); ctx.rotate(toS ? me.h - me.awa : -me.awa); ctx.strokeStyle = '#ff9a5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();
    ctx.fillStyle = '#ff9a5c'; ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(-5, -13); ctx.lineTo(5, -13); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '800 15px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('VENT ' + Math.round(me.tws) + ' nds', 48, 100);
    {
      const sh = g.wd / D;
      if (Math.abs(me.twa) < 75 * D && Math.abs(sh) > 2.5 && me.knock <= 0) {
        const lift = Math.sign(me.twa) * (-sh) > 0;
        ctx.font = '700 12px Barlow,sans-serif'; ctx.fillStyle = lift ? '#3ddc97' : '#f4a261';
        ctx.fillText((lift ? 'ADONNANTE ' : 'REFUSANTE ') + Math.round(Math.abs(sh)) + '°', 48, 117);
        if (!lift && Math.abs(sh) > 7 && g.simT > g.shiftWarn && t > 0) { g.shiftWarn = g.simT + 40; g.say('Refusante de ' + Math.round(Math.abs(sh)) + '° : pense à virer !'); }
      }
    }
    if (g.timeScale > 1) {
      ctx.font = '800 14px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd23f'; ctx.fillText('ACCÉLÉRÉ ×' + g.timeScale + ' (T)', 48, 136);
    }
    // classement
    const st = g.standings();
    if (st.length > 1 && w > 420) {
      const rows = st.slice(0, 8), bw = 170, bh = 14 + rows.length * 20, bx = w - bw - 12;
      this.panel(bx, 12, bw, bh, 10, 0.55);
      ctx.font = '600 13px Barlow,sans-serif'; ctx.textBaseline = 'middle';
      const meD = st.find(e => e.me)!.d;
      rows.forEach((e, i) => {
        const y = 12 + 17 + i * 20;
        ctx.textAlign = 'left'; ctx.fillStyle = e.me ? '#fff' : 'rgba(255,255,255,.8)'; ctx.fillText((i + 1) + '.', bx + 10, y);
        ctx.fillStyle = e.col; ctx.beginPath(); ctx.arc(bx + 34, y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = e.me ? '#fff' : 'rgba(255,255,255,.85)'; ctx.fillText((e.me ? 'Toi' : e.name).slice(0, 10) + (e.ocs ? ' ⚑' : ''), bx + 46, y);
        ctx.textAlign = 'right';
        ctx.fillText(e.fin != null ? '✓' : e.me ? '' : (e.d - meD > 0 ? '+' : '−') + fmtDist(Math.abs(e.d - meD)), bx + bw - 10, y);
      });
    }
    // carte
    const pts = [{ x: 0, y: 0 }, ...c.marks];
    let X0 = Math.min(...pts.map(p => p.x)), X1 = Math.max(...pts.map(p => p.x)), Y0 = Math.min(...pts.map(p => p.y)), Y1 = Math.max(...pts.map(p => p.y));
    const pad = Math.max(X1 - X0, Y1 - Y0) * 0.12 + 300; X0 -= pad; X1 += pad; Y0 -= pad; Y1 += pad;
    const mh = 130, mw = clamp(mh * (X1 - X0) / (Y1 - Y0), 60, 130), mx = w - mw - 12, my = st.length > 1 && w > 420 ? 12 + 14 + Math.min(8, st.length) * 20 + 10 : 12;
    const sc = Math.min((mw - 12) / (X1 - X0), (mh - 12) / (Y1 - Y0)), ox = mx + mw / 2 - (X0 + X1) / 2 * sc, oy = my + mh / 2 - (Y0 + Y1) / 2 * sc;
    const tx = (x: number) => ox + x * sc, ty = (y: number) => oy + y * sc;
    this.panel(mx, my, mw, mh, 10, 0.55);
    ctx.save(); this.rrect(mx, my, mw, mh, 10); ctx.clip();
    for (const isl of ISLANDS) { ctx.fillStyle = '#5f8456'; ctx.beginPath(); ctx.arc(tx(isl.x), ty(isl.y), Math.max(1.5, isl.r * sc), 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(tx(0), ty(0)); c.marks.forEach(k => ctx.lineTo(tx(k.x), ty(k.y))); ctx.lineTo(tx(0), ty(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(tx(c.pin.x), ty(0)); ctx.lineTo(tx(c.cmte.x), ty(0)); ctx.stroke();
    c.marks.forEach((k, i) => { ctx.fillStyle = me.leg === i + 1 ? '#ffd2b8' : '#ff6a1f'; ctx.beginPath(); ctx.arc(tx(k.x), ty(k.y), me.leg === i + 1 ? 4.5 : 3, 0, TAU); ctx.fill(); });
    const dotB = (b: Boat, r: number) => { ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(clamp(tx(b.x), mx + 4, mx + mw - 4), clamp(ty(b.y), my + 4, my + mh - 4), r, 0, TAU); ctx.fill(); };
    for (const b of boats) if (b !== me) dotB(b, 2.5);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; dotB(me, 4); ctx.stroke();
    ctx.restore();
    // compte à rebours
    if (t < 0) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      this.panel(w / 2 - 90, 14, 180, 74, 16, 0.6);
      ctx.fillStyle = -t <= 10 ? '#ffd23f' : '#fff'; ctx.font = '800 44px "Barlow Condensed",sans-serif'; ctx.fillText(fmt(t), w / 2, 44);
      ctx.font = '600 12px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText('Reste sous la ligne', w / 2, 74);
    }
    if (!toS) this.speedLines(me, w, h);
    if (me.fin == null && !g.assist.sheets) this.drawTrim(me, false, w, h);
    if (me.fin == null) { this.speedo(me, w, h); this.compass(g, me, w, h); }
    // manœuvre en cours
    if (me.task) {
      const T = me.task, p = clamp(T.t / T.dur, 0, 1), txt = T.kind === 'head' ? 'Changement de voile → ' + me.cls.heads[T.to].name : (T.to > T.from ? 'Prise du ' + T.to + (T.to > 1 ? 'e' : 'er') + ' ris' : 'Largage de ris');
      const bw = 300, bx = w / 2 - bw / 2, by = g.assist.sheets ? h - 60 : h - 124 - 12 - 46;
      this.panel(bx, by, bw, 38, 12, 0.75);
      ctx.fillStyle = 'rgba(255,214,120,.35)'; this.rrect(bx + 4, by + 4, (bw - 8) * p, 30, 9); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '700 14px Barlow,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt + ' · ' + Math.ceil(T.dur - T.t) + ' s', w / 2, by + 19);
    }
    const banner = (txt: string, y: number, col = 'rgba(232,56,79,.92)') => {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 19px "Barlow Condensed",sans-serif';
      const tw = ctx.measureText(txt).width + 40; ctx.fillStyle = col; this.rrect(w / 2 - tw / 2, y, tw, 36, 18); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(txt, w / 2, y + 18);
    };
    if (me.knock > 0) banner('COUCHÉ · le bateau se redresse dans ' + Math.ceil(me.knock) + ' s', h - 230);
    else if (me.aground > 0) banner('ÉCHOUÉ · dégagement dans ' + Math.ceil(me.aground) + ' s', h - 230);
    else if (me.broach > 0) banner('DÉPART AU LOF', h - 230);
    if (me.ocs && t >= 0) banner('DÉPART ANTICIPÉ · repasse sous la ligne', h - 270);
    if (g.msgT > 0) {
      const yy = t < 0 ? 100 : toS ? 16 : 72;
      ctx.globalAlpha = Math.min(1, g.msgT * 2); ctx.font = '800 20px "Barlow Condensed",sans-serif';
      const tw = Math.min(w - 20, ctx.measureText(g.msg).width + 32); this.panel(w / 2 - tw / 2, yy, tw, 36, 18, 0.75);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(g.msg, w / 2, yy + 19, w - 40); ctx.globalAlpha = 1;
    }
    void app;
  }
}
