// Rendu 2D : vue du ciel et surimpressions (instruments, panneau de réglage, classement, carte).
import { D, TAU, clamp, hash, norm } from '../util/math';
import { MARKS, PIN, CMTE, objective } from '../game/course';
import { trimState } from '../game/trim';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';
import { app } from '../app';

export interface Off { ox: number; oy: number }

export class Canvas2D {
  readonly ctx: CanvasRenderingContext2D;
  DPR = 1; VW = 800; VH = 500;
  cam = { x: 0, y: 150 };
  /** Temps de rendu courant (s), pour les animations. */
  rt = 0;

  constructor(readonly cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!;
  }

  fit(): void {
    const r = this.cv.getBoundingClientRect();
    this.DPR = Math.min(2, window.devicePixelRatio || 1);
    this.VW = r.width; this.VH = r.height;
    this.cv.width = Math.round(this.VW * this.DPR);
    this.cv.height = Math.round(this.VH * this.DPR);
  }

  resetCam(x: number, y: number): void { this.cam = { x, y }; }

  clear(): void {
    this.ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    this.ctx.clearRect(0, 0, this.VW, this.VH);
  }

  private rrect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  }

  private buoy(x: number, y: number, col: string, r: number, label: string, hot: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,20,40,.3)'; ctx.beginPath(); ctx.ellipse(x + 4, y + 5, r, r * 0.8, 0, 0, TAU); ctx.fill();
    if (hot) {
      const p = (this.rt * 1.2) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${1 - p})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 6 + p * 60, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([6, 8]); ctx.beginPath(); ctx.arc(x, y, 85, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, 1, x, y, r);
    g.addColorStop(0, '#fff3e0'); g.addColorStop(0.35, col); g.addColorStop(1, '#a8360a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (label) { ctx.fillStyle = '#fff'; ctx.font = '800 13px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x, y + 1); }
  }

  private drawWake(b: Boat): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#fff';
    for (const p of b.wake) { ctx.globalAlpha = (1 - p.t / 2.6) * 0.45; ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.t * 3, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  private drawBoat(b: Boat, label: string, isMe: boolean): void {
    const ctx = this.ctx, anim = this.rt;
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.h);
    const hull = () => { ctx.beginPath(); ctx.moveTo(0, -24); ctx.bezierCurveTo(11, -12, 11, 10, 7, 20); ctx.lineTo(-7, 20); ctx.bezierCurveTo(-11, 10, -11, -12, 0, -24); ctx.closePath(); };
    ctx.save(); ctx.translate(3, 5); hull(); ctx.fillStyle = 'rgba(0,20,40,.3)'; ctx.fill(); ctx.restore();
    hull();
    const hg = ctx.createLinearGradient(-10, 0, 10, 0); hg.addColorStop(0, '#fff'); hg.addColorStop(1, '#d4e3ec');
    ctx.fillStyle = hg; ctx.fill(); ctx.strokeStyle = isMe ? '#fff' : '#0a3550'; ctx.lineWidth = isMe ? 2.5 : 1.5; ctx.stroke();
    ctx.fillStyle = b.col; ctx.beginPath(); ctx.moveTo(0, -24); ctx.bezierCurveTo(4, -20, 6, -16, 7, -12); ctx.lineTo(-7, -12); ctx.bezierCurveTo(-6, -16, -4, -20, 0, -24); ctx.fill();
    ctx.fillStyle = '#b9cfdc'; ctx.fillRect(-5, 7, 10, 10);
    const side = b.twa >= 0 ? 1 : -1, a = Math.abs(b.twa) / D, s = (8 + b.sheet * 80) * D;
    const ux = side * Math.sin(s), uy = Math.cos(s), L = 26, my = -6, bx = ux * L, by = my + uy * L;
    const luff = a < 32 || b.sheet - b.opt > 0.13;
    const camber = luff ? 1.5 + Math.sin(anim * 34 + b.x) * 4 : 4 + Math.min(1, b.eff) * 4;
    const nx = side * Math.cos(s), ny = -Math.sin(s);
    ctx.beginPath(); ctx.moveTo(0, my); ctx.quadraticCurveTo(bx / 2 + nx * camber, (my + by) / 2 + ny * camber, bx, by); ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.strokeStyle = '#5f7f93'; ctx.lineWidth = 1; ctx.stroke();
    ctx.strokeStyle = '#22404f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(bx, by); ctx.stroke();
    if (b.spiT > 0.02) {
      const k = b.spiT, fl = a < 80 ? Math.sin(anim * 28 + b.y) * 5 * k : 0;
      ctx.beginPath(); ctx.moveTo(0, -8);
      ctx.quadraticCurveTo(side * (30 * k + fl), -6, side * 22 * k, -22 - 10 * k);
      ctx.quadraticCurveTo(side * (14 * k + fl), -30 - 16 * k, 0, -26); ctx.closePath();
      const sg = ctx.createLinearGradient(0, -8, side * 24 * k, -28); sg.addColorStop(0, b.col); sg.addColorStop(0.55, '#ffffff'); sg.addColorStop(1, b.col);
      ctx.globalAlpha = 0.92; ctx.fillStyle = sg; ctx.fill(); ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(10,40,60,.5)'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = '#22404f'; ctx.beginPath(); ctx.arc(0, my, 2.4, 0, TAU); ctx.fill();
    ctx.restore();
    if (label) {
      ctx.font = '600 12px Barlow,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(4,30,50,.55)';
      const w = ctx.measureText(label).width + 10; this.rrect(b.x - w / 2, b.y + 28, w, 17, 8); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, b.x, b.y + 30);
    }
  }

  /** Vue du ciel. */
  drawTop(g: Game, boats: Boat[], me: Boat): Off {
    const ctx = this.ctx, w = this.VW, h = this.VH, anim = this.rt, t = g.t, cam = this.cam;
    ctx.setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    const cx = me.x + Math.sin(me.h) * me.v * 14, cy = me.y - Math.cos(me.h) * me.v * 14;
    cam.x += (cx - cam.x) * 0.06; cam.y += (cy - cam.y) * 0.06;
    const ox = w / 2 - cam.x, oy = h / 2 - cam.y, vx0 = cam.x - w / 2, vy0 = cam.y - h / 2;
    const bg = ctx.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#1077b0'); bg.addColorStop(1, '#0a4d7a');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(ox, oy);
    g.wind.eachGust(vx0 - 320, vy0 - 320, vx0 + w + 320, vy0 + h + 320, t, (gx, gy, r, s) => {
      const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      rg.addColorStop(0, `rgba(3,28,52,${0.1 + s * 0.035})`); rg.addColorStop(1, 'rgba(3,28,52,0)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(gx, gy, r, 0, TAU); ctx.fill();
    });
    const C = 78, x0 = Math.floor(vx0 / C) - 1, x1 = Math.ceil((vx0 + w) / C) + 1, y0 = Math.floor(vy0 / C) - 1, y1 = Math.ceil((vy0 + h) / C) + 1;
    const wx = -Math.sin(g.wd), wy = Math.cos(g.wd);
    ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
      const r1 = hash(i, j), r2 = hash(j, i), ph = (anim * 0.35 + r1) % 1, d = ph * 60, px = i * C + r2 * C + wx * d, py = j * C + r1 * C + wy * d;
      ctx.strokeStyle = `rgba(220,240,255,${Math.sin(ph * Math.PI) * 0.38})`;
      ctx.save(); ctx.translate(px, py); ctx.rotate(g.wd); ctx.beginPath(); ctx.moveTo(-8, 0); ctx.quadraticCurveTo(0, -4, 8, 0); ctx.stroke(); ctx.restore();
    }
    const lineHot = me.leg === 0 || me.leg === 4 || me.ocs;
    ctx.strokeStyle = lineHot ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(PIN.x, 0); ctx.lineTo(CMTE.x, 0); ctx.stroke(); ctx.setLineDash([]);
    if (lineHot) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.font = '800 15px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(me.leg === 4 ? 'ARRIVÉE ↓' : 'DÉPART ↑', 0, me.leg === 4 ? -12 : 24);
    }
    ctx.save(); ctx.translate(CMTE.x + 8, 0);
    ctx.fillStyle = 'rgba(0,20,40,.3)'; ctx.fillRect(-11, -26, 26, 58);
    ctx.fillStyle = '#eef3f6'; ctx.beginPath(); ctx.moveTo(0, -30); ctx.quadraticCurveTo(13, -14, 12, 26); ctx.lineTo(-12, 26); ctx.quadraticCurveTo(-13, -14, 0, -30); ctx.fill();
    ctx.fillStyle = '#8aa4b3'; ctx.fillRect(-7, -4, 14, 16); ctx.fillStyle = t < 0 ? '#3d7bd9' : '#ff6a1f'; ctx.fillRect(1, -24, 10, 7);
    ctx.restore();
    this.buoy(PIN.x, PIN.y, '#ffc93c', 8, '', false);
    MARKS.forEach((m, i) => this.buoy(m.x, m.y, '#ff6a1f', 12, String(i + 1), me.leg === i + 1 && !me.ocs && !g.demo));
    for (const b of boats) this.drawWake(b);
    for (const b of boats) if (b !== me) this.drawBoat(b, b.name, false);
    this.drawBoat(me, g.demo ? '' : (boats.length > 1 ? 'Toi' : ''), !g.demo);
    ctx.restore();
    return { ox, oy };
  }

  private yarn(x: number, y: number, col: string, bad: boolean, ph: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y);
    for (let i = 1; i <= 8; i++) { const xx = x + i * 3.4, yy = y + (bad ? Math.sin(ph + i * 0.9) * 4 - i * 0.9 : Math.sin(ph * 0.5 + i) * 0.6); ctx.lineTo(xx, yy); }
    ctx.stroke();
  }

  private drawTrim(me: Boat, w: number, h: number): void {
    const ctx = this.ctx, anim = this.rt;
    const S = trimState(me), narrow = w < 640, pw = Math.min(400, w - 24 - (narrow ? 110 : 0)), px = narrow ? 12 : (w - pw) / 2, py = h - 114, ph = 102;
    ctx.fillStyle = 'rgba(4,30,50,.74)'; this.rrect(px, py, pw, ph, 16); ctx.fill();
    ctx.strokeStyle = S.col; ctx.globalAlpha = S.lvl === 2 ? 0.6 + 0.4 * Math.sin(anim * 9) : 0.9; ctx.lineWidth = 2; this.rrect(px + 1, py + 1, pw - 2, ph - 2, 15); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = S.col; ctx.font = '800 24px "Barlow Condensed",sans-serif'; ctx.fillText(S.txt, px + 16, py + 22);
    ctx.textAlign = 'right'; ctx.font = '600 12px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(app.auto ? 'réglage auto' : 'rendement', px + pw - 16, py + 15);
    const ef = Math.round(clamp(me.cap > 0 ? 0 : me.eff, 0, 1) * 100);
    ctx.font = '800 20px "Barlow Condensed",sans-serif'; ctx.fillStyle = ef > 88 ? '#3ddc97' : ef > 65 ? '#f4a261' : '#e8384f'; ctx.fillText(ef + ' %', px + pw - 16, py + 32);
    const x0 = px + 16, x1 = px + pw - 16, bw = x1 - x0, by = py + 52, X = (v: number) => x0 + clamp(v, 0, 1) * bw;
    ctx.fillStyle = 'rgba(255,255,255,.16)'; this.rrect(x0, by, bw, 12, 6); ctx.fill();
    ctx.fillStyle = 'rgba(61,220,151,.28)'; this.rrect(X(S.tgt - 0.13), by, X(S.tgt + 0.13) - X(S.tgt - 0.13), 12, 6); ctx.fill();
    ctx.fillStyle = '#3ddc97'; this.rrect(X(S.tgt - 0.05), by, X(S.tgt + 0.05) - X(S.tgt - 0.05), 12, 6); ctx.fill();
    const cx = X(me.sheet);
    if (S.ad > 0.13 && me.cap <= 0) {
      const dir = S.d > 0 ? -1 : 1; ctx.fillStyle = 'rgba(255,255,255,.85)';
      for (let i = 0; i < 3; i++) {
        const ax = cx + dir * (14 + i * 10 + ((anim * 30) % 10));
        if ((dir < 0 && ax < X(S.tgt)) || (dir > 0 && ax > X(S.tgt))) continue;
        ctx.beginPath(); ctx.moveTo(ax + dir * 5, by + 6); ctx.lineTo(ax - dir * 2, by + 1); ctx.lineTo(ax - dir * 2, by + 11); ctx.fill();
      }
    }
    ctx.fillStyle = '#fff'; ctx.fillRect(cx - 2, by - 6, 4, 24); ctx.beginPath(); ctx.moveTo(cx - 7, by - 10); ctx.lineTo(cx + 7, by - 10); ctx.lineTo(cx, by - 3); ctx.fill();
    ctx.font = '600 11px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.textAlign = 'left'; ctx.fillText('◀ bordé (↑)', x0, by + 24); ctx.textAlign = 'right'; ctx.fillText('choqué (↓) ▶', x1, by + 24);
    const wb = S.d > 0.08 || me.cap > 0, lb = S.d < -0.08, yy = py + 90;
    ctx.textAlign = 'left'; ctx.font = '600 12px Barlow,sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText('Penons', x0, yy);
    const half = x0 + 56;
    this.yarn(half, yy, '#e8384f', wb, anim * 14);
    ctx.fillStyle = wb ? '#ffb3bd' : 'rgba(255,255,255,.7)'; ctx.fillText(wb ? 'au vent : se lève' : 'au vent : file', half + 34, yy);
    if (pw > 330) {
      const h2 = half + (pw - 88) / 2 - 14; ctx.font = '600 12px Barlow,sans-serif';
      this.yarn(h2, yy, '#3ddc97', lb, anim * 14 + 2);
      ctx.fillStyle = lb ? '#b6f5d9' : 'rgba(255,255,255,.7)'; ctx.fillText(lb ? 'sous le vent : décroche' : 'sous le vent : file', h2 + 32, yy);
    }
  }

  /** Surimpressions de jeu. o = décalage de la vue du ciel (null en 3D). */
  drawHUD(g: Game, boats: Boat[], me: Boat, o: Off | null): void {
    const ctx = this.ctx, w = this.VW, h = this.VH, t = g.t;
    const tg = objective(me, true);
    if (!o && t >= 0 && me.fin == null) {
      const bc = w < 520 ? Math.max(w / 2, 216) : w / 2;
      const rel = norm(Math.atan2(tg.x - me.x, -(tg.y - me.y)) - me.h), lbl = me.ocs || me.leg === 0 ? 'Ligne de départ' : me.leg === 4 ? 'Arrivée' : 'Bouée ' + me.leg;
      ctx.fillStyle = 'rgba(4,30,50,.6)'; this.rrect(bc - 120, 14, 240, 46, 14); ctx.fill();
      ctx.save(); ctx.translate(bc - 92, 37); ctx.rotate(rel); ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(10, 8); ctx.lineTo(0, 3); ctx.lineTo(-10, 8); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = '800 19px "Barlow Condensed",sans-serif';
      ctx.fillText(lbl + ' · ' + Math.round(Math.hypot(tg.x - me.x, tg.y - me.y) / 10) + ' m', bc - 70, 30);
      ctx.font = '600 12px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
      const dg = Math.round(rel / D);
      ctx.fillText(Math.abs(dg) < 6 ? 'droit devant' : Math.abs(dg) + '° à ' + (dg < 0 ? 'gauche' : 'droite'), bc - 70, 48);
    }
    const ox = o ? o.ox : 0, oy = o ? o.oy : 0, sx = tg.x + ox, sy = tg.y + oy, m = 34;
    if (o && me.fin == null && (sx < m || sx > w - m || sy < m || sy > h - m)) {
      const ang = Math.atan2(sy - h / 2, sx - w / 2), k = Math.min((w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), (h / 2 - m) / Math.abs(Math.sin(ang) || 1e-6));
      const ax = w / 2 + Math.cos(ang) * k, ay = h / 2 + Math.sin(ang) * k;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.fillStyle = '#ff6a1f'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -10); ctx.lineTo(-3, 0); ctx.lineTo(-8, 10); ctx.fill(); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = '600 13px Barlow,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(Math.hypot(tg.x - me.x, tg.y - me.y) / 10) + ' m', clamp(ax - Math.cos(ang) * 30, 30, w - 30), clamp(ay - Math.sin(ang) * 24, 14, h - 14));
    }
    // girouette
    ctx.save(); ctx.translate(48, 48); ctx.fillStyle = 'rgba(4,30,50,.55)'; ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
    ctx.rotate(o ? g.wd : g.wd - me.h); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(0, 14); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(-7, 10); ctx.lineTo(7, 10); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(48, 48); ctx.rotate(o ? me.h - me.awa : -me.awa); ctx.strokeStyle = '#ff9a5c'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();
    ctx.fillStyle = '#ff9a5c'; ctx.beginPath(); ctx.moveTo(0, -4); ctx.lineTo(-5, -13); ctx.lineTo(5, -13); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#fff'; ctx.font = '800 15px "Barlow Condensed",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText('VENT ' + Math.round(me.wk) + ' nds', 48, 100);
    {
      const sh = g.wd / D;
      if (Math.abs(me.twa) < 75 * D && Math.abs(sh) > 2.5 && me.cap <= 0) {
        const lift = Math.sign(me.twa) * (-sh) > 0;
        ctx.font = '700 12px Barlow,sans-serif'; ctx.fillStyle = lift ? '#3ddc97' : '#f4a261';
        ctx.fillText((lift ? 'ADONNANTE ' : 'REFUSANTE ') + Math.round(Math.abs(sh)) + '°', 48, 117);
        if (!lift && Math.abs(sh) > 7 && g.simT > g.shiftWarn && t > 0) { g.shiftWarn = g.simT + 25; g.say('Refusante de ' + Math.round(Math.abs(sh)) + '° : pense à virer !'); }
      }
    }
    // classement
    const st = g.standings();
    if (st.length > 1 && w > 420) {
      const rows = st.slice(0, 8), bw = 150, bh = 14 + rows.length * 20, bx = w - bw - 12;
      ctx.fillStyle = 'rgba(4,30,50,.55)'; this.rrect(bx, 12, bw, bh, 10); ctx.fill();
      ctx.font = '600 13px Barlow,sans-serif'; ctx.textBaseline = 'middle';
      rows.forEach((e, i) => {
        const y = 12 + 17 + i * 20;
        ctx.textAlign = 'left'; ctx.fillStyle = e.me ? '#fff' : 'rgba(255,255,255,.8)'; ctx.fillText((i + 1) + '.', bx + 10, y);
        ctx.fillStyle = e.col; ctx.beginPath(); ctx.arc(bx + 34, y, 5, 0, TAU); ctx.fill();
        ctx.fillStyle = e.me ? '#fff' : 'rgba(255,255,255,.85)'; ctx.fillText((e.me ? 'Toi' : e.name).slice(0, 12) + (e.ocs ? ' ⚑' : ''), bx + 46, y);
        if (e.fin != null) { ctx.textAlign = 'right'; ctx.fillText('✓', bx + bw - 10, y); }
      });
    }
    // carte
    const mw = 96, mh = 140, mx = w - mw - 12, my = h - mh - 12, X0 = -1080, X1 = 280, Y0 = -2160, Y1 = 360;
    const tx = (x: number) => mx + 8 + (x - X0) / (X1 - X0) * (mw - 16), ty = (y: number) => my + 8 + (y - Y0) / (Y1 - Y0) * (mh - 16);
    ctx.fillStyle = 'rgba(4,30,50,.55)'; this.rrect(mx, my, mw, mh, 10); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(tx(0), ty(0)); MARKS.forEach(k => ctx.lineTo(tx(k.x), ty(k.y))); ctx.lineTo(tx(0), ty(0)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(tx(PIN.x), ty(0)); ctx.lineTo(tx(CMTE.x), ty(0)); ctx.stroke();
    MARKS.forEach((k, i) => { ctx.fillStyle = me.leg === i + 1 ? '#ffd2b8' : '#ff6a1f'; ctx.beginPath(); ctx.arc(tx(k.x), ty(k.y), me.leg === i + 1 ? 4.5 : 3, 0, TAU); ctx.fill(); });
    const dotB = (b: Boat, r: number) => { ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(clamp(tx(b.x), mx + 4, mx + mw - 4), clamp(ty(b.y), my + 4, my + mh - 4), r, 0, TAU); ctx.fill(); };
    for (const b of boats) if (b !== me) dotB(b, 2.5);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; dotB(me, 4); ctx.stroke();
    // compte à rebours
    if (t < 0) {
      const n = Math.ceil(-t); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(4,30,50,.6)'; this.rrect(w / 2 - 90, 14, 180, 74, 16); ctx.fill();
      ctx.fillStyle = n <= 5 ? '#ffd23f' : '#fff'; ctx.font = '800 44px "Barlow Condensed",sans-serif'; ctx.fillText('0:' + String(n).padStart(2, '0'), w / 2, 44);
      ctx.font = '600 12px Barlow,sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText('Reste sous la ligne', w / 2, 74);
    }
    if (me.fin == null) this.drawTrim(me, w, h);
    if (me.cap > 0) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 20px "Barlow Condensed",sans-serif'; ctx.fillStyle = 'rgba(232,56,79,.92)';
      this.rrect(w / 2 - 150, h - 204, 300, 38, 19); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('DESSALÉ · redressage ' + Math.ceil(me.cap) + ' s', w / 2, h - 185);
    }
    if (me.ocs && t >= 0) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '800 18px "Barlow Condensed",sans-serif'; ctx.fillStyle = 'rgba(232,56,79,.9)';
      this.rrect(w / 2 - 130, h - 158, 260, 34, 17); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText('DÉPART ANTICIPÉ · repasse sous la ligne', w / 2, h - 141);
    }
    if (g.msgT > 0) {
      const yy = t < 0 ? 100 : o ? 16 : 70;
      ctx.globalAlpha = Math.min(1, g.msgT * 2); ctx.font = '800 22px "Barlow Condensed",sans-serif';
      const tw = ctx.measureText(g.msg).width + 32; ctx.fillStyle = 'rgba(4,30,50,.72)'; this.rrect(w / 2 - tw / 2, yy, tw, 38, 19); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(g.msg, w / 2, yy + 20); ctx.globalAlpha = 1;
    }
  }
}
