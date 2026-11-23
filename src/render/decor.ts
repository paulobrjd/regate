// Décor vivant : forêts et villages sur les îles, port et voiliers au mouillage, parc éolien, cargo,
// vedettes de spectateurs, hélicoptère TV, mouettes et dauphins.
import * as T from 'three';
import { ISLANDS, shoreR, islandHeight, type Island } from '../physics/world';
import { waveH } from '../physics/waves';
import { makeRng, norm, TAU, clamp } from '../util/math';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';

const std = (color: string, rough = 0.7) => new T.MeshStandardMaterial({ color, roughness: rough });

interface Spectator { g: T.Group; wake: T.Mesh<T.PlaneGeometry, T.MeshBasicMaterial>; x: number; z: number; h: number; v: number; ox: number; oz: number; follow: 'me' | 'lead' | 'start' }
interface Gull { g: T.Group; wl: T.Mesh; wr: T.Mesh; a: number; r: number; y: number; w: number; ph: number }
interface Dolphin { g: T.Group; side: number; fwd: number; ph: number; lastUp: boolean }

export class Decor {
  private amp = 1; private rt = 0;
  private rotors: T.Object3D[] = [];
  private ship = new T.Group();
  private spect: Spectator[] = [];
  private heli = new T.Group(); private heliRotor = new T.Group(); private heliTail = new T.Group(); private heliA = 0;
  private gulls: Gull[] = [];
  private dolphins: Dolphin[] = []; private dolTimer = 25; private dolActive = 0;

  constructor(private scene: T.Scene, private splash: (x: number, y: number, z: number, n: number) => void) {
    const rng = makeRng(2024);
    this.forests(rng);
    this.villages(rng);
    this.harbour(rng);
    this.windFarm();
    this.cargo();
    this.spectators(rng);
    this.helicopter();
    this.birds(rng);
    this.mkDolphins();
  }

  private wh(x: number, z: number): number { return waveH(x, z, this.rt, this.amp); }

  // ---------- îles ----------
  private forests(rng: () => number): void {
    const pts: { x: number; y: number; z: number; s: number; h: number }[] = [];
    for (const isl of ISLANDS) {
      const n = Math.min(650, Math.round(isl.r * isl.r / 2200));
      for (let i = 0; i < n * 2 && pts.length < 4000; i++) {
        const th = rng() * TAU, rho = 0.12 + rng() * 0.78, R = shoreR(isl, th) * rho, y = islandHeight(isl, th, rho);
        if (y < 5 || y > isl.h * 1.4 || rng() < 0.3) continue;
        pts.push({ x: isl.x + Math.cos(th) * R, y, z: isl.y + Math.sin(th) * R, s: 3 + rng() * 2.5, h: 11 + rng() * 12 });
      }
    }
    const cone = new T.ConeGeometry(1, 1, 7); cone.translate(0, 0.5, 0);
    const trees = new T.InstancedMesh(cone, std('#ffffff', 0.9), pts.length);
    const m = new T.Matrix4(), c = new T.Color();
    pts.forEach((p, i) => {
      m.makeScale(p.s, p.h, p.s); m.setPosition(p.x, p.y - 0.5, p.z); trees.setMatrixAt(i, m);
      c.setHSL(0.28 + rng() * 0.06, 0.45, 0.17 + rng() * 0.1); trees.setColorAt(i, c);
    });
    trees.castShadow = false; this.scene.add(trees);
  }

