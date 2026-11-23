// Rendu 3D (Three.js) à l'échelle réelle (1 unité = 1 m) : mer de Gerstner jusqu'à l'horizon, ciel, îles,
// bouées, IMOCA (carène, quille pendulaire, foils, safrans, voiles d'avant interchangeables, ris), skipper.
import * as T from 'three';
import { D, TAU, clamp, norm } from '../util/math';
import { WV, waveH } from '../physics/waves';
import { ISLANDS, shoreR } from '../physics/world';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';
import { headAngle, mainAngle } from '../physics/model';

T.ColorManagement.enabled = false;
const f = (v: number) => v.toFixed(5);

import { HZ, HW, deckY, MAST_Z, DECK, WINCHES, TRAV_T, buildImoca, mainTex, headTex, mats } from './imoca';

const NU = 12, NV = 22;

interface Rec {
  yaw: T.Group; roll: T.Group; boomG: T.Group; mast: T.Mesh; keelG: T.Group; foilP: T.Group; foilS: T.Group; ruds: T.Group[];
  mg: T.BufferGeometry; hg: T.BufferGeometry; hmesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  sailor: T.Group; armL: T.Mesh; armR: T.Mesh; head: T.Mesh;
  car: T.Mesh; tiller: T.Group; ropes: T.LineSegments; ropePos: Float32Array; ropeCol: Float32Array; clew: T.Vector3;
  /** Skipper : position sur le pont (x, t), activité et minuterie. */
  sk: { x: number; t: number; mode: 'helm' | 'grind' | 'pedestal'; timer: number; tack: number };
  lb: T.Sprite; name: string; heel: number; used: boolean; sideS?: number; prevS?: number; headId: string;
}
interface Drop { x: number; y: number; z: number; vx: number; vy: number; vz: number; a: number }
export interface Look { yaw: number; pitch: number; idle: number }

export class Scene3D {
  private ren: T.WebGLRenderer;
  private scene = new T.Scene();
  private cam = new T.PerspectiveCamera(60, 1, 0.1, 30000);
  private wU: Record<string, T.IUniform>;
  private gN = 64; private gS = 4000;
  private gData: Uint8Array; private gTex: T.DataTexture;
  private marks3: T.Object3D[] = [];
  private markGame: Game['course'] | null = null;
  private pin3: T.Group; private cb = new T.Group(); private flagM: T.MeshBasicMaterial;
  private ring: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  private line: T.Line<T.BufferGeometry, T.LineDashedMaterial>;
  private boats3 = new Map<number, Rec>();
  private tg = new T.BufferGeometry(); private tP = new Float32Array(4 * 3 * 2 * 3); private tC = new Float32Array(4 * 3 * 2 * 3);
  private tells: T.LineSegments;
  private dotTex: T.CanvasTexture;
  private wake: { g: T.BufferGeometry; pos: Float32Array; age: Float32Array; n: number };
  private spray: { g: T.BufferGeometry; pos: Float32Array; age: Float32Array; n: number };
  /** Écume posée sur l'eau autour du bateau : immobile dans le monde, elle défile et fait sentir la vitesse. */
  private flecks: { g: T.BufferGeometry; pos: Float32Array; age: Float32Array; n: number };
  private fleckXZ: Float32Array;
  private shake = 0;
  private arrow!: T.Mesh<T.ShapeGeometry, T.MeshBasicMaterial>;
  private drops: Drop[] = [];
  private gTimer = 0; private camYaw: number | null = null; private lastFov = 0;
  private eul = new T.Euler(); private tmp = new T.Vector3(); private hw = new T.Vector3();
  private A = new T.Vector3(); private B = new T.Vector3(); private C = new T.Vector3(); private P = new T.Vector3(); private Q = new T.Vector3(); private R = new T.Vector3();
  private amp = 1; private rt = 0;
  look: Look = { yaw: 0, pitch: 0, idle: 9 };
  private sun!: T.DirectionalLight; private sunDir!: T.Vector3;
  private shadows = !/Mobi|Android/i.test(navigator.userAgent);
  onBoom: (gybe: boolean) => void = () => {};

