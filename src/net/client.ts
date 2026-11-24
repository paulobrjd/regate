// Client multijoueur : connexion WebSocket au serveur, synchronisation d'horloge, messages des salons.
export interface RoomPlayer { id: string; name: string; col: string }
export interface RoomSettings { venue: string; course: string; met: number; sky: string; pace: number; sea?: string; collisions?: boolean }
export interface RoomInfo { code: string; public: boolean; permanent?: boolean; name?: string; autoAt?: number; gunAt?: number; host: string | null; phase: 'lobby' | 'race'; settings: RoomSettings; players: RoomPlayer[] }
export interface StartMsg { seed: number; gunAt: number; settings: RoomSettings; players: RoomPlayer[]; late?: boolean }
export interface ResultRow { id: string; name: string; col: string; fin: number | null; leg: number; d: number; ocs: boolean }
export interface BoatState { id: string; s: number[]; fin: number | null }

export class Net {
  ws: WebSocket | null = null;
  id = '';
  room: RoomInfo | null = null;
  /** Écart d'horloge : heure serveur ≈ Date.now() + offset. */
  private offset = 0; private rtt = 999; private pingT = 0;
  onRoom: (r: RoomInfo | null) => void = () => {};
  onRooms: (l: { code: string; name: string; players: number; phase: string; permanent?: boolean; autoAt?: number }[]) => void = () => {};
  onStart: (m: StartMsg) => void = () => {};
  onStates: (t: number, boats: BoatState[]) => void = () => {};
  onResults: (list: ResultRow[], final: boolean) => void = () => {};
  onError: (msg: string) => void = () => {};
  onClose: () => void = () => {};

  get connected(): boolean { return !!this.ws && this.ws.readyState === 1; }
  serverNow(): number { return Date.now() + this.offset; }

  /** Adresse du serveur : la même que la page (en développement, Vite relaie /ws vers le port 8080). */
  static url(): string {
    const q = new URLSearchParams(location.search).get('serveur');
    if (q) return q;
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  }

  connect(name: string): Promise<void> {
    if (this.connected) { this.send({ type: 'hello', name }); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      let ok = false;
      let ws: WebSocket;
      try { ws = new WebSocket(Net.url()); } catch (e) { reject(e); return; }
      this.ws = ws;
      const timer = setTimeout(() => { if (!ok) { ws.close(); reject(new Error('délai dépassé')); } }, 8000);
      ws.onopen = () => { ok = true; clearTimeout(timer); this.send({ type: 'hello', name }); this.ping(); resolve(); };
      ws.onerror = () => { if (!ok) { clearTimeout(timer); reject(new Error('connexion impossible')); } };
      ws.onclose = () => { this.ws = null; this.room = null; if (ok) this.onClose(); };
      ws.onmessage = ev => this.handle(JSON.parse(String(ev.data)));
    });
  }

  send(o: object): void { if (this.connected) this.ws!.send(JSON.stringify(o)); }

  /** Appelé régulièrement : mesure l'aller-retour et recale l'horloge. */
  ping(): void { this.pingT = Date.now(); this.send({ type: 'ping', c: this.pingT }); }

  private handle(m: any): void {
    switch (m.type) {
      case 'welcome': this.id = m.id; this.offset = m.t - Date.now(); break;
      case 'pong': {
        const now = Date.now(), rtt = now - m.c, off = m.s + rtt / 2 - now;
        // on garde les mesures aux allers-retours les plus courts (les plus fiables)
        if (rtt < this.rtt * 1.5) { this.offset = this.rtt === 999 ? off : this.offset * 0.7 + off * 0.3; this.rtt = Math.min(this.rtt, rtt) * 0.9 + rtt * 0.1; }
        break;
      }
      case 'room': this.room = m; this.onRoom(m); break;
      case 'rooms': this.onRooms(m.rooms); break;
      case 'start': this.onStart(m); break;
      case 'states': this.onStates(m.t, m.boats); break;
      case 'results': this.onResults(m.list, !!m.final); break;
      case 'error': this.onError(m.msg); break;
    }
  }

  get ping_ms(): number { return Math.round(this.rtt); }
}
