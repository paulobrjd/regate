// Serveur de « Régate au large » : sert le jeu (dossier dist/) et gère les salons en WebSocket (/ws).
// Le serveur fait autorité sur le chrono, le départ et le classement ; chaque joueur simule son bateau
// et envoie sa position 10 fois par seconde, que le serveur rediffuse aux autres joueurs du salon.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, normalize } from 'node:path';
import { WebSocketServer } from 'ws';

const PRE = 60;                 // compte à rebours (secondes de jeu)
const MAX_PLAYERS = 8;
const COLS = ['#ffd23f', '#e8384f', '#3ddc97', '#b388ff', '#4cc9f0', '#ff8fab', '#f4a261', '#a3e635'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };

export function startServer({ port = Number(process.env.PORT) || 8080, dist = resolve('dist'), log = console.log } = {}) {
  const rooms = new Map();
  let nextId = 1;

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
  const roomInfo = r => ({ type: 'room', code: r.code, public: r.public, host: r.host, phase: r.phase, settings: r.settings,
    players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, col: p.col })) });
  const broadcast = (r, o) => { const s = JSON.stringify(o); for (const p of r.players.values()) if (p.ws.readyState === 1) p.ws.send(s); };
  const publicList = () => [...rooms.values()].filter(r => r.public).map(r => ({ code: r.code, name: r.name, players: r.players.size, phase: r.phase }));
  const raceTime = r => (Date.now() - r.gunAt) * r.settings.pace / 1000;
  const results = r => {
    const L = [...r.players.values()].map(p => ({ id: p.id, name: p.name, col: p.col, fin: p.fin, leg: p.leg, d: p.d, ocs: p.ocs }));
    L.sort((a, b) => (a.fin != null) !== (b.fin != null) ? (a.fin != null ? -1 : 1) : a.fin != null ? a.fin - b.fin : (b.leg - a.leg) || (a.d - b.d));
    return L;
  };

  function leave(c) {
    const r = c.room; if (!r) return;
    r.players.delete(c.id); c.room = null;
    if (r.players.size === 0) { rooms.delete(r.code); log(`salon ${r.code} fermé`); return; }
    if (r.host === c.id) r.host = r.players.keys().next().value;
    broadcast(r, roomInfo(r));
  }
  function joinRoom(c, r) {
    if (r.players.size >= MAX_PLAYERS) return send(c.ws, { type: 'error', msg: 'Ce salon est plein (8 joueurs maximum).' });
    if (r.phase === 'race') return send(c.ws, { type: 'error', msg: 'Une course est en cours dans ce salon : attends l\'arrivée et réessaie.' });
    leave(c);
    const used = new Set([...r.players.values()].map(p => p.col));
    const col = COLS.find(x => !used.has(x)) || COLS[0];
    r.players.set(c.id, { id: c.id, name: c.name, col, ws: c.ws, s: null, leg: 0, d: 1e9, fin: null, ocs: false });
    c.room = r;
    broadcast(r, roomInfo(r));
  }
  function create(c, isPublic) {
    const r = { code: code(), public: !!isPublic, name: 'Salon de ' + c.name, host: c.id, phase: 'lobby', players: new Map(),
      settings: { venue: 'baie', course: 'sprint', met: 1, sky: 'auto', pace: 3 }, seed: 0, gunAt: 0, firstFin: 0 };
    rooms.set(r.code, r); log(`salon ${r.code} créé par ${c.name}`);
    joinRoom(c, r);
  }
  function endRace(r) {
    r.phase = 'lobby';
    for (const p of r.players.values()) { p.s = null; }
    broadcast(r, { type: 'results', final: true, list: results(r) });
    broadcast(r, roomInfo(r));
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
        case 'join': { const t = rooms.get(String(m.code || '').toUpperCase().trim()); if (!t) send(ws, { type: 'error', msg: 'Aucun salon avec ce code.' }); else joinRoom(c, t); break; }
        case 'quick': { const t = [...rooms.values()].find(x => x.public && x.phase === 'lobby' && x.players.size < MAX_PLAYERS); if (t) joinRoom(c, t); else create(c, true); break; }
        case 'leave': leave(c); break;
        case 'settings':
          if (r && r.host === c.id && r.phase === 'lobby' && m.settings) {
            const s = m.settings, o = r.settings;
            r.settings = { venue: String(s.venue ?? o.venue).slice(0, 20), course: String(s.course ?? o.course).slice(0, 20), met: Math.max(0, Math.min(4, Number(s.met ?? o.met) | 0)),
              sky: String(s.sky ?? o.sky).slice(0, 12), pace: [1, 2, 3].includes(Number(s.pace)) ? Number(s.pace) : o.pace };
            broadcast(r, roomInfo(r));
          }
          break;
        case 'start':
          if (r && r.host === c.id && r.phase === 'lobby') {
            r.phase = 'race'; r.seed = Math.random() * 10; r.firstFin = 0;
            r.gunAt = Date.now() + 4000 + PRE * 1000 / r.settings.pace;
            for (const p of r.players.values()) { p.s = null; p.leg = 0; p.d = 1e9; p.fin = null; p.ocs = false; }
            broadcast(r, { type: 'start', seed: r.seed, gunAt: r.gunAt, settings: r.settings, players: roomInfo(r).players });
            broadcast(r, roomInfo(r));
            log(`salon ${r.code} : départ (${r.players.size} joueurs)`);
          }
          break;
        case 'state':
          if (r && r.phase === 'race') {
            const p = r.players.get(c.id); if (!p || !Array.isArray(m.s) || m.s.length > 40) break;
            p.s = m.s.map(Number); p.leg = Number(m.leg) | 0; p.d = Number(m.d) || 0; p.ocs = !!m.ocs;
          }
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
      if (r.phase !== 'race') continue;
      const boats = [...r.players.values()].filter(p => p.s).map(p => ({ id: p.id, s: p.s, fin: p.fin }));
      broadcast(r, { type: 'states', t: Date.now(), boats });
      // 10 minutes réelles après le premier arrivé, ou 3 heures de course : on clôt
      if ((r.firstFin && Date.now() - r.firstFin > 10 * 60 * 1000) || raceTime(r) > 3 * 3600) endRace(r);
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
