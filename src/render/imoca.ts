// Modèle 3D d'IMOCA 60 : carène à étrave ronde et bouchains vifs, pont, casquette, cockpit, accastillage,
// mât-aile, gréement, quille pendulaire à bulbe, foils en C, safrans. Unités : mètres, étrave vers -z, tribord vers +x.
import * as T from 'three';

export const L = 18.28;
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** t ∈ [0,1] de l'étrave au tableau. */
export const HZ = (t: number) => -L / 2 + t * L;
/** Demi-largeur au livet : étrave ronde (scow), maître-bau à 62 %, tableau large. */
export const HW = (t: number) => t < 0.62 ? 2.8 - 1.7 * Math.pow(1 - t / 0.62, 2.3) : 2.8 - 0.3 * Math.pow((t - 0.62) / 0.38, 1.5);
/** Hauteur du livet au-dessus de la flottaison. */
export const HT = (t: number) => 1.45 - 0.35 * t + 0.08 * Math.sin(Math.PI * t);
/** Ligne de quille : l'étrave sort de l'eau (rocker), le tableau trempe à peine. */
const HK = (t: number) => t < 0.42 ? 0.5 - 1.05 * (1 - Math.pow(1 - t / 0.42, 2)) : -0.55 + 0.27 * Math.pow((t - 0.42) / 0.58, 1.4);
/** Bouchain : hauteur et demi-largeur. */
const HC = (t: number) => 0.32 + 0.5 * Math.pow(1 - t, 3);
const XC = (t: number) => HW(t) * (0.96 - 0.3 * Math.pow(1 - t, 5));
/** Pont bombé, avec le cockpit en creux à l'arrière. */
export const deckY = (t: number, w: number) => HT(t) + 0.13 * (1 - w * w) - 0.5 * sm(0.64, 0.52, Math.abs(w)) * sm(0.70, 0.73, t) * sm(0.99, 0.965, t);
export const MAST_T = 0.43, MAST_Z = HZ(MAST_T), DECK = HT(MAST_T) + 0.13;
/** Winchs : primaires (écoutes de voile d'avant) et secondaires, de chaque côté. */
export const WINCHES = [{ x: 1.85, t: 0.84, r: 0.17 }, { x: 1.95, t: 0.93, r: 0.14 }];
export const TRAV_T = 0.95;

/** Petit écran de navigation (courbes et chiffres). */
function screenTex(col: string): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d')!;
  x.fillStyle = '#05121c'; x.fillRect(0, 0, 128, 64);
  x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); for (let i = 0; i <= 64; i++) x.lineTo(4 + i * 1.9, 44 - Math.sin(i * 0.25) * 8 - Math.random() * 4); x.stroke();
  x.fillStyle = col; x.font = 'bold 18px sans-serif'; x.fillText((10 + Math.random() * 15).toFixed(1), 6, 20);
  return new T.CanvasTexture(c);
}

/** Point de la demi-section : s ∈ [0,1] de la quille au livet. */
function sect(t: number, s: number): [number, number] {
  const k = 0.6;
  if (s <= k) { const u = s / k; return [XC(t) * Math.pow(u, 0.85), HK(t) + (HC(t) - HK(t)) * Math.pow(u, 2.6)]; }
  const v = (s - k) / (1 - k);
  return [XC(t) + (HW(t) - XC(t)) * Math.pow(v, 1.4), HC(t) + (HT(t) - HC(t)) * v];
}

