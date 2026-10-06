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
// Límits per IP perquè una sola persona no pugui omplir el servidor
const MAX_CONN_PER_IP = 30;        // pestanyes/dispositius d'una mateixa casa o escola
const MAX_ROOMS_PER_IP = 8;        // sales vives creades des d'una mateixa IP
const MAX_CREATES_PER_MIN = 10;    // sales creades per minut i IP
const ipConns = new Map();         // ip -> connexions obertes
const ipCreates = new Map();       // ip -> [marques de temps]
// Domini propi: posa CANONICAL_HOST=trucmallorqui.com a Render quan el domini ja funcioni.
// Llavors qui entri per *.onrender.com serà redirigit al domini (bo per a Google).
const CANONICAL_HOST = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
const SITE_URL = CANONICAL_HOST ? 'https://' + CANONICAL_HOST : 'https://trucmallorqui.onrender.com';
// Estadístiques: GOATCOUNTER=codi (p. ex. «trucmallorqui») activa el comptador de visites sense galetes.
// STATS_KEY=una-clau-secreta activa /stats?key=... amb les dades en directe del servidor.
const GOATCOUNTER = (process.env.GOATCOUNTER || '').trim().replace(/[^a-z0-9-]/gi, '');
const STATS_KEY = (process.env.STATS_KEY || '').trim();
const ANALYTICS_TAG = GOATCOUNTER
  ? `<script data-goatcounter="https://${GOATCOUNTER}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`
  : '';
const STARTED_AT = Date.now();
const counters = { gamesStarted: 0, gamesFinished: 0, quick: 0, matched: 0 };
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

// ---------- Filtre de noms ofensius (català, castellà, anglès) ----------
// Paraules curtes: han de començar una paraula. Llargues/distintives: es cerquen a tot el nom (també «joanfilldeputa»).
const BAD_START = ['puta', 'puto', 'putes', 'puti', 'polla', 'pollon', 'cony', 'cono', 'conyo', 'cabron', 'cabro', 'collons', 'collon',
  'joder', 'jodete', 'follar', 'folla', 'marica', 'maricon', 'marieta', 'bujarra', 'zorra', 'guarra', 'mamon', 'capullo', 'idiota',
  'imbecil', 'gilipolla', 'subnormal', 'retrasad', 'mongol', 'negrat', 'sudaca', 'nazi', 'hitler', 'polvo', 'pajillero', 'pajero',
  'verga', 'chupa', 'xupa', 'mierda', 'merda', 'cagon', 'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'nigg', 'nigga',
  'whore', 'slut', 'porn', 'rape', 'violad', 'pederast', 'pedofil', 'sexo', 'penis', 'vagina', 'tetas', 'culo', 'ojete'];
const BAD_ANY = ['fillputa', 'filldeputa', 'fillsdeputa', 'hijoputa', 'hijodeputa', 'hdp', 'deputa', 'gilipoll', 'maricon', 'subnormal',
  'retrasad', 'motherfuck', 'fuck', 'nigger', 'nigga', 'hitler', 'pederast', 'pedofil', 'mecagu', 'mecago', 'mecachen', 'cagonde',
  'cabron', 'putamare', 'tumare', 'tumadre', 'puteta', 'polla', 'follar'];
