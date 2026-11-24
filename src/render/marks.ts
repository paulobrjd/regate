// Habillage du parcours : bouées gonflables de régate aux couleurs du parcours, tours « DÉPART / ARRIVÉE »
// aux extrémités de la ligne et ligne de flotteurs entre elles.
import * as T from 'three';

/** Palette de couleurs par parcours (couleur principale, couleur secondaire). */
const PALETTES: [string, string][] = [['#ff6a1f', '#ffd23f'], ['#e8384f', '#ffffff'], ['#ffd23f', '#1f3a5f'], ['#3ddc97', '#0b3d2e'], ['#b388ff', '#ffffff'], ['#4cc9f0', '#ff6a1f']];
export function palette(courseId: string): [string, string] {
  let h = 0; for (const c of courseId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

function bandTex(col: string, col2: string, num: string, text: string): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d')!;
  x.fillStyle = col; x.fillRect(0, 0, 512, 256);
  x.fillStyle = col2; x.fillRect(0, 150, 512, 38);
  x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(0, 0, 512, 10);
  x.font = '800 120px "Barlow Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 6;
  for (const cx of [128, 384]) { x.strokeText(num, cx, 82); x.fillText(num, cx, 82); }
  x.font = '800 30px "Barlow Condensed", sans-serif'; x.fillStyle = col === col2 ? '#000' : col;
  for (const cx of [128, 384]) x.fillText(text, cx, 170);
  const t = new T.CanvasTexture(c); t.wrapS = T.RepeatWrapping; return t;
}

/** Bouée gonflable de parcours (≈ 5 m de haut), avec pavillon et feu à éclats. */
export function raceMark(col: string, col2: string, num: string): T.Group {
  const g = new T.Group();
  const skin = new T.MeshStandardMaterial({ map: bandTex(col, col2, num, 'RÉGATE AU LARGE'), roughness: 0.35 });
  const body = new T.Mesh(new T.CylinderGeometry(1.7, 2.0, 4.2, 28, 1, true), skin); body.position.y = 2.1; body.castShadow = true; g.add(body);
  const top = new T.Mesh(new T.SphereGeometry(1.7, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), new T.MeshStandardMaterial({ color: col, roughness: 0.35 })); top.position.y = 4.2; g.add(top);
  const ring = new T.Mesh(new T.TorusGeometry(2.05, 0.35, 10, 28), new T.MeshStandardMaterial({ color: '#20262b', roughness: 0.6 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.15; g.add(ring);
  const pole = new T.Mesh(new T.CylinderGeometry(0.05, 0.07, 3.2, 8), new T.MeshStandardMaterial({ color: '#e9eef2', roughness: 0.4 })); pole.position.y = 7.3; g.add(pole);
  const fl = new T.Mesh(new T.PlaneGeometry(1.8, 1.1), new T.MeshBasicMaterial({ color: col2 === '#ffffff' ? col : col2, side: T.DoubleSide })); fl.position.set(0.95, 8.3, 0); g.add(fl);
  g.userData.flag = fl;
  return g;
}

function bannerTex(text: string, col: string): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const x = c.getContext('2d')!;
  x.fillStyle = col; x.fillRect(0, 0, 256, 1024);
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 40); x.fillRect(0, 984, 256, 40);
  for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#111' : '#fff'; x.fillRect(i * 32, 60, 32, 32); x.fillStyle = i % 2 ? '#fff' : '#111'; x.fillRect(i * 32, 92, 32, 32); } // damier
  x.save(); x.translate(128, 560); x.rotate(-Math.PI / 2); x.font = '800 150px "Barlow Condensed", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#ffffff'; x.fillText(text, 0, 0); x.restore();
  return new T.CanvasTexture(c);
}

/** Tour gonflable (≈ 11 m) en bout de ligne, avec « DÉPART · ARRIVÉE » sur ses faces. */
export function lineTower(col: string): T.Group {
  const g = new T.Group(), tex = bannerTex('DÉPART · ARRIVÉE', col);
  const m = new T.MeshStandardMaterial({ map: tex, roughness: 0.4 });
  const body = new T.Mesh(new T.CylinderGeometry(0.6, 2.4, 11, 4, 1), m); body.rotation.y = Math.PI / 4; body.position.y = 5.5; body.castShadow = true; g.add(body);
  const base = new T.Mesh(new T.TorusGeometry(2.6, 0.5, 10, 24), new T.MeshStandardMaterial({ color: '#20262b', roughness: 0.6 })); base.rotation.x = Math.PI / 2; base.position.y = 0.2; g.add(base);
  const cap = new T.Mesh(new T.SphereGeometry(0.75, 14, 10), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 })); cap.position.y = 11.2; g.add(cap);
  return g;
}

/** Ligne de flotteurs entre la bouée de départ et le bateau comité (positions mises à jour avec la houle). */
export class FloatLine {
  readonly mesh: T.InstancedMesh;
  private pts: { x: number; z: number }[] = [];
  private m = new T.Matrix4();
  constructor(n = 40) {
    this.mesh = new T.InstancedMesh(new T.SphereGeometry(0.8, 12, 8), new T.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }), n);
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, new T.Color(i % 2 ? '#ffffff' : '#ff6a1f'));
    this.mesh.frustumCulled = false;
  }
  set(a: { x: number; y: number }, b: { x: number; y: number }, col: string): void {
    const n = this.mesh.count; this.pts = [];
    for (let i = 0; i < n; i++) { const f = (i + 1) / (n + 1); this.pts.push({ x: a.x + (b.x - a.x) * f, z: a.y + (b.y - a.y) * f }); this.mesh.setColorAt(i, new T.Color(i % 2 ? '#ffffff' : col)); }
    this.mesh.instanceColor!.needsUpdate = true;
  }
  update(wh: (x: number, z: number) => number, opacity: number): void {
    this.pts.forEach((p, i) => { this.m.makeTranslation(p.x, wh(p.x, p.z) * 0.8 + 0.1, p.z); this.mesh.setMatrixAt(i, this.m); });
    this.mesh.instanceMatrix.needsUpdate = true;
    (this.mesh.material as T.MeshStandardMaterial).opacity = opacity; (this.mesh.material as T.MeshStandardMaterial).transparent = opacity < 1;
  }
}
