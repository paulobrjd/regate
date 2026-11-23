// Cordage 3D : tube tressé qui suit une polyligne, mis à jour à chaque image (géométrie réutilisée).
import * as T from 'three';

const S = 6; // côtés du tube

/** Texture de tresse (diagonales), répétée le long du cordage. */
export function braidTex(a: string, b: string): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d')!;
  x.fillStyle = a; x.fillRect(0, 0, 64, 16);
  x.strokeStyle = b; x.lineWidth = 3;
  for (let i = -16; i < 80; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 16, 16); x.stroke(); }
  x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1;
  for (let i = -16; i < 80; i += 8) { x.beginPath(); x.moveTo(i + 16, 0); x.lineTo(i, 16); x.stroke(); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; return t;
}

export class Rope {
  readonly mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  private pos: Float32Array; private nrm: Float32Array;
  private a = new T.Vector3(); private t = new T.Vector3(); private n = new T.Vector3(); private b = new T.Vector3(); private up = new T.Vector3(0, 1, 0);

  constructor(readonly N: number, readonly r: number, mat: T.MeshStandardMaterial) {
    const g = new T.BufferGeometry();
    this.pos = new Float32Array(N * (S + 1) * 3); this.nrm = new Float32Array(N * (S + 1) * 3);
    const uv: number[] = [], idx: number[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j <= S; j++) uv.push(i * 0.5, j / S);
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < S; j++) { const p = i * (S + 1) + j, q = p + 1, s = p + S + 1, u = s + 1; idx.push(p, s, q, q, s, u); }
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    this.mesh = new T.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
  }

  /** pts : points [x,y,z] (rééchantillonnés à N points). */
  update(pts: number[][]): void {
    const N = this.N, m = pts.length;
    if (m < 2) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    // longueurs cumulées pour un échantillonnage régulier
    const L = [0]; for (let i = 1; i < m; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    const tot = L[m - 1] || 1e-6;
    const P: number[][] = []; let k = 0;
    for (let i = 0; i < N; i++) {
      const s = tot * i / (N - 1); while (k < m - 2 && L[k + 1] < s) k++;
      const f = Math.min(1, Math.max(0, (s - L[k]) / ((L[k + 1] - L[k]) || 1e-6))), A = pts[k], B = pts[k + 1];
      P.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
    }
    let o = 0;
    for (let i = 0; i < N; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[Math.min(N - 1, i + 1)];
      this.t.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
      this.n.crossVectors(this.t, this.up); if (this.n.lengthSq() < 1e-6) this.n.set(1, 0, 0); this.n.normalize();
      this.b.crossVectors(this.n, this.t).normalize();
      for (let j = 0; j <= S; j++) {
        const an = j / S * Math.PI * 2, c = Math.cos(an), s = Math.sin(an);
        this.a.set(this.n.x * c + this.b.x * s, this.n.y * c + this.b.y * s, this.n.z * c + this.b.z * s);
        this.pos[o] = P[i][0] + this.a.x * this.r; this.pos[o + 1] = P[i][1] + this.a.y * this.r; this.pos[o + 2] = P[i][2] + this.a.z * this.r;
        this.nrm[o] = this.a.x; this.nrm[o + 1] = this.a.y; this.nrm[o + 2] = this.a.z; o += 3;
      }
    }
    // longueur réelle → répétition de la tresse
    (this.mesh.material.map as T.Texture).repeat.x = 1;
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.normal.needsUpdate = true;
    this.mesh.geometry.computeBoundingSphere();
  }
}
