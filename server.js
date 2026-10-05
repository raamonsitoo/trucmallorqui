'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { Game } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const SPEED = process.env.TRUC_SPEED ? Number(process.env.TRUC_SPEED) : 1;
const TIMER_MS = process.env.TRUC_TIMER_MS ? Number(process.env.TRUC_TIMER_MS) : 40000;
const MAX_ROOMS = 300;
const LOOKS = ['palla', 'barretina', 'mocador'];
const DEF_NAMES = ['Biel', 'Toni', 'Catalina', 'Miquel'];
const DEF_LOOKS = ['palla', 'palla', 'mocador', 'barretina'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rooms = new Map();      // codi -> Room
const sessions = new Map();   // token -> { code, seat }

const clean = (s, def) => {
  s = String(s == null ? '' : s).replace(/[\u0000-\u001f<>&"'`]/g, '').trim().slice(0, 16);
  return s || def;
};
const cleanLook = l => (LOOKS.includes(l) ? l : 'palla');
const newToken = () => crypto.randomBytes(16).toString('hex');
function newCode() {
  for (let k = 0; k < 50; k++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}

class Room {
  constructor(code) {
    this.code = code;
    this.phase = 'lobby';
    this.hostSeat = -1;
    this.game = null;
    this.lastActive = Date.now();
    this.seats = [0, 1, 2, 3].map(() => ({ human: false, name: '', look: 'palla', connected: false, ws: null, token: null, freeTimer: null }));
  }
  sendSeat(s, msg) {
    const x = this.seats[s];
    if (x && x.human && x.connected && x.ws && x.ws.readyState === 1) x.ws.send(JSON.stringify(msg));
  }
  sendAll(msg) {
    const d = JSON.stringify(msg);
    for (const x of this.seats) if (x.human && x.connected && x.ws && x.ws.readyState === 1) x.ws.send(d);
  }
  roster(s) {
    return {
      t: 'room', code: this.code, phase: this.phase, host: this.hostSeat, you: s,
      seats: this.seats.map((x, i) => ({
        human: x.human, name: x.human ? x.name : DEF_NAMES[i], look: x.human ? x.look : DEF_LOOKS[i], connected: x.human ? x.connected : true
      }))
    };
  }
  broadcastRoom() { for (let s = 0; s < 4; s++) this.sendSeat(s, this.roster(s)); }
  humans() { return this.seats.filter(x => x.human && x.connected).length; }
  freeSeat(prefer) {
    for (const s of prefer) if (!this.seats[s].human) return s;
    return -1;
  }
  attach(seat, ws, token, name, look) {
    const x = this.seats[seat];
    if (x.freeTimer) { clearTimeout(x.freeTimer); x.freeTimer = null; }
    if (x.ws && x.ws !== ws) { try { x.ws.ctx = null; x.ws.close(); } catch (e) { /* res */ } }
    x.human = true; x.connected = true; x.ws = ws; x.token = token;
    if (name) x.name = name;
    if (look) x.look = look;
    ws.ctx.code = this.code; ws.ctx.seat = seat;
    sessions.set(token, { code: this.code, seat });
    this.lastActive = Date.now();
    if (this.hostSeat < 0) this.hostSeat = seat;
  }
  detach(seat, final) {
    const x = this.seats[seat];
    x.connected = false; x.ws = null;
    if (this.phase === 'lobby') {
      if (final) this.freeSeatNow(seat);
      else x.freeTimer = setTimeout(() => { this.freeSeatNow(seat); this.broadcastRoom(); }, 30000);
    } else {
      if (final && x.token) sessions.delete(x.token);
      if (this.game) this.game.onDisconnect(seat);
    }
    if (this.hostSeat === seat && this.phase === 'lobby') this.pickHost();
    this.lastActive = Date.now();
  }
  freeSeatNow(seat) {
    const x = this.seats[seat];
    if (x.token) sessions.delete(x.token);
    x.human = false; x.connected = false; x.ws = null; x.token = null; x.name = ''; x.freeTimer = null;
    if (this.hostSeat === seat) this.pickHost();
  }
  pickHost() {
    this.hostSeat = -1;
    for (let s = 0; s < 4; s++) if (this.seats[s].human && this.seats[s].connected) { this.hostSeat = s; break; }
  }
  startGame() {
    this.phase = 'playing';
    this.game = new Game(this, { speed: SPEED, timerMs: TIMER_MS });
    this.broadcastRoom();
    this.game.start();
  }
  onGameOver() {
    this.phase = 'lobby';
    this.game = null;
    for (let s = 0; s < 4; s++) if (this.seats[s].human && !this.seats[s].connected) this.freeSeatNow(s);
    this.pickHost();
    this.broadcastRoom();
  }
  destroy() {
    if (this.game) { this.game.stop(); this.game = null; }
    for (const x of this.seats) { if (x.freeTimer) clearTimeout(x.freeTimer); if (x.token) sessions.delete(x.token); }
    rooms.delete(this.code);
  }
}

// ---------- HTTP ----------
const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url === '/' || url === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Falta public/index.html'); }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('No trobat');
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const err = (ws, m) => send(ws, { t: 'err', m });

wss.on('connection', ws => {
  ws.ctx = { token: null, code: null, seat: -1, count: 0, windowStart: Date.now() };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    const c = ws.ctx; if (!c) return;
    const now = Date.now();
    if (now - c.windowStart > 1000) { c.windowStart = now; c.count = 0; }
    if (++c.count > 40) return;
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(ws, m); } catch (e) { console.error('handle', e); }
  });
  ws.on('close', () => {
    const c = ws.ctx; if (!c || !c.code) return;
    const room = rooms.get(c.code);
    if (room && room.seats[c.seat] && room.seats[c.seat].ws === ws) {
      room.detach(c.seat, false);
      room.broadcastRoom();
    }
  });
});

function ctxRoom(ws) {
  const c = ws.ctx; if (!c || !c.code) return null;
  const r = rooms.get(c.code);
  return r && r.seats[c.seat] && r.seats[c.seat].ws === ws ? r : null;
}

function handle(ws, m) {
  const c = ws.ctx;
  if (m.t === 'hello') {
    const tk = typeof m.token === 'string' ? m.token : null;
    const s = tk && sessions.get(tk);
    if (s) {
      const room = rooms.get(s.code);
      if (room && room.seats[s.seat] && room.seats[s.seat].token === tk) {
        c.token = tk;
        room.attach(s.seat, ws, tk, null, null);
        send(ws, { t: 'hello', token: tk, resumed: true });
        room.broadcastRoom();
        if (room.game) room.game.onReconnect(s.seat);
        return;
      }
    }
    c.token = newToken();
    send(ws, { t: 'hello', token: c.token, resumed: false });
    return;
  }
  if (!c.token) return;

  if (m.t === 'create') {
    if (ctxRoom(ws)) return err(ws, 'Ja ets en una sala');
    if (rooms.size >= MAX_ROOMS) return err(ws, 'Ara mateix hi ha massa sales. Torna-ho a provar més tard.');
    const code = newCode();
    if (!code) return err(ws, 'No s\'ha pogut crear la sala');
    const room = new Room(code);
    rooms.set(code, room);
    room.attach(0, ws, c.token, clean(m.name, 'Jugador'), cleanLook(m.look));
    room.hostSeat = 0;
    if (m.quick) { room.broadcastRoom(); room.startGame(); }
    else room.broadcastRoom();
    return;
  }
  if (m.t === 'join') {
    if (ctxRoom(ws)) return err(ws, 'Ja ets en una sala');
    const code = String(m.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = rooms.get(code);
    if (!room) return err(ws, 'No trobo aquesta sala');
    if (room.phase !== 'lobby') return err(ws, 'La partida ja ha començat');
    const seat = room.freeSeat([2, 1, 3, 0]);
    if (seat < 0) return err(ws, 'La sala està plena');
    room.attach(seat, ws, c.token, clean(m.name, 'Jugador'), cleanLook(m.look));
    room.broadcastRoom();
    return;
  }

  const room = ctxRoom(ws);
  if (!room) return;
  const seat = c.seat;
  room.lastActive = Date.now();

  switch (m.t) {
    case 'sit': {
      if (room.phase !== 'lobby') return;
      const to = m.seat;
      if (!Number.isInteger(to) || to < 0 || to > 3 || room.seats[to].human) return;
      const x = room.seats[seat], y = room.seats[to];
      Object.assign(y, { human: true, name: x.name, look: x.look, connected: true, ws: x.ws, token: x.token, freeTimer: null });
      Object.assign(x, { human: false, name: '', connected: false, ws: null, token: null, freeTimer: null });
      c.seat = to;
      sessions.set(y.token, { code: room.code, seat: to });
      if (room.hostSeat === seat) room.hostSeat = to;
      room.broadcastRoom();
      return;
    }
    case 'profile': {
      if (room.phase !== 'lobby') return;
      room.seats[seat].name = clean(m.name, room.seats[seat].name || 'Jugador');
      room.seats[seat].look = cleanLook(m.look);
      room.broadcastRoom();
      return;
    }
    case 'start': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat) return;
      room.startGame();
      return;
    }
    case 'leave': {
      room.detach(seat, true);
      c.code = null; c.seat = -1;
      if (room.humans() === 0 && room.phase === 'lobby') room.destroy();
      else room.broadcastRoom();
      send(ws, { t: 'left' });
      return;
    }
    case 'act': if (room.game) room.game.handleAct(seat, m.a); return;
    case 'talk': if (room.game && (m.kind === 'tu' || m.kind === 'mi' || m.kind === 'envit')) room.game.onTalk(seat, m.kind); return;
    case 'sign': if (room.game && typeof m.id === 'string') room.game.onSign(seat, m.id); return;
    case 'gaze': if (room.game) room.game.onGaze(seat, m.target); return;
    default: return;
  }
}

// Cor de vida de les connexions i neteja de sales abandonades
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { /* res */ }
  });
  const now = Date.now();
  for (const room of Array.from(rooms.values())) {
    if (room.humans() === 0 && now - room.lastActive > 10 * 60 * 1000) room.destroy();
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Truc mallorquí en línia escoltant al port ${PORT}`));
}
module.exports = { server, rooms };
