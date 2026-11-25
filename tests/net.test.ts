import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';
// @ts-expect-error module JS du serveur
import { startServer } from '../server/server.mjs';

let srv: { port: number; close(): void };
beforeAll(async () => { srv = await startServer({ port: 0, log: () => {} }); });
afterAll(() => srv.close());

/** Client simulé : garde tous les messages reçus. */
async function client(name: string) {
  const ws = new WebSocket(`ws://localhost:${srv.port}/ws`), msgs: any[] = [];
  ws.on('message', d => msgs.push(JSON.parse(String(d))));
  await new Promise(r => ws.on('open', r));
  const send = (o: object) => ws.send(JSON.stringify(o));
  send({ type: 'hello', name });
  const wait = async (type: string, pred: (m: any) => boolean = () => true, ms = 3000) => {
    const t0 = Date.now();
    for (;;) { const m = msgs.find(x => x.type === type && pred(x)); if (m) { msgs.splice(msgs.indexOf(m), 1); return m; } if (Date.now() - t0 > ms) throw new Error(name + ' : pas de ' + type); await new Promise(r => setTimeout(r, 10)); }
  };
  const last = (type: string) => [...msgs].reverse().find(x => x.type === type);
  return { ws, msgs, send, wait, last, close: () => ws.close() };
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('serveur multijoueur', () => {
  it('sert la page du jeu et répond au test de santé', async () => {
    const h = await fetch(`http://localhost:${srv.port}/sante`); expect(await h.text()).toBe('ok');
    const r = await fetch(`http://localhost:${srv.port}/`); expect([200, 404]).toContain(r.status); // 404 tant que le jeu n'est pas construit
    const bad = await fetch(`http://localhost:${srv.port}/../../etc/passwd`); expect(bad.status).not.toBe(500);
  });

  it('salon privé à 3 : code, réglages, départ commun, positions, arrivées, classement', async () => {
    const a = await client('Alice'), b = await client('Bob'), c = await client('Chloé');
    a.send({ type: 'create', public: false });
    const room = await a.wait('room');
    expect(room.code).toMatch(/^[A-Z]{4}$/);
    b.send({ type: 'join', code: room.code.toLowerCase() }); c.send({ type: 'join', code: room.code });
    const full = await a.wait('room', m => m.players.length === 3);
    expect(new Set(full.players.map((p: any) => p.col)).size).toBe(3); // couleurs différentes
    // seul l'hôte peut régler et lancer
    b.send({ type: 'settings', settings: { venue: 'lac' } }); await sleep(100);
    expect(a.last('room').settings.venue).toBe('baie');
    a.send({ type: 'settings', settings: { venue: 'lac', course: 'sprint-lac', met: 4, sky: 'pluie', pace: 3 } });
    await b.wait('room', m => m.settings.venue === 'lac' && m.settings.met === 4);
    b.send({ type: 'start' }); await sleep(100); expect(b.msgs.find(m => m.type === 'start')).toBeUndefined();
    a.send({ type: 'start' });
    const [sa, sb, sc] = await Promise.all([a.wait('start'), b.wait('start'), c.wait('start')]);
    expect(sa.seed).toBe(sb.seed); expect(sa.gunAt).toBe(sc.gunAt); expect(sb.settings.course).toBe('sprint-lac');
    // pendant la course, un nouveau venu la rejoint en route
    const d = await client('Dan'); d.send({ type: 'join', code: room.code });
    const late = await d.wait('start'); expect(late.late).toBe(true); expect(late.seed).toBe(sa.seed);
    d.close(); await a.wait('room', m => m.players.length === 3);
    // positions rediffusées
    a.send({ type: 'state', s: [10, 20, 0.5, 7], leg: 1, d: 900 }); b.send({ type: 'state', s: [30, 40, 0.1, 6], leg: 1, d: 950 });
    const st = await c.wait('states', m => m.boats.length === 2);
    expect(st.boats.find((x: any) => x.s[0] === 10)).toBeTruthy();
    // arrivées : chrono du serveur, classement dans l'ordre (on attend le coup de canon : 4 s + 20 s au rythme ×3)
    const wait0 = sa.gunAt - Date.now() + 50; await sleep(Math.max(0, wait0));
    b.send({ type: 'finish' }); await sleep(120); a.send({ type: 'finish' });
    const res = await c.wait('results', m => m.list.filter((x: any) => x.fin != null).length === 2);
    expect(res.list[0].name).toBe('Bob'); expect(res.list[1].name).toBe('Alice'); expect(res.list[2].fin).toBeNull();
    expect(res.list[1].fin).toBeGreaterThan(res.list[0].fin);
    // le dernier arrive : fin de course, retour au salon
    c.send({ type: 'finish' });
    const fin = await a.wait('results', m => m.final);
    expect(fin.list.map((x: any) => x.name)).toEqual(['Bob', 'Alice', 'Chloé']);
    await a.wait('room', m => m.phase === 'lobby');
    // l'hôte s'en va : un autre joueur devient hôte
    b.msgs.length = 0;
    a.close();
    const after = await b.wait('room', m => m.players.length === 2);
    expect(after.host).not.toBe(room.host);
    [b, c, d].forEach(x => x.close());
  }, 40000);

  it('partie rapide et liste des salons publics', async () => {
    const a = await client('Eva'), b = await client('Félix');
    a.send({ type: 'quick' }); const r = await a.wait('room'); expect(r.public).toBe(true);
    b.send({ type: 'list' }); const l = await b.wait('rooms');
    expect(l.rooms.some((x: any) => x.code === r.code)).toBe(true);
    b.send({ type: 'quick' }); const r2 = await b.wait('room'); expect(r2.code).toBe(r.code);
    a.close(); b.close();
  });

  it('synchronisation d\'horloge (ping / pong)', async () => {
    const a = await client('Gus'); const t0 = Date.now(); a.send({ type: 'ping', c: t0 });
    const p = await a.wait('pong'); expect(p.c).toBe(t0); expect(Math.abs(p.s - Date.now())).toBeLessThan(1000);
    a.close();
  });
});

describe('partie ouverte « Le Grand Large »', () => {
  let s2: { port: number; close(): void };
  beforeAll(async () => { s2 = await startServer({ port: 0, log: () => {}, autoDelay: 1500 }); });
  afterAll(() => s2.close());
  const cli = async (name: string) => {
    const ws = new WebSocket(`ws://localhost:${s2.port}/ws`), msgs: any[] = [];
    ws.on('message', (d: any) => msgs.push(JSON.parse(String(d)))); await new Promise(r => ws.on('open', r));
    const send = (o: object) => ws.send(JSON.stringify(o)); send({ type: 'hello', name });
    const wait = async (type: string, pred: (m: any) => boolean = () => true) => { const t0 = Date.now(); for (;;) { const m = msgs.find(x => x.type === type && pred(x)); if (m) { msgs.splice(msgs.indexOf(m), 1); return m; } if (Date.now() - t0 > 6000) throw new Error(name + ' : pas de ' + type); await new Promise(r => setTimeout(r, 10)); } };
    return { ws, send, wait, msgs };
  };
  it('toujours là, sans code, départ automatique, réglages imposés, course rejointe en route', async () => {
    const a = await cli('Alice');
    a.send({ type: 'list' }); const l = await a.wait('rooms'); expect(l.rooms[0].permanent).toBe(true);
    a.send({ type: 'open' }); const r = await a.wait('room'); expect(r.permanent).toBe(true); expect(r.host).toBeNull();
    a.send({ type: 'settings', settings: { venue: 'lac' } }); await new Promise(res => setTimeout(res, 150));
    const start = await a.wait('start'); // départ automatique (1,5 s dans ce test)
    expect(start.settings.course).toBeTruthy();
    const b = await cli('Bob'); b.send({ type: 'open' });
    const late = await b.wait('start'); expect(late.late).toBe(true); expect(late.seed).toBe(start.seed);
    // le salon vide n'est jamais fermé
    a.ws.close(); b.ws.close(); await new Promise(res => setTimeout(res, 300));
    const c = await cli('Chloé'); c.send({ type: 'open' }); const r2 = await c.wait('room'); expect(r2.code).toBe(r.code);
    c.ws.close();
  }, 20000);
});

describe('bots dans un salon', () => {
  it('l\'hôte fait naviguer les bots : leurs positions et arrivées sont relayées à tout le monde', async () => {
    const a = await client('Hôte'), b = await client('Pote');
    a.send({ type: 'create', public: false }); const r = await a.wait('room');
    b.send({ type: 'join', code: r.code }); await a.wait('room', m => m.players.length === 2);
    a.send({ type: 'settings', settings: { bots: 3, pre: 30 } }); await b.wait('room', m => m.settings.bots === 3 && m.settings.pre === 30);
    a.send({ type: 'start' });
    const sa = await a.wait('start'), sb = await b.wait('start');
    expect(sa.botHost).toBe(sb.botHost); expect(sa.settings.bots).toBe(3);
    const host = sa.botHost === r.players[0].id ? a : b;
    host.send({ type: 'state', s: [1, 2, 0, 5], leg: 1, d: 900, bots: [1, 2, 3].map(i => ({ i, n: 'Bot' + i, c: '#fff', s: [i * 10, 0, 0, 5], fin: null, leg: 1, d: 1000 + i })) });
    const st = await b.wait('states', m => m.boats.filter((x: any) => x.id.startsWith('bot')).length === 3);
    expect(st.boats.find((x: any) => x.id === 'bot2').n).toBe('Bot2');
    a.close(); b.close();
  }, 20000);
});

