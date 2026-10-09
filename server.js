'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { WebSocketServer } = require('ws');
const { Game, LEVEL_IDS } = require('./game');
const acc = require('./accounts');
const fb = require('./feedback');
const shop = require('./shop');
const stats = require('./stats');
const handoff = require('./handoff');
const ipHits = new Map(); // ip -> [marques de temps] (avisos d'estadístiques; com a màxim 120 cada 10 minuts)
// En aturar el servidor (una actualització): temps màxim per acabar les mans en joc abans de passar les sales al
// servidor nou. Render dona 30 s per defecte (o el que digui maxShutdownDelaySeconds); ha de ser una mica menys.
const DRAIN_MS = Number(process.env.TRUC_DRAIN_MS) || 25000;
const RESUME_MS = Number(process.env.TRUC_RESUME_MS) || 2500; // una partida recuperada es reprèn al cap d'aquest temps
let moving = false; // el servidor s'atura i passa les sales al nou

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
// Bústia de suggeriments: com a màxim 5 cada 10 minuts per IP i 120 per hora en total
const FB_PER_IP = 5, FB_PER_HOUR = 120;
const ipFeedback = new Map();      // ip -> [marques de temps]
let fbHour = [];
// Domini propi: posa CANONICAL_HOST=trucmallorqui.com a Render quan el domini ja funcioni.
// Llavors qui entri per *.onrender.com serà redirigit al domini (bo per a Google).
const CANONICAL_HOST = (process.env.CANONICAL_HOST || '').trim().toLowerCase();
const SITE_URL = CANONICAL_HOST ? 'https://' + CANONICAL_HOST : 'https://trucmallorqui.onrender.com';
// Estadístiques: GOATCOUNTER=codi (p. ex. «trucmallorqui») activa el comptador de visites sense galetes.
// STATS_KEY=una-clau-secreta activa /stats?key=... (dades en directe) i /suggeriments?key=... (bústia de suggeriments).
const GOATCOUNTER = (process.env.GOATCOUNTER || '').trim().replace(/[^a-z0-9-]/gi, '');
const STATS_KEY = (process.env.STATS_KEY || '').trim();
const ANALYTICS_TAG = GOATCOUNTER
  ? `<script data-goatcounter="https://${GOATCOUNTER}.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>`
  : '';