/** Livrée de coque : couleur d'équipe, bande blanche, nom et numéro des deux côtés. */
function liveryTex(col: string, name: string, num: string): T.CanvasTexture {
  const W = 2048, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d')!;
  x.fillStyle = '#eef1f3'; x.fillRect(0, 0, W, H);
  const band = (y0: number, y1: number, flipX: boolean, flipY: boolean) => {
    x.save(); x.beginPath(); x.rect(0, y0, W, y1 - y0); x.clip();
    x.translate(flipX ? W : 0, flipY ? y1 + y0 : 0); x.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    x.fillStyle = col; x.fillRect(0, y0, W, y1 - y0);
    // vague blanche de l'étrave vers l'arrière
    x.fillStyle = 'rgba(255,255,255,.92)'; x.beginPath();
    x.moveTo(0, y1); x.bezierCurveTo(W * 0.25, y1 - (y1 - y0) * 0.1, W * 0.45, y0 + (y1 - y0) * 0.75, W * 0.95, y0 + (y1 - y0) * 0.15);
    x.lineTo(W, y0 + (y1 - y0) * 0.22); x.bezierCurveTo(W * 0.5, y0 + (y1 - y0) * 0.95, W * 0.3, y1, 0, y1); x.fill();
    x.fillStyle = '#1b2328'; x.fillRect(0, y1 - 6, W, 6); // liston
    x.fillStyle = '#ffffff'; x.font = `800 ${Math.round((y1 - y0) * 0.5)}px "Barlow Condensed", sans-serif`; x.textBaseline = 'middle';
    x.fillText(name.toUpperCase(), W * 0.22, y0 + (y1 - y0) * 0.45);
    x.font = `800 ${Math.round((y1 - y0) * 0.38)}px "Barlow Condensed", sans-serif`; x.fillText('FRA ' + num, W * 0.72, y0 + (y1 - y0) * 0.5);
    x.restore();
  };
  // v = 1 (haut de l'image) : livet tribord ; v = 0 (bas) : livet bâbord ; voir sect()
  const top = H * 0.21;
  band(0, top, true, false);       // tribord : lu de l'arrière vers l'avant
  band(H - top, H, false, true);   // bâbord
  const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
}

function nonSkidTex(): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
  x.fillStyle = '#c4cacd'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.08)'; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  const t = new T.CanvasTexture(c); t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(6, 2); return t;
}

/** Section de profil NACA symétrique (corde selon y, épaisseur selon x). */
function foilShape(chord: number, thick: number): T.Shape {
  const s = new T.Shape(), n = 16, pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos(Math.PI * i / n)) / 2;
    const yt = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
    pts.push([yt * chord, x * chord]);
  }
  s.moveTo(0, 0);
  for (const [a, b] of pts) s.lineTo(a, b - chord * 0.3);
  for (let i = pts.length - 1; i >= 0; i--) s.lineTo(-pts[i][0], pts[i][1] - chord * 0.3);
  return s;
}
/** Aile verticale (quille, safran) : profil extrudé vers le bas. */
function blade(chord: number, thick: number, depth: number, mat: T.Material): T.Mesh {
  const g = new T.ExtrudeGeometry(foilShape(chord, thick), { depth, bevelEnabled: false, steps: 1 });
  g.rotateX(Math.PI / 2); // extrusion vers -y, corde selon z
  return new T.Mesh(g, mat);
}