  constructor(canvas: HTMLCanvasElement) {
    const scene = this.scene;
    this.ren = new T.WebGLRenderer({ canvas, antialias: true });
    this.ren.outputColorSpace = T.LinearSRGBColorSpace;
    this.ren.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    const FOG = new T.Color('#c6dbe8');
    scene.fog = new T.Fog(FOG, 2500, 14000);
    const sunDir = new T.Vector3(-0.45, 0.42, -0.78).normalize();

    scene.add(new T.Mesh(new T.SphereGeometry(20000, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color('#2569ad') }, hor: { value: FOG }, sun: { value: sunDir } },
      vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_Position.z=gl_Position.w*.99999;}',
      fragmentShader: 'uniform vec3 top,hor,sun;varying vec3 vP;void main(){float h=clamp(vP.y*1.8,0.,1.);vec3 c=mix(hor,top,pow(h,.5));float s=max(dot(vP,sun),0.);c+=vec3(1.,.88,.65)*(pow(s,900.)*3.+pow(s,10.)*.22);gl_FragColor=vec4(c,1.);}',
    })));
    scene.add(new T.HemisphereLight('#e4f3ff', '#1d5a7a', 0.75 * Math.PI));
    scene.add(new T.AmbientLight('#ffffff', 0.25 * Math.PI));
    const sl = new T.DirectionalLight('#fff1d6', 0.9 * Math.PI); sl.position.copy(sunDir).multiplyScalar(100); scene.add(sl); scene.add(sl.target);
    this.sun = sl; this.sunDir = sunDir;
    if (this.shadows) {
      this.ren.shadowMap.enabled = true; this.ren.shadowMap.type = T.PCFSoftShadowMap;
      sl.castShadow = true; sl.shadow.mapSize.set(2048, 2048);
      const sc = sl.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 220;
      sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.04;
    }

    {
      const envScene = new T.Scene();
      envScene.add(new T.Mesh(new T.SphereGeometry(100, 32, 16), new T.ShaderMaterial({
        side: T.BackSide, uniforms: { top: { value: new T.Color('#2569ad') }, hor: { value: FOG }, sun: { value: sunDir } },
        vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: 'uniform vec3 top,hor,sun;varying vec3 vP;void main(){float h=clamp(vP.y*1.8,0.,1.);vec3 c=vP.y<0.?vec3(.03,.16,.25):mix(hor,top,pow(h,.5));float s=max(dot(vP,sun),0.);c+=vec3(1.,.9,.7)*(pow(s,300.)*6.+pow(s,8.)*.3);gl_FragColor=vec4(c,1.);}',
      })));
      const pm = new T.PMREMGenerator(this.ren);
      scene.environment = pm.fromScene(envScene, 0.02).texture; pm.dispose();
      scene.environmentIntensity = 0.3; // reflets discrets : la lumière du soleil garde les vraies couleurs
    }
    // nuages
    const cloudTex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d')!;
      for (let i = 0; i < 22; i++) {
        const px = 40 + Math.random() * 176, py = 50 + Math.random() * 40, r = 18 + Math.random() * 34, g = x.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, 'rgba(255,255,255,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      }
      return new T.CanvasTexture(c);
    })();
    for (let i = 0; i < 30; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.55 + Math.random() * 0.35, depthWrite: false }));
      const an = Math.random() * TAU, d = 5000 + Math.random() * 11000;
      sp.position.set(Math.cos(an) * d, 600 + Math.random() * 1600, Math.sin(an) * d - 10000);
      const w = 1500 + Math.random() * 2800; sp.scale.set(w, w * 0.32, 1); scene.add(sp);
    }

    // mer : grille radiale (dense près de la caméra, jusqu'à 12 km)
    const gN = this.gN;
    this.gData = new Uint8Array(gN * gN);
    this.gTex = new T.DataTexture(this.gData, gN, gN, T.RedFormat);
    this.gTex.magFilter = T.LinearFilter; this.gTex.minFilter = T.LinearFilter; this.gTex.needsUpdate = true;
    const waves = WV.map(([A, dx, dz, k, st]) => {
      const Q = st / (k * A), w = Math.sqrt(9.8 * k);
      return `{float ph=${f(k)}*dot(vec2(${f(dx)},${f(dz)}),p0)-t*${f(w)};float c=cos(ph),s=sin(ph);P.x+=a*${f(Q * A * dx)}*c;P.z+=a*${f(Q * A * dz)}*c;P.y+=a*${f(A)}*s;N.x-=a*${f(dx * k * A)}*c;N.z-=a*${f(dz * k * A)}*c;N.y-=a*${f(st)}*s;J-=a*${f(st)}*s;}`;
    }).join('');
    this.wU = { amp: { value: 1 }, t: { value: 0 }, off: { value: new T.Vector2() }, sun: { value: sunDir }, gT: { value: this.gTex }, gC: { value: new T.Vector2() }, gS: { value: this.gS }, fogC: { value: FOG } };
    const water = new T.Mesh(this.radialGrid(150, 256, 12000), new T.ShaderMaterial({
      uniforms: this.wU,
      vertexShader: 'uniform float t,amp;uniform vec2 off;varying vec3 vW;varying vec3 vN;varying float vJ;void main(){vec2 p0=position.xz+off;float a=amp*(1.-smoothstep(900.,2600.,length(position.xz)));vec3 P=vec3(p0.x,0.,p0.y);vec3 N=vec3(0.,1.,0.);float J=1.;' + waves + 'vN=normalize(N);vJ=J;vW=P;gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}',
      fragmentShader: `uniform vec3 sun,fogC;uniform float t,gS;uniform sampler2D gT;uniform vec2 gC;varying vec3 vW,vN;varying float vJ;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),q=fract(p);q=q*q*(3.-2.*q);return mix(mix(hs(i),hs(i+vec2(1.,0.)),q.x),mix(hs(i+vec2(0.,1.)),hs(i+vec2(1.,1.)),q.x),q.y);}
void main(){float d=length(cameraPosition.xz-vW.xz);float fd=1.-smoothstep(40.,500.,d);
vec2 uv=(vW.xz-gC)/gS+.5;float g=texture2D(gT,uv).r*(1.-smoothstep(1500.,2000.,d));float r=(1.+g*2.)*fd;
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
c=mix(c,fogC,smoothstep(1500.,11000.,d));gl_FragColor=vec4(c,1.);}`,
    }));
    water.frustumCulled = false; scene.add(water);

    // îles
    ISLANDS.forEach(isl => this.scene.add(this.mkIsland(isl)));

    // bouée de la ligne, bateau comité, ligne
    this.pin3 = this.mkBuoy('#ffc93c', 1.6); scene.add(this.pin3);
    this.ring = new T.Mesh(new T.RingGeometry(68, 72, 96), new T.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.5, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.6; scene.add(this.ring);
    const cb = this.cb, white = new T.MeshPhongMaterial({ color: '#eef3f6', shininess: 50 });
    const cbh = new T.Mesh(new T.BoxGeometry(5, 2.2, 16), white); cbh.position.y = 0.6; cb.add(cbh);
    const cab = new T.Mesh(new T.BoxGeometry(3.6, 2.4, 5), new T.MeshLambertMaterial({ color: '#8aa4b3' })); cab.position.set(0, 2.8, 1); cb.add(cab);
    const cm = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 8), white); cm.position.set(0, 6, -3); cb.add(cm);
    this.flagM = new T.MeshBasicMaterial({ color: '#3d7bd9', side: T.DoubleSide });
    const flag = new T.Mesh(new T.PlaneGeometry(2.2, 1.4), this.flagM); flag.position.set(1.1, 9.2, -3); cb.add(flag);
    scene.add(cb);
    this.line = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(-260, 0.6, 0), new T.Vector3(260, 0.6, 0)]), new T.LineDashedMaterial({ color: '#ffffff', dashSize: 6, gapSize: 5, transparent: true, opacity: 0.85 }));
    this.line.computeLineDistances(); scene.add(this.line);

    this.tg.setAttribute('position', new T.BufferAttribute(this.tP, 3));
    this.tg.setAttribute('color', new T.BufferAttribute(this.tC, 3));
    this.tells = new T.LineSegments(this.tg, new T.LineBasicMaterial({ vertexColors: true })); this.tells.frustumCulled = false;

    this.dotTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d')!, g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32);
      return new T.CanvasTexture(c);
    })();
    this.wake = this.pts(4000, [2.6, 3.6, 140], 6, 0.55);
    this.flecks = this.pts(700, [0.9, 0, 40], 4, 0.6);
    this.fleckXZ = new Float32Array(700 * 2).fill(1e9);
    this.spray = this.pts(900, [0.5, 0.8, 26], 1.2, 0.85);

    {
      const sh = new T.Shape(); sh.moveTo(0, -7); sh.lineTo(4.5, -1); sh.lineTo(1.6, -1); sh.lineTo(1.6, 6); sh.lineTo(-1.6, 6); sh.lineTo(-1.6, -1); sh.lineTo(-4.5, -1); sh.closePath();
      const ag = new T.ShapeGeometry(sh); ag.rotateX(Math.PI / 2); // pointe vers -z (l'avant)
      this.arrow = new T.Mesh(ag, new T.MeshBasicMaterial({ color: '#50ff96', transparent: true, opacity: 0.55, depthWrite: false, fog: false, side: T.DoubleSide }));
      this.arrow.renderOrder = 5; scene.add(this.arrow);
    }
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; try { canvas.setPointerCapture(e.pointerId); } catch { /* */ } });
    canvas.addEventListener('pointermove', e => {
      if (!drag) return;
      this.look.yaw = clamp(this.look.yaw - (e.clientX - drag.x) * 0.006, -3, 3);
      this.look.pitch = clamp(this.look.pitch - (e.clientY - drag.y) * 0.004, -0.6, 0.7);
      drag = { x: e.clientX, y: e.clientY }; this.look.idle = 0;
    });
    const endDrag = () => { drag = null; };
    canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  }

  private radialGrid(rings: number, segs: number, R: number): T.BufferGeometry {
    const pos: number[] = [], idx: number[] = [];
    pos.push(0, 0, 0);
    for (let i = 1; i <= rings; i++) {
      const r = R * Math.pow(i / rings, 2.3);
      for (let j = 0; j < segs; j++) { const a = j / segs * TAU; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + (j + 1) % segs, 1 + j);
    for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
      const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + (j + 1) % segs, c = a + segs, d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    return g;
  }

  private mkIsland(isl: (typeof ISLANDS)[number]): T.Group {
    const grp = new T.Group(), RN = 14, SN = 72, pos: number[] = [], col: number[] = [], idx: number[] = [];
    const sand = new T.Color('#e3d6ae'), green = new T.Color('#5f8456'), dark = new T.Color('#46653f'), rock = new T.Color('#8f877a');
    for (let i = 0; i <= RN; i++) {
      const rho = 1.08 - i / RN * 1.08; // de la plage (1.08) au sommet (0)
      for (let j = 0; j < SN; j++) {
        const th = j / SN * TAU, R = shoreR(isl, th) * rho;
        const bump = Math.sin(th * 4 + isl.seed * 3) * 0.08 + Math.sin(th * 7 + isl.seed) * 0.05;
        const y = rho > 1 ? -2.5 : isl.h * Math.pow(1 - rho * rho, 0.9) * (1 + bump) + 0.8;
        pos.push(isl.x + Math.cos(th) * R, y, isl.y + Math.sin(th) * R);
        const c = y < 4 ? sand : y > isl.h * 0.8 ? rock : (j + i) % 3 ? green : dark;
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < RN; i++) for (let j = 0; j < SN; j++) {
      const a = i * SN + j, b = i * SN + (j + 1) % SN, c = a + SN, d = b + SN;
      idx.push(a, c, b, b, c, d);
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    grp.add(new T.Mesh(g, new T.MeshLambertMaterial({ vertexColors: true })));
    if (isl.lighthouse) {
      const th = 0.6, R = shoreR(isl, th) * 0.75, x = isl.x + Math.cos(th) * R, z = isl.y + Math.sin(th) * R, y0 = isl.h * Math.pow(1 - 0.5625, 0.9);
      const ph = new T.Mesh(new T.CylinderGeometry(3, 4.2, 30, 12), new T.MeshLambertMaterial({ color: '#f2f2f2' })); ph.position.set(x, y0 + 15, z); grp.add(ph);
      const tp = new T.Mesh(new T.CylinderGeometry(3.3, 3.3, 6, 12), new T.MeshLambertMaterial({ color: '#c8371e' })); tp.position.set(x, y0 + 33, z); grp.add(tp);
    }
    return grp;
  }

  private label(text: string, bg: string): T.Sprite {
    const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d')!;
    x.font = '700 34px Barlow, sans-serif'; const w = Math.min(500, x.measureText(text).width + 28);
    x.fillStyle = bg; x.beginPath(); if (x.roundRect) x.roundRect(256 - w / 2, 8, w, 48, 24); else x.rect(256 - w / 2, 8, w, 48); x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 256, 33);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), sizeAttenuation: false, depthTest: false, transparent: true, fog: false }));
    sp.scale.set(0.32, 0.04, 1); sp.renderOrder = 10; return sp;
  }

  private mkBuoy(col: string, s = 1, txt?: string): T.Group {
    const g = new T.Group(), m = new T.MeshPhongMaterial({ color: col, shininess: 40 });
    const c = new T.Mesh(new T.CylinderGeometry(1.1 * s, 1.3 * s, 3 * s, 20), m); c.position.y = 1 * s; g.add(c);
    const tp = new T.Mesh(new T.SphereGeometry(1.1 * s, 18, 9), m); tp.position.y = 2.5 * s; g.add(tp);
    if (txt) { const sp = this.label(txt, 'rgba(255,106,31,.9)'); sp.position.y = 8; sp.scale.set(0.2, 0.025, 1); g.add(sp); }
    return g;
  }

  private setCourse(c: Game['course']): void {
    if (this.markGame === c) return;
    for (const m of this.marks3) this.scene.remove(m);
    this.marks3 = c.marks.map(m => {
      const side = m.side === 'port' ? 'à bâbord' : 'à tribord';
      let o: T.Object3D;
      if (m.island != null) {
        o = new T.Group(); const sp = this.label(m.name + ' · ' + side, 'rgba(255,106,31,.9)'); sp.position.y = ISLANDS[m.island].h + 40; o.add(sp);
        o.position.set(m.x, 0, m.y);
      } else { o = this.mkBuoy('#ff6a1f', 1.4, m.name + ' · ' + side); o.position.set(m.x, 0, m.y); }
      this.scene.add(o); return o;
    });
    this.pin3.position.set(c.pin.x, 0, c.pin.y); this.cb.position.set(c.cmte.x + 4, 0, c.cmte.y);
    this.markGame = c;
  }

  // ---------- IMOCA ----------
  private grid(): T.BufferGeometry {
    const g = new T.BufferGeometry(), p = new Float32Array((NU + 1) * (NV + 1) * 3), uv: number[] = [], idx: number[] = [];
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) uv.push(i / NU, j / NV);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    return g;
  }
  private headTexs = new Map<string, T.CanvasTexture>();
  private headMap(id: string, col: string): T.CanvasTexture {
    const k = id + col; let t = this.headTexs.get(k);
    if (!t) { t = headTex(id === 'A3' ? col : id === 'C0' ? '#d4d9dc' : '#7d868c', col, id === 'A3'); this.headTexs.set(k, t); }
    return t;
  }

  private mkBoat(b: Boat, num: string): Rec {
    const M = mats();
    const yaw = new T.Group(), roll = new T.Group(); yaw.add(roll);
    const parts = buildImoca(roll, b.col, b.name, num);
    const mg = this.grid(), main = new T.Mesh(mg, new T.MeshStandardMaterial({ map: mainTex(num, b.col, b.name), side: T.DoubleSide, roughness: 0.55, metalness: 0.05 }));
    main.castShadow = true; parts.boomG.add(main);
    const hg = this.grid(), hmesh = new T.Mesh(hg, new T.MeshStandardMaterial({ map: this.headMap('J1', b.col), side: T.DoubleSide, roughness: 0.6, transparent: true, opacity: 0.97 }));
    hmesh.castShadow = true; roll.add(hmesh);
    // skipper en ciré, casque
    const sailor = new T.Group(); roll.add(sailor);
    const jacket = new T.MeshStandardMaterial({ color: b.col, roughness: 0.6 }), pants = new T.MeshStandardMaterial({ color: '#23292e', roughness: 0.8 });
    const torso = new T.Mesh(new T.CapsuleGeometry(0.2, 0.42, 4, 10), jacket); torso.position.y = 1.02; sailor.add(torso);
    const head = new T.Mesh(new T.SphereGeometry(0.13, 14, 10), M.skin); head.position.y = 1.5; sailor.add(head);
    const helmet = new T.Mesh(new T.SphereGeometry(0.145, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), new T.MeshStandardMaterial({ color: '#f4f4f2', roughness: 0.3 })); helmet.position.y = 1.53; head.add(helmet); helmet.position.set(0, 0.03, 0);
    for (const sx of [-1, 1]) { const leg = new T.Mesh(new T.CapsuleGeometry(0.09, 0.55, 4, 8), pants); leg.position.set(sx * 0.11, 0.4, 0); sailor.add(leg); }
    const armG = new T.CapsuleGeometry(0.065, 0.45, 4, 8); armG.rotateX(Math.PI / 2); armG.translate(0, 0, -0.26);
    const armL = new T.Mesh(armG, jacket), armR = armL.clone();
    armL.position.set(-0.26, 1.22, 0); armR.position.set(0.26, 1.22, 0); sailor.add(armL, armR);
    sailor.traverse(o => { (o as T.Mesh).castShadow = true; });
    const lb = this.label(b.name, 'rgba(4,30,50,.6)'); lb.position.y = 33; yaw.add(lb);
    this.scene.add(yaw);
    // cordages : écoutes, grand-écoute, tours sur les winchs (mis à jour à chaque image)
    const RN = 400, ropePos = new Float32Array(RN * 6), ropeCol = new Float32Array(RN * 6);
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(ropePos, 3)); rg.setAttribute('color', new T.BufferAttribute(ropeCol, 3));
    const ropes = new T.LineSegments(rg, new T.LineBasicMaterial({ vertexColors: true })); ropes.frustumCulled = false; roll.add(ropes);
    return { yaw, roll, boomG: parts.boomG, mast: parts.mast, keelG: parts.keelG, foilP: parts.foilP, foilS: parts.foilS, ruds: parts.ruds, mg, hg, hmesh, sailor, armL, armR, head, lb, name: b.name, heel: 0, used: true, headId: '',
      car: parts.car, tiller: parts.tiller, ropes, ropePos, ropeCol, clew: new T.Vector3(), sk: { x: -1.6, t: 0.955, mode: 'helm', timer: 0, tack: 0 } };
  }

  /** Grand-voile : guindant le long du mât, bordure sur la bôme, rond de chute et tête carrée. */
  private setMain(g: T.BufferGeometry, side: number, h: number, camber: number, fl: boolean, tm: number): void {
    const p = (g.attributes.position as T.BufferAttribute).array as Float32Array; let k = 0;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, ch = 7.0 * (1 - v) + 2.9 * v + 1.1 * Math.sin(Math.PI * Math.pow(v, 0.8)) * (1 - v * 0.3);
      const twist = 0.22 * v * v;
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, bulge = 4 * u * (1 - u) * (1 - 0.35 * u);
        let x = side * camber * ch * 0.13 * bulge * (1 - v * 0.25) + side * u * ch * twist;
        if (fl) x += Math.sin(tm * 20 + u * 9 + v * 5) * 0.28 * u;
        p[k++] = x; p[k++] = v * h + 0.05; p[k++] = u * ch - 0.1 * Math.sin(Math.PI * v) ;
      }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }

  /** Voile d'avant : point d'amure, tête, point d'écoute selon l'angle d'écoute delta (°). */
  private setHead(r: Rec, b: Boat, side: number, delta: number, pow: number, fl: boolean, tm: number): void {
    const s = b.cls.heads[b.head], id = s.id;
    const geo = { J1: [0.1, 24.8, 7.4, 0.5, 0.11], J2: [0.3, 22.5, 6.4, 0.9, 0.1], J3: [2.6, 17.3, 4.6, 1.4, 0.09], C0: [-2.3, 28.3, 10, 0.9, 0.09], A3: [-2.3, 28.3, 12.5, 1.4, 0.3] }[id] ?? [0, 25, 7, 1.3, 0.1];
    const [tz, hh, foot, clewH, belly] = geo;
    const { A, B, C, P, Q, R } = this;
    A.set(0, deckY(0, 0) + 0.25, HZ(0) + tz); B.set(0, DECK + hh, MAST_Z - 0.5);
    // le point d'écoute s'éloigne vers sous le vent avec l'angle d'écoute ; affalée (pow→0) : roulée sur l'étai
    const dRad = delta * D, len = foot * (0.15 + 0.85 * pow);
    C.set(side * Math.sin(dRad) * len, A.y + clewH, A.z + Math.cos(dRad) * len);
    const p = (r.hg.attributes.position as T.BufferAttribute).array as Float32Array; let k = 0;
    const isGen = id === 'A3';
    for (let j = 0; j <= NV; j++) {
      const v = j / NV; P.lerpVectors(A, B, v); Q.lerpVectors(C, B, v);
      for (let i = 0; i <= NU; i++) {
        const u = i / NU; R.lerpVectors(P, Q, u);
        const bl = Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 1.02 + 0.03)) * belly * len * (isGen ? 1 : 1 - v * 0.5);
        const fx = fl ? Math.sin(tm * 24 + u * 7 + v * 5) * 0.2 * (1 - u * 0.5) * (1 - v) : 0;
        R.x += side * (bl + fx * (isGen ? 2 : 1)); if (isGen) R.z -= bl * 0.6;
        p[k++] = R.x; p[k++] = R.y; p[k++] = R.z;
      }
    }
    r.hg.attributes.position.needsUpdate = true; r.hg.computeVertexNormals(); r.hg.computeBoundingSphere();
    r.clew.copy(C);
    if (r.headId !== id) { r.hmesh.material.map = this.headMap(id, b.col); r.hmesh.material.needsUpdate = true; r.headId = id; }
  }

  private setTells(r: Rec, b: Boat, side: number, tm: number): void {
    if (this.tells.parent !== r.roll) r.roll.add(this.tells);
    const d = b.headSheet - b.ideal.headSheet, p = (r.hg.attributes.position as T.BufferAttribute).array as Float32Array, tP = this.tP, tC = this.tC; let q = 0;
    for (const v of [0.3, 0.55]) for (const w of [-1, 1]) {
      const j = Math.round(v * NV), i = 1, o = (j * (NU + 1) + i) * 3;
      let x = p[o] + w * side * 0.04, y = p[o + 1], z = p[o + 2];
      const stall = w < 0 ? d > 0.06 || b.knock > 0 : d < -0.06, amp = stall ? 0.14 : 0.02, ph = tm * (stall ? 17 : 9) + v * 7 + w;
      const col = w < 0 ? [0.86, 0.15, 0.2] : [0.15, 0.75, 0.35];
      for (let s = 0; s < 3; s++) {
        const nx = x + w * side * (stall ? 0.03 : 0.008) + Math.sin(ph + s * 1.7) * amp, ny = y + (stall ? (w < 0 ? 0.05 : -0.08) : -0.006) + Math.cos(ph * 1.3 + s) * amp * 0.6, nz = z + (stall ? 0.05 : 0.13);
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
      vertexShader: `attribute float age;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vA=age;gl_PointSize=min((${sz[0].toFixed(2)}+age*${sz[1].toFixed(2)})*300./-mv.z,${sz[2]}.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D tex;varying float vA;void main(){float a=texture2D(tex,gl_PointCoord).a*(1.-vA/${life.toFixed(2)})*${alpha};gl_FragColor=vec4(.95,.97,1.,a);}`,
    });
    const o = new T.Points(g, m); o.frustumCulled = false; this.scene.add(o);
    return { g, pos, age, n };
  }

  private wh(x: number, z: number): number { return waveH(x, z, this.rt, this.amp); }

  private placeBoat(r: Rec, b: Boat, dt: number, isMe: boolean, pov: boolean): void {
    const X = b.x, Z = b.y, tm = this.rt, tack = b.twa >= 0 ? 1 : -1, aa = Math.abs(b.awa) / D;
    const fx = Math.sin(b.h), fz = -Math.cos(b.h);
    const y = this.wh(X, Z) * 0.8, pf = this.wh(X + fx * 8, Z + fz * 8), pb = this.wh(X - fx * 8, Z - fz * 8), pl = this.wh(X + fz * 2.5, Z - fx * 2.5) - this.wh(X - fz * 2.5, Z + fx * 2.5);
    const lift = Math.min(0.9, b.foilLift / 9.81 / 8000 * 1.6); // le foil soulage la coque
    r.heel += (b.heel - r.heel) * Math.min(1, dt * 4);
    r.yaw.position.set(X, y + lift - (b.knock > 0 ? 0.4 : 0), Z); r.yaw.rotation.y = -b.h;
    r.roll.rotation.set(Math.atan2(pf - pb, 16) * 0.9 - lift * 0.02, 0, -tack * r.heel + Math.atan2(pl, 5) * 0.3, 'YXZ');
    if (r.sideS == null) r.sideS = -tack;
    // côté de la bôme : sous le vent (le vent vient de bâbord quand tack > 0 → bôme à tribord, +x)
    const gy = aa > 100, rate = dt * (gy ? 5 : 1.4); r.sideS += clamp(tack - r.sideS, -rate, rate);
    const ss = r.sideS, sa = Math.abs(ss);
    if (isMe && r.prevS != null && Math.sign(ss) !== Math.sign(r.prevS) && ss !== 0) this.onBoom(gy);
    r.prevS = ss;
    const md = mainAngle(b.mainSheet, b.trav), mf = b.knock > 0 || aa < md + 2;
    r.boomG.rotation.y = ss * clamp(md, -6, 85) * D * sa;
    r.mast.rotation.y = r.boomG.rotation.y * 0.45; // mât-aile pivotant
    const reefH = [27, 23.5, 20, 16.5][b.reefs];
    const camber = mf ? 0.05 : 0.6 + 0.5 * clamp(1 - Math.abs(b.mainSheet - b.ideal.mainSheet) * 3, 0, 1);
    this.setMain(r.mg, ss, reefH * (0.6 + 0.4 * b.mainPow), camber, mf, tm + X);
    const head = b.cls.heads[b.head], hd = headAngle(head, b.headSheet), hf = b.knock > 0 || aa < head.awaMin || aa < hd + 2;
    this.setHead(r, b, ss, hd, b.headPow, hf || b.headPow < 0.9, tm + Z);
    r.hmesh.visible = b.headPow > 0.02;
    r.keelG.rotation.z = b.keel * b.cls.keelMax * D;
    r.foilP.position.x = -1.2 + (1 - b.foilP) * 2.4;
    r.foilS.position.x = 1.2 - (1 - b.foilS) * 2.4;
    for (const rd of r.ruds) rd.rotation.y = b.rud * 0.8;
    // chariot de grand-écoute et barres franches
    r.car.position.x = clamp(b.trav, -1, 1) * ss * HW(TRAV_T) * 0.6;
    r.tiller.rotation.y = b.rud * 0.8;
    this.animSkipper(r, b, dt, tack);
    r.sailor.visible = b.knock <= 0 && !(isMe && pov);
    this.updateRopes(r, b, ss, tm);
    r.head.visible = !(isMe && pov);
    r.lb.visible = !isMe; r.used = true;
    if (isMe && r.hmesh.visible) this.setTells(r, b, ss, tm);
    // embruns
    const drops = this.drops;
    if (b.knock <= 0 && b.v > 4.5 && drops.length < 850) {
      let n = (b.v - 4.5) * dt * 70 * (1 + Math.max(0, (pb - pf)) * 4) * (isMe ? 1.5 : 1);
      while (n > 0 && (n >= 1 || Math.random() < n)) {
        n--; const sd = Math.random() < 0.5 ? -1 : 1, bx = X + fx * 8.5, bz = Z + fz * 8.5;
        drops.push({ x: bx + fz * sd * 1.2, y: y + 0.4, z: bz - fx * sd * 1.2, vx: fx * b.v * 0.3 + fz * sd * (2 + Math.random() * 4), vy: 2 + Math.random() * (2 + b.v * 0.35), vz: fz * b.v * 0.3 - fx * sd * (2 + Math.random() * 4), a: 0 });
      }
    }
  }

  /** Skipper : à la barre côté au vent ; au virement il traverse et mouline sur le winch sous le vent ; pendant une manœuvre, à la colonne. */
  private animSkipper(r: Rec, b: Boat, dt: number, tack: number): void {
    const k = r.sk;
    if (!k.tack) k.tack = tack;
    if (tack !== k.tack) { k.tack = tack; k.mode = 'grind'; k.timer = 3.5; }
    if (b.task) k.mode = 'pedestal';
    else if (k.mode === 'pedestal') k.mode = 'helm';
    if (k.mode === 'grind') { k.timer -= dt; if (k.timer <= 0) k.mode = 'helm'; }
    const tx = k.mode === 'helm' ? -tack * 1.55 : k.mode === 'grind' ? tack * 1.4 : 0;
    const tt = k.mode === 'helm' ? 0.952 : k.mode === 'grind' ? 0.84 : 0.83;
    const sp = 2.4 * dt, dx = tx - k.x, dz = (tt - k.t) * 18.28, d = Math.hypot(dx, dz);
    const walking = d > 0.06;
    if (walking) { const f = Math.min(1, sp / d); k.x += dx * f; k.t += (tt - k.t) * f; }
    const ph = this.rt * 9;
    r.sailor.position.set(k.x, deckY(k.t, k.x / HW(k.t)) + (walking ? Math.abs(Math.sin(ph)) * 0.05 : 0), HZ(k.t));
    // il reste vertical malgré la gîte ; il regarde vers l'avant, ou vers son winch
    r.sailor.rotation.set(0, walking ? Math.atan2(-dx, -dz) : k.mode === 'grind' ? -tack * Math.PI / 2 : k.mode === 'helm' ? tack * 0.35 : 0, tack * r.heel * 0.75, 'YXZ');
    if (walking) { r.armL.rotation.x = 0.3 + Math.sin(ph) * 0.5; r.armR.rotation.x = 0.3 - Math.sin(ph) * 0.5; }
    else if (k.mode === 'helm') {
      // une main sur la barre (côté bordé), l'autre sur l'écoute
      const tillerArm = tack > 0 ? r.armL : r.armR, other = tack > 0 ? r.armR : r.armL;
      tillerArm.rotation.x = 1.25 + b.rud * 0.6; other.rotation.x = 0.6 + Math.sin(this.rt * 0.7) * 0.1;
    } else { r.armL.rotation.x = 1.1 + Math.sin(ph * 0.8) * 0.75; r.armR.rotation.x = 1.1 + Math.sin(ph * 0.8 + Math.PI) * 0.75; }
  }

  /** Écoutes de voile d'avant (bordée sous le vent, molle au vent), grand-écoute, tours sur les winchs. */
  private updateRopes(r: Rec, b: Boat, ss: number, tm: number): void {
    const P = r.ropePos, Cc = r.ropeCol; let n = 0;
    const max = P.length / 6;
    const seg = (a: number[], c: number[], col: number[]) => { if (n >= max) return; P.set(a, n * 6); P.set(c, n * 6 + 3); Cc.set(col, n * 6); Cc.set(col, n * 6 + 3); n++; };
    const line = (a: number[], c: number[], sag: number, col: number[], k = 10, floorY?: number) => {
      let prev = a;
      for (let i = 1; i <= k; i++) {
        const u = i / k; let y = a[1] + (c[1] - a[1]) * u - sag * 4 * u * (1 - u);
        const x = a[0] + (c[0] - a[0]) * u, z = a[2] + (c[2] - a[2]) * u;
        if (floorY !== undefined) y = Math.max(y, floorY);
        const p = [x, y, z]; seg(prev, p, col); prev = p;
      }
    };
    const wrap = (x: number, y: number, z: number, rad: number, turns: number, col: number[]) => {
      let prev = [x + rad, y, z];
      for (let i = 1; i <= turns * 14; i++) { const a = i / 14 * Math.PI * 2, p = [x + Math.cos(a) * rad, y + i / (turns * 14) * 0.18, z + Math.sin(a) * rad]; seg(prev, p, col); prev = p; }
      return prev;
    };
    const ORANGE = [1, 0.45, 0.15], BLUE = [0.25, 0.55, 1], WHITE = [0.92, 0.92, 0.88];
    const lee = ss >= 0 ? 1 : -1, wp = WINCHES[0];
    const winch = (sx: number) => { const t = wp.t, x = sx * wp.x; return [x, deckY(t, x / HW(t)) + 0.08, HZ(t)]; };
    // voile d'avant
    if (b.headPow > 0.05) {
      const id = b.cls.heads[b.head].id, big = id === 'C0' || id === 'A3', lt = big ? 0.72 : 0.5;
      const lead = (sx: number) => [sx * HW(lt) * (big ? 0.96 : 0.8), deckY(lt, big ? 0.96 : 0.8) + 0.08, HZ(lt)];
      const clew = [r.clew.x, r.clew.y, r.clew.z];
      // écoute bordée, sous le vent
      const Ll = lead(lee), Wl = winch(lee);
      line(clew, Ll, 0.05, ORANGE, 6); line(Ll, [Wl[0] - lee * wp.r, Wl[1] + 0.2, Wl[2]], 0.02, ORANGE, 3);
      const end = wrap(Wl[0], Wl[1], Wl[2], wp.r + 0.01, 3, ORANGE);
      line(end, [lee * 1.0, deckY(0.85, 0.4) + 0.02, HZ(0.86)], 0.25, ORANGE, 5); // mou dans le cockpit
      // écoute molle, au vent
      const Lw = lead(-lee), Ww = winch(-lee);
      line(clew, Lw, 1.2, BLUE, 10, deckY(0.3, 0) - 0.4); line(Lw, [Ww[0] + lee * wp.r, Ww[1] + 0.2, Ww[2]], 0.15, BLUE, 4);
      wrap(Ww[0], Ww[1], Ww[2], wp.r + 0.01, 1, BLUE);
    }
    // grand-écoute : bout de bôme → chariot (palan) → winch de colonne
    {
      const ba = r.boomG.rotation.y, bp = r.boomG.position;
      const be = [bp.x + Math.sin(ba) * 6.6, bp.y - 0.25, bp.z + Math.cos(ba) * 6.6];
      const car = r.car.position, cp = [car.x, car.y + 0.05, car.z];
      for (const o of [-0.06, 0, 0.06]) seg([be[0] + o, be[1], be[2]], [cp[0] + o, cp[1], cp[2]], WHITE);
      line(cp, [0, deckY(0.8, 0) + 0.95, HZ(0.8)], 0.3, WHITE, 6);
    }
    // drisses et bosses de ris le long du mât (légère vibration)
    const fl = Math.sin(tm * 3) * 0.01;
    seg([0.12, DECK + 1.2, MAST_Z + 0.3], [0.12 + fl, DECK + 26, MAST_Z + 0.3], WHITE);
    for (let i = n; i < max; i++) { P.fill(0, i * 6, i * 6 + 6); }
    r.ropes.geometry.setDrawRange(0, n * 2);
    r.ropes.geometry.attributes.position.needsUpdate = true; r.ropes.geometry.attributes.color.needsUpdate = true;
  }

  resize(w: number, h: number): void {
    this.ren.setSize(w, h, false);
    this.cam.aspect = w / Math.max(1, h); this.cam.updateProjectionMatrix();
  }

  render(g: Game, boats: Boat[], me: Boat, dt: number, rt: number, view: 'pov' | 'chase'): void {
    this.rt = rt; this.amp = g.met.amp;
    this.setCourse(g.course);
    const tm = rt, pov = view === 'pov' && !g.demo, cam = this.cam, look = this.look;
    for (const r of this.boats3.values()) r.used = false;
    let meR: Rec | null = null;
    boats.forEach((b, i) => {
      let r = this.boats3.get(b.id);
      if (!r || r.name !== b.name) { if (r) this.scene.remove(r.yaw); r = this.mkBoat(b, String(7 + i * 13)); this.boats3.set(b.id, r); }
      this.placeBoat(r, b, dt, b === me, pov);
      if (b === me) meR = r;
    });
    for (const r of this.boats3.values()) r.yaw.visible = r.used;
    // sillage
    const wake = this.wake; let n = 0;
    for (const b of boats) for (const w of b.wake) {
      if (n >= wake.n) break;
      wake.pos[n * 3] = w.x; wake.pos[n * 3 + 1] = 0.15 + this.wh(w.x, w.y) * 0.8; wake.pos[n * 3 + 2] = w.y; wake.age[n] = w.t; n++;
    }
    wake.g.setDrawRange(0, n); wake.g.attributes.position.needsUpdate = true; wake.g.attributes.age.needsUpdate = true;
    const drops = this.drops, spray = this.spray;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.a += dt; d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.a > 1.2 || d.y < this.wh(d.x, d.z) - 0.3) drops.splice(i, 1);
    }
    drops.forEach((d, i) => { spray.pos[i * 3] = d.x; spray.pos[i * 3 + 1] = d.y; spray.pos[i * 3 + 2] = d.z; spray.age[i] = d.a; });
    spray.g.setDrawRange(0, drops.length); spray.g.attributes.position.needsUpdate = true; spray.g.attributes.age.needsUpdate = true;
    // tremblement : vitesse + coups de mer
    const kn = Math.max(0, me.v) / 0.514444;
    this.shake = this.shake * Math.exp(-dt * 3) + Math.max(0, kn - 12) * 0.0006 * dt * 60;
    this.moveFlecks(me, dt);
    // caméra
    if (look.idle > 2) { look.yaw *= 1 - Math.min(1, dt * 1.2); look.pitch *= 1 - Math.min(1, dt * 1.2); }
    look.idle += dt;
    const X = me.x, Z = me.y, mr = meR as Rec | null;
    if (pov && mr) {
      // vue cockpit : à la barre, derrière la casquette
      mr.yaw.updateMatrixWorld(true);
      this.hw.set(-(me.twa >= 0 ? 1 : -1) * 1.5, deckY(0.96, 0.6) + 1.7, HZ(0.96)); mr.roll.localToWorld(this.hw); // debout à la barre, côté au vent
      cam.position.copy(this.hw);
      const tack = me.twa >= 0 ? 1 : -1;
      this.eul.set(-0.06 + mr.roll.rotation.x * 0.6 + look.pitch, -me.h + look.yaw, -tack * mr.heel * 0.55, 'YXZ'); cam.quaternion.setFromEuler(this.eul);
      this.setFov(74 + clamp((kn - 8) * 0.7, 0, 16), dt);
    } else {
      if (this.camYaw == null) this.camYaw = me.h;
      this.camYaw = norm(this.camYaw + norm(me.h - this.camYaw) * Math.min(1, dt * 1.6));
      // caméra basse et proche : la mer défile ; elle recule un peu et s'élargit avec la vitesse
      const cy = this.camYaw + look.yaw + 0.3, dist = 24 + kn * 0.25 - look.pitch * 14, tx = X - Math.sin(cy) * dist, tz = Z + Math.cos(cy) * dist, ty = 6.5 + kn * 0.08 + look.pitch * -18;
      if (Math.hypot(cam.position.x - tx, cam.position.z - tz) > 200) cam.position.set(tx, ty, tz);
      cam.position.lerp(this.tmp.set(tx, Math.max(3, ty), tz), Math.min(1, dt * 3));
      cam.lookAt(X + Math.sin(cy) * 10, 7, Z - Math.cos(cy) * 10);
      this.setFov(58 + clamp((kn - 8) * 0.9, 0, 22), dt);
    }
    // mer + risées
    const wU = this.wU;
    wU.t.value = tm; wU.amp.value = this.amp;
    (wU.off.value as T.Vector2).set(cam.position.x, cam.position.z);
    this.gTimer -= dt;
    if (this.gTimer <= 0) {
      this.gTimer = 0.4;
      const gN = this.gN, gs = this.gS, gx = Math.round(cam.position.x / 50) * 50, gz = Math.round(cam.position.z / 50) * 50;
      (wU.gC.value as T.Vector2).set(gx, gz);
      for (let j = 0; j < gN; j++) for (let i = 0; i < gN; i++) {
        const wx = gx + ((i + 0.5) / gN - 0.5) * gs, wz = gz + ((j + 0.5) / gN - 0.5) * gs;
        this.gData[j * gN + i] = clamp((g.wind.speedAt(wx, wz, g.t) - g.met.base) / (7 * g.met.gust), 0, 1) * 255;
      }
      this.gTex.needsUpdate = true;
    }
    g.course.marks.forEach((m, i) => { if (m.island == null) { const o = this.marks3[i]; o.position.y = this.wh(m.x, m.y) * 0.8 - 0.2; o.rotation.z = Math.sin(tm * 1.3 + i) * 0.08; } });
    this.pin3.position.y = this.wh(this.pin3.position.x, 0) * 0.8 - 0.2;
    this.cb.position.y = this.wh(this.cb.position.x, 0) * 0.5; this.cb.rotation.z = Math.sin(tm * 0.9) * 0.03;
    const nm = !g.demo && !me.ocs && me.leg >= 1 && me.leg <= g.course.marks.length ? g.course.marks[me.leg - 1] : null;
    this.ring.visible = !!nm && nm.island == null;
    if (nm) { this.ring.position.set(nm.x, 0.6, nm.y); this.ring.material.opacity = 0.35 + 0.25 * Math.sin(tm * 4); }
    this.line.material.opacity = me.leg === 0 || me.leg > g.course.marks.length || me.ocs ? 0.95 : 0.3;
    this.flagM.color.set(g.t < 0 ? '#3d7bd9' : '#ff6a1f');
    if (this.shake > 0.0005) {
      const s = Math.min(0.03, this.shake * 0.08 + (kn / 30) ** 2 * 0.004);
      cam.rotateX(Math.sin(tm * 23) * s * 0.6 + Math.sin(tm * 41) * s * 0.4);
      cam.rotateZ(Math.sin(tm * 17 + 1) * s * 0.5);
    }
    // flèche du cap conseillé, posée sur l'eau devant le bateau
    this.arrow.visible = !g.demo && g.advice != null && me.fin == null && view === 'chase';
    if (this.arrow.visible) {
      // devant l'étrave (toujours dans le champ), orientée vers le cap conseillé
      const a = g.advice!, d = 26;
      const ax = me.x + Math.sin(me.h) * d, az = me.y - Math.cos(me.h) * d;
      this.arrow.position.set(ax, this.wh(ax, az) * 0.8 + 0.4, az); this.arrow.rotation.y = -a;
      this.arrow.material.opacity = 0.55 + 0.25 * Math.sin(tm * 5); this.arrow.scale.setScalar(1.7);
    }
    this.sun.position.set(me.x + this.sunDir.x * 100, this.sunDir.y * 100, me.y + this.sunDir.z * 100); this.sun.target.position.set(me.x, 0, me.y);
    this.ren.render(this.scene, cam);
  }

  private setFov(target: number, dt: number): void {
    const f = this.lastFov ? this.lastFov + (target - this.lastFov) * Math.min(1, dt * 2) : target;
    if (Math.abs(f - this.cam.fov) > 0.05) { this.cam.fov = f; this.cam.updateProjectionMatrix(); }
    this.lastFov = f;
  }

  /** Écume immobile sur l'eau, recyclée devant le bateau quand elle passe derrière. */
  private moveFlecks(me: Boat, dt: number): void {
    const F = this.flecks, xz = this.fleckXZ, R = 140, fx = Math.sin(me.h), fz = -Math.cos(me.h);
    for (let i = 0; i < F.n; i++) {
      let x = xz[i * 2], z = xz[i * 2 + 1];
      const dx = x - me.x, dz = z - me.y;
      if (dx * dx + dz * dz > R * R) {
        // réapparaît au hasard, plutôt devant
        const a = Math.random() * TAU, r = (0.15 + 0.85 * Math.sqrt(Math.random())) * R;
        x = me.x + Math.cos(a) * r; z = me.y + Math.sin(a) * r;
        if ((x - me.x) * fx + (z - me.y) * fz < -20 && Math.random() < 0.7) { x = me.x + fx * r * 0.9 + Math.cos(a) * 30; z = me.y + fz * r * 0.9 + Math.sin(a) * 30; }
        xz[i * 2] = x; xz[i * 2 + 1] = z;
        F.age[i] = Math.random() * 2;
      }
      F.pos[i * 3] = x; F.pos[i * 3 + 1] = this.wh(x, z) * 0.8 + 0.05; F.pos[i * 3 + 2] = z;
    }
    void dt;
    F.g.setDrawRange(0, F.n); F.g.attributes.position.needsUpdate = true; F.g.attributes.age.needsUpdate = true;
  }
}
