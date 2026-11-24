// Skipper articulé : bassin, colonne, cou/tête, bras et jambes à deux segments.
// Les mains vont chercher leurs cibles (stick de barre, manivelle, bout) par cinématique inverse ;
// le corps se penche, s'accroupit, marche et regarde autour de lui.
import * as T from 'three';

const UP = 0.31, FORE = 0.29, THIGH = 0.45, SHIN = 0.46;

export interface Pose {
  /** Cibles des mains, en coordonnées du groupe parent (le pont), ou null : bras le long du corps. */
  handL: T.Vector3 | null; handR: T.Vector3 | null;
  /** Inclinaison latérale (rad, + vers tribord du skipper), avant (rad), accroupissement 0..1. */
  lean: number; bend: number; crouch: number;
  /** Phase de marche (rad) ou null à l'arrêt. */
  walk: number | null;
  /** Où regarde la tête (rad, + à gauche). */
  look: number;
  t: number;
}

const std = (c: string, r = 0.7) => new T.MeshStandardMaterial({ color: c, roughness: r });

export class Skipper {
  readonly root = new T.Group();
  private hips = new T.Group(); private spine = new T.Group(); private chest = new T.Group(); private neck = new T.Group();
  readonly head = new T.Group();
  private sh: T.Group[] = []; private el: T.Group[] = [];
  private th: T.Group[] = []; private kn: T.Group[] = []; private ft: T.Group[] = [];
  private v = new T.Vector3(); private w = new T.Vector3(); private m = new T.Matrix4(); private q = new T.Quaternion();
  private ax = new T.Vector3(); private ay = new T.Vector3(); private az = new T.Vector3();

  constructor(col: string) {
    const jacket = std(col, 0.55), salop = std('#1f262c', 0.8), boots = std('#30363b', 0.6), skin = std('#d9a37e', 0.7);
    const helmet = std('#f2f2ee', 0.35), visor = new T.MeshStandardMaterial({ color: '#111820', roughness: 0.1, metalness: 0.4 });
    const vest = std('#ff6a1f', 0.6);
    const cap = (r: number, l: number, m: T.Material) => { const g = new T.CapsuleGeometry(r, l, 4, 10); const o = new T.Mesh(g, m); o.castShadow = true; return o; };
    this.root.add(this.hips); this.hips.position.y = 0.95;
    // bassin et jambes
    { const p = cap(0.17, 0.12, salop); p.rotation.z = Math.PI / 2; p.scale.set(1, 1, 0.75); this.hips.add(p); }
    for (const s of [-1, 1]) {
      const th = new T.Group(); th.position.set(s * 0.11, -0.04, 0); this.hips.add(th);
      const tm = cap(0.085, THIGH - 0.12, salop); tm.position.y = -THIGH / 2; th.add(tm);
      const kn = new T.Group(); kn.position.y = -THIGH; th.add(kn);
      const sm = cap(0.075, SHIN - 0.12, salop); sm.position.y = -SHIN / 2; kn.add(sm);
      const ft = new T.Group(); ft.position.y = -SHIN; kn.add(ft);
      const boot = new T.Mesh(new T.BoxGeometry(0.12, 0.1, 0.28), boots); boot.position.set(0, -0.02, -0.06); boot.castShadow = true; ft.add(boot);
      this.th.push(th); this.kn.push(kn); this.ft.push(ft);
    }
    // tronc
    this.hips.add(this.spine); this.spine.position.y = 0.08;
    { const b = cap(0.18, 0.22, jacket); b.position.y = 0.16; this.spine.add(b); }
    this.spine.add(this.chest); this.chest.position.y = 0.3;
    { const c = cap(0.2, 0.16, jacket); c.position.y = 0.06; c.scale.set(1.1, 1, 0.85); this.chest.add(c);
      const lj = cap(0.205, 0.14, vest); lj.position.y = 0.05; lj.scale.set(1.12, 0.9, 0.9); this.chest.add(lj); // gilet de sauvetage
      const col = new T.Mesh(new T.CylinderGeometry(0.11, 0.13, 0.08, 12), jacket); col.position.y = 0.24; this.chest.add(col); }
    // cou, tête, casque, visière
    this.chest.add(this.neck); this.neck.position.y = 0.28;
    this.neck.add(this.head); this.head.position.y = 0.1;
    { const h = new T.Mesh(new T.SphereGeometry(0.115, 16, 12), skin); h.scale.set(1, 1.08, 1.02); h.castShadow = true; this.head.add(h);
      const hm = new T.Mesh(new T.SphereGeometry(0.13, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), helmet); hm.position.y = 0.025; this.head.add(hm);
      const vz = new T.Mesh(new T.BoxGeometry(0.2, 0.05, 0.04), visor); vz.position.set(0, 0.02, -0.11); vz.rotation.x = 0.15; this.head.add(vz); }
    // bras
    for (const s of [-1, 1]) {
      const sh = new T.Group(); sh.position.set(s * 0.24, 0.17, 0); this.chest.add(sh);
      const ua = cap(0.065, UP - 0.1, jacket); ua.position.y = -UP / 2; sh.add(ua);
      const el = new T.Group(); el.position.y = -UP; sh.add(el);
      const fa = cap(0.055, FORE - 0.1, jacket); fa.position.y = -FORE / 2; el.add(fa);
      const hand = new T.Mesh(new T.SphereGeometry(0.05, 10, 8), std('#2b2f33', 0.6)); hand.position.y = -FORE - 0.02; el.add(hand); // gants
      this.sh.push(sh); this.el.push(el);
    }
  }