/** Foil en C balayé le long d'une courbe, effilé vers le saumon. */
function foilGeo(sign: number): T.BufferGeometry {
  const curve = new T.CatmullRomCurve3([
    new T.Vector3(-0.6 * sign, 0.6, 0), new T.Vector3(0.6 * sign, 0.15, 0.05), new T.Vector3(1.9 * sign, -0.45, 0.15),
    new T.Vector3(2.9 * sign, -1.3, 0.25), new T.Vector3(3.15 * sign, -2.3, 0.35), new T.Vector3(2.85 * sign, -3.0, 0.4),
  ]);
  const NS = 40, NC = 10, pos: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NS; i++) {
    const u = i / NS, P = curve.getPointAt(u), Tg = curve.getTangentAt(u);
    const nx = -Tg.y, ny = Tg.x, nl = Math.hypot(nx, ny) || 1;
    const chord = 0.62 - 0.32 * u, th = 0.07 - 0.035 * u;
    for (let j = 0; j < NC; j++) {
      const a = j / NC * Math.PI * 2;
      pos.push(P.x + nx / nl * Math.sin(a) * th / 2, P.y + ny / nl * Math.sin(a) * th / 2, P.z + Math.cos(a) * chord / 2);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NC; j++) {
    const a = i * NC + j, b = i * NC + (j + 1) % NC, c = a + NC, d = b + NC;
    if (sign > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export interface Mats { carbon: T.Material; deck: T.Material; dark: T.Material; metal: T.Material; glass: T.Material; rope: T.LineBasicMaterial; skin: T.Material }
let shared: (Mats & { nonSkid: T.CanvasTexture }) | null = null;
export function mats(): Mats {
  if (shared) return shared;
  const nonSkid = nonSkidTex();
  shared = {
    nonSkid,
    carbon: new T.MeshStandardMaterial({ color: '#1a1f23', roughness: 0.35, metalness: 0.2 }),
    deck: new T.MeshStandardMaterial({ color: '#ffffff', map: nonSkid, roughness: 0.85, side: T.DoubleSide }),
    dark: new T.MeshStandardMaterial({ color: '#2a3238', roughness: 0.5 }),
    metal: new T.MeshStandardMaterial({ color: '#c9ced3', roughness: 0.25, metalness: 0.9 }),
    glass: new T.MeshStandardMaterial({ color: '#0f1a22', roughness: 0.05, metalness: 0.3 }),
    rope: new T.LineBasicMaterial({ color: '#30383d' }),
    skin: new T.MeshStandardMaterial({ color: '#d9a37e', roughness: 0.7 }),
  };
  return shared;
}

export interface ImocaParts {
  roll: T.Group; mast: T.Mesh; boomG: T.Group; keelG: T.Group; foilP: T.Group; foilS: T.Group; ruds: T.Group[]; car: T.Mesh; tiller: T.Group;
}

/** Construit la coque, le pont, l'accastillage, le mât et les appendices dans le groupe roll. */
export function buildImoca(roll: T.Group, col: string, name: string, num: string): ImocaParts {
  const M = mats();
  // --- carène ---
  const N = 96, S = 26, pos: number[] = [], uv: number[] = [], colr: number[] = [], idx: number[] = [];
  const tOf = (i: number) => Math.pow(i / N, 1.15);
  for (let i = 0; i <= N; i++) {
    const t = tOf(i);
    for (let j = -S; j <= S; j++) {
      const s = Math.abs(j) / S, [x, y] = sect(t, s);
      pos.push(Math.sign(j) * x, y, HZ(t));
      uv.push(t, (j + S) / (2 * S));
      const k = y < -0.01 ? 0.22 : y < 0.07 ? 0.05 : 1; // antifouling sous la flottaison, liseré noir
      colr.push(k, k, k);
    }
  }
  const W2 = 2 * S + 1;
  for (let i = 0; i < N; i++) for (let j = 0; j < 2 * S; j++) { const a = i * W2 + j, b = a + 1, c = a + W2, d = c + 1; idx.push(a, b, c, b, d, c); }
  // étrave et tableau : fermés en éventail
  const cap = (i: number, flip: boolean) => {
    const t = tOf(i), ci = pos.length / 3; pos.push(0, (HT(t) + HK(t)) / 2 + 0.2, HZ(t)); uv.push(t, 0.5); colr.push(1, 1, 1);
    for (let j = 0; j < 2 * S; j++) { const a = i * W2 + j; if (flip) idx.push(ci, a + 1, a); else idx.push(ci, a, a + 1); }
  };
  cap(0, true); cap(N, false);
  const hg = new T.BufferGeometry();
  hg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); hg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  hg.setAttribute('color', new T.Float32BufferAttribute(colr, 3)); hg.setIndex(idx); hg.computeVertexNormals();
  const hull = new T.Mesh(hg, new T.MeshStandardMaterial({ map: liveryTex(col, name, num), vertexColors: true, roughness: 0.22, metalness: 0.05, side: T.DoubleSide }));
  hull.castShadow = true; hull.receiveShadow = true; roll.add(hull);

  // --- pont (bombé, cockpit en creux) ---
  {
    const K = 18, p: number[] = [], u: number[] = [], id: number[] = [];
    for (let i = 0; i <= N; i++) { const t = tOf(i); for (let k = 0; k <= K; k++) { const w = -1 + 2 * k / K; p.push(w * HW(t) * 0.995, deckY(t, w), HZ(t)); u.push(t * 3, (w + 1)); } }
    for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + 1, c = a + K + 1, d = c + 1; id.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(u, 2)); g.setIndex(id); g.computeVertexNormals();
    const deck = new T.Mesh(g, M.deck); deck.receiveShadow = true; deck.castShadow = true; roll.add(deck);
  }
  // --- casquette (abri du cockpit) avec vitrages ---
  {
    const NT = 10, NP = 14, p: number[] = [], id: number[] = [];
    const t0 = 0.58, t1 = 0.84;
    for (let i = 0; i <= NT; i++) {
      const f = i / NT, t = t0 + (t1 - t0) * f, a = HW(t) * (0.58 + 0.12 * f), h = 0.25 + 0.5 * Math.min(1, f * 3);
      for (let k = 0; k <= NP; k++) {
        const ph = Math.PI * k / NP, c = Math.cos(ph), s = Math.sin(ph);
        p.push(a * Math.sign(c) * Math.pow(Math.abs(c), 0.35), deckY(t, 0.72) - 0.05 + h * Math.pow(s, 0.3), HZ(t));
      }
    }
    for (let i = 0; i < NT; i++) for (let k = 0; k < NP; k++) { const a = i * (NP + 1) + k, b = a + 1, c = a + NP + 1, d = c + 1; id.push(a, c, b, b, c, d); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(p, 3)); g.setIndex(id); g.computeVertexNormals();
    const roof = new T.Mesh(g, new T.MeshStandardMaterial({ color: '#dde2e5', roughness: 0.3, side: T.DoubleSide })); roof.castShadow = true; roll.add(roof);
    const win = new T.Mesh(new T.BoxGeometry(HW(0.62) * 1.05, 0.22, 0.04), M.glass);
    win.position.set(0, deckY(0.62, 0.5) + 0.45, HZ(0.62)); win.rotation.x = -0.9; roll.add(win);
    for (const sx of [-1, 1]) { const sw = new T.Mesh(new T.BoxGeometry(0.04, 0.2, 1.6), M.glass); sw.position.set(sx * HW(0.7) * 0.66, deckY(0.7, 0.6) + 0.48, HZ(0.7)); roll.add(sw); }
  }
  // --- winchs (sur l'hiloire du cockpit), colonne de moulin à café ---
  for (const wp of WINCHES) for (const sx of [-1, 1]) {
    const x = sx * wp.x, t = wp.t, y = deckY(t, x / HW(t));
    const w = new T.Mesh(new T.CylinderGeometry(wp.r, wp.r * 1.25, 0.3, 18), M.metal); w.position.set(x, y + 0.15, HZ(t)); w.castShadow = true; roll.add(w);
    const top = new T.Mesh(new T.CylinderGeometry(wp.r * 0.75, wp.r * 0.9, 0.08, 14), M.carbon); top.position.set(x, y + 0.33, HZ(t)); roll.add(top);
  }
  const floor = (t: number) => deckY(t, 0);
  { const ped = new T.Mesh(new T.CylinderGeometry(0.09, 0.14, 0.95, 12), M.carbon); ped.position.set(0, floor(0.8) + 0.47, HZ(0.8)); roll.add(ped);
    const hd = new T.Mesh(new T.CylinderGeometry(0.11, 0.11, 0.12, 12), M.metal); hd.rotation.z = Math.PI / 2; hd.position.set(0, floor(0.8) + 0.95, HZ(0.8)); roll.add(hd);
    for (const sx of [-1, 1]) { const h = new T.Mesh(new T.BoxGeometry(0.04, 0.3, 0.04), M.metal); h.position.set(sx * 0.12, floor(0.8) + 0.95, HZ(0.8) + 0.12); roll.add(h); } }
  // --- intérieur : cloison avec descente, écrans, siège baquet, cale-pieds ---
  {
    const tb = 0.715, zb = HZ(tb), wB = HW(tb) * 0.6, yF = floor(0.74), hB = deckY(tb, 0.7) + 0.6 - yF;
    const bulk = new T.Mesh(new T.BoxGeometry(wB * 2, hB, 0.05), new T.MeshStandardMaterial({ color: '#d6dbde', roughness: 0.6 }));
    bulk.position.set(0, yF + hB / 2, zb); roll.add(bulk);
    // descente vers la cabine : ouverture sombre et lueur de la table à cartes
    const hole = new T.Mesh(new T.BoxGeometry(0.62, 0.95, 0.5), new T.MeshStandardMaterial({ color: '#0b1014', roughness: 1, side: T.BackSide }));
    hole.position.set(0, yF + 0.5, zb - 0.24); roll.add(hole);
    const glow = new T.Mesh(new T.PlaneGeometry(0.4, 0.22), new T.MeshBasicMaterial({ color: '#3fa7ff' })); glow.position.set(0, yF + 0.55, zb - 0.47); roll.add(glow);
    // écrans de navigation au-dessus de la descente
    const scr = (x: number, w: number, c: string) => { const m = new T.Mesh(new T.PlaneGeometry(w, 0.26), new T.MeshBasicMaterial({ map: screenTex(c) })); m.position.set(x, yF + hB - 0.32, zb + 0.03); roll.add(m); };
    scr(-0.62, 0.42, '#38d27a'); scr(0, 0.5, '#3fa7ff'); scr(0.62, 0.42, '#ffb340');
    // siège baquet face aux écrans
    const seatM = new T.MeshStandardMaterial({ color: '#30383e', roughness: 0.8 });
    const seat = new T.Mesh(new T.BoxGeometry(0.55, 0.12, 0.55), seatM); seat.position.set(0, yF + 0.45, HZ(0.765)); roll.add(seat);
    const back = new T.Mesh(new T.BoxGeometry(0.55, 0.7, 0.1), seatM); back.position.set(0, yF + 0.82, HZ(0.765) + 0.3); back.rotation.x = 0.2; roll.add(back);
    const leg = new T.Mesh(new T.CylinderGeometry(0.05, 0.08, 0.42, 8), M.carbon); leg.position.set(0, yF + 0.2, HZ(0.765)); roll.add(leg);
    // cale-pieds et marche
    for (const t of [0.86, 0.92]) { const fb = new T.Mesh(new T.BoxGeometry(HW(t) * 1.1, 0.06, 0.12), M.carbon); fb.position.set(0, floor(t) + 0.05, HZ(t)); roll.add(fb); }
  }
  // --- rail et chariot de grand-écoute ---
  { const t = TRAV_T, track = new T.Mesh(new T.BoxGeometry(HW(t) * 1.5, 0.05, 0.1), M.metal); track.position.set(0, floor(t) + 0.32, HZ(t)); roll.add(track);
    for (const sx of [-1, 1]) { const ft = new T.Mesh(new T.BoxGeometry(0.08, 0.32, 0.12), M.carbon); ft.position.set(sx * HW(t) * 0.75, floor(t) + 0.16, HZ(t)); roll.add(ft); } }
  const car = new T.Mesh(new T.BoxGeometry(0.22, 0.1, 0.16), M.dark); car.position.set(0, floor(TRAV_T) + 0.38, HZ(TRAV_T)); roll.add(car);
  // --- barres franches jumelles reliées par une traverse ---
  const tiller = new T.Group(); tiller.position.set(0, HT(0.97) + 0.3, HZ(0.965)); roll.add(tiller);
  { const tm = new T.MeshStandardMaterial({ color: '#b5895a', roughness: 0.5 });
    for (const sx of [-1, 1]) { const g = new T.CylinderGeometry(0.03, 0.04, 1.5, 8); g.rotateX(Math.PI / 2); const m = new T.Mesh(g, M.carbon); m.position.set(sx * HW(0.97) * 0.72, 0, -0.75); tiller.add(m); }
    const cb = new T.CylinderGeometry(0.025, 0.025, HW(0.97) * 1.44, 8); cb.rotateZ(Math.PI / 2); const cross = new T.Mesh(cb, tm); cross.position.set(0, 0, -1.45); tiller.add(cross); }

  // --- bout-dehors ---
  { const bs = new T.Mesh(new T.CylinderGeometry(0.06, 0.09, 2.6, 10), M.carbon); bs.rotation.x = Math.PI / 2 - 0.05; bs.position.set(0, HT(0) + 0.05, HZ(0) - 1.1); roll.add(bs); }

  // --- mât-aile, barres de flèche, bôme ---
  const mg = new T.CylinderGeometry(0.12, 0.19, 29, 20); mg.scale(1, 1, 2.4);
  const mast = new T.Mesh(mg, M.carbon); mast.position.set(0, DECK + 14.5, MAST_Z); mast.castShadow = true; roll.add(mast);
  for (const [hgt, len] of [[11, 2.2], [20, 1.6]]) for (const sx of [-1, 1]) {
    const sp = new T.Mesh(new T.BoxGeometry(len, 0.07, 0.18), M.carbon); sp.position.set(sx * len / 2, hgt - 14.5, 0.2); sp.rotation.y = sx * 0.25; mast.add(sp);
  }
  const boomG = new T.Group(); boomG.position.set(0, DECK + 2.2, MAST_Z + 0.35); roll.add(boomG);
  { const bg = new T.CylinderGeometry(0.09, 0.15, 7.2, 12); bg.rotateX(Math.PI / 2); bg.translate(0, 0, 3.6); bg.scale(1, 1.8, 1);
    const boom = new T.Mesh(bg, M.carbon); boom.castShadow = true; boomG.add(boom); }

  // --- gréement dormant, filières ---
  {
    const v: number[] = [], seg = (a: number[], b: number[]) => v.push(...a, ...b);
    const top = [0, DECK + 28.8, MAST_Z], hi = [0, DECK + 25, MAST_Z - 0.2];
    for (const sx of [-1, 1]) {
      const s1 = [sx * 2.1, DECK + 11, MAST_Z + 0.75], s2 = [sx * 1.55, DECK + 20, MAST_Z + 0.6], cp = [sx * HW(0.47) * 0.97, HT(0.47) + 0.1, HZ(0.47)];
      seg(top, s2); seg(s2, s1); seg(s1, cp); seg([0, DECK + 20, MAST_Z], s1);
      const bk = [sx * HW(0.985) * 0.9, HT(0.985) + 0.1, HZ(0.985)];
      seg(top, bk); seg(hi, bk); // bastaques
      // filières et chandeliers
      let prev: number[] | null = null;
      for (let t = 0.07; t <= 0.96; t += 0.0625) {
        const x = sx * HW(t) * 0.97, y0 = HT(t) + 0.05, p0 = [x, y0, HZ(t)], p1 = [x, y0 + 0.62, HZ(t)];
        seg(p0, p1); if (prev) seg(prev, p1); prev = p1;
      }
    }
    seg([0, HT(0) + 0.3, HZ(0) - 2.3], hi);               // étai de code 0 / gennaker
    seg([0, HT(0) + 0.3, HZ(0)], [0, DECK + 25, MAST_Z]);  // étai de J1
    seg([0, HT(0.14) + 0.2, HZ(0.14)], [0, DECK + 17.5, MAST_Z]); // étai de trinquette
    seg([0, HT(0) + 0.05, HZ(0) - 2.3], [0, HK(0.03), HZ(0.03)]); // sous-barbe
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
    const rig = new T.LineSegments(g, M.rope); rig.frustumCulled = false; roll.add(rig);
  }

  // --- quille pendulaire : voile de quille profilé et bulbe en torpille ---
  const keelG = new T.Group(); keelG.position.set(0, HK(0.5) + 0.1, HZ(0.5)); roll.add(keelG);
  { const fin = blade(1.0, 0.12, 4.3, M.carbon); fin.castShadow = true; keelG.add(fin);
    const prof: T.Vector2[] = [];
    for (let i = 0; i <= 24; i++) { const z = i / 24; prof.push(new T.Vector2(0.46 * Math.pow(Math.sin(Math.PI * Math.pow(z, 0.8)), 0.7) + 0.001, (z - 0.4) * 3.8)); }
    const bg = new T.LatheGeometry(prof, 20); bg.rotateX(Math.PI / 2);
    const bulb = new T.Mesh(bg, M.dark); bulb.position.set(0, -4.45, 0.1); keelG.add(bulb); }

  // --- foils ---
  const foilP = new T.Group(), foilS = new T.Group();
  foilP.add(new T.Mesh(foilGeo(-1), M.carbon)); foilS.add(new T.Mesh(foilGeo(1), M.carbon));
  foilP.position.set(-HW(0.36) * 0.9, 0.2, HZ(0.36)); foilS.position.set(HW(0.36) * 0.9, 0.2, HZ(0.36)); roll.add(foilP, foilS);

  // --- safrans jumeaux ---
  const ruds = [-1, 1].map(sx => {
    const g = new T.Group(); g.position.set(sx * HW(0.97) * 0.72, HT(0.97) - 0.3, HZ(0.965)); g.rotation.z = -sx * 0.12;
    const bl = blade(0.5, 0.11, 2.8, M.carbon); bl.position.y = 0.4; g.add(bl); roll.add(g); return g;
  });
  return { roll, mast, boomG, keelG, foilP, foilS, ruds, car, tiller };
}

/** Texture de grand-voile : membrane 3Di anthracite, lattes, bandes de ris, numéro. */
export function mainTex(num: string, col: string, name: string): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 2048; const x = c.getContext('2d')!;
  x.fillStyle = '#3a4045'; x.fillRect(0, 0, 512, 2048);
  x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 2;
  for (let i = -40; i < 80; i++) { x.beginPath(); x.moveTo(i * 30, 2048); x.lineTo(i * 30 + 900, 0); x.stroke(); } // fibres
  x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 7;
  for (let k = 1; k < 10; k++) { const y = 2048 - k * 200; x.beginPath(); x.moveTo(0, y); x.lineTo(512, y + 14); x.stroke(); } // lattes
  x.fillStyle = 'rgba(255,255,255,.35)'; for (let k = 1; k < 4; k++) for (let i = 0; i < 9; i++) x.fillRect(30 + i * 52, 2048 - k * 270, 6, 6); // garcettes de ris
  x.fillStyle = col; x.fillRect(0, 560, 512, 150);
  x.fillStyle = '#fff'; x.font = '800 96px "Barlow Condensed", sans-serif'; x.textAlign = 'center'; x.fillText(name.toUpperCase().slice(0, 10), 230, 670);
  x.font = '800 150px "Barlow Condensed", sans-serif'; x.fillText('FRA', 220, 1050); x.font = '800 230px "Barlow Condensed", sans-serif'; x.fillText(num, 220, 1290);
  const t = new T.CanvasTexture(c); t.anisotropy = 4; return t;
}
/** Texture de voile d'avant : coutures et laizes. */
export function headTex(base: string, col: string, gen: boolean): T.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const x = c.getContext('2d')!;
  x.fillStyle = base; x.fillRect(0, 0, 256, 1024);
  x.strokeStyle = 'rgba(0,0,0,.12)'; x.lineWidth = 3;
  for (let k = 1; k < 12; k++) { x.beginPath(); x.moveTo(0, k * 85); x.lineTo(256, k * 85 - 30); x.stroke(); }
  if (gen) { x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, 1024); x.quadraticCurveTo(140, 600, 256, 520); x.lineTo(256, 640); x.quadraticCurveTo(150, 720, 0, 1024); x.fill(); }
  else { x.fillStyle = col; x.fillRect(0, 980, 256, 44); }
  return new T.CanvasTexture(c);
}
