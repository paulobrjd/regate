// Rendu 3D (Three.js) : mer de Gerstner, ciel, îles, bouées, bateaux, voiles, barreur, sillage, embruns.
import * as T from 'three';
import { D, TAU, clamp, norm } from '../util/math';
import { WV, waveH } from '../physics/waves';
import { MARKS, PIN, CMTE } from '../game/course';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';

// Rendu « hérité » comme la r128 du prototype : couleurs non converties, sortie linéaire.
T.ColorManagement.enabled = false;

/** Échelle unités jeu → mètres monde. */
const S = 0.1;
const f = (v: number) => v.toFixed(5);

// coque profilée : demi-largeur, position longitudinale, hauteur de pont, creux selon t ∈ [0,1] (étrave → tableau)
const HW = (t: number) => Math.max(0.02, t < 0.62 ? 1.08 * Math.pow(Math.sin(t / 0.62 * Math.PI / 2), 0.75) : 1.08 - (t - 0.62) / 0.38 * 0.32);
const HZ = (t: number) => -2.45 + t * 4.45;
const HT = (t: number) => 0.66 + 0.16 * Math.pow(1 - t, 2.2);
const HD = (t: number) => (0.32 + 0.12 * Math.min(1, t / 0.3)) * Math.min(1, 0.25 + t * 4);
const NU = 9, NV = 12;

interface BoatRec {
  yaw: T.Group; roll: T.Group; boomG: T.Group;
  mg: T.BufferGeometry; jg: T.BufferGeometry; sg: T.BufferGeometry;
  fs: T.Mesh; spi: T.Mesh; vane: T.Mesh; rud: T.Group;
  sailor: T.Group; hip: T.Group; head: T.Mesh; cap: T.Mesh; legs: T.Mesh;
  lb: T.Sprite; rope: T.Line; name: string;
  heel: number; used: boolean; sideS?: number; prevS?: number;
}

interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; a: number }

export interface Look { yaw: number; pitch: number; idle: number }

export class Scene3D {
  private ren: T.WebGLRenderer;
  private scene = new T.Scene();
  private cam = new T.PerspectiveCamera(65, 1, 0.08, 7000);
  private wU: Record<string, T.IUniform>;
  private gN = 64;
  private gData: Uint8Array;
  private gTex: T.DataTexture;
  private marks3: T.Group[];
  private pin3: T.Group;
  private ring: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  private cb = new T.Group();
  private flagM: T.MeshBasicMaterial;
  private line: T.Line<T.BufferGeometry, T.LineDashedMaterial>;
  private boats3 = new Map<number, BoatRec>();
  private deckM = new T.MeshLambertMaterial({ color: '#dfe6ea', side: T.DoubleSide });
  private darkM = new T.MeshLambertMaterial({ color: '#2b4352' });
  private skin = new T.MeshLambertMaterial({ color: '#d9a37e' });
  private mastY = HT(0.416);
  private mastGeo = new T.CylinderGeometry(0.04, 0.065, 7.2, 10);
  private boomGeo: T.CylinderGeometry;
  private vaneGeo: T.ConeGeometry;
  private tg = new T.BufferGeometry();
  private tP = new Float32Array(4 * 3 * 2 * 3);
  private tC = new Float32Array(4 * 3 * 2 * 3);
  private tells: T.LineSegments;
  private dotTex: T.CanvasTexture;
  private wake: { g: T.BufferGeometry; pos: Float32Array; age: Float32Array; n: number };
  private spray: { g: T.BufferGeometry; pos: Float32Array; age: Float32Array; n: number };
  private drops: Drop[] = [];
  private gTimer = 0;
  private camYaw: number | null = null;
  private lastFov = 0;
  private headW = new T.Vector3();
  private eul = new T.Euler();
  // vecteurs de travail
  private hd = new T.Vector3(); private tk = new T.Vector3(); private cl = new T.Vector3();
  private L = new T.Vector3(); private C = new T.Vector3(); private P = new T.Vector3(); private tmp = new T.Vector3();
  private amp = 1;
  private rt = 0;

  /** Regard libre (cliquer-glisser). */
  look: Look = { yaw: 0, pitch: 0, idle: 9 };
  /** Son de bôme au virement / empannage. */
  onBoom: (gybe: boolean) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    const scene = this.scene;
    this.ren = new T.WebGLRenderer({ canvas, antialias: true });
    this.ren.outputColorSpace = T.LinearSRGBColorSpace;
    this.ren.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const FOG = new T.Color('#c6dbe8');
    const sunDir = new T.Vector3(-0.45, 0.42, -0.78).normalize();