  /** Cinématique inverse à deux segments : place l'épaule et le coude pour que la main touche la cible. */
  private reach(i: number, target: T.Vector3 | null, side: number, rest: number): void {
    const sh = this.sh[i], el = this.el[i];
    if (!target) {
      sh.quaternion.setFromEuler(new T.Euler(rest, 0, side * 0.12)); el.rotation.set(-0.35 - rest * 0.3, 0, 0);
      return;
    }
    // cible dans le repère du thorax
    const D = this.chest.worldToLocal(this.v.copy(target)).sub(sh.position);
    const d = Math.min(D.length(), (UP + FORE) * 0.995), n = D.normalize();
    const cosA = (UP * UP + d * d - FORE * FORE) / (2 * UP * d), A = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const cosE = (UP * UP + FORE * FORE - d * d) / (2 * UP * FORE), bend = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosE)));
    // le coude part vers le bas, l'arrière et l'extérieur
    const pole = this.w.set(side * 0.6, -1, 0.5);
    const p = pole.sub(this.ax.copy(n).multiplyScalar(pole.dot(n))).normalize();
    const upper = this.ay.copy(n).multiplyScalar(Math.cos(A)).addScaledVector(p, Math.sin(A)).normalize();
    // repère local du bras : y le long de l'humérus (vers l'épaule), z vers la cible
    const y = upper.clone().negate();
    const z = this.az.copy(n).addScaledVector(upper, -n.dot(upper)).normalize();
    const x = new T.Vector3().crossVectors(y, z);
    this.m.makeBasis(x, y, z); this.q.setFromRotationMatrix(this.m); sh.quaternion.copy(this.q);
    el.rotation.set(-bend, 0, 0);
  }

  update(p: Pose): void {
    const c = p.crouch, walk = p.walk;
    // bassin : plus bas quand il s'accroupit, balancé quand il marche
    this.hips.position.y = 0.95 - 0.32 * c + (walk != null ? Math.abs(Math.sin(walk)) * 0.04 : Math.sin(p.t * 1.7) * 0.008);
    this.hips.rotation.set(0, 0, p.lean * 0.35);
    this.spine.rotation.set(-p.bend * 0.6 - c * 0.25, 0, p.lean * 0.4);
    this.chest.rotation.set(-p.bend * 0.4, walk != null ? Math.sin(walk) * 0.15 : 0, p.lean * 0.25 + Math.sin(p.t * 1.3) * 0.015);
    this.neck.rotation.set(p.bend * 0.5 + c * 0.2, p.look, -p.lean * 0.5);
    // jambes : genoux fléchis (amortissent la houle), pas de marche
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, ph = walk != null ? Math.sin(walk + (i ? Math.PI : 0)) : 0;
      const knee = 0.25 + c * 1.3 + (walk != null ? Math.max(0, -ph) * 0.6 : 0);
      this.th[i].rotation.set(-knee * 0.55 - ph * 0.45 + p.bend * 0.2, 0, -p.lean * 0.3 + s * 0.06);
      this.kn[i].rotation.set(knee, 0, 0);
      this.ft[i].rotation.set(-knee * 0.45 + ph * 0.2, 0, 0);
    }
    this.root.updateMatrixWorld(true);
    this.reach(0, p.handL, -1, walk != null ? Math.sin(walk) * 0.5 : 0.1);
    this.reach(1, p.handR, 1, walk != null ? -Math.sin(walk) * 0.5 : 0.1);
  }
}