// Correu de contacte que surt a la política de privacitat (per defecte trucmallorqui@gmail.com; es pot canviar amb CONTACT_EMAIL)
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || '').trim().replace(/[<>"']/g, '');
// Qui ven (surt a les condicions de venda; és obligatori abans d'obrir la botiga de veres)
const envText = k => (process.env[k] || '').trim().replace(/[<>"'&]/g, '');
const SELLER = [envText('SELLER_NAME'), envText('SELLER_NIF') && 'NIF ' + envText('SELLER_NIF'), envText('SELLER_ADDRESS')].filter(Boolean).join(' · ');
if (shop.ENABLED && !shop.TEST && !SELLER) console.warn('BOTIGA: falten SELLER_NAME, SELLER_NIF i SELLER_ADDRESS per a les condicions de venda');
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
// ---------- Xat de la sala d'espera ----------
// Les paraules ofensives es tapen (•••). Al xat, una paraula curta només compta si és la paraula sola o amb poca cosa més
// («puta», «putes», «fucking»), perquè paraules normals més llargues no quedin tapades.
const CHAT_MAX = 120, CHAT_KEEP = 30;
const CHAT_OK = ['conoc', 'conoz', 'dicke', 'cockta', 'coctel', 'culpa', 'chupach', 'chupit', 'xupit', 'polast', 'polet', 'polac', 'polar', 'raper'];
const chatOk = n => CHAT_OK.some(o => n.startsWith(o.replace(/(.)\1+/g, '$1')));
// Dins una paraula només es cerquen les llargues (així «española» no cau per «polla»); les curtes, a l'inici
const ANY_ALL = BAD_ANY.filter(b => b !== 'tumare' && b !== 'tumadre').map(b => b.replace(/(.)\1+/g, '$1')); // «tu mare» és massa normal
const CHAT_ANY = ANY_ALL.filter(b => b.length >= 6);
const CHAT_START = BAD_START.concat(ANY_ALL.filter(b => b.length < 6)).map(b => b.replace(/(.)\1+/g, '$1'));
function badWord(w) {
  const n = normName(w).replace(/[^a-z]/g, '');
  if (!n || chatOk(n)) return false;
  if (CHAT_ANY.some(b => n.includes(b))) return true;
  return CHAT_START.some(b => n.startsWith(b) && n.length <= b.length + 3);
}
// Caràcters de control i invisibles (espais d'amplada zero, canvis de direcció del text)
const CHAT_STRIP = new RegExp('[' + [[0, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e]]
  .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']', 'g');
// Torna el text net i tapat, o null si no s'ha d'enviar (buit, o un insult escrit separat: «f i l l d e p u t a»)
function cleanChat(s) {
  s = String(s == null ? '' : s).replace(CHAT_STRIP, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  if (!s) return null;
  const words = s.split(' '), out = words.map(w => (badWord(w) ? '•••' : w));
  const joined = normName(out.filter(w => w !== '•••' && !chatOk(normName(w).replace(/[^a-z]/g, ''))).join('')).replace(/[^a-z]/g, '');
  if (CHAT_ANY.some(b => joined.includes(b))) return null;
  return out.join(' ');
}
const READY_MS = 3000; // quan tots estan llests, la partida comença al cap de 3 s (encara es pot desfer)
const cleanLook = l => (LOOKS.includes(l) ? l : 'palla');
// Aspectes («El meu aspecte»): capell i revers de cartes. Llista blanca: el servidor no accepta res més.
const HATS = ['palla', 'pallaAmple', 'pallaNegre', 'gorra', 'barretina', 'mocador', 'res'];
const BACKS = ['llenguesBlau', 'llenguesVermell', 'llenguesVerd', 'rajola', 'siurell', 'tramuntana'];
const DEF_HAT = { palla: 'palla', barretina: 'barretina', mocador: 'mocador' };
const cleanHat = (h, look) => (HATS.includes(h) ? h : DEF_HAT[look] || 'palla');
// Els reversos de la botiga només els pot dur qui els ha comprat (`owned`: el que té desbloquejat)
const cleanBack = (b, owned) => (BACKS.includes(b) || (shop.PREMIUM_BACKS.has(b) && owned && owned.has('back:' + b)) ? b : 'llenguesBlau');
const cleanStyle = (m, look, owned) => ({ hat: cleanHat(m && m.hat, look), back: cleanBack(m && m.back, owned) });
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
    this.botLevel = 'normal'; // nivell dels bots (facil, normal, dificil, mestre); el tria l'amfitrió
    this.cantons = 2;         // 1 = partida ràpida (un cantó), 2 = llarga (dos cantons); el tria l'amfitrió
    this.chat = [];           // darrers missatges del xat (només en memòria: desapareixen amb la sala)
    this.chatSeq = 0;
    this.readyTimer = null;   // tots llestos: compte enrere per començar
    this.readyAt = 0;
    this.seats = [0, 1, 2, 3].map(() => ({ human: false, name: '', look: 'palla', hat: 'palla', back: 'llenguesBlau', connected: false, ws: null, token: null, freeTimer: null, uid: null, lvl: 0, badge: '', ready: false, chatTimes: [] }));
  }
  // Si tots els que hi són (dos o més) estan llests, comença la partida al cap de READY_MS; si algú ho desfà, s'atura
  checkReady() {
    const hs = this.seats.filter(x => x.human && x.connected);
    const all = this.phase === 'lobby' && hs.length >= 2 && hs.every(x => x.ready);
    if (all && !this.readyTimer) {
      this.readyAt = Date.now() + READY_MS;
      this.readyTimer = setTimeout(() => {
        this.readyTimer = null; this.readyAt = 0;
        if (!rooms.has(this.code) || this.phase !== 'lobby') return;
        const now = this.seats.filter(x => x.human && x.connected);
        if (now.length >= 2 && now.every(x => x.ready)) { stats.inc('accio:inici-llestos'); this.startGame(); }
        else this.broadcastRoom();
      }, READY_MS);
    } else if (!all && this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; this.readyAt = 0; }
  }
  addChat(seat, text) {
    const msg = { id: ++this.chatSeq, s: seat, n: this.seats[seat].name, x: text };
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    this.sendAll({ t: 'chat', m: msg });
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
      searching: this.searching, searchMs: this.searching ? Date.now() - this.searchSince : 0, botLevel: this.botLevel, cantons: this.cantons,
      startsIn: this.readyAt ? Math.max(0, this.readyAt - Date.now()) : 0, chat: this.chat,
      seats: this.seats.map((x, i) => ({
        ready: x.human ? !!x.ready : false,
        human: x.human, name: x.human ? x.name : DEF_NAMES[i], look: x.human ? x.look : DEF_LOOKS[i],
        hat: x.human ? x.hat : DEF_HAT[DEF_LOOKS[i]], back: x.human ? x.back : 'llenguesBlau', connected: x.human ? x.connected : true,
        lvl: x.human && x.uid ? x.lvl : 0, badge: x.human && x.uid ? x.badge || '' : ''
      }))
    };
  }
  broadcastRoom() { this.checkReady(); for (let s = 0; s < 4; s++) this.sendSeat(s, this.roster(s)); this.persist(); }
  // ---------- Sobreviure als reinicis del servidor (vegeu handoff.js) ----------
  tokens() { return this.seats.filter(x => x.human && x.token).map(x => x.token); }
  // Tot el que cal per refer la sala en un altre servidor; d'una partida, el marcador d'abans de la mà en joc.
  // El xat no s'hi desa (la política de privacitat diu que els missatges no es guarden enlloc).
  state() {
    const playing = this.phase === 'playing' && !!this.checkpoint;
    return {
      v: 1, phase: playing ? 'playing' : 'lobby', hostSeat: this.hostSeat, botLevel: this.botLevel, cantons: this.cantons,
      chatSeq: this.chatSeq, humansAtStart: this.humansAtStart || 0, game: playing ? this.checkpoint : null,
      seats: this.seats.map(x => (x.human && x.token ? { name: x.name, look: x.look, hat: x.hat, back: x.back, token: x.token, uid: x.uid || null, lvl: x.lvl || 0, badge: x.badge || '' } : null))
    };
  }
  persist() {
    if (this.moved || !handoff.ENABLED || !rooms.has(this.code)) return;
    const tokens = this.tokens();
    if (tokens.length) handoff.save(this.code, this.state(), tokens, false); else handoff.remove(this.code);
  }
  // El joc la crida abans de cada mà: es desa el marcador i, si el servidor s'atura, la sala passa aquí al nou
  onHandStart(game) {
    this.checkpoint = game.checkpoint();
    this.persist();
    if (moving && handoff.ENABLED) { this.handOver(); return false; }
    return true;
  }
  // Deixa la sala al servidor nou: la desa com a lliure i diu als jugadors que tornin a entrar (aniran al nou)
  handOver() {
    if (this.moved) return;
    this.moved = true;
    if (this.game) { this.game.stop(); this.game = null; }
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
    const tokens = this.tokens();
    if (handoff.ENABLED && tokens.length) handoff.save(this.code, this.state(), tokens, true);
    const socks = this.seats.filter(x => x.human && x.ws).map(x => x.ws);
    for (const ws of socks) { send(ws, { t: 'moving' }); ws.ctx = null; }
    handoff.flush().catch(() => {}).then(() => { for (const ws of socks) { try { ws.close(4000, 'actualitzant'); } catch (e) { /* res */ } } });
  }
  // Partida recuperada d'un altre servidor: continua des del marcador desat
  resumeGame() {
    this.resumeTimer = null;
    if (!rooms.has(this.code) || this.moved || this.phase !== 'playing' || this.game || !this.checkpoint) return;
    const ck = this.checkpoint;
    this.game = new Game(this, { speed: SPEED, timerMs: TIMER_MS, level: ck.level, cantons: ck.win, resume: ck });
    this.broadcastRoom();
    this.game.start();
  }
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
    if (name) { x.name = name; x.ready = false; } // entra de nou (en reprendre la connexió, es manté)
    if (look) x.look = look;
    if (style) { x.hat = style.hat; x.back = style.back; }
    if (ws.ctx.uid) { x.uid = ws.ctx.uid; x.lvl = ws.ctx.lvl || 1; x.badge = ws.ctx.badge || ''; }
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
    x.human = false; x.connected = false; x.ws = null; x.token = null; x.name = ''; x.freeTimer = null; x.uid = null; x.lvl = 0; x.badge = ''; x.ready = false; x.chatTimes = [];
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
    for (const x of this.seats) x.ready = false;
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; this.readyAt = 0; }
    this.humansAtStart = this.seats.filter(x => x.human).length;
    stats.inc('partida:comencada');
    stats.inc('partida:tipus:' + (this.humansAtStart <= 1 ? 'bots' : this.humansAtStart === 4 ? 'persones' : 'mixta'));
    if (this.humansAtStart < 4) stats.inc('partida:nivell:' + this.botLevel);
    stats.inc('partida:durada:' + (this.cantons === 1 ? 'rapida' : 'llarga'));
    this.checkpoint = null;
    this.game = new Game(this, { speed: SPEED, timerMs: TIMER_MS, level: this.botLevel, cantons: this.cantons });
    this.broadcastRoom();
    this.game.start();
  }
  onGameOver() {
    counters.gamesFinished++;
    // Només compta com a acabada si encara hi ha algú jugant (si tothom se n'ha anat, l'han acabada els bots)
    stats.inc(this.humans() > 0 ? 'partida:acabada' : 'partida:abandonada');
    if (this.game) awardGame(this, this.game);
    this.phase = 'lobby';
    this.game = null;
    this.checkpoint = null;
    for (const x of this.seats) x.ready = false;
    for (let s = 0; s < 4; s++) if (this.seats[s].human && !this.seats[s].connected) this.freeSeatNow(s);
    this.pickHost();
    this.broadcastRoom();
  }
  destroy() {
    if (this.game) { this.game.stop(); this.game = null; }
    if (this.readyTimer) { clearTimeout(this.readyTimer); this.readyTimer = null; }
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
    for (const x of this.seats) { if (x.freeTimer) clearTimeout(x.freeTimer); if (x.token) sessions.delete(x.token); }
    if (!this.moved) handoff.remove(this.code);
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
    Object.assign(y, { human: true, name: x.name, look: x.look, hat: x.hat, back: x.back, connected: true, ws: x.ws, token: x.token, freeTimer: null, uid: x.uid, lvl: x.lvl, badge: x.badge, ready: false, chatTimes: x.chatTimes });
    if (x.ws && x.ws.ctx) { x.ws.ctx.code = A.code; x.ws.ctx.seat = t; }
    sessions.set(x.token, { code: A.code, seat: t });
    Object.assign(x, { human: false, name: '', connected: false, ws: null, token: null, freeTimer: null, uid: null, lvl: 0, badge: '', ready: false, chatTimes: [] });
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
const PAGES = { '/': 'index.html', '/index.html': 'index.html', '/regles': 'regles.html', '/regles.html': 'regles.html', '/reglas': 'reglas.html', '/reglas.html': 'reglas.html',
  '/privacitat': 'privacitat.html', '/privacidad': 'privacidad.html', '/condicions': 'condicions.html' };
const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  // Avisos d'estadístiques del navegador (visites i accions); només comptadors, sense IP ni galetes
  if (url === '/hit' && req.method === 'POST') {
    const chunks = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > 2048) req.destroy(); else chunks.push(d); });
    req.on('end', () => {
      const ip = clientIp(req), now = Date.now(), mine = (ipHits.get(ip) || []).filter(t => now - t < 10 * 60000);
      if (mine.length < 120) {
        mine.push(now); ipHits.set(ip, mine);
        try { stats.hit(JSON.parse(Buffer.concat(chunks).toString('utf8')), req.headers['user-agent']); } catch (e) { /* res */ }
      }
      res.writeHead(204); res.end();
    });
    return;
  }
  // Stripe ens avisa quan algú ha pagat (abans de la redirecció al domini: Stripe no segueix redireccions)
  if (url === '/stripe/webhook' && req.method === 'POST') {
    const chunks = []; let size = 0;
    req.on('data', d => { size += d.length; if (size > 256 * 1024) req.destroy(); else chunks.push(d); });
    req.on('end', () => {
      const ev = shop.verifyWebhook(Buffer.concat(chunks).toString('utf8'), req.headers['stripe-signature']);
      if (!ev) { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Signatura no vàlida'); }
      const o = ev.data && ev.data.object;
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type) && o && o.payment_status === 'paid'
        && o.metadata && shop.ITEMS[o.metadata.item] && Number(o.metadata.uid) > 0 && acc.ENABLED) {
        grantPurchase(Number(o.metadata.uid), o.metadata.item, o.id, o.amount_total || 0).catch(e => console.error('webhook', e.message));
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok');
    });
    return;
  }
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  if (CANONICAL_HOST && host.endsWith('.onrender.com')) {
    res.writeHead(301, { Location: SITE_URL + (req.url || '/') });
    return res.end();
  }
  if (PAGES[url]) {
    fs.readFile(path.join(__dirname, 'public', PAGES[url]), 'utf8', (err, data) => {
      if (err) { res.writeHead(500); return res.end('Falta public/' + PAGES[url]); }
      const body = data.split('__SITE__').join(SITE_URL).replace('<!--ANALYTICS-->', ANALYTICS_TAG)
        .split('__GCLIENT__').join(acc.GOOGLE_CLIENT_ID).split('__CONTACT__').join(CONTACT_EMAIL || 'trucmallorqui@gmail.com')
        .split('__SELLER__').join(SELLER || '[falten el nom, el NIF i l\'adreça del venedor]');
      // Pàgines comprimides (gzip): la web carrega molt més aviat, sobretot al mòbil
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
        return zlib.gzip(body, (e, buf) => {
          if (e) { res.writeHead(200, HTML_HEADERS); return res.end(body); }
          res.writeHead(200, Object.assign({}, HTML_HEADERS, { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' }));
          res.end(buf);
        });
      }
      res.writeHead(200, Object.assign({}, HTML_HEADERS, { 'Vary': 'Accept-Encoding' }));
      res.end(body);
    });
    return;
  }
  // Pagament de mentida per provar la botiga a l'ordinador (SHOP_SIMULATED=1, sense Stripe)
  if (url === '/compra-simulada' && shop.SIMULATED) {
    const q = new URL(req.url, 'http://x').searchParams, s = String(q.get('s') || '').replace(/[^a-z0-9_]/g, '');
    if (q.get('pagar') === '1' && shop.simulatePay(s)) { res.writeHead(302, { Location: '/?compra=' + s }); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pagament simulat</title>
<body style="font-family:system-ui;background:#0a1b1d;color:#e2eeea;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:380px;text-align:center"><h1>Pagament simulat</h1><p>Aquí aniria la pàgina de pagament de Stripe. No es cobra res.</p>
<p><a href="?s=${s}&pagar=1" style="display:inline-block;background:#e0a21f;color:#2b1c00;padding:12px 22px;border-radius:999px;font-weight:800;text-decoration:none">Pagar (simulat)</a></p>
<p><a href="/?compra=cancel" style="color:#8fb0aa">Cancel·lar</a></p></div>`);
  }
  // Estadístiques: /stats?key=... (pàgina amb gràfiques) i /stats.json?key=... (dades en directe)
  if (url === '/stats' || url === '/stats.json') {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No trobat'); }
    let humans = 0, playing = 0, searching = 0;
    for (const r of rooms.values()) { humans += r.humans(); if (r.phase === 'playing') playing++; if (r.searching) searching++; }
    const live = { connexions: wss.clients.size, jugadorsEnSales: humans, sales: rooms.size, partidesEnJoc: playing, salesCercantRivals: searching };
    if (url === '/stats') {
      stats.page(live).then(html => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
        res.end(html);
      }).catch(e => { console.error('stats', e.message); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Error'); });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(Object.assign(live, {
      desDeReinici: { partidesComencades: counters.gamesStarted, partidesAcabades: counters.gamesFinished, contraBots: counters.quick, emparellamentsAmbDesconeguts: counters.matched },
      encesDesDe: new Date(STARTED_AT).toISOString(), minutsEnces: Math.round((Date.now() - STARTED_AT) / 60000)
    }), null, 2));
  }
  if (url === '/suggeriments') {
    const key = new URL(req.url, 'http://x').searchParams.get('key');
    if (!STATS_KEY || key !== STATS_KEY) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('No trobat'); }
    fb.store.list(300).then(rows => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
      res.end(fb.page(rows));
    }).catch(e => { console.error('suggeriments', e.message); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('Error'); });
    return;
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
  ws.ctx = { token: null, code: null, seat: -1, count: 0, windowStart: Date.now(), ip, ua: String(req.headers['user-agent'] || '').slice(0, 300), owned: new Set(), badge: '',
    // On torna el comprador després de pagar (en mode simulat, l'ordinador on es prova)
    origin: shop.SIMULATED ? 'http://' + String(req.headers.host || 'localhost').replace(/[^a-z0-9.:\-[\]]/gi, '') : SITE_URL };
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
// Torna a entrar al seient que tenia (després d'un tall de connexió o d'una actualització del servidor)
function resumeSeat(ws, room, seat, tk) {
  ws.ctx.token = tk;
  room.attach(seat, ws, tk, null, null);
  send(ws, { t: 'hello', token: tk, resumed: true, shop: shop.visibleTo(null) });
  room.broadcastRoom();
  if (room.game) room.game.onReconnect(seat);
}
function newSession(ws) {
  ws.ctx.token = newToken();
  send(ws, { t: 'hello', token: ws.ctx.token, resumed: false, shop: shop.visibleTo(null) });
}
// Refà una sala desada per un servidor anterior (vegeu handoff.js). Els jugadors hi tornen a entrar amb el seu testimoni.
function restoreRoom(code, d) {
  if (rooms.has(code)) return rooms.get(code); // ja l'ha recuperada un altre jugador de la sala
  const room = new Room(code);
  rooms.set(code, room);
  room.botLevel = LEVEL_IDS.includes(d.botLevel) ? d.botLevel : 'normal';
  room.cantons = d.cantons === 1 ? 1 : 2;
  room.chatSeq = Number(d.chatSeq) || 0;
  room.humansAtStart = Number(d.humansAtStart) || 0;
  (Array.isArray(d.seats) ? d.seats : []).slice(0, 4).forEach((s, i) => {
    if (!s || typeof s.token !== 'string') return;
    Object.assign(room.seats[i], { human: true, connected: false, ws: null, token: s.token, name: cleanName(s.name, 'Jugador'), look: cleanLook(s.look),
      hat: s.hat, back: s.back, uid: s.uid || null, lvl: s.lvl || 0, badge: s.badge || '', ready: false, chatTimes: [] });
    sessions.set(s.token, { code, seat: i });
    // Qui no torni en dos minuts deixa el seient lliure (a la sala d'espera); a la partida, mentrestant hi juga un bot
    const x = room.seats[i];
    x.freeTimer = setTimeout(() => {
      x.freeTimer = null;
      if (x.connected || rooms.get(code) !== room || room.phase !== 'lobby') return;
      room.freeSeatNow(i);
      if (room.humans() === 0) room.destroy(); else room.broadcastRoom();
    }, 120000);
  });
  room.hostSeat = room.seats[d.hostSeat] && room.seats[d.hostSeat].human ? d.hostSeat : -1;
  if (room.hostSeat < 0) room.pickHost();
  if (room.hostSeat < 0) room.hostSeat = room.seats.findIndex(x => x.human);
  if (d.phase === 'playing' && d.game && Array.isArray(d.game.scores)) {
    room.phase = 'playing';
    room.checkpoint = d.game;
    // Es reprèn al cap d'un moment, perquè els altres jugadors també tenguin temps de tornar a entrar
    room.resumeTimer = setTimeout(() => room.resumeGame(), RESUME_MS);
  }
  console.log(`sala ${code} recuperada (${room.phase === 'playing' ? 'partida ' + d.game.scores.join('-') : "sala d'espera"})`);
  return room;
}

function handle(ws, m) {
  const c = ws.ctx;
  if (m.t === 'hello') {
    if (c.token || c.helloWait) return;
    // El servidor s'atura: que torni a entrar, i anirà al servidor nou
    if (moving) { send(ws, { t: 'moving' }); ws.ctx = null; setTimeout(() => { try { ws.close(4000); } catch (e) { /* res */ } }, 200); return; }
    const tk = typeof m.token === 'string' && /^[0-9a-f]{32}$/.test(m.token) ? m.token : null;
    const s = tk && sessions.get(tk);
    if (s) {
      const room = rooms.get(s.code);
      if (room && room.seats[s.seat] && room.seats[s.seat].token === tk) return resumeSeat(ws, room, s.seat, tk);
    }
    // Pot ser que la seva sala vengui d'un servidor anterior (s'ha actualitzat el joc): es recupera
    if (tk && handoff.ENABLED) {
      c.helloWait = true;
      handoff.claim(tk).then(res => {
        c.helloWait = false;
        if (ws.readyState !== 1 || ws.ctx !== c || moving) return;
        if (res && res.code && res.data) {
          const room = restoreRoom(res.code, res.data), seat = room.seats.findIndex(x => x.human && x.token === tk);
          if (seat >= 0) return resumeSeat(ws, room, seat, tk);
        } else if (res && res.busy) {
          // La sala encara la duu el servidor vell, que l'acaba de passar: que ho torni a provar d'aquí a un moment
          send(ws, { t: 'wait', ms: 2500 });
          setTimeout(() => { try { ws.close(4001); } catch (e) { /* res */ } }, 100);
          return;
        }
        newSession(ws);
      }).catch(e => {
        c.helloWait = false;
        console.error('sala no recuperada', e.message);
        if (ws.readyState === 1 && ws.ctx === c) newSession(ws);
      });
      return;
    }
    return newSession(ws);
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
    room.attach(0, ws, c.token, cleanName(m.name, 'Jugador'), cleanLook(m.look), cleanStyle(m, cleanLook(m.look), c.owned));
    room.hostSeat = 0;
    if (LEVEL_IDS.includes(m.level)) room.botLevel = m.level;
    if (m.cantons === 1 || m.cantons === 2) room.cantons = m.cantons;
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
    room.attach(seat, ws, c.token, cleanName(m.name, 'Jugador'), cleanLook(m.look), cleanStyle(m, cleanLook(m.look), c.owned));
    room.broadcastRoom();
    // Sala oberta que s'omple: comença sola
    if (room.searching && room.humans() === 4) room.startGame();
    return;
  }
  if (m.t === 'list') { send(ws, { t: 'list', rooms: openRooms(), online: wss.clients.size }); return; }
  if (m.t === 'login' || m.t === 'auth' || m.t === 'logout' || m.t === 'prefs' || m.t === 'delete') { accountMsg(ws, m); return; }
  if (m.t === 'feedback') { feedbackMsg(ws, m); return; }
  if (m.t === 'shop') { if (shop.visibleTo(c.uid)) send(ws, { t: 'shop', items: shop.catalog(), test: shop.TEST }); return; }
  if (m.t === 'buy' || m.t === 'buyCheck') { shopMsg(ws, m); return; }

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
      Object.assign(y, { human: true, name: x.name, look: x.look, hat: x.hat, back: x.back, connected: true, ws: x.ws, token: x.token, freeTimer: null, uid: x.uid, lvl: x.lvl, badge: x.badge, ready: x.ready, chatTimes: x.chatTimes });
      Object.assign(x, { human: false, name: '', connected: false, ws: null, token: null, freeTimer: null, uid: null, lvl: 0, badge: '', ready: false, chatTimes: [] });
      c.seat = to;
      sessions.set(y.token, { code: room.code, seat: to });
      if (room.hostSeat === seat) room.hostSeat = to;
      room.broadcastRoom();
      return;
    }
    case 'profile': {
      if (room.phase !== 'lobby') {
        Object.assign(room.seats[seat], cleanStyle(m, room.seats[seat].look, c.owned));
        room.broadcastRoom();
        return;
      }
      room.seats[seat].name = cleanName(m.name, 'Jugador');
      room.seats[seat].look = cleanLook(m.look);
      Object.assign(room.seats[seat], cleanStyle(m, room.seats[seat].look, c.owned));
      room.broadcastRoom();
      return;
    }
    case 'start': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat) return;
      room.startGame();
      return;
    }
    case 'botlevel': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat || !LEVEL_IDS.includes(m.level)) return;
      room.botLevel = m.level;
      room.broadcastRoom();
      return;
    }
    case 'cantons': {
      if (room.phase !== 'lobby' || room.hostSeat !== seat || (m.n !== 1 && m.n !== 2)) return;
      room.cantons = m.n;
      room.broadcastRoom();
      return;
    }
    case 'ready': {
      if (room.phase !== 'lobby') return;
      const x = room.seats[seat];
      if (!!m.on === x.ready) return;
      x.ready = !!m.on;
      if (x.ready) stats.inc('accio:llest');
      room.broadcastRoom();
      return;
    }
    case 'chat': {
      if (room.phase !== 'lobby') return;
      const x = room.seats[seat], now = Date.now();
      x.chatTimes = (x.chatTimes || []).filter(t => now - t < 10000);
      if (x.chatTimes.length >= 5) return send(ws, { t: 'chatno', m: 'Massa missatges seguits. Espera un moment.' });
      const text = cleanChat(m.text);
      if (text === null) return send(ws, { t: 'chatno', m: m.text && String(m.text).trim() ? 'Aquest missatge no s\'ha enviat.' : '' });
      x.chatTimes.push(now);
      stats.inc('accio:xat-missatge');
      room.addChat(seat, text);
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
    case 'talk': if (room.game && (m.kind === 'tu' || m.kind === 'mi' || m.kind === 'envit' || m.kind === 'truc')) room.game.onTalk(seat, m.kind); return;
    case 'sign': if (room.game && typeof m.id === 'string') room.game.onSign(seat, m.id); return;
    case 'gaze': if (room.game) room.game.onGaze(seat, m.target); return;
    default: return;
  }
}

// ---------- Comptes ----------
// El compte queda lligat a la connexió (ws.ctx.uid) i al seient que ocupa (seat.uid).
function setSeatAccount(ws) {
  const room = ctxRoom(ws); if (!room) return;
  const x = room.seats[ws.ctx.seat];
  x.uid = ws.ctx.uid || null; x.lvl = ws.ctx.uid ? ws.ctx.lvl || 1 : 0; x.badge = ws.ctx.uid ? ws.ctx.badge || '' : '';
  x.back = cleanBack(x.back, ws.ctx.owned);
  room.broadcastRoom();
}
function prefsFrom(m, owned) {
  const look = cleanLook(m.look);
  return Object.assign({ name: cleanName(m.name, 'Jugador'), look }, cleanStyle(m, look, owned));
}
// El que ha comprat el compte de la connexió (reversos i insígnia)
async function loadOwned(c) {
  c.owned = c.uid ? shop.entitlements(await acc.store.owned(c.uid)) : new Set();
  c.badge = c.owned.has('badge:fundador') ? 'fundador' : '';
}
function forgetAccount(c) { c.uid = null; c.lvl = 0; c.owned = new Set(); c.badge = ''; }
// Perfil per al client: progrés, què té comprat i si veu la botiga
const profileOf = (c, p) => Object.assign(acc.publicProfile(p), { owned: Array.from(c.owned), badge: c.badge, shop: shop.visibleTo(c.uid), shopTest: shop.TEST });
async function accountMsg(ws, m) {
  const c = ws.ctx;
  if (!acc.ENABLED) return;
  try {
    if (m.t === 'login') {
      if ((c.logins = (c.logins || 0) + 1) > 10) return;
      const sub = await acc.verifyGoogle(m.credential);
      if (!sub) return err(ws, "No s'ha pogut entrar amb Google. Torna-ho a provar.");
      const p = await acc.store.login(sub, prefsFrom(m));
      c.uid = p.id; c.lvl = acc.levelOf(p.xp);
      await loadOwned(c);
      send(ws, { t: 'login', session: acc.signSession(p.id), profile: profileOf(c, p) });
      setSeatAccount(ws);
    } else if (m.t === 'auth') {
      const id = acc.verifySession(m.session);
      const p = id && await acc.store.get(id);
      if (!p) return send(ws, { t: 'logout' });
      c.uid = p.id; c.lvl = acc.levelOf(p.xp);
      await loadOwned(c);
      send(ws, { t: 'me', profile: profileOf(c, p) });
      setSeatAccount(ws);
    } else if (m.t === 'prefs') {
      if (!c.uid) return;
      const p = await acc.store.prefs(c.uid, prefsFrom(m, c.owned));
      if (p) send(ws, { t: 'me', profile: profileOf(c, p) });
    } else if (m.t === 'logout') {
      forgetAccount(c); setSeatAccount(ws);
    } else if (m.t === 'delete') {
      if (!c.uid) return;
      await acc.store.remove(c.uid);
      forgetAccount(c); setSeatAccount(ws);
      send(ws, { t: 'deleted' });
    }
  } catch (e) {
    console.error('compte', e.message);
    err(ws, 'Ara mateix no podem accedir als comptes. Torna-ho a provar més tard.');
  }
}
// ---------- Botiga ----------
async function shopMsg(ws, m) {
  const c = ws.ctx;
  if (!acc.ENABLED) return;
  try {
    if (m.t === 'buy') {
      if (!c.uid) return err(ws, 'Entra amb Google per comprar: així la compra queda guardada al teu compte.');
      if (!shop.visibleTo(c.uid) || !shop.ITEMS[m.item]) return;
      if (m.consent !== true) return err(ws, 'Per comprar has de marcar la casella de les condicions.');
      if ((await acc.store.owned(c.uid)).includes(m.item)) return err(ws, 'Ja tens aquest pack.');
      if ((c.buys = (c.buys || 0) + 1) > 20) return;
      send(ws, { t: 'buy', url: await shop.createCheckout(c.uid, m.item, c.origin) });
    } else if (m.t === 'buyCheck') {
      // En tornar de la pàgina de pagament: si ja s'ha pagat, es desbloqueja ara (l'avís de Stripe també ho fa)
      if (!c.uid || (c.checks = (c.checks || 0) + 1) > 20) return;
      const s = await shop.getSession(m.session);
      if (!s || !s.paid || s.uid !== c.uid || !shop.ITEMS[s.item]) return send(ws, { t: 'bought', ok: false });
      await grantPurchase(s.uid, s.item, m.session, s.amount);
      send(ws, { t: 'bought', ok: true, item: s.item, name: shop.ITEMS[s.item].name });
    }
  } catch (e) {
    console.error('botiga', e.message);
    err(ws, "Ara mateix no s'ha pogut obrir el pagament. Torna-ho a provar més tard.");
  }
}
// Apunta la compra (una sola vegada per pagament) i ho diu a totes les connexions d'aquest compte
async function grantPurchase(uid, item, ref, amount) {
  if (await acc.store.grant(uid, item, ref, amount)) console.log(`compra: compte ${uid}, ${item}, ${(amount / 100).toFixed(2)} €`);
  const p = await acc.store.get(uid);
  if (!p) return;
  for (const w of wss.clients) {
    if (!w.ctx || w.ctx.uid !== uid) continue;
    await loadOwned(w.ctx);
    send(w, { t: 'me', profile: profileOf(w.ctx, p) });
    setSeatAccount(w);
  }
}

// ---------- Bústia de suggeriments ----------
function feedbackMsg(ws, m) {
  const c = ws.ctx, now = Date.now();
  const f = fb.clean(m, c.ua);
  if (!f) return send(ws, { t: 'fb', ok: false, m: 'Escriu una mica més, per favor.' });
  const mine = (ipFeedback.get(c.ip) || []).filter(t => now - t < 10 * 60000);
  fbHour = fbHour.filter(t => now - t < 3600e3);
  if (mine.length >= FB_PER_IP || fbHour.length >= FB_PER_HOUR) return send(ws, { t: 'fb', ok: false, m: "N'has enviat molts seguits. Torna-ho a provar d'aquí a una estona." });
  mine.push(now); ipFeedback.set(c.ip, mine); fbHour.push(now);
  fb.store.add(f).then(() => {
    console.log(`suggeriment (${f.kind}, ${f.place}, ${f.device}): ${f.text.slice(0, 200).replace(/\s+/g, ' ')}`);
    send(ws, { t: 'fb', ok: true });
  }).catch(e => {
    console.error('suggeriment no desat', e.message, '|', f.kind, f.text.slice(0, 300).replace(/\s+/g, ' '));
    send(ws, { t: 'fb', ok: false, m: "Ara mateix no s'ha pogut enviar. Torna-ho a provar més tard." });
  });
}
// En acabar una partida: experiència per a cada jugador amb compte
function awardGame(room, g) {
  if (!acc.ENABLED) return;
  const vsBots = (room.humansAtStart || 0) <= 1;
  room.seats.forEach((x, s) => {
    if (!x.human || !x.uid) return;
    const team = s % 2, cantons = g.G.cantons[team];
    const r = { won: cantons >= (g.cantonsToWin || 2), cantons, hands: (g.tally && g.tally.hands[team]) || 0, vsBots };
    r.xp = acc.xpForGame(r);
    const before = x.lvl || 1, uid = x.uid;
    acc.store.addGame(uid, r).then(p => {
      if (!p) return;
      const prof = acc.publicProfile(p);
      if (x.uid === uid) { x.lvl = prof.level; room.broadcastRoom(); }
      if (x.ws && x.ws.ctx && x.ws.ctx.uid === uid) {
        x.ws.ctx.lvl = prof.level;
        send(x.ws, { t: 'me', profile: profileOf(x.ws.ctx, p), gained: { xp: r.xp, won: r.won, levelUp: prof.level > before } });
      }
    }).catch(e => console.error('xp', e.message));
  });
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
  for (const [ip, arr] of ipFeedback) { const k = arr.filter(t => now - t < 10 * 60000); if (k.length) ipFeedback.set(ip, k); else ipFeedback.delete(ip); }
  for (const [ip, arr] of ipHits) { const k = arr.filter(t => now - t < 10 * 60000); if (k.length) ipHits.set(ip, k); else ipHits.delete(ip); }
  for (const room of Array.from(rooms.values())) {
    if (room.humans() === 0 && now - room.lastActive > 10 * 60 * 1000) room.destroy();
  }
}, 30000);

// Les sales d'aquest servidor continuen essent seves (si s'aturàs de cop, un altre les podria agafar al cap de LEASE_MS)
setInterval(() => { handoff.renew(Array.from(rooms.values()).filter(r => !r.moved).map(r => r.code)); }, Math.max(1000, Math.floor(handoff.LEASE_MS / 3))).unref();

// ---------- Aturada per actualització ----------
// Render engega el servidor nou, hi envia les connexions noves i, un minut després, avisa el vell (SIGTERM).
// El vell deixa acabar les mans en joc (com a màxim DRAIN_MS), passa cada sala al nou i s'atura.
// Els jugadors tornen a entrar sols i continuen la partida; només noten una pausa entre dues mans.
function startMoving() {
  if (moving) return;
  moving = true;
  console.log(`aturada: passam les sales al servidor nou (com a màxim ${Math.round(DRAIN_MS / 1000)} s)`);
  // Qui no és a cap sala, que torni a entrar ara (anirà al servidor nou)
  wss.clients.forEach(ws => {
    if (!ws.ctx || ws.ctx.code) return;
    send(ws, { t: 'moving' }); ws.ctx = null;
    setTimeout(() => { try { ws.close(4000); } catch (e) { /* res */ } }, 200);
  });
  const until = Date.now() + DRAIN_MS;
  const step = () => {
    // Les sales d'espera passen ara; les partides, en acabar la mà (sense on desar-les, en acabar la partida)
    for (const r of Array.from(rooms.values())) if (!r.moved && (r.phase !== 'playing' || !r.game || Date.now() >= until)) r.handOver();
    if (Array.from(rooms.values()).every(r => r.moved)) { clearInterval(iv); finishMoving(); }
  };
  const iv = setInterval(step, 250);
  step();
}
let finishing = false;
function finishMoving() {
  if (finishing) return;
  finishing = true;
  setTimeout(() => process.exit(0), 8000).unref(); // per si la base de dades no contesta
  handoff.flush().catch(() => {}).then(() => stats.flush()).catch(() => {}).then(() => setTimeout(() => process.exit(0), 600));
}
if (require.main === module) {
  server.listen(PORT, () => console.log(`Truc mallorquí en línia escoltant al port ${PORT}`));
  process.once('SIGTERM', startMoving);
  process.on('message', m => { if (m === 'drain') startMoving(); }); // les proves (a Windows no hi ha SIGTERM)
}
module.exports = { server, rooms, tryMatch, cleanChat };
