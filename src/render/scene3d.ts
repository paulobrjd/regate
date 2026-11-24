// Rendu 3D (Three.js) à l'échelle réelle (1 unité = 1 m) : mer de Gerstner jusqu'à l'horizon, ciel, îles,
// bouées, IMOCA (carène, quille pendulaire, foils, safrans, voiles d'avant interchangeables, ris), skipper.
import * as T from 'three';
import { D, TAU, clamp, norm } from '../util/math';
import { WV, waveH, SWELL } from '../physics/waves';
import { ISLANDS, shoreR, islandHeight } from '../physics/world';
import type { Game } from '../game/game';
import type { Boat } from '../physics/boat';
import { headAngle, mainAngle } from '../physics/model';

T.ColorManagement.enabled = false;
const f = (v: number) => v.toFixed(5);

import { HZ, HW, deckY, MAST_Z, DECK, WINCHES, TRAV_T, EXT_L, buildImoca, mainTex, headTex } from './imoca';
import { Rope, braidTex } from './rope';
import { Decor } from './decor';
import { Skipper } from './skipper';
import { raceMark, lineTower, FloatLine, palette } from './marks';

const NU = 12, NV = 22;

interface Rec {
  yaw: T.Group; roll: T.Group; boomG: T.Group; mast: T.Mesh; keelG: T.Group; foilP: T.Group; foilS: T.Group; ruds: T.Group[];
  mg: T.BufferGeometry; hg: T.BufferGeometry; hmesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  skipper: Skipper; navG: T.Group; tillerExt: T.Group; handles: T.Group[]; pedCrank: T.Group;
  car: T.Mesh; tiller: T.Group; winches: { g: T.Group; i: number; sx: number }[];
  /** Cordages en 3D (bateau du joueur). */
  tubes?: { lee: Rope; wind: Rope; main: Rope; light: T.PointLight; lastHead: number; lastMain: number; lastLee: number };
  ropes: T.LineSegments; ropePos: Float32Array; ropeCol: Float32Array; clew: T.Vector3;
  /** Skipper : position sur le pont (x, t), activité et minuterie. */
  sk: { x: number; t: number; mode: 'helm' | 'grind' | 'trim' | 'pedestal'; timer: number; tack: number; walk: number; lastHead: number; lastMain: number; trimT: number; mainT: number; crank: number; yaw: number };
  /** Main qui tient le mou de l'écoute (coordonnées du pont), quand le skipper reprend un bout. */
  tailHand: T.Vector3 | null;
  /** Voiles vivantes : bôme sur ressort amorti, faseyement progressif, creux qui respire. */
  sail: { boom: number; boomV: number; luffM: number; luffH: number; breath: number; side: number };
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
  private towers: T.Group[] = []; private floats = new FloatLine(36);
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
  /** Repères de la prochaine marque : colonne de lumière, chevron flottant, flèches de contournement. */
  private beam!: T.Mesh<T.CylinderGeometry, T.ShaderMaterial>;
  private chevron!: T.Mesh;
  private arcArrows: T.Mesh<T.ShapeGeometry, T.MeshBasicMaterial>[] = [];
  private arcKey = '';
  private arcPts: { x: number; z: number; h: number }[] = [];
  private projV = new T.Vector3();
  // ciel, météo, plan d'eau
  private FOG!: T.Color; private skyTop = new T.Color('#2569ad'); private glow = new T.Color(1, 0.88, 0.65);
  // nuit : étoiles, feux de navigation, phares, bouées à éclats
  private night = false; private stars!: T.Points; private foamLum = new T.Color(0.95, 0.97, 1);
  private beams: { g: T.Group; ph: number }[] = [];
  private glowTex: T.Texture | null = null;
  private hemi!: T.HemisphereLight; private amb!: T.AmbientLight;
  private envScene!: T.Scene;
  private clouds: { sp: T.Sprite; op: number }[] = [];
  private islG = new T.Group(); private venueId = ''; private skyId = '';
  private sky = { near: 2500, far: 14000, sun: 0.9, hemi: 0.75, rain: 0 };
  private rain!: T.LineSegments; private rainPos!: Float32Array; private rainAmt = 0;
  private decor!: Decor;
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