  private villages(rng: () => number): void {
    const spots: [number, number][] = [[4, 45], [0, 22], [1, 20], [5, 18], [3, 6]]; // [île, nombre de maisons]
    const walls: T.Matrix4[] = [], roofs: T.Matrix4[] = [], wc: T.Color[] = [], rc: T.Color[] = [];
    const roofCols = ['#b5523b', '#c0643f', '#5d6770', '#9c4a36'], wallCols = ['#f3eee2', '#ffffff', '#efe3cf', '#e8eef2'];
    for (const [ii, n] of spots) {
      const isl = ISLANDS[ii], th0 = Math.atan2(-isl.y, -isl.x); // côté tourné vers le plan d'eau
      for (let k = 0; k < n; k++) {
        const th = th0 + (rng() - 0.5) * 0.9, rho = 0.66 + rng() * 0.24, R = shoreR(isl, th) * rho;
        const x = isl.x + Math.cos(th) * R, z = isl.y + Math.sin(th) * R, y = islandHeight(isl, th, rho);
        if (y < 2) continue;
        const w = 10 + rng() * 8, d = 9 + rng() * 7, h = 7 + rng() * 5, rot = th + Math.PI / 2 + (rng() - 0.5) * 0.3;
        const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), rot);
        walls.push(new T.Matrix4().compose(new T.Vector3(x, y + h / 2 - 1, z), q, new T.Vector3(w, h, d)));
        roofs.push(new T.Matrix4().compose(new T.Vector3(x, y + h - 1, z), q, new T.Vector3(w * 1.08, 3 + rng() * 1.5, d * 1.1)));
        wc.push(new T.Color(wallCols[Math.floor(rng() * wallCols.length)])); rc.push(new T.Color(roofCols[Math.floor(rng() * roofCols.length)]));
      }
    }
    const box = new T.BoxGeometry(1, 1, 1);
    const prism = new T.ExtrudeGeometry(new T.Shape([new T.Vector2(-0.5, 0), new T.Vector2(0.5, 0), new T.Vector2(0, 1)]), { depth: 1, bevelEnabled: false }); prism.translate(0, 0, -0.5);
    const W = new T.InstancedMesh(box, std('#ffffff', 0.8), walls.length), R = new T.InstancedMesh(prism, std('#ffffff', 0.8), roofs.length);
    walls.forEach((m, i) => { W.setMatrixAt(i, m); W.setColorAt(i, wc[i]); });
    roofs.forEach((m, i) => { R.setMatrixAt(i, m); R.setColorAt(i, rc[i]); });
    this.scene.add(W, R);
    // clocher sur l'Île Longue
    const isl = ISLANDS[4], th = Math.atan2(-isl.y, -isl.x) + 0.05, rho = 0.72, Rr = shoreR(isl, th) * rho;
    const x = isl.x + Math.cos(th) * Rr, z = isl.y + Math.sin(th) * Rr, y = islandHeight(isl, th, rho);
    const tower = new T.Mesh(new T.BoxGeometry(6, 26, 6), std('#ece6d8')); tower.position.set(x, y + 12, z); this.scene.add(tower);
    const spire = new T.Mesh(new T.ConeGeometry(4.6, 12, 4), std('#5d6770')); spire.position.set(x, y + 31, z); spire.rotation.y = Math.PI / 4; this.scene.add(spire);
  }

  private harbour(rng: () => number): void {
    const isl: Island = ISLANDS[4], th0 = Math.atan2(-isl.y, -isl.x) + 0.32;
    const shore = (th: number, k = 1) => { const R = shoreR(isl, th) * k; return [isl.x + Math.cos(th) * R, isl.y + Math.sin(th) * R]; };
    // digue en enrochements, en arc depuis la côte
    const rockM = std('#8d8a83', 0.95);
    for (let i = 0; i < 26; i++) {
      const f = i / 25, th = th0 + 0.12 * f, k = 1.0 + 0.16 * Math.sin(f * Math.PI * 0.9);
      const [x, z] = shore(th, k);
      const b = new T.Mesh(new T.BoxGeometry(22, 5, 14), rockM); b.position.set(x, 0.5, z); b.rotation.y = -th; this.scene.add(b);
    }
    const [lx, lz] = shore(th0 + 0.12, 1.12);
    const light = new T.Mesh(new T.CylinderGeometry(1.4, 1.8, 9, 10), std('#2e8b57')); light.position.set(lx, 5, lz); this.scene.add(light);
    // voiliers au mouillage
    const hullG = new T.BoxGeometry(3, 1.4, 10); const mastG = new T.CylinderGeometry(0.08, 0.1, 13, 5); mastG.translate(0, 7, 0);
    const N = 18, hulls = new T.InstancedMesh(hullG, std('#f4f6f7', 0.4), N), masts = new T.InstancedMesh(mastG, std('#c9ced3', 0.4), N);
    const m = new T.Matrix4();
    for (let i = 0; i < N; i++) {
      const th = th0 + 0.01 + rng() * 0.1, [x, z] = shore(th, 1.03 + rng() * 0.08), rot = rng() * TAU;
      m.makeRotationY(rot); m.setPosition(x, 0.4, z); hulls.setMatrixAt(i, m); masts.setMatrixAt(i, m);
    }
    this.scene.add(hulls, masts);
  }

  // ---------- au large ----------
  private windFarm(): void {
    const white = std('#dfe4e8', 0.5);
    const blade = new T.BoxGeometry(1.6, 46, 0.4); blade.translate(0, 23, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const x = 4700 + i * 800 + (j % 2) * 280, z = -6600 + j * 800;
      const tower = new T.Mesh(new T.CylinderGeometry(2.4, 4, 110, 12), white); tower.position.set(x, 55, z); this.scene.add(tower);
      const nac = new T.Mesh(new T.BoxGeometry(5, 5, 12), white); nac.position.set(x, 111, z); this.scene.add(nac);
      const rotor = new T.Group(); rotor.position.set(x, 111, z - 6.5); this.scene.add(rotor);
      for (let k = 0; k < 3; k++) { const b = new T.Mesh(blade, white); b.rotation.z = k * TAU / 3; rotor.add(b); }
      rotor.rotation.z = i + j; this.rotors.push(rotor);
      const base = new T.Mesh(new T.CylinderGeometry(4.5, 4.5, 6, 12), std('#e8c547')); base.position.set(x, 1, z); this.scene.add(base);
    }
  }

  private cargo(): void {
    const s = this.ship;
    const hull = new T.Mesh(new T.BoxGeometry(28, 14, 190), std('#2c3338', 0.6)); hull.position.y = 3; s.add(hull);
    const red = new T.Mesh(new T.BoxGeometry(28.4, 4, 190.4), std('#8e2b22', 0.8)); red.position.y = -2.5; s.add(red);
    const bow = new T.Mesh(new T.CylinderGeometry(14, 14, 14, 3, 1), std('#2c3338', 0.6)); bow.rotation.y = Math.PI / 6; bow.scale.set(1, 1, 1.6); bow.position.set(0, 3, -100); s.add(bow);
    const bridge = new T.Mesh(new T.BoxGeometry(26, 18, 14), std('#f1f1ee')); bridge.position.set(0, 19, 78); s.add(bridge);
    const stack = new T.Mesh(new T.BoxGeometry(6, 10, 6), std('#c0392b')); stack.position.set(0, 32, 84); s.add(stack);
    const cols = ['#c0392b', '#2471a3', '#f1c40f', '#27ae60', '#7f8c8d', '#e67e22', '#ecf0f1'];
    const box = new T.BoxGeometry(2.5, 2.6, 12), N = 7 * 4 * 10, C = new T.InstancedMesh(box, std('#ffffff'), N), m = new T.Matrix4(), rng = makeRng(7);
    let n = 0;
    for (let row = 0; row < 10; row++) for (let col = 0; col < 7; col++) for (let lv = 0; lv < 4; lv++) {
      if (rng() < 0.15) continue;
      m.makeTranslation(-9 + col * 3, 11.5 + lv * 2.7, -80 + row * 14); C.setMatrixAt(n, m); C.setColorAt(n, new T.Color(cols[Math.floor(rng() * cols.length)])); n++;
    }
    C.count = n; s.add(C);
    this.scene.add(s);
  }

  private spectators(rng: () => number): void {
    const plan = new T.Shape(); plan.moveTo(0, -5); plan.quadraticCurveTo(2, -2.5, 1.9, 2.5); plan.lineTo(1.7, 4); plan.lineTo(-1.7, 4); plan.lineTo(-1.9, 2.5); plan.quadraticCurveTo(-2, -2.5, 0, -5);
    const hullG = new T.ExtrudeGeometry(plan, { depth: 1.3, bevelEnabled: true, bevelSize: 0.15, bevelThickness: 0.15, bevelSegments: 2 }); hullG.rotateX(-Math.PI / 2); hullG.translate(0, -0.3, 0);
    const wakeTex = (() => { const c = document.createElement('canvas'); c.width = 32; c.height = 128; const x = c.getContext('2d')!; const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.beginPath(); x.moveTo(12, 0); x.lineTo(20, 0); x.lineTo(32, 128); x.lineTo(0, 128); x.fill(); return new T.CanvasTexture(c); })();
    const cols = ['#ffffff', '#1f3a5f', '#c0392b', '#f4f6f7', '#2c3e50', '#e67e22', '#ffffff', '#16a085'];
    for (let i = 0; i < 8; i++) {
      const g = new T.Group();
      g.add(new T.Mesh(hullG, std(cols[i], 0.35)));
      const cab = new T.Mesh(new T.BoxGeometry(2.2, 1.3, 2.6), std('#e9edf0', 0.3)); cab.position.set(0, 1.5, 0.6); g.add(cab);
      const win = new T.Mesh(new T.BoxGeometry(2.25, 0.6, 0.1), new T.MeshStandardMaterial({ color: '#10202b', roughness: 0.05 })); win.position.set(0, 1.7, -0.75); win.rotation.x = -0.5; g.add(win);
      const fl = new T.Mesh(new T.PlaneGeometry(0.9, 0.6), new T.MeshBasicMaterial({ color: ['#0055a4', '#ff6a1f', '#ffd23f'][i % 3], side: T.DoubleSide })); fl.position.set(0.45, 3.4, 3.6); g.add(fl);
      const pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 2.2, 5), std('#c9ced3')); pole.position.set(0, 2.6, 3.6); g.add(pole);
      const wake = new T.Mesh(new T.PlaneGeometry(5, 26), new T.MeshBasicMaterial({ map: wakeTex, transparent: true, depthWrite: false, opacity: 0 }));
      wake.rotation.x = -Math.PI / 2; wake.renderOrder = 4; this.scene.add(wake);
      this.scene.add(g);
      const follow = i < 3 ? 'me' : i < 6 ? 'lead' : 'start';
      const side = i % 2 ? 1 : -1;
      this.spect.push({ g, wake, x: (rng() - 0.5) * 1200, z: 700 + rng() * 300, h: rng() * TAU, v: 0, ox: side * (150 + rng() * 120), oz: 120 + rng() * 200, follow });
    }
  }

  private helicopter(): void {
    const h = this.heli, body = std('#d6dde2', 0.35), dark = std('#2c3338', 0.5);
    const fus = new T.Mesh(new T.CapsuleGeometry(1.4, 3.6, 6, 12), body); fus.rotation.x = Math.PI / 2; h.add(fus);
    const glass = new T.Mesh(new T.SphereGeometry(1.35, 12, 8, 0, TAU, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: '#10202b', roughness: 0.05 })); glass.rotation.x = -Math.PI / 2; glass.position.z = -2.2; h.add(glass);
    const tail = new T.Mesh(new T.CylinderGeometry(0.25, 0.5, 7, 8), body); tail.rotation.x = Math.PI / 2; tail.position.set(0, 0.4, 5.5); h.add(tail);
    for (const sx of [-1, 1]) { const sk = new T.Mesh(new T.BoxGeometry(0.15, 0.15, 5), dark); sk.position.set(sx * 1.2, -1.9, 0); h.add(sk); }
    const bladeG = new T.BoxGeometry(0.5, 0.08, 11); this.heliRotor.position.y = 2; h.add(this.heliRotor);
    for (let k = 0; k < 4; k++) { const b = new T.Mesh(bladeG, dark); b.rotation.y = k * Math.PI / 4 * 2; this.heliRotor.add(b); }
    this.heliTail.position.set(0.4, 0.8, 9); h.add(this.heliTail);
    const tb = new T.Mesh(new T.BoxGeometry(0.06, 2.2, 0.3), dark); this.heliTail.add(tb);
    this.scene.add(h);
  }

  private birds(rng: () => number): void {
    const white = std('#f5f6f6', 0.8), grey = std('#9aa3a8', 0.8);
    const wingG = new T.BoxGeometry(0.9, 0.04, 0.32); wingG.translate(0.45, 0, 0);
    for (let i = 0; i < 14; i++) {
      const g = new T.Group();
      const body = new T.Mesh(new T.CapsuleGeometry(0.12, 0.45, 4, 6), white); body.rotation.x = Math.PI / 2; g.add(body);
      const wl = new T.Mesh(wingG, grey), wr = new T.Mesh(wingG, grey); wr.scale.x = -1; g.add(wl, wr);
      this.scene.add(g);
      this.gulls.push({ g, wl, wr, a: rng() * TAU, r: 25 + rng() * 50, y: 12 + rng() * 22, w: (0.25 + rng() * 0.35) * (rng() < 0.5 ? 1 : -1), ph: rng() * TAU });
    }
  }

  private mkDolphins(): void {
    const skin = std('#4b5a66', 0.35), belly = std('#c9d2d8', 0.5);
    for (let i = 0; i < 3; i++) {
      const g = new T.Group();
      const body = new T.Mesh(new T.CapsuleGeometry(0.38, 1.7, 6, 12), skin); body.rotation.x = Math.PI / 2; body.scale.set(1, 1, 0.85); g.add(body);
      const bel = new T.Mesh(new T.CapsuleGeometry(0.3, 1.3, 6, 10), belly); bel.rotation.x = Math.PI / 2; bel.position.y = -0.12; g.add(bel);
      const fin = new T.Mesh(new T.ConeGeometry(0.22, 0.6, 4), skin); fin.position.set(0, 0.45, 0.1); fin.rotation.x = 0.4; g.add(fin);
      const tail = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.35), skin); tail.position.set(0, 0, 1.3); g.add(tail);
      const nose = new T.Mesh(new T.ConeGeometry(0.14, 0.45, 8), skin); nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.05, -1.4); g.add(nose);
      g.visible = false; this.scene.add(g);
      this.dolphins.push({ g, side: i % 2 ? 1 : -1, fwd: -2 + i * 4, ph: i * 0.37, lastUp: false });
    }
  }

  // ---------- animation ----------
  update(g: Game, boats: Boat[], me: Boat, dt: number, rt: number, amp: number): void {
    this.amp = amp; this.rt = rt;
    for (const r of this.rotors) r.rotation.z += dt * 1.1;
    // cargo : longe le plan d'eau, très loin
    { const L = 40000, s = ((rt * 7) % L + L) % L, z = 9000 - s; this.ship.position.set(9200, this.wh(9200, z) * 0.2, z); }
    // vedettes de spectateurs
    const st = g.standings(), leadName = st[0]?.name, lead = boats.find(b => b.name === leadName) ?? me;
    for (const s of this.spect) {
      let tx: number, tz: number;
      if (g.t < 0 || s.follow === 'start') { tx = s.ox * 1.6; tz = 470 + s.oz * 0.5; }
      else {
        const ref = s.follow === 'me' ? me : lead, fx = Math.sin(ref.h), fz = -Math.cos(ref.h);
        tx = ref.x - fx * s.oz + fz * s.ox; tz = ref.y - fz * s.oz - fx * s.ox;
      }
      if (Math.hypot(tx - s.x, tz - s.z) > 1500) { s.x = tx; s.z = tz; } // trop loin : on la remet à son poste
      const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz);
      const want = clamp(d / 20, 0, 16);
      s.v += clamp(want - s.v, -3 * dt, 2.5 * dt);
      if (d > 3) s.h += clamp(norm(Math.atan2(dx, -dz) - s.h), -0.6 * dt, 0.6 * dt);
      s.x += Math.sin(s.h) * s.v * dt; s.z += -Math.cos(s.h) * s.v * dt;
      const y = this.wh(s.x, s.z) * 0.8;
      s.g.position.set(s.x, y + 0.2, s.z); s.g.rotation.set(-Math.min(0.12, s.v * 0.008), -s.h, Math.sin(rt * 1.3 + s.ox) * 0.04, 'YXZ');
      s.wake.position.set(s.x - Math.sin(s.h) * 15, y + 0.15, s.z + Math.cos(s.h) * 15); s.wake.rotation.set(-Math.PI / 2, 0, -s.h);
      s.wake.material.opacity = clamp(s.v / 10, 0, 0.8);
    }
    // hélicoptère TV : tourne autour de la tête de course
    {
      this.heliA += dt * 0.14;
      const ref = g.t < 0 ? me : lead, R = 150;
      const x = ref.x + Math.cos(this.heliA) * R, z = ref.y + Math.sin(this.heliA) * R;
      this.heli.position.set(x, 60 + Math.sin(rt * 0.5) * 3, z);
      this.heli.rotation.set(0.12, -(this.heliA + Math.PI), 0.15, 'YXZ');
      this.heliRotor.rotation.y += dt * 28; this.heliTail.rotation.x += dt * 40;
    }
    // mouettes autour du bateau du joueur
    for (const b of this.gulls) {
      b.a += b.w * dt;
      const x = me.x + Math.cos(b.a) * b.r, z = me.y + Math.sin(b.a) * b.r, y = b.y + Math.sin(rt * 0.7 + b.ph) * 2;
      b.g.position.set(x, y, z); b.g.rotation.set(0, -(b.a + (b.w > 0 ? 0 : Math.PI)), (b.w > 0 ? -1 : 1) * 0.35, 'YXZ');
      const glide = Math.sin(rt * 0.4 + b.ph) > 0.2, f = glide ? 0.1 : Math.sin(rt * 9 + b.ph) * 0.7;
      b.wl.rotation.z = f; b.wr.rotation.z = -f;
    }
    // dauphins : ils viennent sauter à l'étrave de temps en temps
    if (this.dolActive > 0) this.dolActive -= dt; else { this.dolTimer -= dt; if (this.dolTimer <= 0 && me.v > 4) { this.dolActive = 16; this.dolTimer = 45 + Math.random() * 50; } }
    const fx = Math.sin(me.h), fz = -Math.cos(me.h);
    for (const d of this.dolphins) {
      d.g.visible = this.dolActive > 0;
      if (!d.g.visible) continue;
      const lat = d.side * (6 + Math.abs(d.fwd) * 0.4), along = 8 + d.fwd + Math.sin(rt * 0.6 + d.ph * 5) * 2;
      const x = me.x + fx * along + fz * lat, z = me.y + fz * along - fx * lat;
      const cyc = ((rt * 0.55 + d.ph) % 1 + 1) % 1, jump = cyc < 0.35, f = cyc / 0.35;
      const yw = this.wh(x, z) * 0.8, y = jump ? yw - 0.6 + Math.sin(Math.PI * f) * 2.6 : yw - 1.4 + Math.sin(cyc * 20) * 0.1;
      d.g.position.set(x, y, z);
      d.g.rotation.set(jump ? -Math.cos(Math.PI * f) * 0.9 : 0, -me.h, 0, 'YXZ');
      if (jump !== d.lastUp) { this.splash(x, yw + 0.2, z, 14); d.lastUp = jump; }
    }
  }
}
