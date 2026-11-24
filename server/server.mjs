// Serveur de « Régate au large » : sert le jeu (dossier dist/) et gère les salons en WebSocket (/ws).
// Le serveur fait autorité sur le chrono, le départ et le classement ; chaque joueur simule son bateau
// et envoie sa position 10 fois par seconde, que le serveur rediffuse aux autres joueurs du salon.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const PRE = 60;                 // compte à rebours (secondes de jeu)
const MAX_PLAYERS = 15;
const COLS = ['#ffd23f', '#e8384f', '#3ddc97', '#b388ff', '#4cc9f0', '#ff8fab', '#f4a261', '#a3e635', '#ffffff', '#1f6feb', '#ff6a1f', '#00b3a4', '#c2185b', '#8d6e63', '#2c3e50'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

/** Courses de la partie ouverte « Le Grand Large » : courtes et variées, tirées à tour de rôle. */
const OPEN_COURSES = [['baie', 'sprint'], ['lac', 'sprint-lac'], ['baie', 'huit'], ['corsaires', 'crique'], ['baie', 'banane'], ['archipel', 'chenal'], ['baie', 'zigzag'], ['lac', 'triangle-lac'], ['corsaires', 'chiens'], ['baie', 'triangle']];
export const OPEN_CODE = 'QUAI';

export function startServer({ port = Number(process.env.PORT) || 8080, dist = resolve('dist'), log = console.log, autoDelay = 45000 } = {}) {
  const rooms = new Map();
  let nextId = 1;
  // ---------- la partie toujours ouverte ----------
  let openTurn = Math.floor(Math.random() * OPEN_COURSES.length);
  const openSettings = () => {
    const [venue, course] = OPEN_COURSES[openTurn++ % OPEN_COURSES.length], rnd = Math.random();
    const met = rnd < 0.2 ? 0 : rnd < 0.65 ? 1 : rnd < 0.85 ? 2 : 4;
    const sky = ['auto', 'auto', 'soleil', 'couchant', 'nuageux', 'nuit'][Math.floor(Math.random() * 6)];
    return { venue, course, met, sky, pace: 3, sea: 'auto', collisions: true, events: true };
  };
  rooms.set(OPEN_CODE, { code: OPEN_CODE, public: true, permanent: true, name: 'Le Grand Large', host: null, phase: 'lobby', players: new Map(),
    settings: openSettings(), seed: 0, gunAt: 0, firstFin: 0, autoAt: 0 });

  // ---------- fichiers du jeu ----------
  const http = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/sante') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return; }
    let p = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!p.startsWith(dist)) { res.writeHead(403); res.end(); return; }
    if (p.endsWith('/') || !extname(p)) p = join(dist, 'index.html');
    try {
      const f = await readFile(p);
      res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream', 'cache-control': p.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000' });
      res.end(f);
    } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Introuvable. As-tu lancé « npm run build » ?'); }
  });

  // ---------- salons ----------
  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });
  const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const code = () => { let c; do { c = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(c)); return c; };
  const roomInfo = r => ({ type: 'room', code: r.code, public: r.public, permanent: !!r.permanent, name: r.name, autoAt: r.autoAt || 0, gunAt: r.gunAt, host: r.host, phase: r.phase, settings: r.settings,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, col: p.col })) });
  const broadcast = (r, o) => { const s = JSON.stringify(o); for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
  const publicList = () => [...rooms.values()].filter(r => r.public).sort((a, b) => (b.permanent ? 1 : 0) - (a.permanent ? 1 : 0)).map(r => ({ code: r.code, name: r.name, players: r.players.size, phase: r.phase, permanent: !!r.permanent, autoAt: r.autoAt || 0 }));
  const raceTime = r => (Date.now() - r.gunAt) * r.settings.pace / 1000;
  const results = r => {
    const L = [...r.players.values()].map(p => ({ id: p.id, name: p.name, col: p.col, fin: p.fin, leg: p.leg, d: p.d, ocs: p.ocs }));
    L.sort((a, b) => (a.fin != null) !== (b.fin != null) ? (a.fin != null ? -1 : 1) : a.fin != null ? a.fin - b.fin : (b.leg - a.leg) || (a.d - b.d));
    return L;
  };

  function leave(c) {
    const r = c.room; if (!r) return;
    r.players.delete(c.id); c.room = null;
    if (r.players.size === 0 && r.permanent) { if (r.phase === 'race') endRace(r); r.autoAt = 0; return; }
    if (r.players.size === 0) {
      // salon vide : on le garde 3 minutes (téléphone en veille, page rechargée…)
      if (r.phase === 'race') endRace(r);
      clearTimeout(r.closeT);
      r.closeT = setTimeout(() => { if (r.players.size === 0) { rooms.delete(r.code); log(`salon ${r.code} fermé`); } }, 3 * 60 * 1000);
      return;
    }
    if (r.host === c.id && !r.permanent) r.host = r.players.keys().next().value;
    broadcast(r, roomInfo(r));
    if (r.phase === 'race' && [...r.players.values()].every(q => q.fin != null)) endRace(r);
  }
  function joinRoom(c, r) {
    if (r.players.size >= MAX_PLAYERS) return send(c.ws, { type: 'error', msg: 'Ce salon est plein (15 joueurs maximum).' });
    leave(c);
    const used = new Set([...r.players.values()].map(p => p.col));
    const col = COLS.find(x => !used.has(x)) || COLS[0];
    clearTimeout(r.closeT);
    if (!r.players.size && !r.permanent) r.host = c.id; // le salon vide revient au premier qui revient
    r.players.set(c.id, { id: c.id, name: c.name, col, ws: c.ws, s: null, leg: 0, d: 1e9, fin: null, ocs: false, seen: Date.now() });
    c.room = r;
    broadcast(r, roomInfo(r));
    // course déjà lancée : le nouveau venu la rejoint en route (il part de la ligne)
    if (r.phase === 'race') send(c.ws, { type: 'start', seed: r.seed, gunAt: r.gunAt, settings: r.settings, players: roomInfo(r).players, late: true });
  }
  function create(c, isPublic) {
    const r = { code: code(), public: !!isPublic, name: 'Salon de ' + c.name, host: c.id, phase: 'lobby', players: new Map(),
      settings: { venue: 'baie', course: 'sprint', met: 1, sky: 'auto', pace: 3, sea: 'auto', collisions: true }, seed: 0, gunAt: 0, firstFin: 0 };
    rooms.set(r.code, r); log(`salon ${r.code} créé par ${c.name}`);
    joinRoom(c, r);
  }
  function endRace(r) {
    r.phase = 'lobby';
    for (const p of r.players.values()) { p.s = null; }
    broadcast(r, { type: 'results', final: true, list: results(r) });
    if (r.permanent) { r.settings = openSettings(); r.autoAt = r.players.size ? Date.now() + autoDelay : 0; }
    broadcast(r, roomInfo(r));
  }
  function startRace(r) {
    r.phase = 'race'; r.seed = Math.random() * 10; r.firstFin = 0; r.autoAt = 0;
    r.gunAt = Date.now() + 4000 + PRE * 1000 / r.settings.pace;
    for (const p of r.players.values()) { p.s = null; p.leg = 0; p.d = 1e9; p.fin = null; p.ocs = false; p.seen = Date.now(); }
    broadcast(r, { type: 'start', seed: r.seed, gunAt: r.gunAt, settings: r.settings, players: roomInfo(r).players });
    broadcast(r, roomInfo(r));
    log(`salon ${r.code} : départ (${r.players.size} joueurs)`);
  }

  wss.on('connection', ws => {
    const c = { id: String(nextId++), name: 'Marin', ws, room: null, alive: true };
    send(ws, { type: 'welcome', id: c.id, t: Date.now() });
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const r = c.room;
      switch (m.type) {
        case 'ping': send(ws, { type: 'pong', c: m.c, s: Date.now() }); break;
        case 'hello': c.name = String(m.name || 'Marin').replace(/[<>]/g, '').trim().slice(0, 14) || 'Marin'; break;
        case 'list': send(ws, { type: 'rooms', rooms: publicList() }); break;
        case 'create': create(c, m.public); break;
        case 'join': { const t = rooms.get(String(m.code || '').toUpperCase().trim()); if (!t) send(ws, { type: 'error', msg: 'Aucun salon avec le code ' + String(m.code || '').toUpperCase().trim() + '. Vérifie les 4 lettres, ou demande à ton pote de créer un nouveau salon.' }); else joinRoom(c, t); break; }
        case 'quick': { const t = rooms.get(OPEN_CODE); if (t.players.size < MAX_PLAYERS) joinRoom(c, t); else create(c, true); break; }
        case 'open': joinRoom(c, rooms.get(OPEN_CODE)); break;
        case 'leave': leave(c); break;
        case 'settings':
          if (r && r.host === c.id && r.phase === 'lobby' && m.settings) {
            const s = m.settings, o = r.settings;
            r.settings = { venue: String(s.venue ?? o.venue).slice(0, 20), course: String(s.course ?? o.course).slice(0, 20), met: Math.max(0, Math.min(4, Number(s.met ?? o.met) | 0)),
              sky: String(s.sky ?? o.sky).slice(0, 12), pace: [1, 2, 3].includes(Number(s.pace)) ? Number(s.pace) : o.pace,
              sea: ['auto', 'plate', 'belle', 'formee', 'grosse'].includes(s.sea) ? s.sea : o.sea, collisions: typeof s.collisions === 'boolean' ? s.collisions : o.collisions, events: typeof s.events === 'boolean' ? s.events : o.events !== false };
            broadcast(r, roomInfo(r));
          }
          break;
        case 'start':
          // partie ouverte : n'importe qui peut donner le départ sans attendre
          if (r && (r.host === c.id || r.permanent) && r.phase === 'lobby') startRace(r);
          break;
        case 'state':
          if (r && r.phase === 'race') {
            const p = r.players.get(c.id); if (!p || !Array.isArray(m.s) || m.s.length > 40) break;
            p.s = m.s.map(Number); p.leg = Number(m.leg) | 0; p.d = Number(m.d) || 0; p.ocs = !!m.ocs; p.seen = Date.now();
          }
          break;
        case 'abort':
          if (r && r.host === c.id && r.phase === 'race') { log(`salon ${r.code} : course arrêtée par l'hôte`); endRace(r); }
          break;
        case 'finish':
          if (r && r.phase === 'race') {
            const p = r.players.get(c.id), t = raceTime(r);
            if (p && p.fin == null && t > 0) {
              p.fin = Math.round(t * 10) / 10; // le chrono officiel est celui du serveur
              if (!r.firstFin) r.firstFin = Date.now();
              broadcast(r, { type: 'results', final: false, list: results(r) });
              if ([...r.players.values()].every(q => q.fin != null)) endRace(r);
            }
          }
          break;
      }
    });
    ws.on('close', () => leave(c));
  });

  // diffusion des positions (10 Hz), fin de course si tout le monde est arrivé ou délai dépassé
  const tick = setInterval(() => {
    for (const r of rooms.values()) {
      // partie ouverte : départ automatique quand il y a du monde au ponton
      if (r.permanent && r.phase === 'lobby') {
        if (!r.players.size) r.autoAt = 0;
        else if (!r.autoAt) { r.autoAt = Date.now() + autoDelay; broadcast(r, roomInfo(r)); }
        else if (Date.now() >= r.autoAt) startRace(r);
      }
      if (r.phase !== 'race') continue;
      const boats = [...r.players.values()].filter(p => p.s).map(p => ({ id: p.id, s: p.s, fin: p.fin }));
      broadcast(r, { type: 'states', t: Date.now(), boats });
      // 10 minutes réelles après le premier arrivé, ou 3 heures de course : on clôt
      // fin : 10 min après le premier arrivé, 3 h de course, ou plus personne ne navigue depuis 2 min
      const idle = [...r.players.values()].every(p => p.fin != null || Date.now() - (p.seen || 0) > 120000);
      if ((r.firstFin && Date.now() - r.firstFin > (r.permanent ? 3 : 10) * 60 * 1000) || raceTime(r) > 3 * 3600 || idle) endRace(r);
    }
  }, 100);
  // connexions mortes
  const alive = setInterval(() => { for (const ws of wss.clients) { if (ws.isDead) { ws.terminate(); continue; } ws.isDead = true; ws.ping(); ws.once('pong', () => { ws.isDead = false; }); } }, 30000);

  return new Promise(res => http.listen(port, () => {
    log(`Régate au large : serveur prêt sur http://localhost:${http.address().port}`);
    res({ port: http.address().port, rooms, close: () => { clearInterval(tick); clearInterval(alive); for (const ws of wss.clients) ws.terminate(); wss.close(); http.close(); } });
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) startServer();