    // ciel
    scene.add(new T.Mesh(new T.SphereGeometry(6000, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { top: { value: new T.Color('#2569ad') }, hor: { value: FOG }, sun: { value: sunDir } },
      vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 top,hor,sun;varying vec3 vP;void main(){float h=clamp(vP.y*1.8,0.,1.);vec3 c=mix(hor,top,pow(h,.5));float s=max(dot(vP,sun),0.);c+=vec3(1.,.88,.65)*(pow(s,900.)*3.+pow(s,10.)*.22);gl_FragColor=vec4(c,1.);}',
    })));
    // Depuis la r155, les intensités sont physiques : ×π pour retrouver l'éclairage de la r128.
    scene.add(new T.HemisphereLight('#e4f3ff', '#1d5a7a', 0.75 * Math.PI));
    const sl = new T.DirectionalLight('#fff1d6', 0.9 * Math.PI); sl.position.copy(sunDir).multiplyScalar(100); scene.add(sl);

    // nuages
    const cloudTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d')!;
      for (let i = 0; i < 22; i++) {
        const px = 40 + Math.random() * 176, py = 50 + Math.random() * 40, r = 18 + Math.random() * 34, g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      }
      return new T.CanvasTexture(c);
    })();
    for (let i = 0; i < 26; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.55 + Math.random() * 0.35, depthWrite: false }));
      const an = Math.random() * TAU, d = 1500 + Math.random() * 3200;
      sp.position.set(Math.cos(an) * d, 180 + Math.random() * 520, Math.sin(an) * d - 600);
      const w = 500 + Math.random() * 900; sp.scale.set(w, w * 0.32, 1); scene.add(sp);
    }

    // mer
    const gN = this.gN;
    this.gData = new Uint8Array(gN * gN);
    this.gTex = new T.DataTexture(this.gData, gN, gN, T.RedFormat);
    this.gTex.magFilter = T.LinearFilter; this.gTex.minFilter = T.LinearFilter; this.gTex.needsUpdate = true;
    const wGeo = new T.PlaneGeometry(2600, 2600, 240, 240); wGeo.rotateX(-Math.PI / 2);
    const waves = WV.map(([A, dx, dz, k, st]) => {
      const Q = st / (k * A), w = Math.sqrt(9.8 * k);
      return `{float ph=${f(k)}*dot(vec2(${f(dx)},${f(dz)}),p0)-t*${f(w)};float c=cos(ph),s=sin(ph);P.x+=amp*${f(Q * A * dx)}*c;P.z+=amp*${f(Q * A * dz)}*c;P.y+=amp*${f(A)}*s;N.x-=amp*${f(dx * k * A)}*c;N.z-=amp*${f(dz * k * A)}*c;N.y-=amp*${f(st)}*s;J-=amp*${f(st)}*s;}`;
    }).join('');
    this.wU = { amp: { value: 1 }, t: { value: 0 }, off: { value: new T.Vector2() }, sun: { value: sunDir }, gT: { value: this.gTex }, gC: { value: new T.Vector2() }, gS: { value: 640 }, fogC: { value: FOG } };
    const water = new T.Mesh(wGeo, new T.ShaderMaterial({
      uniforms: this.wU,
      vertexShader: 'uniform float t,amp;uniform vec2 off;varying vec3 vW;varying vec3 vN;varying float vJ;void main(){vec2 p0=position.xz+off;vec3 P=vec3(p0.x,0.,p0.y);vec3 N=vec3(0.,1.,0.);float J=1.;' + waves + 'vN=normalize(N);vJ=J;vW=P;gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}',
      fragmentShader: `uniform vec3 sun,fogC;uniform float t,gS;uniform sampler2D gT;uniform vec2 gC;varying vec3 vW,vN;varying float vJ;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),q=fract(p);q=q*q*(3.-2.*q);return mix(mix(hs(i),hs(i+vec2(1.,0.)),q.x),mix(hs(i+vec2(0.,1.)),hs(i+vec2(1.,1.)),q.x),q.y);}
void main(){float d=length(cameraPosition.xz-vW.xz);float fd=1.-smoothstep(25.,300.,d);
vec2 uv=(vW.xz-gC)/gS+.5;float g=texture2D(gT,uv).r;float r=(1.+g*2.)*fd;
vec3 n=normalize(vN+r*vec3(sin(vW.x*1.7+t*2.1)*.03+sin(vW.z*3.1-vW.x*.7-t*2.9)*.022+(vn(vW.xz*1.3+t*.6)-.5)*.07,0.,cos(vW.z*1.9+t*1.6)*.03+sin(vW.x*2.7+vW.z*1.3+t*3.3)*.018+(vn(vW.zx*1.1-t*.5)-.5)*.07));
vec3 V=normalize(cameraPosition-vW);float fr=.02+.98*pow(1.-max(dot(n,V),0.),5.);
vec3 R=reflect(-V,n);float sk=clamp(R.y,0.,1.);vec3 skyc=mix(vec3(.76,.86,.92),vec3(.3,.53,.78),pow(sk,.5));
vec3 deep=mix(vec3(.02,.17,.28),vec3(.01,.09,.17),g*.8);
float sss=clamp(vW.y*1.3,0.,1.)*(dot(V,-sun)*.5+.5);deep+=vec3(0.,.22,.2)*sss*.6;
vec3 c=mix(deep,skyc,fr*.9);vec3 H=normalize(sun+V);c+=vec3(1.,.93,.8)*pow(max(dot(n,H),0.),500.)*1.8;
float fn=vn(vW.xz*.9+t*.3)*.6+vn(vW.xz*3.1-t*.2)*.4;
float foam=smoothstep(.55,.3,vJ)*(.45+g)*smoothstep(.4,.75,fn);
foam+=g*smoothstep(.74,.9,vn(vW.xz*.22+vec2(t*.05,-t*.35)))*smoothstep(.45,.8,fn)*.9;
c=mix(c,vec3(.93,.96,.98),clamp(foam,0.,1.)*mix(.2,1.,fd));
c=mix(c,fogC,smoothstep(250.,1300.,d));gl_FragColor=vec4(c,1.);}`,
    }));
    water.frustumCulled = false; scene.add(water);

    // îles
    const isl = new T.MeshLambertMaterial({ color: '#6d8a5f' }), rock = new T.MeshLambertMaterial({ color: '#9a8f80' }), sand = new T.MeshLambertMaterial({ color: '#e8dcb8' });
    ([[900, -700, 170, 38], [-1050, -1300, 230, 55], [-700, 700, 140, 26], [1100, 500, 190, 44], [150, -1250, 260, 62], [-400, -1150, 120, 22]] as const).forEach(([x, z, r, h], i) => {
      const m = new T.Mesh(new T.ConeGeometry(r, h, 11, 3), i % 3 === 2 ? rock : isl); m.position.set(x, h / 2 - 4, z); m.scale.z = 0.55; m.rotation.y = i; scene.add(m);
      const b = new T.Mesh(new T.CylinderGeometry(r * 1.02, r * 1.06, 3, 11), sand); b.position.set(x, -0.6, z); b.scale.z = 0.55; b.rotation.y = i; scene.add(b);
      if (i === 1) {
        const ph = new T.Mesh(new T.CylinderGeometry(3, 4, 26, 10), new T.MeshLambertMaterial({ color: '#f2f2f2' })); ph.position.set(x + r * 0.6, h * 0.35 + 13, z); scene.add(ph);
        const tp = new T.Mesh(new T.CylinderGeometry(3.2, 3.2, 5, 10), new T.MeshLambertMaterial({ color: '#c8371e' })); tp.position.set(x + r * 0.6, h * 0.35 + 28, z); scene.add(tp);
      }
    });

    // bouées
    this.marks3 = MARKS.map((m, i) => { const g = this.mkBuoy('#ff6a1f', 'Bouée ' + (i + 1)); g.position.set(m.x * S, 0, m.y * S); return g; });
    this.pin3 = this.mkBuoy('#ffc93c'); this.pin3.position.set(PIN.x * S, 0, 0); this.pin3.scale.setScalar(0.8);
    this.ring = new T.Mesh(new T.RingGeometry(8.1, 8.6, 72), new T.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.4; scene.add(this.ring);

    // bateau comité
    const cb = this.cb, white = new T.MeshPhongMaterial({ color: '#eef3f6', shininess: 50 });
    const cbh = new T.Mesh(new T.BoxGeometry(2.8, 1.4, 9), white); cbh.position.y = 0.4; cb.add(cbh);
    const cab = new T.Mesh(new T.BoxGeometry(2, 1.4, 3), new T.MeshLambertMaterial({ color: '#8aa4b3' })); cab.position.set(0, 1.8, 0.5); cb.add(cab);
    const cm = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 5), white); cm.position.set(0, 4, -1.5); cb.add(cm);
    this.flagM = new T.MeshBasicMaterial({ color: '#3d7bd9', side: T.DoubleSide });
    const flag = new T.Mesh(new T.PlaneGeometry(1.4, 0.9), this.flagM); flag.position.set(0.7, 6, -1.5); cb.add(flag);
    cb.position.set(CMTE.x * S + 0.8, 0, 0); scene.add(cb);
    this.line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(PIN.x * S, 0.45, 0), new T.Vector3(CMTE.x * S, 0.45, 0)]), new T.LineDashedMaterial({ color: '#ffffff', dashSize: 1, gapSize: 0.8, transparent: true, opacity: 0.85 }));
    this.line.computeLineDistances(); scene.add(this.line);

    // gréement partagé
    this.boomGeo = new T.CylinderGeometry(0.04, 0.04, 2.7, 8); this.boomGeo.rotateX(Math.PI / 2); this.boomGeo.translate(0, 0, 1.35);
    this.vaneGeo = new T.ConeGeometry(0.1, 0.55, 6); this.vaneGeo.rotateX(-Math.PI / 2);

    // penons du foc (bateau du joueur)
    this.tg.setAttribute('position', new T.BufferAttribute(this.tP, 3));
    this.tg.setAttribute('color', new T.BufferAttribute(this.tC, 3));
    this.tells = new T.LineSegments(this.tg, new T.LineBasicMaterial({ vertexColors: true })); this.tells.frustumCulled = false;

    // sillage et embruns
    this.dotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
      return new T.CanvasTexture(c);
    })();
    this.wake = this.pts(1400, [1, 1.6, 60], 2.6, 0.55);
    this.spray = this.pts(500, [0.3, 0.4, 14], 1, 0.85);

    // regarder autour (cliquer-glisser)
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* */ } });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      this.look.yaw = clamp(this.look.yaw - (e.clientX - drag.x) * 0.006, -2.6, 2.6);
      this.look.pitch = clamp(this.look.pitch - (e.clientY - drag.y) * 0.004, -0.6, 0.5);
      drag = { x: e.clientX, y: e.clientY }; this.look.idle = 0;
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  }

  private wh(x: number, z: number): number { return waveH(x, z, this.rt, this.amp); }

  private label(text: string, bg: string): T.Sprite {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d')!;
    x.font = '700 34px Barlow, sans-serif'; const w = Math.min(250, x.measureText(text).width + 28);
    x.fillStyle = bg; x.beginPath(); if (x.roundRect) x.roundRect(128 - w / 2, 8, w, 48, 24); else x.rect(128 - w / 2, 8, w, 48); x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 128, 33);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true }));
    sp.scale.set(0.16, 0.04, 1); sp.renderOrder = 10; return sp;
  }

  private mkBuoy(col: string, txt?: string): T.Group {
    const g = new T.Group(), m = new T.MeshPhongMaterial({ color: col, shininess: 40 });
    const c = new T.Mesh(new T.CylinderGeometry(0.55, 0.8, 1.8, 20), m); c.position.y = 0.5; g.add(c);
    const tp = new T.Mesh(new T.SphereGeometry(0.56, 18, 9), m); tp.position.y = 1.4; g.add(tp);
    if (txt) { const sp = this.label(txt, 'rgba(255,106,31,.9)'); sp.position.y = 4; sp.scale.set(0.1, 0.025, 1); g.add(sp); }
    this.scene.add(g); return g;
  }

  private hullGeos(col: string): [T.BufferGeometry, T.BufferGeometry] {
    const N = 28, M = 14, pos: number[] = [], cl: number[] = [], idx: number[] = [], c1 = new T.Color('#f7fafc'), c2 = new T.Color(col), c3 = new T.Color('#1d2b33');
    for (let i = 0; i <= N; i++) {
      const t = i / N, w = HW(t);
      for (let j = 0; j <= M; j++) {
        const th = -Math.PI / 2 + Math.PI * j / M, y = HT(t) - HD(t) * Math.pow(Math.cos(th), 0.6);
        pos.push(w * Math.sin(th), y, HZ(t)); const c = y < 0.02 ? c3 : y < 0.14 ? c2 : c1; cl.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = i * (M + 1) + j, b = a + 1, c = a + M + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    const tc = pos.length / 3; pos.push(0, HT(1) - HD(1) * 0.5, HZ(1)); cl.push(c1.r, c1.g, c1.b);
    for (let j = 0; j < M; j++) idx.push(N * (M + 1) + j, tc, N * (M + 1) + j + 1);
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(cl, 3)); g.setIndex(idx); g.computeVertexNormals();
    const dp: number[] = [], di: number[] = [];
    for (let i = 0; i <= N; i++) { const t = i / N, w = HW(t) * 0.98, y = HT(t) - 0.005; dp.push(-w, y, HZ(t), w, y, HZ(t)); }
    for (let i = 0; i < N; i++) { const a = i * 2; di.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const dg = new T.BufferGeometry(); dg.setAttribute('position', new T.Float32BufferAttribute(dp, 3)); dg.setIndex(di); dg.computeVertexNormals();
    return [g, dg];
  }

  private grid(): T.BufferGeometry {
    const g = new T.BufferGeometry(), p = new Float32Array((NU + 1) * (NV + 1) * 3), uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) uv.push(i / NU, j / NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  }

  private sailTex(num: string, col: string): T.CanvasTexture {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d')!;
    x.fillStyle = '#f3f2ec'; x.fillRect(0, 0, 256, 512);
    x.strokeStyle = 'rgba(120,130,135,.35)'; x.lineWidth = 3;
    for (const v of [0.22, 0.42, 0.62, 0.8]) { x.beginPath(); x.moveTo(0, 512 * (1 - v)); x.lineTo(256, 512 * (1 - v) + 10); x.stroke(); }
    x.fillStyle = 'rgba(120,130,135,.18)'; for (let k = 0; k < 6; k++) x.fillRect(0, 512 - k * 86 - 2, 256, 1);
    x.fillStyle = '#1d2b33'; x.font = '800 64px "Barlow Condensed", sans-serif'; x.textAlign = 'center'; x.fillText('FRA', 100, 200);
    x.font = '800 92px "Barlow Condensed", sans-serif'; x.fillText(num, 100, 290);
    x.fillStyle = col; x.beginPath(); x.arc(100, 90, 26, 0, TAU); x.fill();
    return new T.CanvasTexture(c);
  }

  private mkBoat(col: string, name: string, num: string): BoatRec {
    const darkM = this.darkM, mastY = this.mastY;
    const yaw = new T.Group(), roll = new T.Group(); yaw.add(roll);
    const [hg, dg] = this.hullGeos(col);
    roll.add(new T.Mesh(hg, new T.MeshPhongMaterial({ vertexColors: true, shininess: 70 }))); roll.add(new T.Mesh(dg, this.deckM));
    const ck = new T.Mesh(new T.BoxGeometry(0.95, 0.1, 1.4), darkM); ck.position.set(0, HT(0.85) - 0.03, 1.1); roll.add(ck);
    const cbd = new T.Mesh(new T.BoxGeometry(0.05, 1.1, 0.5), darkM); cbd.position.set(0, -0.7, -0.3); roll.add(cbd);
    const rud = new T.Group(); rud.position.set(0, 0.2, HZ(1) + 0.05); roll.add(rud);
    const blade = new T.Mesh(new T.BoxGeometry(0.04, 1, 0.32), darkM); blade.position.set(0, -0.45, 0.12); rud.add(blade);
    const til = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 1.2, 6), new T.MeshLambertMaterial({ color: '#b5895a' })); til.rotation.x = Math.PI / 2 - 0.12; til.position.set(0, 0.62, -0.55); rud.add(til);
    const mast = new T.Mesh(this.mastGeo, darkM); mast.position.set(0, mastY + 3.6, -0.6); roll.add(mast);
    const boomG = new T.Group(); boomG.position.set(0, mastY + 0.85, -0.6); roll.add(boomG); boomG.add(new T.Mesh(this.boomGeo, darkM));
    const mg = this.grid(), main = new T.Mesh(mg, new T.MeshLambertMaterial({ map: this.sailTex(num, col), side: T.DoubleSide, transparent: true, opacity: 0.9 })); main.position.y = 0.04; boomG.add(main);
    const jg = this.grid(), jib = new T.Mesh(jg, new T.MeshLambertMaterial({ color: '#f3f2ec', side: T.DoubleSide, transparent: true, opacity: 0.88 })); roll.add(jib);
    const fs = new T.Mesh(new T.CylinderGeometry(0.008, 0.008, 1, 4), darkM); roll.add(fs);
    const sg = this.grid(), spi = new T.Mesh(sg, new T.MeshLambertMaterial({ color: col, side: T.DoubleSide })); roll.add(spi);
    const vane = new T.Mesh(this.vaneGeo, new T.MeshBasicMaterial({ color: '#ff6a1f' })); vane.position.set(0, mastY + 7.25, -0.6); roll.add(vane);
    // barreur
    const sailor = new T.Group(); roll.add(sailor); const hip = new T.Group(); sailor.add(hip);
    const torso = new T.Mesh(new T.CylinderGeometry(0.17, 0.19, 0.62, 10), new T.MeshLambertMaterial({ color: col })); torso.position.y = 0.34; hip.add(torso);
    const head = new T.Mesh(new T.SphereGeometry(0.12, 12, 8), this.skin); head.position.y = 0.78; hip.add(head);
    const cap = new T.Mesh(new T.SphereGeometry(0.125, 12, 6, 0, TAU, 0, Math.PI / 2), new T.MeshLambertMaterial({ color: '#1d2b33' })); cap.position.y = 0.8; hip.add(cap);
    const legs = new T.Mesh(new T.BoxGeometry(0.6, 0.14, 0.32), darkM); sailor.add(legs);
    const rope = new T.Line(new T.BufferGeometry().setAttribute('position', new T.BufferAttribute(new Float32Array(9), 3)), new T.LineBasicMaterial({ color: '#e9e4d0' })); rope.frustumCulled = false; roll.add(rope);
    const lb = this.label(name, 'rgba(4,30,50,.6)'); lb.position.y = 9.6; yaw.add(lb);
    this.scene.add(yaw);
    return { yaw, roll, boomG, mg, jg, fs, sg, spi, vane, rud, sailor, hip, head, cap, legs, lb, rope, name, heel: 0, used: true };
  }

  private setMain(g: T.BufferGeometry, side: number, camber: number, fl: boolean, tm: number): void {
    const p = (g.attributes.position as T.BufferAttribute).array as Float32Array; let k = 0;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, ch = 2.6 * (1 - v * 0.96);
      for (let i = 0; i <= NU; i++) {
        const u = i / NU;
        p[k++] = side * camber * 4 * u * (1 - u) * (1 - v * 0.5) + (fl ? Math.sin(tm * 26 + u * 9 + v * 5) * 0.14 * u * (1 - v * 0.5) : 0);
        p[k++] = v * 6.3; p[k++] = u * ch;
      }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }

  private jibPt(side: number, sheet: number, camber: number, fl: boolean, tm: number, u: number, v: number, out: T.Vector3): T.Vector3 {
    const { tk, hd, cl, L, C } = this, mastY = this.mastY;
    tk.set(0, HT(0) + 0.1, -2.35); hd.set(0, mastY + 5.4, -0.6); cl.set(side * (0.22 + 0.85 * sheet), mastY + 0.35, 0.25 - 0.45 * sheet);
    L.lerpVectors(tk, hd, v); C.lerpVectors(cl, hd, v); out.lerpVectors(L, C, u);
    out.x += side * camber * 4 * u * (1 - u) * (1 - v * 0.6) + (fl ? Math.sin(tm * 30 + u * 7 + v * 5) * 0.11 * (1 - u * 0.6) * (1 - v) : 0);
    return out;
  }

  private setJib(r: BoatRec, side: number, sheet: number, camber: number, fl: boolean, tm: number): void {
    const g = r.jg, p = (g.attributes.position as T.BufferAttribute).array as Float32Array, P = this.P; let k = 0;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { this.jibPt(side, sheet, camber, fl, tm, i / NU, j / NV, P); p[k++] = P.x; p[k++] = P.y; p[k++] = P.z; }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
    const { tk, hd } = this;
    tk.set(0, HT(0) + 0.1, -2.35); hd.set(0, this.mastY + 5.4, -0.6);
    r.fs.position.lerpVectors(tk, hd, 0.5); r.fs.scale.y = tk.distanceTo(hd); r.fs.rotation.x = Math.atan2(hd.z - tk.z, hd.y - tk.y);
  }

  private setSpi(g: T.BufferGeometry, side: number, k: number, fl: boolean, tm: number): void {
    const p = (g.attributes.position as T.BufferAttribute).array as Float32Array; let q = 0;
    const { hd, tk, cl, L, C, P } = this;
    hd.set(0, this.mastY + 6.8, -0.6); tk.set(0, 0.95, -3.2); cl.set(side * 2.7, 1.35, -1.6);
    const dx = side * 0.55, dz = -0.84;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV; L.lerpVectors(tk, hd, v); C.lerpVectors(cl, hd, v);
      for (let i = 0; i <= NU; i++) {
        const u = i / NU; P.lerpVectors(L, C, u);
        const bl = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.05 + 0.05)) * (2.3 + (fl ? Math.sin(tm * 22 + u * 6 + v * 4) * 0.5 : 0));
        P.x += dx * bl; P.z += dz * bl;
        P.sub(hd).multiplyScalar(k).add(hd); p[q++] = P.x; p[q++] = P.y; p[q++] = P.z;
      }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }

  private setTells(rec: BoatRec, b: Boat, side: number, camber: number, fl: boolean, tm: number): void {
    if (this.tells.parent !== rec.roll) rec.roll.add(this.tells);
    const d = b.sheet - (b.opt0 ?? 0.4), P = this.P, tP = this.tP, tC = this.tC; let q = 0;
    for (const v of [0.32, 0.6]) for (const w of [-1, 1]) { // -1 au vent, +1 sous le vent
      this.jibPt(side, b.sheet, camber, fl, tm, 0.16, v, P); P.x += w * side * 0.03;
      const stall = w < 0 ? d > 0.08 || (b.cap > 0) : d < -0.08, amp = stall ? 0.09 : 0.015, ph = tm * (stall ? 17 : 9) + v * 7 + w;
      const col = w < 0 ? [0.86, 0.15, 0.2] : [0.15, 0.75, 0.35];
      let x = P.x, y = P.y, z = P.z;
      for (let s = 0; s < 3; s++) {
        const nx = x + w * side * (stall ? 0.02 : 0.005) + Math.sin(ph + s * 1.7) * amp, ny = y + (stall ? (w < 0 ? 0.03 : -0.05) : -0.004) + Math.cos(ph * 1.3 + s) * amp * 0.6, nz = z + (stall ? 0.03 : 0.085);
        tP[q] = x; tP[q + 1] = y; tP[q + 2] = z; tP[q + 3] = nx; tP[q + 4] = ny; tP[q + 5] = nz; tC.set(col, q); tC.set(col, q + 3); q += 6; x = nx; y = ny; z = nz;
      }
    }
    this.tg.attributes.position.needsUpdate = true; this.tg.attributes.color.needsUpdate = true;
  }

  private pts(n: number, sz: number[], life: number, alpha: number) {
    const g = new T.BufferGeometry(), pos = new Float32Array(n * 3), age = new Float32Array(n);
    g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('age', new T.BufferAttribute(age, 1));
    const m = new T.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { tex: { value: this.dotTex } },
      vertexShader: `attribute float age;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vA=age;gl_PointSize=min((${sz[0].toFixed(2)}+age*${sz[1].toFixed(2)})*300./-mv.z,${sz[2] || 60}.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D tex;varying float vA;void main(){float a=texture2D(tex,gl_PointCoord).a*(1.-vA/${life.toFixed(2)})*${alpha};gl_FragColor=vec4(.95,.97,1.,a);}`,
    });
    const o = new T.Points(g, m); o.frustumCulled = false; this.scene.add(o);
    return { g, pos, age, n };
  }

  private placeBoat(rec: BoatRec, b: Boat, g: Game, dt: number, isMe: boolean, pov: boolean): { y: number; side: number } {
    const X = b.x * S, Z = b.y * S, tm = this.rt, awa = b.awa ?? b.twa, side = awa >= 0 ? 1 : -1, aa = Math.abs(awa) / D;
    const fx = Math.sin(b.h), fz = -Math.cos(b.h);
    const y = this.wh(X, Z) * 0.85, pf = this.wh(X + fx * 2.2, Z + fz * 2.2), pb = this.wh(X - fx * 2.2, Z - fz * 2.2), pl = this.wh(X + fz * 1, Z - fx * 1) - this.wh(X - fz * 1, Z + fx * 1);
    const cap = b.cap > 0, target = cap ? 86 * D : clamp(b.heelN || 0, 0, 1.6) * 26 * D;
    rec.heel += (target - rec.heel) * Math.min(1, dt * (cap ? 1.4 : 2.2));
    rec.yaw.position.set(X, y - (cap ? 0.35 : 0), Z); rec.yaw.rotation.y = -b.h;
    rec.roll.rotation.set(Math.atan2(pf - pb, 4.4) * 0.9, 0, -side * rec.heel + Math.atan2(pl, 2) * 0.3, 'YXZ');
    if (rec.sideS == null) rec.sideS = side;
    const gy = aa > 100, rate = dt * (gy ? 6 : 1.7); rec.sideS += clamp(side - rec.sideS, -rate, rate);
    const ss = rec.sideS, sa = Math.abs(ss);
    if (isMe && rec.prevS != null && Math.sign(ss) !== Math.sign(rec.prevS) && ss !== 0) this.onBoom(gy);
    rec.prevS = ss;
    const ba = ss * (6 + b.sheet * 82) * D; rec.boomG.rotation.y = ba;
    {
      const p = (rec.rope.geometry.attributes.position as T.BufferAttribute).array as Float32Array;
      const ex = rec.boomG.position.x + Math.sin(ba) * 2.5, ez = rec.boomG.position.z + Math.cos(ba) * 2.5, ey = rec.boomG.position.y, cx = 0, cy = HT(0.8) + 0.08, cz = 1.5;
      p[0] = ex; p[1] = ey; p[2] = ez; p[3] = (ex + cx) / 2; p[4] = (ey + cy) / 2 - 0.12 * (1 + b.sheet); p[5] = (ez + cz) / 2; p[6] = cx; p[7] = cy; p[8] = cz;
      rec.rope.geometry.attributes.position.needsUpdate = true;
    }
    const fl = cap || aa < 20 || b.sheet - (b.opt0 ?? b.opt ?? 0.4) > 0.13, cmb = fl ? 0.06 : 0.16 + Math.min(1, b.eff || 1) * 0.3;
    this.setMain(rec.mg, ss, cmb, fl, tm + X); this.setJib(rec, ss, b.sheet, cmb * 0.8, fl, tm + Z);
    rec.spi.visible = b.spiT > 0.03; if (rec.spi.visible) this.setSpi(rec.sg, ss, b.spiT, aa < 75, tm + Z);
    rec.rud.rotation.y = (b.rud || 0) * 0.45;
    rec.sailor.visible = !cap; rec.sailor.position.set(-ss * 0.9, HT(0.75) - 0.02 + (1 - sa) * 0.1, 0.95); rec.legs.position.set(ss * 0.32, 0.08, 0);
    rec.hip.rotation.set((1 - sa) * 0.5, 0, ss * (0.15 + (b.hike || 0) * 0.85 * sa));
    rec.head.visible = rec.cap.visible = !(isMe && pov);
    rec.vane.rotation.y = -(g.wd + Math.PI - b.h);
    rec.lb.visible = !isMe; rec.used = true;
    if (isMe) this.setTells(rec, b, ss, cmb * 0.8, fl, tm + Z);
    // embruns
    const drops = this.drops;
    if (!cap && b.v > 3.6 && drops.length < 480) {
      let n = (b.v - 3.6) * dt * 28 * (1 + Math.max(0, (pb - pf)) * 6);
      while (n > 0 && (n >= 1 || Math.random() < n)) {
        n--; const sd = Math.random() < 0.5 ? -1 : 1;
        drops.push({ x: X + fx * 2.1 + fz * sd * 0.4, y: y + 0.25, z: Z + fz * 2.1 - fx * sd * 0.4, vx: fx * b.v * 0.25 + fz * sd * (1 + Math.random() * 1.8), vy: 1.2 + Math.random() * 2.4, vz: fz * b.v * 0.25 - fx * sd * (1 + Math.random() * 1.8), a: 0 });
      }
    }
    return { y, side };
  }

  private recFor(key: number, col: string, name: string, num: string): BoatRec {
    let r = this.boats3.get(key);
    if (!r || r.name !== name) { if (r) this.scene.remove(r.yaw); r = this.mkBoat(col, name, num); this.boats3.set(key, r); }
    return r;
  }

  resize(w: number, h: number): void {
    this.ren.setSize(w, h, false);
    this.cam.aspect = w / Math.max(1, h); this.cam.updateProjectionMatrix();
  }

  /** rt : temps de simulation interpolé (s), pour que la houle affichée corresponde à la physique. */
  render(g: Game, boats: Boat[], me: Boat, dt: number, rt: number, view: 'pov' | 'chase'): void {
    this.rt = rt; this.amp = g.met.amp;
    const tm = rt, pov = view === 'pov' && !g.demo, cam = this.cam, look = this.look;
    for (const r of this.boats3.values()) r.used = false;
    let meI: { r: BoatRec; y: number; side: number } | null = null;
    boats.forEach((b, i) => {
      const r = this.recFor(b.id, b.col, b.name, String(7 + i * 13));
      const inf = this.placeBoat(r, b, g, dt, b === me, pov);
      if (b === me) meI = { r, ...inf };
    });
    for (const r of this.boats3.values()) r.yaw.visible = r.used;
    // sillage
    const wake = this.wake; let n = 0;
    for (const b of boats) for (const w of b.wake) {
      if (n >= wake.n) break;
      wake.pos[n * 3] = w.x * S; wake.pos[n * 3 + 1] = 0.12 + this.wh(w.x * S, w.y * S) * 0.85; wake.pos[n * 3 + 2] = w.y * S; wake.age[n] = w.t; n++;
    }
    wake.g.setDrawRange(0, n); wake.g.attributes.position.needsUpdate = true; wake.g.attributes.age.needsUpdate = true;
    const drops = this.drops, spray = this.spray;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.a += dt; d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.a > 1 || d.y < this.wh(d.x, d.z) - 0.2) drops.splice(i, 1);
    }
    drops.forEach((d, i) => { spray.pos[i * 3] = d.x; spray.pos[i * 3 + 1] = d.y; spray.pos[i * 3 + 2] = d.z; spray.age[i] = d.a; });
    spray.g.setDrawRange(0, drops.length); spray.g.attributes.position.needsUpdate = true; spray.g.attributes.age.needsUpdate = true;
    // caméra
    if (look.idle > 1.5) { look.yaw *= 1 - Math.min(1, dt * 1.5); look.pitch *= 1 - Math.min(1, dt * 1.5); }
    look.idle += dt;
    const X = me.x * S, Z = me.y * S;
    const mi = meI as { r: BoatRec; y: number; side: number } | null;
    if (pov && mi) {
      mi.r.yaw.updateMatrixWorld(true); mi.r.head.getWorldPosition(this.headW);
      const heel = mi.r.heel, headW = this.headW;
      cam.position.set(headW.x + Math.sin(me.h) * 0.12, headW.y + 0.05, headW.z - Math.cos(me.h) * 0.12);
      this.eul.set(-0.07 + mi.r.roll.rotation.x * 0.6 + look.pitch, -me.h + look.yaw, -mi.side * heel * 0.45, 'YXZ'); cam.quaternion.setFromEuler(this.eul);
      if (this.lastFov !== 74) { cam.fov = 74; this.lastFov = 74; cam.updateProjectionMatrix(); }
    } else {
      if (this.camYaw == null) this.camYaw = me.h;
      this.camYaw = norm(this.camYaw + norm(me.h - this.camYaw) * Math.min(1, dt * 2.2));
      const cy = this.camYaw + look.yaw, dist = 16 - look.pitch * 6, tx = X - Math.sin(cy) * dist, tz = Z + Math.cos(cy) * dist, ty = 6.2 + look.pitch * -8;
      if (Math.hypot(cam.position.x - tx, cam.position.z - tz) > 60) cam.position.set(tx, ty, tz);
      cam.position.lerp(this.tmp.set(tx, Math.max(2, ty), tz), Math.min(1, dt * 4));
      cam.lookAt(X + Math.sin(cy) * 6, 1.8, Z - Math.cos(cy) * 6);
      if (this.lastFov !== 60) { cam.fov = 60; this.lastFov = 60; cam.updateProjectionMatrix(); }
    }
    // mer + risées
    const wU = this.wU;
    wU.t.value = tm; wU.amp.value = this.amp;
    (wU.off.value as T.Vector2).set(Math.round(cam.position.x / 10) * 10, Math.round(cam.position.z / 10) * 10);
    this.gTimer -= dt;
    if (this.gTimer <= 0) {
      this.gTimer = 0.3;
      const gN = this.gN, gx = Math.round(cam.position.x / 20) * 20, gz = Math.round(cam.position.z / 20) * 20, gs = 640;
      (wU.gC.value as T.Vector2).set(gx, gz);
      for (let j = 0; j < gN; j++) for (let i = 0; i < gN; i++) {
        const wx = gx + ((i + 0.5) / gN - 0.5) * gs, wz = gz + ((j + 0.5) / gN - 0.5) * gs;
        this.gData[j * gN + i] = clamp((g.wind.speedAt(wx / S, wz / S, g.t) - g.met.base) / (7 * g.met.gust), 0, 1) * 255;
      }
      this.gTex.needsUpdate = true;
    }
    this.marks3.forEach((m3, i) => { const m = MARKS[i]; m3.position.y = this.wh(m.x * S, m.y * S) * 0.8 - 0.1; m3.rotation.z = Math.sin(tm * 1.3 + i) * 0.08; });
    this.pin3.position.y = this.wh(PIN.x * S, 0) * 0.8 - 0.1;
    this.cb.position.y = this.wh(this.cb.position.x, 0) * 0.5; this.cb.rotation.z = Math.sin(tm * 0.9) * 0.03;
    const nm = !g.demo && !me.ocs && me.leg >= 1 && me.leg <= 3 ? MARKS[me.leg - 1] : null;
    this.ring.visible = !!nm;
    if (nm) { this.ring.position.set(nm.x * S, 0.4, nm.y * S); this.ring.material.opacity = 0.35 + 0.25 * Math.sin(tm * 4); }
    this.line.material.opacity = me.leg === 0 || me.leg === 4 || me.ocs ? 0.95 : 0.3;
    this.flagM.color.set(g.t < 0 ? '#3d7bd9' : '#ff6a1f');
    this.ren.render(this.scene, cam);
  }
}