    this.FOG = FOG;
    scene.add(new T.Mesh(new T.SphereGeometry(20000, 32, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: this.skyTop }, hor: { value: FOG }, sun: { value: sunDir }, glow: { value: this.glow } },
      vertexShader: 'varying vec3 vP;void main(){vP=normalize(position);vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;gl_Position.z=gl_Position.w*.99999;}',
      fragmentShader: 'uniform vec3 top,hor,sun,glow;varying vec3 vP;void main(){float h=clamp(vP.y*1.8,0.,1.);vec3 c=mix(hor,top,pow(h,.5));float s=max(dot(vP,sun),0.);c+=glow*(pow(s,900.)*3.+pow(s,10.)*.22);gl_FragColor=vec4(c,1.);}',
    })));
    this.hemi = new T.HemisphereLight('#e4f3ff', '#1d5a7a', 0.75 * Math.PI); scene.add(this.hemi);
    this.amb = new T.AmbientLight('#ffffff', 0.25 * Math.PI); scene.add(this.amb);
    const sl = new T.DirectionalLight('#fff1d6', 0.9 * Math.PI); sl.position.copy(sunDir).multiplyScalar(100); scene.add(sl); scene.add(sl.target);
    this.sun = sl; this.sunDir = sunDir;
    if (this.shadows) {
      this.ren.shadowMap.enabled = true; this.ren.shadowMap.type = T.PCFSoftShadowMap;
      sl.castShadow = true; sl.shadow.mapSize.set(2048, 2048);
      const sc = sl.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 1; sc.far = 220;
      sl.shadow.bias = -0.0004; sl.shadow.normalBias = 0.04;
    }

    {
      const envScene = new T.Scene(); this.envScene = envScene;
      envScene.add(new T.Mesh(new T.SphereGeometry(100, 32, 16), new T.ShaderMaterial({
        side: T.BackSide, uniforms: { top: { value: this.skyTop }, hor: { value: FOG }, sun: { value: sunDir } },
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
      this.clouds.push({ sp, op: sp.material.opacity });
    }

    // étoiles (visibles la nuit)
    {
      const N = 2200, pos = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = Math.random() * TAU, e = Math.asin(Math.random() * 0.98 + 0.02), r = 15000; pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3); }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      this.stars = new T.Points(g, new T.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
      this.stars.visible = false; this.stars.frustumCulled = false; scene.add(this.stars);
    }
    // mer : grille radiale (dense près de la caméra, jusqu'à 12 km)
    const gN = this.gN;
    this.gData = new Uint8Array(gN * gN);
    this.gTex = new T.DataTexture(this.gData, gN, gN, T.RedFormat);
    this.gTex.magFilter = T.LinearFilter; this.gTex.minFilter = T.LinearFilter; this.gTex.needsUpdate = true;
    const waves = WV.map(([A, dx, dz, k, st]) => {
      const Q = st / (k * A), w = Math.sqrt(9.8 * k);
      return `{vec2 d=Rw*vec2(${f(dx)},${f(dz)});float ph=${f(k)}*dot(d,p0)-t*${f(w)};float c=cos(ph),s=sin(ph);P.x+=a*${f(Q * A)}*d.x*c;P.z+=a*${f(Q * A)}*d.y*c;P.y+=a*${f(A)}*s;N.x-=a*${f(k * A)}*d.x*c;N.z-=a*${f(k * A)}*d.y*c;N.y-=a*${f(st)}*s;J-=a*${f(st)}*s;}`;
    }).join('');
    this.wU = { rot: { value: new T.Vector2(1, 0) }, chop: { value: 1 }, amp: { value: 1 }, t: { value: 0 }, off: { value: new T.Vector2() }, sun: { value: sunDir }, gT: { value: this.gTex }, gC: { value: new T.Vector2() }, gS: { value: this.gS }, fogC: { value: FOG }, isl: { value: Array.from({ length: 16 }, () => new T.Vector4(1e7, 1e7, 1, 0)) }, nIsl: { value: 0 }, deepC: { value: new T.Vector3(0.02, 0.17, 0.28) }, skyLo: { value: new T.Vector3(0.76, 0.86, 0.92) }, skyHi: { value: new T.Vector3(0.3, 0.53, 0.78) } };
    const water = new T.Mesh(this.radialGrid(150, 256, 12000), new T.ShaderMaterial({
      uniforms: this.wU,
      vertexShader: 'uniform float t,amp;uniform vec2 off,rot;varying vec3 vW;varying vec3 vN;varying float vJ;void main(){mat2 Rw=mat2(rot.x,rot.y,-rot.y,rot.x);vec2 p0=position.xz+off;float a=amp*(1.-smoothstep(900.,2600.,length(position.xz)));vec3 P=vec3(p0.x,0.,p0.y);vec3 N=vec3(0.,1.,0.);float J=1.;' + waves + 'vN=normalize(N);vJ=J;vW=P;gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}',
      fragmentShader: `uniform vec3 sun,fogC;uniform float t,gS,chop;uniform sampler2D gT;uniform vec2 gC;uniform vec4 isl[16];uniform int nIsl;uniform vec3 deepC,skyLo,skyHi;varying vec3 vW,vN;varying float vJ;
float hs(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),q=fract(p);q=q*q*(3.-2.*q);return mix(mix(hs(i),hs(i+vec2(1.,0.)),q.x),mix(hs(i+vec2(0.,1.)),hs(i+vec2(1.,1.)),q.x),q.y);}
void main(){float d=length(cameraPosition.xz-vW.xz);float fd=1.-smoothstep(40.,500.,d);
vec2 uv=(vW.xz-gC)/gS+.5;float g=texture2D(gT,uv).r*(1.-smoothstep(1500.,2000.,d));float r=(chop+g*2.)*fd;
vec3 n=normalize(vN+r*vec3(sin(vW.x*1.7+t*2.1)*.03+sin(vW.z*3.1-vW.x*.7-t*2.9)*.022+(vn(vW.xz*1.3+t*.6)-.5)*.07,0.,cos(vW.z*1.9+t*1.6)*.03+sin(vW.x*2.7+vW.z*1.3+t*3.3)*.018+(vn(vW.zx*1.1-t*.5)-.5)*.07));
vec3 V=normalize(cameraPosition-vW);float fr=.02+.98*pow(1.-max(dot(n,V),0.),5.);
vec3 R=reflect(-V,n);float sk=clamp(R.y,0.,1.);vec3 skyc=mix(skyLo,skyHi,pow(sk,.5));
vec3 deep=mix(deepC,deepC*.55,g*.8);
float sss=clamp(vW.y*1.3,0.,1.)*(dot(V,-sun)*.5+.5);deep+=vec3(0.,.22,.2)*sss*.6;
vec3 c=mix(deep,skyc,fr*.9);vec3 H=normalize(sun+V);c+=vec3(1.,.93,.8)*pow(max(dot(n,H),0.),500.)*1.8;
float fn=vn(vW.xz*.9+t*.3)*.6+vn(vW.xz*3.1-t*.2)*.4;
float foam=smoothstep(.55,.3,vJ)*(.45+g)*smoothstep(.4,.75,fn);
foam+=g*smoothstep(.74,.9,vn(vW.xz*.22+vec2(t*.05,-t*.35)))*smoothstep(.45,.8,fn)*.9;
c=mix(c,vec3(.93,.96,.98),clamp(foam,0.,1.)*mix(.2,1.,fd));
float sh=1e9;for(int i=0;i<16;i++){if(i>=nIsl)break;vec4 I=isl[i];vec2 q=vW.xz-I.xy;float th=atan(q.y,q.x),s=I.w;float R=I.z*(1.+.12*sin(3.*th+s)+.07*sin(5.*th+2.*s)+.04*sin(9.*th+3.*s));sh=min(sh,length(q)-R*1.04);}
float shallow=smoothstep(450.,0.,sh);c=mix(c,mix(vec3(.05,.42,.45),vec3(.35,.75,.7),smoothstep(150.,0.,sh)),shallow*.55*(1.-fr*.6));
c=mix(c,vec3(.95,.97,.98),smoothstep(90.,0.,sh)*smoothstep(.35,.7,vn(vW.xz*.15+vec2(t*.3,0.))+.3*sin(sh*.15-t*1.5))*.8);
c=mix(c,fogC,smoothstep(1500.,11000.,d));gl_FragColor=vec4(c,1.);}`,
    }));
    water.frustumCulled = false; scene.add(water);

    // îles
    scene.add(this.islG);

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
    // colonne de lumière qui pulse au-dessus de la prochaine marque
    this.beam = new T.Mesh(new T.CylinderGeometry(5, 5, 140, 24, 1, true), new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.NormalBlending, side: T.DoubleSide, fog: false,
      uniforms: { t: { value: 0 }, col: { value: new T.Color('#ff5a0a') } },
      vertexShader: 'varying vec2 vU;void main(){vU=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform float t;uniform vec3 col;varying vec2 vU;void main(){float a=pow(1.-vU.y,1.3)*(.6+.2*sin(t*3.))+.3*smoothstep(.02,0.,abs(fract(vU.y*4.-t*.6)-.5)-.45)*(1.-vU.y);gl_FragColor=vec4(mix(col,vec3(1.,.85,.5),.25),clamp(a*.85,0.,.85));}',
    }));
    this.beam.position.y = 70; this.beam.renderOrder = 6; scene.add(this.beam);
    this.chevron = new T.Mesh(new T.ConeGeometry(2.4, 5, 4), new T.MeshBasicMaterial({ color: '#ff7a2a', fog: false }));
    this.chevron.rotation.x = Math.PI; scene.add(this.chevron);
    {
      const sh = new T.Shape(); sh.moveTo(0, -3); sh.lineTo(3, 0.5); sh.lineTo(1.6, 0.5); sh.lineTo(0, -1.2); sh.lineTo(-1.6, 0.5); sh.lineTo(-3, 0.5); sh.closePath();
      const ag = new T.ShapeGeometry(sh); ag.rotateX(Math.PI / 2);
      for (let i = 0; i < 12; i++) {
        const m = new T.Mesh(ag, new T.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.8, depthWrite: false, side: T.DoubleSide, fog: false }));
        m.renderOrder = 5; scene.add(m); this.arcArrows.push(m);
      }
    }
    // décor vivant (îles habitées, spectateurs, faune…) ; les dauphins font des gerbes
    this.decor = new Decor(scene, (x, y, z, n) => {
      for (let i = 0; i < n && this.drops.length < 850; i++) {
        const a = Math.random() * TAU, sp = 1 + Math.random() * 2;
        this.drops.push({ x, y, z, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 3, vz: Math.sin(a) * sp, a: 0 });
      }
    });
    {
      const N = 1500; this.rainPos = new Float32Array(N * 6);
      for (let i = 0; i < N; i++) { const x = (Math.random() - 0.5) * 120, y = Math.random() * 60, z = (Math.random() - 0.5) * 120; this.rainPos.set([x, y, z, x, y - 1.2, z], i * 6); }
      const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(this.rainPos, 3));
      this.rain = new T.LineSegments(rg, new T.LineBasicMaterial({ color: '#c9d6df', transparent: true, opacity: 0.45, fog: false }));
      this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
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
        const y = islandHeight(isl, th, rho);
        pos.push(isl.x + Math.cos(th) * R, y, isl.y + Math.sin(th) * R);
        const c = y < 4 ? sand : y > isl.h * 1.45 || (rho > 0.9 && y > 12) ? rock : (j + i) % 3 ? green : dark;
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
      const th = 0.6, R = shoreR(isl, th) * 0.75, x = isl.x + Math.cos(th) * R, z = isl.y + Math.sin(th) * R, y0 = islandHeight(isl, th, 0.75) - 1;
      const ph = new T.Mesh(new T.CylinderGeometry(3, 4.2, 30, 12), new T.MeshLambertMaterial({ color: '#f2f2f2' })); ph.position.set(x, y0 + 15, z); grp.add(ph);
      const tp = new T.Mesh(new T.CylinderGeometry(3.3, 3.3, 6, 12), new T.MeshLambertMaterial({ color: '#c8371e' })); tp.position.set(x, y0 + 33, z); grp.add(tp);
      // la nuit : lanterne et deux faisceaux qui balaient l'horizon
      const bg = new T.Group(); bg.position.set(x, y0 + 37, z); bg.visible = this.night; grp.add(bg);
      const lamp = this.glowSprite('#fff4c8', 0.05); bg.add(lamp);
      const cone = new T.ConeGeometry(260, 4200, 24, 1, true); cone.translate(0, -2100, 0); cone.rotateZ(Math.PI / 2);
      const beamM = new T.MeshBasicMaterial({ color: '#fff2c0', transparent: true, opacity: 0.07, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, fog: false });
      for (const r of [0, Math.PI]) { const m = new T.Mesh(cone, beamM); m.rotation.y = r; bg.add(m); }
      this.beams.push({ g: bg, ph: isl.seed });
    }
    return grp;
  }

  /** Halo lumineux (feu de navigation, lanterne) : taille fixe à l'écran. */
  private glowSprite(col: string, size: number): T.Sprite {
    if (!this.glowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d')!, g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      this.glowTex = new T.CanvasTexture(c);
    }
    const sp = new T.Sprite(new T.SpriteMaterial({ map: this.glowTex, color: col, transparent: true, blending: T.AdditiveBlending, depthWrite: false, sizeAttenuation: false, fog: false }));
    sp.scale.set(size, size, 1); sp.renderOrder = 9; return sp;
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
    { const fl = this.glowSprite('#ffe27a', 0.035); fl.position.y = (txt ? 9 : 3.4) * s; fl.visible = false; g.add(fl); g.userData.flash = fl; }
    if (txt) {
      const pole = new T.Mesh(new T.CylinderGeometry(0.06 * s, 0.08 * s, 6 * s, 8), new T.MeshStandardMaterial({ color: '#e9eef2', roughness: 0.4 })); pole.position.y = 5.5 * s; g.add(pole);
      const fl = new T.Mesh(new T.PlaneGeometry(1.8 * s, 1.1 * s), new T.MeshBasicMaterial({ color: col, side: T.DoubleSide })); fl.position.set(0.95 * s, 7.8 * s, 0); g.add(fl);
      g.userData.flag = fl;
      const sp = this.label(txt, 'rgba(255,106,31,.9)'); sp.position.y = 12 * s; sp.scale.set(0.2, 0.025, 1); g.add(sp);
    }
    return g;
  }

  private setCourse(c: Game['course']): void {
    if (this.markGame === c) return;
    for (const m of this.marks3) this.scene.remove(m);
    this.marks3 = c.marks.map(m => {
      const side = m.side === 'port' ? 'à bâbord' : 'à tribord';
      let o: T.Object3D;
      const [col, col2] = palette(c.id), num = String(c.marks.indexOf(m) + 1);
      if (m.island != null) {
        // île : une grande bouée de dégagement au large de la pointe, à contourner avec l'île
        const isl = ISLANDS[m.island], w = m.wp[1], th = Math.atan2(w.y - m.y, w.x - m.x), r0 = shoreR(isl, th);
        const d = Math.hypot(w.x - m.x, w.y - m.y), k = (r0 + (d - r0) * 0.45) / d;
        o = raceMark(col, col2, num); o.scale.setScalar(1.8); o.position.set(m.x + (w.x - m.x) * k, 0, m.y + (w.y - m.y) * k);
        const sp = this.label(m.name + ' · ' + side, 'rgba(255,106,31,.9)'); sp.position.y = 9; sp.scale.set(0.2, 0.025, 1); o.add(sp);
      } else {
        o = raceMark(col, col2, num); o.scale.setScalar(1.2); o.position.set(m.x, 0, m.y);
        const sp = this.label(m.name + ' · ' + side, 'rgba(255,106,31,.9)'); sp.position.y = 11; sp.scale.set(0.2, 0.025, 1); o.add(sp);
      }
      { const fl = this.glowSprite('#ffe27a', 0.035); fl.position.y = 9; fl.visible = false; o.add(fl); o.userData.flash = fl; }
      this.scene.add(o); return o;
    });
    this.pin3.position.set(c.pin.x, 0, c.pin.y); this.cb.position.set(c.cmte.x + 4, 0, c.cmte.y);
    // tours DÉPART / ARRIVÉE et ligne de flotteurs aux couleurs du parcours
    for (const t of this.towers) this.scene.remove(t);
    const [col] = palette(c.id);
    this.towers = [lineTower(col), lineTower(col)]; for (const t of this.towers) t.scale.setScalar(1.6);
    this.towers[0].position.set(c.pin.x - 14, 0, c.pin.y); this.towers[1].position.set(c.cmte.x + 26, 0, c.cmte.y);
    for (const t of this.towers) this.scene.add(t);
    this.floats.set({ x: c.pin.x + 6, y: c.pin.y }, { x: c.cmte.x - 6, y: c.cmte.y }, col);
    if (!this.floats.mesh.parent) this.scene.add(this.floats.mesh);
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
    const yaw = new T.Group(), roll = new T.Group(); yaw.add(roll);
    const parts = buildImoca(roll, b.col, b.name, num);
    const mg = this.grid(), main = new T.Mesh(mg, new T.MeshStandardMaterial({ map: mainTex(num, b.col, b.name), side: T.DoubleSide, roughness: 0.55, metalness: 0.05 }));
    main.castShadow = true; parts.boomG.add(main);
    const hg = this.grid(), hmesh = new T.Mesh(hg, new T.MeshStandardMaterial({ map: this.headMap('J1', b.col), side: T.DoubleSide, roughness: 0.6, transparent: true, opacity: 0.97 }));
    hmesh.castShadow = true; roll.add(hmesh);
    // feux de navigation (la nuit) : tricolore en tête de mât, rouge à bâbord, vert à tribord, blanc arrière
    const navG = new T.Group(); navG.visible = false; roll.add(navG);
    { const top = DECK + 29.2;
      const tri = [['#ff3b30', -0.15, top, MAST_Z - 0.1], ['#33ff77', 0.15, top, MAST_Z - 0.1], ['#ffffff', 0, top + 0.05, MAST_Z + 0.2]] as const;
      for (const [c, x, y, z] of tri) { const sp = this.glowSprite(c, 0.022); sp.position.set(x, y, z); navG.add(sp); }
      for (const [c, sx] of [['#ff3b30', -1], ['#33ff77', 1]] as const) { const sp = this.glowSprite(c, 0.03); sp.position.set(sx * HW(0.04) * 0.9, deckY(0.04, 0.9) + 0.7, HZ(0.04)); navG.add(sp); }
      const st = this.glowSprite('#ffffff', 0.028); st.position.set(0, deckY(0.99, 0) + 0.7, HZ(0.995)); navG.add(st); }
    // skipper articulé
    const skipper = new Skipper(b.col); roll.add(skipper.root);
    const lb = this.label(b.name, 'rgba(4,30,50,.6)'); lb.position.y = 33; yaw.add(lb);
    this.scene.add(yaw);
    // cordages : écoutes, grand-écoute, tours sur les winchs (mis à jour à chaque image)
    const RN = 400, ropePos = new Float32Array(RN * 6), ropeCol = new Float32Array(RN * 6);
    const rg = new T.BufferGeometry(); rg.setAttribute('position', new T.BufferAttribute(ropePos, 3)); rg.setAttribute('color', new T.BufferAttribute(ropeCol, 3));
    const ropes = new T.LineSegments(rg, new T.LineBasicMaterial({ vertexColors: true })); ropes.frustumCulled = false; roll.add(ropes);
    return { yaw, roll, boomG: parts.boomG, mast: parts.mast, keelG: parts.keelG, foilP: parts.foilP, foilS: parts.foilS, ruds: parts.ruds, mg, hg, hmesh, skipper, tillerExt: parts.tillerExt, handles: parts.handles, pedCrank: parts.pedCrank, navG, tailHand: null, sail: { boom: 0, boomV: 0, luffM: 0, luffH: 0, breath: 1, side: 1 }, lb, name: b.name, heel: 0, used: true, headId: '',
      car: parts.car, tiller: parts.tiller, winches: parts.winches, ropes, ropePos, ropeCol, clew: new T.Vector3(), sk: { x: -1.55, t: 0.905, mode: 'helm', timer: 0, tack: 0, walk: 0, lastHead: -1, lastMain: -1, trimT: 0, mainT: 0, crank: 0, yaw: 0 } };
  }

  /** Grand-voile : guindant le long du mât, bordure sur la bôme, rond de chute et tête carrée. */
  private setMain(g: T.BufferGeometry, side: number, h: number, camber: number, luff: number, tm: number, aws: number): void {
    const p = (g.attributes.position as T.BufferAttribute).array as Float32Array; let k = 0;
    const flut = 0.02 + Math.min(0.05, aws * 0.0015) + luff * 0.32, speed = 14 + aws * 0.4 + luff * 10;
    for (let j = 0; j <= NV; j++) {
      const v = j / NV, ch = 7.0 * (1 - v) + 2.9 * v + 1.1 * Math.sin(Math.PI * Math.pow(v, 0.8)) * (1 - v * 0.3);
      const twist = 0.22 * v * v;
      const batten = 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * v * 9)); // les lattes raidissent la toile
      for (let i = 0; i <= NU; i++) {
        const u = i / NU, bulge = 4 * u * (1 - u) * (1 - 0.35 * u);
        let x = side * camber * ch * 0.13 * bulge * (1 - v * 0.25) + side * u * ch * twist;
        // ondulation qui court du guindant vers la chute, plus forte sur la chute
        x += Math.sin(tm * speed - u * 7 + v * 4) * flut * Math.pow(u, 1.6) * batten + Math.sin(tm * speed * 1.7 - u * 13) * flut * 0.3 * Math.pow(u, 3);
        p[k++] = x; p[k++] = v * h + 0.05; p[k++] = u * ch - 0.1 * Math.sin(Math.PI * v) ;
      }
    }
    g.attributes.position.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
  }

  /** Voile d'avant : point d'amure, tête, point d'écoute selon l'angle d'écoute delta (°). */
  private setHead(r: Rec, b: Boat, side: number, delta: number, pow: number, luff: number, tm: number): void {
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
        const amp = 0.015 + luff * 0.28, fx = Math.sin(tm * (18 + luff * 10) - u * 8 + v * 5) * amp * (0.3 + u) * (1 - v * 0.7);
        const curl = luff * 0.5 * Math.sin(Math.PI * v) * Math.pow(1 - u, 3); // le guindant se creuse (contre-gîte)
        R.x += side * (bl * (1 - 0.8 * luff) + fx * (isGen ? 2 : 1) - curl); if (isGen) R.z -= bl * 0.6 * (1 - 0.6 * luff);
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
      transparent: true, depthWrite: false, uniforms: { tex: { value: this.dotTex }, lum: { value: this.foamLum } },
      vertexShader: `attribute float age;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vA=age;gl_PointSize=min((${sz[0].toFixed(2)}+age*${sz[1].toFixed(2)})*300./-mv.z,${sz[2]}.);gl_Position=projectionMatrix*mv;}`,
      fragmentShader: `uniform sampler2D tex;uniform vec3 lum;varying float vA;void main(){float a=texture2D(tex,gl_PointCoord).a*(1.-vA/${life.toFixed(2)})*${alpha};gl_FragColor=vec4(lum,a);}`,
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
    const ss = r.sideS;
    const md = mainAngle(b.mainSheet, b.trav), sl = r.sail;
    // faseyement progressif (0 = voile pleine, 1 = elle bat) et creux qui respire avec le vent
    const luffT = b.knock > 0 ? 1 : clamp((md + 4 - aa) / 10, 0, 1);
    sl.luffM += (luffT - sl.luffM) * Math.min(1, dt * 3);
    sl.breath += ((0.9 + Math.min(0.2, b.aws / 120)) * (1 + 0.06 * Math.sin(tm * 1.7 + X * 0.1)) - sl.breath) * Math.min(1, dt * 2);
    // bôme : poussée par le vent vers son angle d'écoute, elle balance et dépasse (ressort amorti)
    const lee = b.awa >= 0 ? 1 : -1, target = lee * clamp(md, -6, 85) * D * (b.knock > 0 ? 0.5 : 1);
    const kSpring = 9 + 14 * (1 - sl.luffM), cDamp = 2.6 + 3 * (1 - sl.luffM);
    const prevV = sl.boomV;
    sl.boomV += (kSpring * (target - sl.boom) - cDamp * sl.boomV) * Math.min(dt, 0.05);
    sl.boom += sl.boomV * Math.min(dt, 0.05);
    if (isMe && Math.abs(prevV) > 1.2 && Math.sign(prevV) !== Math.sign(sl.boomV) && Math.abs(sl.boom) > 0.6) this.onBoom(true); // la bôme arrive en butée
    r.boomG.rotation.y = sl.boom;
    if (Math.abs(sl.boom) > 0.02) sl.side = Math.sign(sl.boom);
    r.mast.rotation.y = r.boomG.rotation.y * 0.45; // mât-aile pivotant
    const reefH = [27, 23.5, 20, 16.5][b.reefs];
    const camber = (0.6 + 0.5 * clamp(1 - Math.abs(b.mainSheet - b.ideal.mainSheet) * 3, 0, 1)) * (1 - 0.9 * sl.luffM) * sl.breath;
    this.setMain(r.mg, sl.side * clamp(Math.abs(sl.boom) * 6, 0.15, 1), reefH * (0.6 + 0.4 * b.mainPow), camber, sl.luffM, tm + X, b.aws);
    const head = b.cls.heads[b.head], hd = headAngle(head, b.headSheet);
    const hT = b.knock > 0 || aa < head.awaMin ? 1 : Math.max(clamp((hd + 4 - aa) / 10, 0, 1), 1 - b.headPow);
    sl.luffH += (hT - sl.luffH) * Math.min(1, dt * 3);
    this.setHead(r, b, ss, hd, b.headPow, sl.luffH, tm + Z);
    r.hmesh.visible = b.headPow > 0.02;
    r.keelG.rotation.z = b.keel * b.cls.keelMax * D;
    r.foilP.position.x = -1.2 + (1 - b.foilP) * 2.4;
    r.foilS.position.x = 1.2 - (1 - b.foilS) * 2.4;
    for (const rd of r.ruds) rd.rotation.y = b.rud * 0.8;
    // chariot de grand-écoute et barres franches
    r.car.position.x = clamp(b.trav, -1, 1) * ss * HW(TRAV_T) * 0.6;
    r.tiller.rotation.y = b.rud * 0.8;
    r.skipper.root.visible = !(isMe && pov);
    this.animSkipper(r, b, dt, tack);
    this.updateRopes(r, b, ss, tm, isMe);
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

  /** Caméra de test (gros plans). */
  debugCam: { p: number[]; t: number[] } | null = null;
  private sv = new T.Vector3(); private sv2 = new T.Vector3(); private sv3 = new T.Vector3(); private sq = new T.Quaternion();
  /** Point du pont (coordonnées du bateau) → monde. */
  private toWorld(r: Rec, x: number, y: number, z: number, out: T.Vector3): T.Vector3 { return r.roll.localToWorld(out.set(x, y, z)); }

  /**
   * Skipper : à la barre côté au vent, une main sur le stick ; au virement il traverse en se baissant sous la bôme,
   * puis mouline sur le winch sous le vent ; quand il règle le foc il reprend le bout à pleines mains ;
   * pendant un changement de voile il mouline à la colonne. Il compense la gîte et regarde autour de lui.
   */
  private animSkipper(r: Rec, b: Boat, dt: number, tack: number): void {
    const k = r.sk, S = r.skipper, tm = this.rt;
    // réglages en cours ?
    if (k.lastHead >= 0) {
      // seuls les réglages francs comptent (l'assistance fait de petites retouches en permanence)
      const vh = Math.abs(b.headSheet - k.lastHead) / Math.max(dt, 1e-3), vm = Math.abs(b.mainSheet - k.lastMain) / Math.max(dt, 1e-3);
      if (vh > 0.08) k.trimT = 1.4; else k.trimT = Math.max(0, k.trimT - dt);
      if (vm > 0.06) k.mainT = 1; else k.mainT = Math.max(0, k.mainT - dt);
    }
    k.lastHead = b.headSheet; k.lastMain = b.mainSheet;
    if (!k.tack) k.tack = tack;
    if (tack !== k.tack) { k.tack = tack; k.mode = 'grind'; k.timer = 3.8; }
    if (b.task) k.mode = 'pedestal';
    else if (k.mode === 'pedestal') k.mode = 'helm';
    if (k.mode === 'grind') { k.timer -= dt; if (k.timer <= 0) k.mode = k.trimT > 0 ? 'trim' : 'helm'; }
    else if (k.mode === 'helm' && k.trimT > 0.9 && b.headPow > 0.5) k.mode = 'trim';
    else if (k.mode === 'trim' && k.trimT <= 0) k.mode = 'helm';
    // où il va
    const tx = k.mode === 'helm' ? -tack * 1.55 : k.mode === 'pedestal' ? 0 : tack * 1.3;
    const tt = k.mode === 'helm' ? 0.905 : k.mode === 'pedestal' ? 0.835 : 0.84;
    const dx = tx - k.x, dz = (tt - k.t) * 18.28, d = Math.hypot(dx, dz), walking = d > 0.08;
    if (walking) { const f = Math.min(1, 2.6 * dt / d); k.x += dx * f; k.t += (tt - k.t) * f; k.walk += dt * 10; }
    const yawT = walking ? Math.atan2(-dx, -dz) : k.mode === 'helm' ? -tack * 0.35 : k.mode === 'pedestal' ? 0 : -tack * Math.PI / 2;
    k.yaw += norm(yawT - k.yaw) * Math.min(1, dt * 6);
    const ducking = walking && Math.abs(k.x) < 0.9; // passe sous la bôme
    const hd = r.heel / D, hike = k.mode === 'helm' ? clamp((hd - 12) / 20, 0, 1) : 0;
    S.root.position.set(k.x, deckY(k.t, clamp(k.x / HW(k.t), -1, 1)), HZ(k.t));
    S.root.rotation.set(-(r.roll.rotation.x) * 0.6, k.yaw, tack * r.heel * 0.75, 'YXZ');
    // mains
    const W = (x: number, y: number, z: number, o: T.Vector3) => this.toWorld(r, x, y, z, o);
    let hL: T.Vector3 | null = null, hR: T.Vector3 | null = null, bend = 0.1, crouch = 0.25, look = 0;
    for (const h of r.handles) h.visible = false;
    r.tailHand = null;
    if (b.knock > 0) { crouch = 0.9; hL = W(k.x - 0.3, deckY(k.t, 0.9) + 0.55, HZ(k.t) - 0.2, this.sv); hR = W(k.x + 0.3, deckY(k.t, 0.9) + 0.55, HZ(k.t) - 0.2, this.sv2); }
    else if (walking) { crouch = ducking ? 0.75 : 0.2; bend = ducking ? 0.5 : 0.15; }
    else if (k.mode === 'helm') {
      // le stick part du bout de la barre vers la main du skipper
      r.tillerExt.getWorldPosition(this.sv3);
      const grip = W(k.x + tack * 0.42, S.root.position.y + 0.92 - 0.25 * hike, HZ(k.t) + 0.05, this.sv);
      const dir = this.sv2.copy(grip).sub(this.sv3), len = dir.length(); dir.normalize();
      const tillerQ = r.tillerExt.parent!.getWorldQuaternion(this.sq).invert();
      r.tillerExt.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().applyQuaternion(tillerQ));
      grip.copy(this.sv3).addScaledVector(dir, Math.min(len, EXT_L - 0.06));
      const inboard = tack > 0 ? 'R' : 'L';
      // l'autre main : l'écoute de grand-voile (elle tire quand on borde), sinon sur la filière
      const pull = k.mainT > 0 ? Math.sin(tm * 9) * 0.18 : 0;
      const other = W(k.x - tack * 0.35, S.root.position.y + 0.75 + pull * 0.5, HZ(k.t) - 0.25 + pull, this.sv2);
      if (inboard === 'R') { hR = grip; hL = other; } else { hL = grip; hR = other; }
      crouch = 0.3 + hike * 0.4; bend = 0.05; look = -tack * 0.25 + Math.sin(tm * 0.31) * 0.45 + Math.sin(tm * 0.13) * 0.2;
    } else if (k.mode === 'grind') {
      // manivelle sur le winch sous le vent
      const side = tack > 0 ? 1 : 0, h = r.handles[side]; h.visible = true;
      k.crank += dt * 7; h.rotation.y = k.crank;
      for (const w of r.winches) if (w.i === 0 && w.sx === tack) w.g.rotation.y += dt * 3;
      h.children[1].getWorldPosition(this.sv); hL = this.sv; hR = this.sv2.copy(this.sv).add(this.sv3.set(0, 0.05, 0));
      crouch = 0.35; bend = 0.55; look = 0;
    } else if (k.mode === 'trim') {
      // il reprend le bout : les mains alternent entre le winch et le corps
      const wp = WINCHES[0], wx = tack * wp.x, wy = deckY(wp.t, wp.x / HW(wp.t)) + 0.4, wz = HZ(wp.t);
      const ph = tm * 6, a = (Math.sin(ph) + 1) / 2, c = (Math.sin(ph + Math.PI) + 1) / 2;
      hL = W(wx + (k.x - wx) * a * 0.7, wy + 0.1 - a * 0.25, wz + 0.1, this.sv);
      hR = W(wx + (k.x - wx) * c * 0.7, wy + 0.1 - c * 0.25, wz - 0.1, this.sv2);
      for (const w of r.winches) if (w.i === 0 && w.sx === tack) w.g.rotation.y += dt * 2;
      r.tailHand = new T.Vector3(wx + (k.x - wx) * 0.6, wy - 0.15, wz);
      crouch = 0.3; bend = 0.45;
    } else {
      // colonne de moulin à café
      r.pedCrank.rotation.x -= dt * 6;
      r.pedCrank.children[1].getWorldPosition(this.sv); r.pedCrank.children[3].getWorldPosition(this.sv2);
      hL = this.sv; hR = this.sv2; crouch = 0.25; bend = 0.6;
    }
    S.update({ handL: hL, handR: hR, lean: tack * hike * 0.35, bend, crouch, walk: walking ? k.walk : null, look, t: tm });
  }

  private ropeMats: { lee: T.MeshStandardMaterial; wind: T.MeshStandardMaterial; main: T.MeshStandardMaterial } | null = null;

  /** Cordages 3D du bateau du joueur, et lumière sous la casquette. */
  private makeTubes(r: Rec): NonNullable<Rec['tubes']> {
    if (!this.ropeMats) this.ropeMats = {
      lee: new T.MeshStandardMaterial({ map: braidTex('#ff6a1f', '#ffd0a8'), roughness: 0.8 }),
      wind: new T.MeshStandardMaterial({ map: braidTex('#2f7de1', '#bcd8ff'), roughness: 0.8 }),
      main: new T.MeshStandardMaterial({ map: braidTex('#f2f2ee', '#3a4a5a'), roughness: 0.8 }),
    };
    const lee = new Rope(170, 0.016, this.ropeMats.lee), wind = new Rope(150, 0.014, this.ropeMats.wind), main = new Rope(110, 0.014, this.ropeMats.main);
    r.roll.add(lee.mesh, wind.mesh, main.mesh);
    const light = new T.PointLight('#dff0ff', 2.2, 6, 1.5); light.position.set(0, deckY(0.76, 0) + 1.25, HZ(0.76)); r.roll.add(light);
    return { lee, wind, main, light, lastHead: -1, lastMain: -1, lastLee: 0 };
  }

  /**
   * Écoutes de voile d'avant (bordée sous le vent, molle au vent qui faseye), grand-écoute en palan.
   * Une seule polyligne par cordage : point d'écoute → poulie de renvoi → tours sur le winch → mou lové dans le cockpit.
   */
  private updateRopes(r: Rec, b: Boat, ss: number, tm: number, detailed: boolean): void {
    const lee = ss >= 0 ? 1 : -1, wp = WINCHES[0], aws = b.aws;
    const winch = (sx: number) => { const t = wp.t, x = sx * wp.x; return [x, deckY(t, x / HW(t)), HZ(t)]; };
    const curve = (out: number[][], a: number[], c: number[], sag: number, k: number, flut = 0, floorY = -9) => {
      for (let i = 1; i <= k; i++) {
        const u = i / k, w = 4 * u * (1 - u);
        let y = a[1] + (c[1] - a[1]) * u - sag * w;
        const fx = flut ? Math.sin(tm * 7 + u * 9) * flut * w : 0, fy = flut ? Math.cos(tm * 5.3 + u * 7) * flut * 0.6 * w : 0;
        y = Math.max(y + fy, floorY);
        out.push([a[0] + (c[0] - a[0]) * u + fx, y, a[2] + (c[2] - a[2]) * u]);
      }
    };
    const wrap = (out: number[][], c: number[], rad: number, turns: number, dir: number) => {
      const steps = Math.round(turns * 16), a0 = dir > 0 ? Math.PI : 0;
      for (let i = 0; i <= steps; i++) { const a = a0 + dir * i / 16 * Math.PI * 2; out.push([c[0] + Math.cos(a) * rad, c[1] + 0.1 + i / steps * 0.16, c[2] + Math.sin(a) * rad]); }
    };
    const coil = (out: number[][], c: number[], turns: number) => {
      const steps = Math.round(turns * 14);
      for (let i = 0; i <= steps; i++) { const a = i / 14 * Math.PI * 2, rr = 0.24 - 0.12 * i / steps; out.push([c[0] + Math.cos(a) * rr, c[1] + 0.02 + i * 0.002, c[2] + Math.sin(a) * rr]); }
    };
    const jibLee: number[][] = [], jibWind: number[][] = [];
    if (b.headPow > 0.05) {
      const id = b.cls.heads[b.head].id, big = id === 'C0' || id === 'A3', lt = big ? 0.72 : 0.5;
      const lead = (sx: number) => [sx * HW(lt) * (big ? 0.96 : 0.8), deckY(lt, big ? 0.96 : 0.8) + 0.1, HZ(lt)];
      const clew = [r.clew.x, r.clew.y, r.clew.z];
      // écoute bordée : légère vibration sous la tension
      const vib = Math.min(0.02, aws * 0.0008);
      const Ll = lead(lee), Wl = winch(lee);
      jibLee.push(clew); curve(jibLee, clew, Ll, 0.04, 12, vib);
      curve(jibLee, Ll, [Wl[0] - lee * wp.r, Wl[1] + 0.1, Wl[2]], 0.02, 8);
      wrap(jibLee, Wl, wp.r + 0.018, 3, lee);
      const tailFloor = deckY(0.85, 0.35), cp = [lee * 0.75, tailFloor, HZ(0.87)];
      curve(jibLee, jibLee[jibLee.length - 1], cp, 0.1, 8, 0, tailFloor + 0.02);
      coil(jibLee, cp, 2.5);
      // écoute au vent : molle, elle faseye dans le vent apparent
      const flap = 0.08 + Math.min(0.35, aws * 0.012);
      const Lw = lead(-lee), Ww = winch(-lee);
      jibWind.push(clew); curve(jibWind, clew, Lw, 1.4, 22, flap, deckY(0.3, 0) - 0.35);
      curve(jibWind, Lw, [Ww[0] + lee * wp.r, Ww[1] + 0.1, Ww[2]], 0.18, 8, flap * 0.3);
      wrap(jibWind, Ww, wp.r + 0.016, 1, -lee);
      const cw = [-lee * 0.8, deckY(0.87, 0.4), HZ(0.9)];
      curve(jibWind, jibWind[jibWind.length - 1], cw, 0.1, 6, 0, cw[1] + 0.02); coil(jibWind, cw, 1.5);
    }
    // grand-écoute : palan à 4 brins entre le bout de bôme et le chariot, puis vers la colonne
    const main: number[][] = [];
    {
      const ba = r.boomG.rotation.y, bp = r.boomG.position;
      const be = [bp.x + Math.sin(ba) * 6.6, bp.y - 0.2, bp.z + Math.cos(ba) * 6.6];
      const car = r.car.position, cp = [car.x, car.y + 0.06, car.z];
      for (let i = 0; i < 4; i++) { const o = (i - 1.5) * 0.05, top = [be[0] + o, be[1], be[2]], bot = [cp[0] + o, cp[1], cp[2]]; main.push(i % 2 ? bot : top, i % 2 ? top : bot); }
      curve(main, main[main.length - 1], [0, deckY(0.8, 0) + 0.95, HZ(0.8)], 0.35, 10);
    }
    if (detailed) {
      const T2 = r.tubes ?? (r.tubes = this.makeTubes(r));
      T2.lee.update(jibLee); T2.wind.update(jibWind); T2.main.update(main);
      // le cordage défile quand on borde ou choque, le winch tourne
      const M = this.ropeMats!;
      if (T2.lastHead >= 0) {
        const dh = b.headSheet - T2.lastHead, dm = b.mainSheet - T2.lastMain;
        (M.lee.map as T.Texture).offset.x -= dh * 60; (M.main.map as T.Texture).offset.x -= dm * 40;
        for (const w of r.winches) if (w.i === 0 && w.sx === lee) w.g.rotation.y += dh * 25;
      }
      if (T2.lastLee !== lee) T2.lastLee = lee;
      T2.lastHead = b.headSheet; T2.lastMain = b.mainSheet;
      r.ropes.visible = false;
      return;
    }
    // bateaux lointains : simples traits
    const P = r.ropePos, Cc = r.ropeCol, max = P.length / 6; let n = 0;
    const strip = (pts: number[][], col: number[]) => { for (let i = 1; i < pts.length && n < max; i++) { P.set(pts[i - 1], n * 6); P.set(pts[i], n * 6 + 3); Cc.set(col, n * 6); Cc.set(col, n * 6 + 3); n++; } };
    strip(jibLee, [1, 0.45, 0.15]); strip(jibWind, [0.25, 0.55, 1]); strip(main, [0.92, 0.92, 0.88]);
    r.ropes.geometry.setDrawRange(0, n * 2);
    r.ropes.geometry.attributes.position.needsUpdate = true; r.ropes.geometry.attributes.color.needsUpdate = true;
  }

  resize(w: number, h: number): void {
    this.ren.setSize(w, h, false);
    this.cam.aspect = w / Math.max(1, h); this.cam.updateProjectionMatrix();
  }

  render(g: Game, boats: Boat[], me: Boat, dt: number, rt: number, view: 'pov' | 'chase' | 'tv'): void {
    this.rt = rt; this.amp = g.waveAmp;
    (this.wU.rot.value as T.Vector2).set(SWELL.c, SWELL.s);
    this.wU.chop.value = clamp(0.35 + me.tws / 16, 0.35, 2.2);
    if (g.venue.id !== this.venueId) this.setVenue(g);
    if (g.sky !== this.skyId) this.setSky(g.sky);
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
    this.decor.update(g, boats, me, dt, rt, this.amp);
    this.updateWeather(g, dt);
    for (const r of this.boats3.values()) r.navG.visible = this.night;
    if (this.night) {
      for (const bm of this.beams) bm.g.rotation.y = tm * 0.9 + bm.ph;
      for (const o of [...this.marks3, this.pin3]) { const fl = o.userData.flash as T.Sprite | undefined; if (fl) fl.visible = ((tm + o.position.x * 0.01) % 2.5) < 0.35; }
    } else for (const o of [...this.marks3, this.pin3]) { const fl = o.userData.flash as T.Sprite | undefined; if (fl) fl.visible = false; }
    this.decor.setNight(this.night, tm);
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
    } else if (view === 'tv' && mr) {
      this.tvCam(me, mr, dt, kn, tm);
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
    // caméra de test (gros plans) : position et cible dans le repère du bateau
    if (this.debugCam && mr) {
      const dc = this.debugCam;
      cam.position.copy(mr.roll.localToWorld(this.tmp.set(dc.p[0], dc.p[1], dc.p[2])));
      cam.lookAt(mr.roll.localToWorld(this.hw.set(dc.t[0], dc.t[1], dc.t[2])));
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
    this.marks3.forEach((o, i) => { o.position.y = this.wh(o.position.x, o.position.z) * 0.8 - 0.2; o.rotation.z = Math.sin(tm * 1.3 + i) * 0.06; o.rotation.x = Math.cos(tm * 1.1 + i) * 0.05; });
    this.pin3.position.y = this.wh(this.pin3.position.x, 0) * 0.8 - 0.2;
    for (const t of this.towers) { t.position.y = this.wh(t.position.x, t.position.z) * 0.8 - 0.2; t.rotation.z = Math.sin(tm * 1.1 + t.position.x) * 0.05; }
    this.floats.update((x, z) => this.wh(x, z), 1);
    this.cb.position.y = this.wh(this.cb.position.x, 0) * 0.5; this.cb.rotation.z = Math.sin(tm * 0.9) * 0.03;
    const nm = !g.demo && !me.ocs && me.leg >= 1 && me.leg <= g.course.marks.length ? g.course.marks[me.leg - 1] : null;
    this.ring.visible = !!nm && nm.island == null;
    this.updateMarkers(g, nm, tm);
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

  /** Plan d'eau : îles, eau, décor. */
  private setVenue(g: Game): void {
    this.venueId = g.venue.id;
    for (const c of [...this.islG.children]) { this.islG.remove(c); c.traverse(o => { const m = o as T.Mesh; if (m.geometry) m.geometry.dispose(); }); }
    ISLANDS.forEach(isl => this.islG.add(this.mkIsland(isl)));
    const arr = this.wU.isl.value as T.Vector4[];
    arr.forEach((v, i) => { const isl = ISLANDS[i]; if (isl) v.set(isl.x, isl.y, isl.r, isl.seed); else v.set(1e7, 1e7, 1, 0); });
    this.wU.nIsl.value = Math.min(16, ISLANDS.length);
    (this.wU.deepC.value as T.Vector3).set(...g.venue.water);
    this.decor.setVenue(g.venue);
    this.markGame = null; this.arcKey = '';
  }

  /** Ciel : couleurs, brume, soleil, nuages, reflets. */
  private setSky(id: string): void {
    this.skyId = id;
    const P: Record<string, { top: string; hor: string; sun: number[]; sunCol: string; sunI: number; hemi: number; near: number; far: number; cloud: string; cloudOp: number; lo: number[]; hi: number[]; rain: number }> = {
      soleil: { top: '#2569ad', hor: '#c6dbe8', sun: [-0.45, 0.42, -0.78], sunCol: '#fff1d6', sunI: 0.9, hemi: 0.75, near: 2500, far: 14000, cloud: '#ffffff', cloudOp: 1, lo: [0.76, 0.86, 0.92], hi: [0.3, 0.53, 0.78], rain: 0 },
      nuageux: { top: '#56789a', hor: '#c3ced7', sun: [-0.45, 0.5, -0.78], sunCol: '#f2f0ea', sunI: 0.55, hemi: 0.85, near: 2000, far: 11000, cloud: '#e6eaee', cloudOp: 1.5, lo: [0.72, 0.78, 0.83], hi: [0.42, 0.52, 0.62], rain: 0 },
      pluie: { top: '#47525c', hor: '#8e9aa4', sun: [-0.45, 0.6, -0.78], sunCol: '#d9dde0', sunI: 0.28, hemi: 0.8, near: 500, far: 5200, cloud: '#7d8892', cloudOp: 1.8, lo: [0.56, 0.61, 0.66], hi: [0.36, 0.41, 0.46], rain: 1 },
      brume: { top: '#a3b5c1', hor: '#dbe2e6', sun: [-0.45, 0.45, -0.78], sunCol: '#f5f3ee', sunI: 0.45, hemi: 0.9, near: 120, far: 2300, cloud: '#ffffff', cloudOp: 0.3, lo: [0.82, 0.86, 0.88], hi: [0.7, 0.76, 0.8], rain: 0 },
      nuit: { top: '#04081a', hor: '#0b1628', sun: [0.35, 0.5, -0.8], sunCol: '#9fb6e8', sunI: 0.2, hemi: 0.12, near: 400, far: 7000, cloud: '#1b2438', cloudOp: 0.7, lo: [0.06, 0.08, 0.14], hi: [0.02, 0.03, 0.08], rain: 0 },
      couchant: { top: '#283a6e', hor: '#f2a463', sun: [-0.3, 0.07, -0.95], sunCol: '#ffae6b', sunI: 0.95, hemi: 0.5, near: 2200, far: 12500, cloud: '#ffc2a0', cloudOp: 1.2, lo: [0.98, 0.66, 0.45], hi: [0.42, 0.42, 0.62], rain: 0 },
    };
    const p = P[id] ?? P.soleil;
    this.skyTop.set(p.top); this.FOG.set(p.hor); (this.scene.fog as T.Fog).color.set(p.hor);
    this.sunDir.set(p.sun[0], p.sun[1], p.sun[2]).normalize();
    this.sun.color.set(p.sunCol);
    this.sky = { near: p.near, far: p.far, sun: p.sunI, hemi: p.hemi, rain: p.rain };
    this.hemi.color.set(id === 'couchant' ? '#ffd2b0' : id === 'nuit' ? '#5a6f9a' : '#e4f3ff');
    this.night = id === 'nuit';
    this.foamLum.setRGB(...((this.night ? [0.22, 0.28, 0.36] : id === 'pluie' ? [0.7, 0.74, 0.78] : id === 'couchant' ? [1, 0.88, 0.8] : [0.95, 0.97, 1]) as [number, number, number]));
    this.glow.set(this.night ? '#cfdcff' : id === 'couchant' ? '#ffb070' : '#ffe1a6');
    this.amb.intensity = (this.night ? 0.05 : 0.25) * Math.PI;
    this.stars.visible = this.night;
    for (const bm of this.beams) bm.g.visible = this.night;
    for (const c of this.clouds) { (c.sp.material as T.SpriteMaterial).color.set(p.cloud); c.sp.material.opacity = Math.min(1, c.op * p.cloudOp); }
    (this.wU.skyLo.value as T.Vector3).set(p.lo[0], p.lo[1], p.lo[2]); (this.wU.skyHi.value as T.Vector3).set(p.hi[0], p.hi[1], p.hi[2]);
    const pm = new T.PMREMGenerator(this.ren);
    this.scene.environment?.dispose(); this.scene.environment = pm.fromScene(this.envScene, 0.02).texture; pm.dispose();
  }

  /** Pluie (ciel « pluie » ou grain qui passe) : traînées, brume plus dense, lumière plus terne. */
  private updateWeather(g: Game, dt: number): void {
    const cam = this.cam.position, sq = g.wind.squall(cam.x, cam.z, g.t);
    const target = Math.max(this.sky.rain, sq);
    this.rainAmt += (target - this.rainAmt) * Math.min(1, dt * 0.8);
    const r = this.rainAmt, fog = this.scene.fog as T.Fog;
    fog.near = this.sky.near * (1 - 0.75 * r); fog.far = this.sky.far * (1 - 0.6 * r);
    this.sun.intensity = this.sky.sun * Math.PI * (1 - 0.6 * r);
    this.hemi.intensity = this.sky.hemi * Math.PI * (1 - 0.2 * r);
    this.rain.visible = r > 0.05;
    if (this.rain.visible) {
      const P = this.rainPos, n = P.length / 6, wx = -Math.sin(g.wd) * 0.35, wz = Math.cos(g.wd) * 0.35, fall = 28 * dt;
      for (let i = 0; i < n; i++) {
        const o = i * 6; let x = P[o], y = P[o + 1], z = P[o + 2];
        y -= fall; x += wx * fall; z += wz * fall;
        if (y < 0 || Math.abs(x) > 60 || Math.abs(z) > 60) { x = (Math.random() - 0.5) * 120; y = 40 + Math.random() * 20; z = (Math.random() - 0.5) * 120; }
        P[o] = x; P[o + 1] = y; P[o + 2] = z; P[o + 3] = x - wx * 1.5; P[o + 4] = y + 1.6; P[o + 5] = z - wz * 1.5;
      }
      this.rain.position.set(cam.x, cam.y - 25, cam.z);
      this.rain.geometry.attributes.position.needsUpdate = true;
      (this.rain.material as T.LineBasicMaterial).opacity = 0.2 + 0.4 * r;
    }
  }

  /** Repères visuels de la prochaine marque (et drapeaux qui flottent). */
  private updateMarkers(g: Game, nm: Game['course']['marks'][number] | null, tm: number): void {
    for (const o of this.marks3) { const fl = o.userData.flag as T.Mesh | undefined; if (fl) { fl.rotation.y = Math.sin(tm * 4 + o.position.x) * 0.35 - g.wd; } }
    const show = !!nm;
    this.beam.visible = this.chevron.visible = show;
    for (const a of this.arcArrows) a.visible = show;
    if (!nm) return;
    const isl = nm.island != null, base = isl ? nm.wp[1] : nm;
    this.beam.position.set(base.x, 70, base.y); this.beam.material.uniforms.t.value = tm;
    this.chevron.position.set(base.x, (isl ? 60 : 22) + Math.sin(tm * 2.5) * 1.5, base.y); this.chevron.rotation.y = tm * 1.5;
    this.chevron.scale.setScalar(isl ? 4 : 1);
    // arc de contournement : approche → extérieur → sortie, dans le sens où il faut tourner
    const key = g.course.id + ':' + nm.name + nm.x;
    if (key !== this.arcKey) {
      this.arcKey = key; this.arcPts = [];
      const R = isl ? Math.hypot(nm.wp[1].x - nm.x, nm.wp[1].y - nm.y) : 40;
      const ang = nm.wp.map(w => Math.atan2(w.y - nm.y, w.x - nm.x));
      const d1 = norm(ang[1] - ang[0]), d2 = norm(ang[2] - ang[1]), total = d1 + d2, n = this.arcArrows.length;
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n * total, a = ang[0] + f, dir = Math.sign(total) || 1;
        const x = nm.x + Math.cos(a) * R, z = nm.y + Math.sin(a) * R;
        const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir; // tangente dans le sens du contournement
        this.arcPts.push({ x, z, h: Math.atan2(tx, -tz) });
      }
    }
    const sc = isl ? 7 : 2.4;
    this.arcArrows.forEach((m, i) => {
      const p = this.arcPts[i]; m.position.set(p.x, this.wh(p.x, p.z) * 0.8 + 0.5, p.z); m.rotation.y = -p.h; m.scale.setScalar(sc);
      const ph = ((tm * 0.9 - i / this.arcArrows.length) % 1 + 1) % 1;
      m.material.opacity = 0.25 + 0.75 * Math.pow(1 - ph, 3);
    });
  }

  /** Projection monde → écran (pixels CSS), pour les marqueurs de l'interface. */
  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number; behind: boolean } {
    const v = this.projV.set(x, y, z).project(this.cam);
    return { x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h, behind: v.z > 1 };
  }

  /** Plan TV en cours. */
  private tv = { shot: '', t: 0, subj: -1, p: new T.Vector3(), a: 0 };
  /** Le dernier plan TV, pour l'afficher (« Caméra hélico »…). */
  tvLabel = '';

  /**
   * Caméra TV : plans automatiques comme une retransmission, avec un changement de plan toutes les 5 à 8 s
   * (hélicoptère, caméra posée sur l'eau, travelling latéral, tête de mât, caméra embarquée).
   */
  private tvCam(me: Boat, mr: Rec, dt: number, kn: number, tm: number): void {
    const cam = this.cam, tv = this.tv;
    tv.t -= dt;
    const fx = Math.sin(me.h), fz = -Math.cos(me.h), sx = -fz, sz = fx;
    if (tv.t <= 0 || tv.subj !== me.id) {
      const shots = ['heli', 'water', 'side', 'mast', 'stern', 'heli', 'water'].filter(x => x !== tv.shot);
      tv.shot = shots[Math.floor(Math.random() * shots.length)];
      tv.t = 5 + Math.random() * 3; tv.subj = me.id; tv.a = Math.random() * Math.PI * 2;
      const side = Math.random() < 0.5 ? 1 : -1;
      // caméra posée sur l'eau, devant le bateau : il passe devant elle
      tv.p.set(me.x + fx * (40 + kn * 2.2) + sx * side * 16, 1.6, me.y + fz * (40 + kn * 2.2) + sz * side * 16);
      tv.a = side;
      this.tvLabel = ({ heli: 'Caméra hélico', water: 'Caméra au ras de l\'eau', side: 'Travelling', mast: 'Caméra tête de mât', stern: 'Caméra embarquée' } as Record<string, string>)[tv.shot];
    }
    const look = this.tmp2.set(me.x, 6, me.y);
    switch (tv.shot) {
      case 'heli': {
        tv.a += dt * 0.12;
        cam.position.set(me.x + Math.cos(tv.a) * 95, 38 + Math.sin(tm * 0.3) * 3, me.y + Math.sin(tv.a) * 95);
        cam.lookAt(look); this.setFov(36, 1); break;
      }
      case 'water': {
        cam.position.copy(tv.p); cam.position.y = 1.2 + this.wh(tv.p.x, tv.p.z) * 0.8;
        cam.lookAt(look.set(me.x, 7, me.y)); this.setFov(clamp(28 + Math.hypot(me.x - tv.p.x, me.y - tv.p.z) * 0.25, 28, 60), 1); break;
      }
      case 'side': {
        const tx = me.x + sx * tv.a * 30 - fx * 6, tz = me.y + sz * tv.a * 30 - fz * 6;
        cam.position.lerp(this.tmp.set(tx, 4.5, tz), Math.min(1, dt * 2)); if (cam.position.distanceTo(this.tmp) > 60) cam.position.copy(this.tmp);
        cam.lookAt(look.set(me.x + fx * 3, 5, me.y + fz * 3)); this.setFov(45, 1); break;
      }
      case 'mast': {
        mr.yaw.updateMatrixWorld(true);
        cam.position.copy(mr.roll.localToWorld(this.tmp.set(0.6, DECK + 27, MAST_Z + 1.2)));
        cam.lookAt(mr.roll.localToWorld(look.set(0, 0.5, HZ(0.8)))); this.setFov(62, 1); break;
      }
      default: { // embarquée, derrière le skipper
        mr.yaw.updateMatrixWorld(true);
        cam.position.copy(mr.roll.localToWorld(this.tmp.set(0.4, deckY(0.99, 0) + 2.6, HZ(1) + 1.4)));
        cam.lookAt(mr.roll.localToWorld(look.set(0, 5, HZ(0.35)))); this.setFov(68, 1); break;
      }
    }
  }
  private tmp2 = new T.Vector3();

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