function normName(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's')
    .replace(/[·.\-_]/g, ' ').replace(/(.)\1+/g, '$1');
}
function isBadName(s) {
  const n = normName(s), joined = n.replace(/[^a-z]/g, '');
  const words = n.split(/[^a-z]+/).filter(Boolean);
  const starts = BAD_START.map(b => b.replace(/(.)\1+/g, '$1'));
  if (words.some(w => starts.some(b => w.startsWith(b)))) return true;
  if (words.length > 2 && starts.some(b => joined.startsWith(b))) return true; // «p u t a»
  return BAD_ANY.some(b => joined.includes(b.replace(/(.)\1+/g, '$1')));
}
const cleanName = (s, def) => { const n = clean(s, def); return isBadName(n) ? def : n; };
const cleanLook = l => (LOOKS.includes(l) ? l : 'palla');
// Aspectes («El meu aspecte»): capell i revers de cartes. Llista blanca: el servidor no accepta res més.
const HATS = ['palla', 'pallaAmple', 'pallaNegre', 'gorra', 'barretina', 'mocador', 'res'];
const BACKS = ['llenguesBlau', 'llenguesVermell', 'llenguesVerd', 'rajola', 'siurell', 'tramuntana'];
const DEF_HAT = { palla: 'palla', barretina: 'barretina', mocador: 'mocador' };
const cleanHat = (h, look) => (HATS.includes(h) ? h : DEF_HAT[look] || 'palla');
const cleanBack = b => (BACKS.includes(b) ? b : 'llenguesBlau');
const cleanStyle = (m, look) => ({ hat: cleanHat(m && m.hat, look), back: cleanBack(m && m.back) });
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
    this.searching = false;   // cercant rivals: surt a la llista de sales obertes i s'emparella sola
    this.searchSince = 0;
    this.seats = [0, 1, 2, 3].map(() => ({ human: false, name: '', look: 'palla', hat: 'palla', back: 'llenguesBlau', connected: false, ws: null, token: null, freeTimer: null }));
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
      searching: this.searching, searchMs: this.searching ? Date.now() - this.searchSince : 0,
      seats: this.seats.map((x, i) => ({
        human: x.human, name: x.human ? x.name : DEF_NAMES[i], look: x.human ? x.look : DEF_LOOKS[i],
        hat: x.human ? x.hat : DEF_HAT[DEF_LOOKS[i]], back: x.human ? x.back : 'llenguesBlau', connected: x.human ? x.connected : true
      }))
    };
  }
  broadcastRoom() { for (let s = 0; s < 4; s++) this.sendSeat(s, this.roster(s)); }
  humans() { return this.seats.filter(x => x.human && x.connected).length; }
  freeSeat(prefer) {
    for (const s of prefer) if (!this.seats[s].human) return s;
    return -1;
  }
  attach(seat, ws, token, name, look, style) {
    const x = this.seats[seat];
    if (x.freeTimer) { clearTimeout(x.freeTimer); x.freeTimer = null; }
    if (x.ws && x.ws !== ws) { try { x.ws.ctx = null; x.ws.close(); } catch (e) { /* res */ } }
    x.human = true; x.connected = true; x.ws = ws; x.token = token;
    if (name) x.name = name;
    if (look) x.look = look;
    if (style) { x.hat = style.hat; x.back = style.back; }
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
  allConnected() { return this.seats.every(x => !x.human || x.connected); }
  setSearching(on) {
    this.searching = !!on;
    this.searchSince = on ? Date.now() : 0;
  }
  startGame() {
    counters.gamesStarted++;
    this.searching = false;
    this.phase = 'playing';
    this.game = new Game(this, { speed: SPEED, timerMs: TIMER_MS });
    this.broadcastRoom();
    this.game.start();
  }
  onGameOver() {
    counters.gamesFinished++;
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

// ---------- Emparellament (sales mixtes) ----------
// Les sales que cerquen rivals s'ajunten: els jugadors d'una sala B passen a la sala A
// girant els seus seients (rot) perquè els companys segueixin essent companys.
const TEAMS = [[0, 2], [1, 3]];
function bestRotation(A, B) {
  let best = -1, bestScore = -1;
  for (const rot of [0, 1, 2, 3]) {
    const taken = A.seats.map(x => x.human);
    let ok = true;
    for (let s = 0; s < 4 && ok; s++) {
      if (!B.seats[s].human) continue;
      const t = (s + rot) % 4;
      if (taken[t]) ok = false; else taken[t] = true;
    }
    if (!ok) continue;
    // Preferim que quedin parelles completes d'humans (així hi cap una altra parella després)
    const score = TEAMS.filter(([a, b]) => taken[a] && taken[b]).length;
    if (score > bestScore) { bestScore = score; best = rot; }
  }
  return best;
}
function mergeInto(A, B, rot) {
  for (let s = 0; s < 4; s++) {
    const x = B.seats[s];
    if (!x.human) continue;
    const t = (s + rot) % 4, y = A.seats[t];
    Object.assign(y, { human: true, name: x.name, look: x.look, hat: x.hat, back: x.back, connected: true, ws: x.ws, token: x.token, freeTimer: null });
    if (x.ws && x.ws.ctx) { x.ws.ctx.code = A.code; x.ws.ctx.seat = t; }
    sessions.set(x.token, { code: A.code, seat: t });
    Object.assign(x, { human: false, name: '', connected: false, ws: null, token: null, freeTimer: null });
  }
  B.searching = false;
  B.destroy();
  A.lastActive = Date.now();
}
function tryMatch() {
  const list = Array.from(rooms.values())
    .filter(r => r.searching && r.phase === 'lobby' && r.humans() > 0 && r.humans() < 4 && r.allConnected())
    .sort((a, b) => a.searchSince - b.searchSince);
  for (const A of list) {
    if (!rooms.has(A.code) || !A.searching) continue;
    let changed = false;
    for (const B of list) {
      if (B === A || !rooms.has(B.code) || !B.searching) continue;
      if (A.humans() + B.humans() > 4) continue;
      const rot = bestRotation(A, B);
      if (rot < 0) continue;
      mergeInto(A, B, rot);
      changed = true;
      if (A.humans() === 4) break;
    }
    if (!changed) continue;
    counters.matched++;
    for (let s = 0; s < 4; s++) A.sendSeat(s, { t: 'info', m: 'Hem trobat jugadors!' });
    if (A.humans() === 4) { A.broadcastRoom(); A.startGame(); }
    else A.broadcastRoom();
  }
}
function openRooms() {
  const out = [];
  for (const r of rooms.values()) {
    if (!r.searching || r.phase !== 'lobby' || r.humans() === 0 || r.humans() >= 4) continue;
    const h = r.seats[r.hostSeat];
    out.push({ code: r.code, host: h && h.human ? h.name : 'Jugador', humans: r.humans(), since: r.searchSince });
  }
  return out.sort((a, b) => a.since - b.since).slice(0, 30).map(({ since, ...x }) => x);
}

// ---------- HTTP ----------
const INDEX = path.join(__dirname, 'public', 'index.html');
const STATIC = {
  '/og.png': 'image/png', '/favicon.svg': 'image/svg+xml',
  '/icon-192.png': 'image/png', '/icon-512.png': 'image/png', '/icon-maskable.png': 'image/png', '/apple-touch-icon.png': 'image/png',
  '/manifest.webmanifest': 'application/manifest+json', '/sw.js': 'text/javascript; charset=utf-8'
};
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/regles': 'regles.html', '/regles.html': 'regles.html', '/reglas': 'reglas.html', '/reglas.html': 'reglas.html' };
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (CANONICAL_HOST && host.endsWith('.onrender.com')) {
    res.writeHead(301, { Location: SITE_URL + (req.url || '/') });
    return res.end();
  }
  if (PAGES[url]) {
    fs.readFile(path.join(__dirname, 'public', PAGES[url]), 'utf8', (err, data) => {
      if (err) { res.writeHead(500); return res.end('Falta public/' + PAGES[url]); }
      res.writeHead(200, HTML_HEADERS);
      res.end(data.split('__SITE__').join(SITE_URL).replace('<!--ANALYTICS-->', ANALYTICS_TAG));
    });
    return;
  }
  if (url === '/stats') {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No trobat'); }
    let humans = 0, playing = 0, searching = 0;
    for (const r of rooms.values()) { humans += r.humans(); if (r.phase === 'playing') playing++; if (r.searching) searching++; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({
      connexions: wss.clients.size, jugadorsEnSales: humans, sales: rooms.size, partidesEnJoc: playing, salesCercantRivals: searching,
      desDeReinici: { partidesComencades: counters.gamesStarted, partidesAcabades: counters.gamesFinished, contraBots: counters.quick, emparellamentsAmbDesconeguts: counters.matched },
      encesDesDe: new Date(STARTED_AT).toISOString(), minutsEnces: Math.round((Date.now() - STARTED_AT) / 60000)
    }, null, 2));
  }
  if (url === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  }
  if (url === '/sitemap.xml') {
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url><url><loc>${SITE_URL}/regles</loc><changefreq>monthly</changefreq><priority>0.8</priority></url><url><loc>${SITE_URL}/reglas</loc><changefreq>monthly</changefreq><priority>0.7</priority></url></urlset>\n`);
  }
  if (STATIC[url]) {
    fs.readFile(path.join(__dirname, 'public', url.slice(1)), (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No trobat'); }
      res.writeHead(200, { 'Content-Type': STATIC[url], 'Cache-Control': url === '/sw.js' || url === '/manifest.webmanifest' ? 'no-cache' : 'public, max-age=86400' });
      res.end(data);
    });
    return;
  }
    const gm = url.match(/^\/(google[a-z0-9]+\.html)$/);
  if (gm) {
    fs.readFile(path.join(__dirname, 'public', gm[1]), (e, data) => {
      if (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No trobat'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
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

function clientIp(req) {
  // Render és darrere un proxy: la IP real és la primera de x-forwarded-for
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || '?';
}
wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const n = (ipConns.get(ip) || 0) + 1;
  if (n > MAX_CONN_PER_IP) { try { ws.close(1008, 'Massa connexions'); } catch (e) { /* res */ } return; }
  ipConns.set(ip, n);
  ws.once('close', () => { const k = (ipConns.get(ip) || 1) - 1; if (k <= 0) ipConns.delete(ip); else ipConns.set(ip, k); });
  ws.ctx = { token: null, code: null, seat: -1, count: 0, windowStart: Date.now(), ip };
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
    const now = Date.now(), recent = (ipCreates.get(c.ip) || []).filter(t => now - t < 60000);
    let mine = 0; for (const r of rooms.values()) if (r.ownerIp === c.ip) mine++;
    if (recent.length >= MAX_CREATES_PER_MIN || mine >= MAX_ROOMS_PER_IP) return err(ws, 'Has creat massa sales seguides. Espera un moment.');
    recent.push(now); ipCreates.set(c.ip, recent);
    const code = newCode();
    if (!code) return err(ws, 'No s\'ha pogut crear la sala');
    const room = new Room(code);
    room.ownerIp = c.ip;
    rooms.set(code, room);
    room.attach(0, ws, c.token, cleanName(m.name, 'Jugador'), cleanLook(m.look), cleanStyle(m, cleanLook(m.look)));
    room.hostSeat = 0;
    if (m.quick) { counters.quick++; room.broadcastRoom(); room.startGame(); }
    else if (m.solo) { room.setSearching(true); room.broadcastRoom(); tryMatch(); }
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
    room.attach(seat, ws, c.token, cleanName(m.name, 'Jugador'), cleanLook(m.look), cleanStyle(m, cleanLook(m.look)));
    room.broadcastRoom();
    // Sala oberta que s'omple: comença sola
    if (room.searching && room.humans() === 4) room.startGame();
    return;
  }
  if (m.t === 'list') { send(ws, { t: 'list', rooms: openRooms() }); return; }

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
      Object.assign(y, { human: true, name: x.name, look: x.look, hat: x.hat, back: x.back, connected: true, ws: x.ws, token: x.token, freeTimer: null });
      Object.assign(x, { human: false, name: '', connected: false, ws: null, token: null, freeTimer: null });
      c.seat = to;
      sessions.set(y.token, { code: room.code, seat: to });
      if (room.hostSeat === seat) room.hostSeat = to;
      room.broadcastRoom();
      return;
    }
    case 'profile': {
      if (room.phase !== 'lobby') {
        Object.assign(room.seats[seat], cleanStyle(m, room.seats[seat].look));
        room.broadcastRoom();
        return;
      }
      room.seats[seat].name = cleanName(m.name, 'Jugador');
      room.seats[seat].look = cleanLook(m.look);
      Object.assign(room.seats[seat], cleanStyle(m, room.seats[seat].look));
      room.broadcastRoom();
      return;
    }
    case 'start': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat) return;
      room.startGame();
      return;
    }
    case 'search': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat) return;
      room.setSearching(!!m.on);
      room.broadcastRoom();
      if (room.searching) tryMatch();
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
  try { tryMatch(); } catch (e) { console.error('match', e); }
  for (const [ip, arr] of ipCreates) { const k = arr.filter(t => now - t < 60000); if (k.length) ipCreates.set(ip, k); else ipCreates.delete(ip); }
  for (const room of Array.from(rooms.values())) {
    if (room.humans() === 0 && now - room.lastActive > 10 * 60 * 1000) room.destroy();
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`Truc mallorquí en línia escoltant al port ${PORT}`));
}
module.exports = { server, rooms, tryMatch };
