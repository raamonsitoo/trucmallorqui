'use strict';
// Motor del Truc mallorquí en el servidor. Els seients són absoluts (0..3).
// Parelles: 0 i 2 contra 1 i 3. Ordre de joc: 0 -> 1 -> 2 -> 3.

const SUITS = ['oros', 'copes', 'espases', 'bastos'];
const NUMS = [1, 3, 4, 5, 6, 7, 10, 11, 12];
const TRUC_VALUE = [1, 3, 6, 9, 24];
const TRUC_REFUSE = [0, 1, 3, 6, 9];
const ENVIT_VALUE = [0, 2, 4, 6, 24];
const ENVIT_REFUSE = [0, 1, 2, 4, 6];
const SIGN_POWER = { amo: 3, madona: 3, asE: 3, asB: 3, sieteE: 3, sieteO: 3, tres: 2, buit: 0 };
const SIGN_DUR = { amo: 1.1, madona: 1.0, asE: 1.3, asB: 1.3, sieteE: 1.3, sieteO: 1.3, tres: 1.4, buit: 1.1 };
// Resposta en parella: si un contesta i el company encara no, aquest té uns segons per dir-hi la seva.
// Mana la resposta que «més vol»: pujar > vull > no vull.
const TEAM_WINDOW_MS = 7000;
const ANS_RANK = { no: 0, vull: 1, raise: 2 };

function makeDeck() { const d = []; for (const s of SUITS) for (const n of NUMS) d.push({ n, s }); return d; }
function shuffle(a, rnd = Math.random) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
// Atzar amb llavor: l'entrenament dels bots repeteix exactament les mateixes mans.
function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function cardRank(c) {
  const n = c.n, s = c.s;
  if (n === 11 && s === 'bastos') return 100;
  if (n === 10 && s === 'oros') return 99;
  if (n === 1 && s === 'espases') return 98;
  if (n === 1 && s === 'bastos') return 97;
  if (n === 7 && s === 'espases') return 96;
  if (n === 7 && s === 'oros') return 95;
  if (n === 3) return 90;
  if (n === 1) return 85;
  if (n === 12) return 80;
  if (n === 11) return 75;
  if (n === 10) return 70;
  if (n === 7) return 65;
  if (n === 6) return 60;
  if (n === 5) return 55;
  return 50;
}
const isAmo = c => c.n === 11 && c.s === 'bastos';
const isMadona = c => c.n === 10 && c.s === 'oros';
const pip = c => (c.n <= 7 ? c.n : 0);
function pairEnvit(a, b) {
  if ((isAmo(a) && isMadona(b)) || (isMadona(a) && isAmo(b))) return 35;
  if (isAmo(a)) return 28 + pip(b);
  if (isAmo(b)) return 28 + pip(a);
  if (isMadona(a)) return 27 + pip(b);
  if (isMadona(b)) return 27 + pip(a);
  if (a.s === b.s) return 20 + pip(a) + pip(b);
  return Math.max(pip(a), pip(b));
}
function envitValue(hand) {
  let best = 0;
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) best = Math.max(best, pairEnvit(hand[i], hand[j]));
  return best;
}
function trickWinner(played) {
  let best = -1, top = [];
  for (const x of played) { const r = cardRank(x.card); if (r > best) { best = r; top = [x]; } else if (r === best) top.push(x); }
  const teams = new Set(top.map(x => x.p % 2));
  if (teams.size === 1) return { team: top[0].p % 2, player: top[0].p, tie: false };
  return { team: null, player: top[0].p, tie: true };
}
function handDecision(res, manoTeam) {
  if (res.length < 2) return undefined;
  const a = res.filter(x => x === 0).length, b = res.filter(x => x === 1).length;
  if (a >= 2) return 0;
  if (b >= 2) return 1;
  if (res.length === 2) {
    if (res[0] === null && res[1] !== null) return res[1];
    if (res[0] !== null && res[1] === null) return res[0];
    return undefined;
  }
  if (res[2] !== null) return res[2];
  if (res[0] !== null) return res[0];
  return manoTeam;
}
function cardPower(c) {
  const r = cardRank(c);
  if (r >= 95) return 3;
  if (r >= 90) return 2;
  if (r >= 80) return 1.4;
  if (r >= 70) return 0.9;
  if (r >= 65) return 0.5;
  return 0.15;
}
function signOf(c) {
  if (isAmo(c)) return 'amo';
  if (isMadona(c)) return 'madona';
  if (c.n === 1 && c.s === 'espases') return 'asE';
  if (c.n === 1 && c.s === 'bastos') return 'asB';
  if (c.n === 7 && c.s === 'espases') return 'sieteE';
  if (c.n === 7 && c.s === 'oros') return 'sieteO';
  if (c.n === 3) return 'tres';
  return null;
}
const infoPower = ids => ids.reduce((a, id) => a + (SIGN_POWER[id] || 0), 0);
const handPower = h => h.reduce((a, c) => a + cardPower(c), 0);

// ---------- Nivells dels bots ----------
// «normal» és el bot de sempre. «dificil» i «mestre» surten de l'entrenament
// (node tools/entrena-bots.js), que desa els valors a bots-entrenats.json.
const BASE = {
  noise: 1, trickWon: 1.5, trickLost: 1.2, wMax: 0.65, caughtPen: 0.4, behind: 0,
  trucBase: 3.4, trucStep: 1.15, raiseM: 1.8, accRand: 0.1, callM: 1.0, callP: 0.6, bluff: 0.04,
  envNoise: 1, envAcc: [0, 25, 27, 29, 33], envRai: [0, 30, 32, 34, 99], envAccRand: 0.08,
  envCall: 27, envCallP: 0.65, envBluff: 0.05,
  lead0: 1, secure: 0, mistake: 0, mc: 0
};
let TRAINED = {};
try { TRAINED = require('./bots-entrenats.json'); } catch (e) { /* encara no s'han entrenat */ }
// El fàcil és poruc: diu «no vull» massa sovint, decideix molt a l'atzar i s'equivoca de carta.
// (Equivocar-se de carta fa poc mal; el que més pesa al truc és saber quan voler i quan cantar.)
const FACIL = Object.assign({}, BASE, {
  noise: 6, trucBase: 5.5, raiseM: 3, accRand: 0.25, callM: 2, callP: 0.3, bluff: 0.01,
  envNoise: 8, envAccRand: 0.35, envCall: 29, envCallP: 0.4, envBluff: 0.02, lead0: 2, mistake: 0.4
});
const DIFICIL = Object.assign({}, BASE, TRAINED.dificil);
// El mestre juga les cartes i decideix els cants mirant moltes mans possibles dels altres (mc = quantes).
const MESTRE = Object.assign({}, DIFICIL, {
  mc: 40, infer: 1, mCall: 0.01, mAcc: 0, mRai: 0.01, mEnvCall: 0, bluffMc: 0.06, envBluffMc: 0.04
}, TRAINED.mestre);
const LEVELS = { facil: FACIL, normal: BASE, dificil: DIFICIL, mestre: MESTRE };
const LEVEL_IDS = Object.keys(LEVELS);

// Probabilitat de guanyar el cantó amb el marcador a–b, suposant que cada mà la pot guanyar
// qualsevol parella i dóna uns punts típics. El mestre la fa servir per decidir segons el marcador.
const HAND_PTS = [[1, 0.3], [2, 0.12], [3, 0.26], [4, 0.1], [5, 0.07], [6, 0.07], [7, 0.03], [9, 0.05]];
const WIN_P = (() => {
  const T = Array.from({ length: 25 }, () => new Float64Array(25));
  for (let a = 24; a >= 0; a--) for (let b = 24; b >= 0; b--) {
    if (a >= 24) { T[a][b] = 1; continue; }
    if (b >= 24) { T[a][b] = 0; continue; }
    let v = 0;
    for (const [k, pr] of HAND_PTS) v += pr * 0.5 * (T[Math.min(24, a + k)][b] + T[a][Math.min(24, b + k)]);
    T[a][b] = v;
  }
  return T;
})();
const winP = (a, b) => (a >= 24 ? 1 : b >= 24 ? 0 : WIN_P[a][b]);

// Qui guanya la mà si tothom juga perfecte amb les cartes que té (cerca alfa-beta).
// Torna 1 si la guanya `team`, 0 si no. Modifica i restaura `hands`, `tricks` i `played`.
function solveHand(hands, tricks, played, leader, manoTeam, team) {
  const rec = (pl, ld, alpha, beta) => {
    if (pl.length === 4) {
      const w = trickWinner(pl);
      tricks.push(w.team);
      const d = handDecision(tricks, manoTeam);
      const v = d !== undefined ? (d === team ? 1 : 0) : rec([], w.player, alpha, beta);
      tricks.pop();
      return v;
    }
    const s = (ld + pl.length) % 4, h = hands[s], maxer = s % 2 === team;
    let best = maxer ? 0 : 1;
    const seen = [];
    for (let i = 0; i < h.length; i++) {
      const c = h[i], r = cardRank(c);
      if (seen.includes(r)) continue; // dues cartes iguals fan el mateix
      seen.push(r);
      h.splice(i, 1); pl.push({ p: s, card: c });
      const v = rec(pl, ld, alpha, beta);
      pl.pop(); h.splice(i, 0, c);
      if (maxer) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (alpha >= beta) break;
    }
    return best;
  };
  return rec(played, leader, 0, 1);
}
const sig = x => 1 / (1 + Math.exp(-x));
const FULL_DECK = makeDeck();
const cardKey = c => c.n + c.s;

class Abort extends Error {}

class Game {
  constructor(room, opts = {}) {
    this.room = room;
    this.speed = opts.speed == null ? 1 : opts.speed;
    this.timerMs = opts.timerMs == null ? 40000 : opts.timerMs;
    // Nivell dels bots rivals; `params` (un per seient) només el fa servir l'entrenament.
    this.level = LEVELS[opts.level] ? opts.level : 'normal';
    this.seatParams = opts.params || null;
    this.rnd = opts.rng || Math.random;
    this.dealRnd = opts.dealRng || Math.random;
    this.token = 0;
    this.G = { cantons: [0, 0], scores: [0, 0], dealer: Math.floor(this.dealRnd() * 4) };
    this.H = null;
    this.pending = null;
    this.lastBy = null;
    this.gaze = [-1, -1, -1, -1];
    this.gzT = [0, 0, 0, 0];
    this.signNext = [0, 0, 0, 0];
    this.signQueue = [[], [], [], []]; // senyes que encara ha de fer cada bot en aquesta mà
    this.signUntil = [0, 0, 0, 0];
    this.signCd = [0, 0, 0, 0];
    this.gazeDirty = false;
    this.lastGazeSend = 0;
    this.iv = null;
    this.finished = false;
    this.stats = { hands: 0, timeouts: 0 };
    this.tally = { hands: [0, 0] }; // mans guanyades per cada parella (per a l'experiència)
  }

  // ---------- Utilitats ----------
  isHuman(s) { const x = this.room.seats[s]; return !!(x && x.human && x.connected); }
  isBot(s) { return !this.isHuman(s); }
  sleep(ms) {
    const t = this.token;
    // A velocitat 0 (entrenament) no s'espera gens.
    if (this.speed === 0) return Promise.resolve().then(() => { if (t !== this.token) throw new Abort(); });
    return new Promise((res, rej) => setTimeout(() => (t === this.token ? res() : rej(new Abort())), ms * this.speed));
  }
  emit(e) { this.room.sendAll({ t: 'ev', e }); }
  emitTo(s, e) { this.room.sendSeat(s, { t: 'ev', e }); }
  snapFor(s) {
    const H = this.H, G = this.G;
    const out = { t: 'snap', phase: this.room.phase, g: { cantons: G.cantons, scores: G.scores, dealer: G.dealer }, h: null };
    if (H) {
      const p = this.pending && this.pending.seats.includes(s) && !(s in this.pending.answers) ? this.pending : null;
      out.h = {
        mano: H.mano, turn: H.turn, over: H.over, trickNo: H.trickNo, tricks: H.tricks, played: H.played,
        trucLevel: H.trucLevel, trucOwner: H.trucOwner, envitLevel: H.envitLevel, envitDone: H.envitDone,
        envitPending: H.envitPending, winPlayer: H.winPlayer, dealt: H.dealt,
        envitFalta: this.envitFalta(), envitMax: this.maxEnvitLevel(),
        counts: H.hands.map(h => h.length), mine: H.hands[s], init: H.initial[s] || [],
        pending: p ? { kind: p.kind, data: p.data, left: Math.max(0, p.deadline - Date.now()) } : null
      };
    }
    return out;
  }
  snap() { for (let s = 0; s < 4; s++) if (this.isHuman(s)) this.room.sendSeat(s, this.snapFor(s)); }
  sendGaze(force) {
    const now = Date.now();
    if (!force && now - this.lastGazeSend < 150) return;
    this.lastGazeSend = now; this.gazeDirty = false;
    this.room.sendAll({ t: 'gz', g: this.gaze.slice() });
  }

  // ---------- Cicle de vida ----------
  start() {
    this.token++;
    this.iv = setInterval(() => { try { this.tick(0.1); } catch (e) { console.error('tick', e); } }, 100);
    this.run().then(() => { this.finished = true; this.stop(); if (this.room.onGameOver) this.room.onGameOver(); })
      .catch(e => { if (!(e instanceof Abort)) console.error('game error', e); });
  }
  stop() {
    this.token++;
    if (this.iv) { clearInterval(this.iv); this.iv = null; }
    if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.reject(new Abort()); }
  }
  onDisconnect(s) {
    this.gaze[s] = -1; this.gazeDirty = true;
    const p = this.pending;
    if (p && p.seats.includes(s)) {
      p.seats = p.seats.filter(x => x !== s);
      delete p.answers[s];
      // Si encara hi ha un altre humà que pot respondre, l'esperam a ell.
      if (!p.seats.length) { clearTimeout(p.timer); this.pending = null; p.by = s; p.resolve(this.fallback(p.kind, s, p.data)); }
      else if (p.seats.every(x => x in p.answers)) this.finishAsk(p);
    }
    this.snap();
  }
  onReconnect(s) {
    this.room.sendSeat(s, this.snapFor(s));
    this.room.sendSeat(s, { t: 'gz', g: this.gaze.slice() });
  }

  // ---------- Preguntar a una persona ----------
  // `seats` pot ser un seient o una llista (la parella que respon un cant).
  // Resol amb la resposta; el seient que l'ha donada queda a `this.lastBy`.
  ask(seats, kind, data) {
    seats = Array.isArray(seats) ? seats.slice() : [seats];
    return new Promise((resolve, reject) => {
      const p = { seats, kind, data, answers: {}, deadline: 0, resolve: v => { this.lastBy = p.by; resolve(v); }, reject, timer: null, by: seats[0] };
      this.pending = p;
      this.armAsk(p, this.timerMs);
      this.snap();
    });
  }
  armAsk(p, ms) {
    clearTimeout(p.timer);
    p.deadline = Date.now() + ms;
    p.timer = setTimeout(() => {
      if (this.pending !== p) return;
      const anyAnswer = Object.keys(p.answers).length > 0;
      if (!anyAnswer) {
        this.stats.timeouts++;
        for (const s of p.seats) this.emit({ e: 'timeout', p: s, a: p.kind === 'turn' ? 'play' : 'no' });
      }
      if (p.kind === 'turn') { this.pending = null; p.by = p.seats[0]; p.resolve(this.timeoutPlay(p.seats[0])); }
      else this.finishAsk(p);
    }, ms);
  }
  // Tanca una resposta de parella: guanya la resposta que més vol.
  finishAsk(p) {
    if (this.pending !== p) return;
    clearTimeout(p.timer); this.pending = null;
    let best = 'no', by = p.seats[0];
    for (const [seat, a] of Object.entries(p.answers)) if (ANS_RANK[a] > ANS_RANK[best] || (best === 'no' && a === 'no')) { best = a; by = Number(seat); }
    p.by = by; p.resolve(best);
  }
  timeoutPlay(seat) {
    const hand = this.H.hands[seat]; let idx = 0;
    hand.forEach((c, i) => { if (cardRank(c) < cardRank(hand[idx])) idx = i; });
    return { type: 'play', idx };
  }
  fallback(kind, seat, data) {
    if (kind === 'turn') return this.botTurn(seat);
    return data.kind === 'truc' ? this.botRespondTruc(seat, data.level) : this.botRespondEnvit(seat, data.level);
  }
  handleAct(seat, a) {
    const p = this.pending, H = this.H;
    if (!p || !p.seats.includes(seat) || !H) return;
    if (p.kind === 'turn') {
      if (!a || typeof a !== 'object') return;
      if (a.type === 'play') {
        if (!Number.isInteger(a.idx) || a.idx < 0 || a.idx >= H.hands[seat].length) return;
      } else if (a.type === 'truc') { if (!this.canCallTruc(seat)) return; }
      else if (a.type === 'envit') { if (!this.canCallEnvit(seat)) return; }
      else if (a.type !== 'fold') return;
      a = a.type === 'play' ? { type: 'play', idx: a.idx } : { type: a.type };
    } else {
      if (a !== 'vull' && a !== 'no' && a !== 'raise') return;
      if (a === 'raise' && p.data.level >= (p.data.kind === 'envit' ? this.maxEnvitLevel() : 4)) return;
      if (seat in p.answers) return;
      p.answers[seat] = a;
      // Pujar ja és el màxim, o ja han contestat tots: es decideix ara.
      if (a === 'raise' || p.seats.every(x => x in p.answers)) { this.finishAsk(p); return; }
      // Primer que contesta: el company ho veu i té uns segons per dir-hi la seva.
      this.emit({ e: 'teamAns', p: seat, a, kind: p.data.kind, level: p.data.level });
      this.armAsk(p, Math.min(TEAM_WINDOW_MS, Math.max(0, p.deadline - Date.now()) + 1500, this.timerMs));
      this.snap();
      return;
    }
    clearTimeout(p.timer); this.pending = null; p.by = seat; p.resolve(a);
  }

  // ---------- Regles de crida ----------
  canCallTruc(p) { const H = this.H; return !!H && !H.over && H.trucLevel < 4 && (H.trucOwner === null || H.trucOwner === p % 2); }
  // L'envit es pot cantar a la primera ronda, també si ja s'ha acceptat el truc.
  canCallEnvit(p) { const H = this.H; return !!H && !H.over && H.trickNo === 0 && !H.envitDone; }
  // «Envit tots» val els punts que falten a la parella que va davant per arribar a 24.
  envitFalta() { const sc = this.G.scores; return 24 - Math.max(sc[0], sc[1]); }
  envitPts(level) { return level === 4 ? this.envitFalta() : ENVIT_VALUE[level]; }
  // Només es pot pujar a «tots» si val més que el «2 més» (6 punts).
  maxEnvitLevel() { return this.envitFalta() > ENVIT_VALUE[3] ? 4 : 3; }

  // ---------- Marcador ----------
  addScore(t, pts) {
    const G = this.G;
    G.scores[t] = Math.min(24, G.scores[t] + pts);
    if (G.scores[t] >= 24) this.H.over = true;
  }
  endHand(t, pts, info) {
    this.H.over = true; this.H.result = { t, pts };
    this.snap(); this.emit(Object.assign({ e: 'result', t, pts }, info));
  }
  async finishHand() {
    const H = this.H, G = this.G;
    const done = () => G.scores[0] >= 24 || G.scores[1] >= 24;
    if (done()) return;
    if (H.envitPending) {
      this.emit({ e: 'envitSoon' });
      await this.sleep(1000);
      H.envitPending = false;
      await this.showdownEnvit(H.envitLevel);
      if (done()) return;
    }
    if (H.result) { this.tally.hands[H.result.t]++; this.addScore(H.result.t, H.result.pts); this.snap(); }
  }

  // ---------- IA dels bots ----------
  // Paràmetres del bot del seient p: tots els bots de la partida (també el company) juguen al nivell triat.
  bp(p) { return this.seatParams ? this.seatParams[p] : LEVELS[this.level]; }
  botStrength(p, P) {
    const H = this.H;
    let s = handPower(H.hands[p]);
    for (const r of H.tricks) { if (r === p % 2) s += P.trickWon; else if (r !== null) s -= P.trickLost; }
    return s + P.noise * (this.rnd() - 0.5);
  }
  // Llindar per voler el truc; amb `behind` el bot arrisca més quan va per darrere.
  trucThr(p, level, P) {
    const sc = this.G.scores, t = p % 2;
    return P.trucBase + P.trucStep * (level - 1) - P.behind * (sc[1 - t] - sc[t]) / 12;
  }
  partnerEstimate(q) {
    const H = this.H, n = H.hands[q].length, ids = H.info[q];
    if (!ids.length) return 1.18 * n;
    const known = ids.filter(id => id !== 'buit').length;
    return infoPower(ids) + Math.max(0, n - known) * (ids.includes('buit') ? 0.2 : 0.7);
  }
  teamStrength(p) {
    const H = this.H, q = (p + 2) % 4, P = this.bp(p), a = this.botStrength(p, P);
    const b = this.isBot(q) ? this.botStrength(q, P) : this.partnerEstimate(q);
    let s = P.wMax * Math.max(a, b) + (1 - P.wMax) * Math.min(a, b);
    s -= P.caughtPen * infoPower(H.caught[1 - p % 2]);
    return s;
  }
  teamEnvit(p) {
    const H = this.H, q = (p + 2) % 4, a = envitValue(H.initial[p]);
    if (this.isBot(q)) return Math.max(a, envitValue(H.initial[q]));
    let e = a;
    if (H.info[q].includes('amo')) e = Math.max(e, 28);
    else if (H.info[q].includes('madona')) e = Math.max(e, 27);
    return e;
  }
  botRespondTruc(p, level) {
    const P = this.bp(p);
    if (P.mc) return this.mcRespond(p, 'truc', level);
    const s = this.teamStrength(p), thr = this.trucThr(p, level, P);
    if (level < 4 && s >= thr + P.raiseM) return 'raise';
    if (s >= thr) return 'vull';
    if (this.rnd() < P.accRand) return 'vull';
    return 'no';
  }
  botWantsTruc(p) {
    const P = this.bp(p), level = this.H.trucLevel + 1, s = this.teamStrength(p), thr = this.trucThr(p, level, P) + P.callM;
    if (s >= thr && this.rnd() < P.callP) return true;
    if (level === 1 && s < thr && this.rnd() < P.bluff) return true;
    return false;
  }
  botRespondEnvit(p, level) {
    const H = this.H, P = this.bp(p);
    if (P.mc) return this.mcRespond(p, 'envit', level);
    let e = this.teamEnvit(p) + P.envNoise * (this.rnd() * 2 - 1);
    const c = H.caught[1 - p % 2];
    if (c.includes('amo') || c.includes('madona')) e -= 2;
    const acc = P.envAcc[level], rai = P.envRai[level];
    if (level < this.maxEnvitLevel() && e >= rai) return 'raise';
    if (e >= acc) return 'vull';
    if (this.rnd() < P.envAccRand) return 'vull';
    return 'no';
  }
  botWantsEnvit(p) {
    const P = this.bp(p), e = this.teamEnvit(p);
    if (e >= P.envCall && this.rnd() < P.envCallP) return true;
    if (e < 24 && this.rnd() < P.envBluff) return true;
    return false;
  }

  // ---------- Bot mestre ----------
  // Reparteix moltes vegades les cartes que el bot no veu (respectant les senyes que sap)
  // i dóna més pes a les mans que expliquen el que han cantat els rivals.
  mcWorlds(p) {
    const H = this.H, P = this.bp(p), q = (p + 2) % 4, me = p % 2;
    const known = [0, 1, 2, 3].map(s => s === p || (s === q && this.isBot(q)));
    const out = new Set();
    for (let s = 0; s < 4; s++) if (known[s]) H.hands[s].forEach(c => out.add(cardKey(c)));
    H.gone.forEach(x => out.add(cardKey(x.card)));
    const pool = FULL_DECK.filter(c => !out.has(cardKey(c)));
    const unk = [0, 1, 2, 3].filter(s => !known[s]);
    const need = Array.from(new Set(H.caught[1 - me])).map(id => ({ seats: unk.filter(s => s % 2 !== me), id }));
    if (!known[q]) for (const id of H.info[q]) if (id !== 'buit') need.push({ seats: [q], id });
    const empty = !known[q] && H.info[q].includes('buit') ? q : -1;
    const goneBy = [0, 1, 2, 3].map(s => H.gone.filter(x => x.p === s).map(x => x.card));
    const worlds = [];
    for (let i = 0; i < P.mc; i++) {
      const deck = shuffle(pool, this.rnd), hands = H.hands.map((h, s) => (known[s] ? h.slice() : []));
      for (const nd of need) {
        const cand = nd.seats.filter(s => hands[s].length < H.hands[s].length), j = deck.findIndex(c => signOf(c) === nd.id);
        if (!cand.length || j < 0) continue;
        hands[cand[Math.floor(this.rnd() * cand.length)]].push(deck.splice(j, 1)[0]);
      }
      for (const s of unk) while (hands[s].length < H.hands[s].length) {
        let j = s === empty ? deck.findIndex(c => !signOf(c)) : 0;
        if (j < 0) j = 0;
        hands[s].push(deck.splice(j, 1)[0]);
      }
      const init = hands.map((h, s) => (known[s] ? H.initial[s] : goneBy[s].concat(h)));
      worlds.push({ hands, init, w: P.infer ? this.mcWeight(init, 1 - me) : 1 });
    }
    return worlds;
  }
  mcWeight(init, o) {
    const env = Math.max(envitValue(init[o]), envitValue(init[o + 2]));
    const a = handPower(init[o]), b = handPower(init[o + 2]), pow = 0.65 * Math.max(a, b) + 0.35 * Math.min(a, b);
    let w = 1;
    for (const x of this.H.acts) {
      if (x.team !== o) continue;
      if (x.kind === 'envit') w *= x.a === 'no' ? 0.3 + 0.7 * sig((26 - env) / 2) : 0.3 + 0.7 * sig((env - (x.a === 'vull' ? 25 : 27)) / 2);
      else if (x.a !== 'no') w *= 0.35 + 0.65 * sig((pow - (x.a === 'vull' ? 3 : 4)) / 1.2);
    }
    return w;
  }
  // Probabilitat que la parella de p guanyi l'envit.
  mcEnvit(p, worlds) {
    const mano = this.H.mano;
    let tot = 0, win = 0;
    for (const W of worlds) {
      let best = -1, bt = 0;
      for (let i = 0; i < 4; i++) { const s = (mano + i) % 4, v = envitValue(W.init[s]); if (v > best) { best = v; bt = s % 2; } }
      tot += W.w; if (bt === p % 2) win += W.w;
    }
    return tot ? win / tot : 0.5;
  }
  // Probabilitat de guanyar la mà des d'ara; si li toca a p, una per cada carta que pot tirar.
  mcHand(p, worlds) {
    const H = this.H, me = p % 2, manoTeam = H.mano % 2;
    const leader = H.played.length ? H.played[0].p : H.turn;
    const mover = (leader + H.played.length) % 4;
    const idxs = mover === p ? H.hands[p].map((c, i) => i) : [-1];
    const sum = idxs.map(() => 0);
    let tot = 0;
    for (const W of worlds) {
      tot += W.w;
      idxs.forEach((i, k) => {
        const hands = W.hands.map(h => h.slice()), played = H.played.slice(), tricks = H.tricks.slice();
        if (i >= 0) played.push({ p, card: hands[p].splice(i, 1)[0] });
        sum[k] += W.w * solveHand(hands, tricks, played, leader, manoTeam, me);
      });
    }
    return { idxs, vals: sum.map(v => (tot ? v / tot : 0.5)) };
  }
  // Valor d'un resultat: probabilitat de guanyar el cantó si la parella de p suma `a` i els rivals `b`.
  util(p, a, b) { const sc = this.G.scores, t = p % 2; return winP(sc[t] + a, sc[1 - t] + b); }
  mcRespond(p, kind, level) {
    const P = this.bp(p), worlds = this.mcWorlds(p);
    let pw, V, R, V2 = 0;
    if (kind === 'truc') {
      pw = this.mcHand(p, worlds).vals[0];
      V = TRUC_VALUE[level]; R = TRUC_REFUSE[level]; if (level < 4) V2 = TRUC_VALUE[level + 1];
    } else {
      pw = this.mcEnvit(p, worlds);
      V = this.envitPts(level); R = ENVIT_REFUSE[level]; if (level < this.maxEnvitLevel()) V2 = this.envitPts(level + 1);
    }
    const uNo = this.util(p, 0, R), uAcc = pw * this.util(p, V, 0) + (1 - pw) * this.util(p, 0, V);
    // Si pujam, els rivals triaran el que menys ens convé: no voler (ens donen V) o jugar-s'ho a V2.
    const uRaise = V2 ? Math.min(this.util(p, V, 0), pw * this.util(p, V2, 0) + (1 - pw) * this.util(p, 0, V2)) : -1;
    if (V2 && uRaise > Math.max(uAcc, uNo) + P.mRai) return 'raise';
    return uAcc + P.mAcc >= uNo ? 'vull' : 'no';
  }
  mcTurn(p) {
    const H = this.H, P = this.bp(p), worlds = this.mcWorlds(p);
    if (this.canCallEnvit(p)) {
      const pe = this.mcEnvit(p, worlds), V = this.envitPts(1);
      const uCall = Math.min(this.util(p, ENVIT_REFUSE[1], 0), pe * this.util(p, V, 0) + (1 - pe) * this.util(p, 0, V));
      if (uCall > this.util(p, 0, 0) + P.mEnvCall || (pe < 0.3 && this.rnd() < P.envBluffMc)) return { type: 'envit' };
    }
    const { idxs, vals } = this.mcHand(p, worlds), hand = H.hands[p];
    let k = 0;
    for (let j = 1; j < idxs.length; j++) {
      // A igualtat, la carta més baixa: les bones es guarden
      if (vals[j] > vals[k] + 1e-9 || (Math.abs(vals[j] - vals[k]) <= 1e-9 && cardRank(hand[idxs[j]]) < cardRank(hand[idxs[k]]))) k = j;
    }
    const pw = vals[k];
    if (this.canCallTruc(p)) {
      const L = H.trucLevel + 1, V0 = TRUC_VALUE[L - 1], V = TRUC_VALUE[L];
      const uPass = pw * this.util(p, V0, 0) + (1 - pw) * this.util(p, 0, V0);
      const uCall = Math.min(this.util(p, TRUC_REFUSE[L], 0), pw * this.util(p, V, 0) + (1 - pw) * this.util(p, 0, V));
      if (uCall > uPass + P.mCall || (L === 1 && pw < 0.35 && this.rnd() < P.bluffMc)) return { type: 'truc' };
    }
    // Si el company humà ha dit «vaig a tu» o «vina a mi», li fa cas.
    if (this.isHuman((p + 2) % 4) && this.intentFor(p)) return { type: 'play', idx: this.botChooseCard(p) };
    return { type: 'play', idx: idxs[k] };
  }
  intentFor(p) {
    const H = this.H, q = (p + 2) % 4;
    if (H.say[q] === 'tu') return 'best';
    if (H.say[q] === 'mi') return 'low';
    if (H.say[p] === 'mi') return 'best';
    if (H.say[p] === 'tu') return 'low';
    return null;
  }
  botChooseCard(p) {
    const H = this.H, hand = H.hands[p], P = this.bp(p);
    if (P.mistake && this.rnd() < P.mistake) return Math.floor(this.rnd() * hand.length);
    const sorted = hand.map((c, i) => ({ i, r: cardRank(c) })).sort((a, b) => a.r - b.r);
    const lowest = sorted[0], highest = sorted[sorted.length - 1], trick = H.played;
    const intent = this.intentFor(p);
    if (intent === 'low') return lowest.i;
    if (intent === 'best') {
      if (trick.length === 0) return highest.i;
      let bb = trick[0];
      for (const x of trick) if (cardRank(x.card) > cardRank(bb.card)) bb = x;
      if (bb.p % 2 === p % 2 || highest.r <= cardRank(bb.card)) return lowest.i;
      return highest.i;
    }
    if (trick.length === 0) {
      // Per sortir a la primera: lead0 0 = la més baixa, 1 = la del mig, 2 = la més alta
      if (H.trickNo === 0) return (P.lead0 === 0 ? lowest : P.lead0 === 2 ? highest : sorted[Math.floor((sorted.length - 1) / 2)]).i;
      return highest.i;
    }
    let best = trick[0];
    for (const x of trick) if (cardRank(x.card) > cardRank(best.card)) best = x;
    const bestRank = cardRank(best.card);
    if (best.p % 2 === p % 2) return lowest.i;
    const beating = sorted.filter(x => x.r > bestRank);
    // Si encara ha de tirar un rival, de vegades assegura amb la més alta en lloc de la justa
    if (beating.length) return (trick.length < 3 && this.rnd() < P.secure ? beating[beating.length - 1] : beating[0]).i;
    const equal = sorted.find(x => x.r === bestRank);
    if (equal && H.trickNo === 0) return equal.i;
    return lowest.i;
  }
  botTurn(p) {
    const H = this.H;
    if (H.ask[p]) {
      H.ask[p] = false;
      if (this.canCallEnvit(p)) return { type: 'envit' };
    }
    if (this.bp(p).mc) return this.mcTurn(p);
    if (this.canCallEnvit(p) && this.botWantsEnvit(p)) return { type: 'envit' };
    if (this.canCallTruc(p) && this.botWantsTruc(p)) return { type: 'truc' };
    return { type: 'play', idx: this.botChooseCard(p) };
  }
  async botAnnounce() {
    const H = this.H;
    let any = false;
    for (let p = 0; p < 4; p++) {
      if (!this.isBot(p) || !H.hands[p].length) continue;
      const top = Math.max(...H.hands[p].map(cardRank));
      const w = top >= 90 ? 'mi' : top <= 65 ? 'tu' : null;
      const partnerHuman = this.isHuman((p + 2) % 4);
      if (w && this.rnd() < (partnerHuman ? 0.85 : 0.35)) {
        H.say[p] = w; this.emit({ e: 'talk', p, w }); any = true;
      }
    }
    if (any) await this.sleep(1000);
  }

  // ---------- Mirades i senyes ----------
  pickGaze(p) {
    const q = (p + 2) % 4, o1 = (p + 1) % 4, o2 = (p + 3) % 4, r = Math.random();
    if (this.isHuman(q)) return r < 0.55 ? q : r < 0.7 ? -1 : r < 0.85 ? o1 : o2;
    return r < 0.5 ? q : r < 0.7 ? o1 : r < 0.85 ? o2 : -1;
  }
  // Com al truc de veres: cada bot fa les seves senyes una sola vegada per mà (una per carta bona,
  // o «buit» si no en té cap), quan el company el mira.
  signsReset() {
    const n = Date.now() / 1000;
    for (let p = 0; p < 4; p++) {
      this.signNext[p] = n + 1.5 + Math.random() * 2.5;
      const ids = Array.from(new Set(this.H.hands[p].map(signOf).filter(Boolean)));
      this.signQueue[p] = ids.length ? ids : ['buit'];
    }
  }
  // La següent seña per fer (les de cartes que ja ha tirat es descarten); null si ja les ha fetes totes
  chooseSign(p) {
    const H = this.H, q = this.signQueue[p];
    while (q.length) {
      const id = q.shift();
      if (id === 'buit' || H.hands[p].some(c => signOf(c) === id)) return id;
    }
    return null;
  }
  tick(dt) {
    const H = this.H;
    const live = !!H && !H.over && H.dealt;
    for (let p = 0; p < 4; p++) {
      if (this.isHuman(p)) continue;
      if (!live) { if (this.gaze[p] !== -1) { this.gaze[p] = -1; this.gazeDirty = true; } continue; }
      this.gzT[p] -= dt;
      if (this.gzT[p] <= 0) { this.gaze[p] = this.pickGaze(p); this.gzT[p] = 1.2 + Math.random() * 2.2; this.gazeDirty = true; }
    }
    if (this.gazeDirty) this.sendGaze(false);
    if (!live) return;
    const now = Date.now() / 1000;
    for (let p = 0; p < 4; p++) {
      if (!this.isBot(p) || !this.signQueue[p].length || now < this.signUntil[p] || now < this.signNext[p] || H.hands[p].length === 0) continue;
      const q = (p + 2) % 4, o1 = (p + 1) % 4, o2 = (p + 3) % 4;
      const watching = this.gaze[q] === p;
      const danger = this.gaze[o1] === p || this.gaze[o2] === p;
      if (watching && (!danger || Math.random() < 0.12)) {
        const id = this.chooseSign(p);
        if (!id) continue;
        // Mira el company mentre li fa la seña
        if (this.gaze[p] !== q) { this.gaze[p] = q; this.gazeDirty = true; }
        this.gzT[p] = SIGN_DUR[id] + 0.8;
        this.emit({ e: 'sign', p, id });
        this.signUntil[p] = now + SIGN_DUR[id];
        this.signNext[p] = now + SIGN_DUR[id] + 0.5 + Math.random() * 0.5;
      } else this.signNext[p] = now + 0.3;
    }
  }
  onGaze(seat, target) {
    if (!Number.isInteger(target) || target < -1 || target > 3 || target === seat) return;
    if (this.gaze[seat] === target) return;
    this.gaze[seat] = target; this.gazeDirty = true;
  }
  onSign(seat, id) {
    const H = this.H;
    if (!H || H.over || !H.dealt || !SIGN_DUR[id]) return;
    const now = Date.now();
    if (now < this.signCd[seat]) return;
    this.signCd[seat] = now + 1000;
    this.emit({ e: 'sign', p: seat, id });
    const h = H;
    setTimeout(() => {
      if (this.H !== h || h.over) return;
      for (let q = 0; q < 4; q++) {
        if (q === seat || !this.isBot(q) || this.gaze[q] !== seat) continue;
        if (q === (seat + 2) % 4) {
          if (!h.info[seat].includes(id)) h.info[seat].push(id);
          this.emit({ e: 'nod', p: q });
        } else {
          h.caught[seat % 2].push(id);
          this.emitTo(seat, { e: 'caught', p: q });
        }
      }
    }, 450 * Math.max(this.speed, 0.05));
  }
  onTalk(seat, kind) {
    const H = this.H;
    if (!H || H.over || !H.dealt) return;
    const q = (seat + 2) % 4;
    if (kind === 'tu' || kind === 'mi') {
      H.say[seat] = kind;
      this.emit({ e: 'talk', p: seat, w: kind });
      if (this.isBot(q)) setTimeout(() => { if (this.H === H && !H.over) this.emit({ e: 'ok', p: q }); }, 800 * this.speed);
    } else if (kind === 'envit') {
      if (!this.canCallEnvit(q)) { this.emitTo(seat, { e: 'deny', why: 'envit' }); return; }
      if (H.played.some(x => x.p === q)) { this.emitTo(seat, { e: 'deny', why: 'tirat' }); return; }
      if (this.isBot(q)) {
        H.ask[q] = true;
        setTimeout(() => { if (this.H === H && !H.over && H.ask[q]) this.emit({ e: 'yes', p: q }); }, 800 * this.speed);
      }
      this.emit({ e: 'ask', p: seat, to: q });
    }
  }
  forgetSign(seat, card) {
    const id = signOf(card); if (!id) return;
    for (const arr of [this.H.info[seat], this.H.caught[seat % 2]]) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); }
  }

  // ---------- Cants ----------
  // Retorna { d, by }: la resposta i el seient que l'ha donada.
  // Si a la parella que respon hi ha humans, tots ells poden contestar; el primer decideix.
  async respond(callerP, kind, level) {
    const c = [(callerP + 1) % 4, (callerP + 3) % 4];
    const humans = c.filter(s => this.isHuman(s));
    if (humans.length) {
      const d = await this.ask(humans, 'respond', { kind, level, callerP });
      return { d, by: this.lastBy };
    }
    const r = c[0];
    this.emit({ e: 'debate', p: r, q: (r + 2) % 4 });
    this.snap();
    await this.sleep(1600);
    return { d: kind === 'truc' ? this.botRespondTruc(r, level) : this.botRespondEnvit(r, level), by: r };
  }
  async negotiate(kind, caller) {
    const H = this.H, isTruc = kind === 'truc';
    let level = (isTruc ? H.trucLevel : H.envitLevel) + 1;
    let callerP = caller, callerTeam = caller % 2;
    // El mestre recorda qui ha cantat què per endevinar les cartes dels rivals
    H.acts.push({ team: callerTeam, kind, a: 'call' });
    while (true) {
      this.emit({ e: 'call', p: callerP, kind, level, pts: isTruc ? TRUC_VALUE[level] : this.envitPts(level) });
      this.snap();
      await this.sleep(900);
      const respTeam = 1 - callerTeam;
      const { d, by: responder } = await this.respond(callerP, kind, level);
      H.acts.push({ team: respTeam, kind, a: d });
      if (d === 'no') {
        this.emit({ e: 'ans', p: responder, a: 'no' });
        await this.sleep(800);
        if (isTruc) {
          const pts = TRUC_REFUSE[level];
          this.endHand(callerTeam, pts, { how: 'refuse', kind, respTeam });
        } else {
          const pts = ENVIT_REFUSE[level];
          H.envitDone = true;
          this.addScore(callerTeam, pts);
          this.snap();
          this.emit({ e: 'refuse', kind, level, callerTeam, respTeam, pts });
        }
        return;
      }
      if (d === 'vull') {
        this.emit({ e: 'ans', p: responder, a: 'vull' });
        await this.sleep(800);
        if (isTruc) { H.trucLevel = level; H.trucOwner = respTeam; this.snap(); }
        else {
          H.envitLevel = level; H.envitDone = true; H.envitPending = true;
          this.snap(); this.emit({ e: 'envitOk', level, pts: this.envitPts(level) });
          await this.sleep(900);
        }
        return;
      }
      if (isTruc) { H.trucLevel = level; this.snap(); } else H.envitLevel = level;
      callerP = responder; callerTeam = respTeam; level++;
    }
  }
  async showdownEnvit(level) {
    const H = this.H;
    const vals = [0, 1, 2, 3].map(p => envitValue(H.initial[p]));
    let best = -1, bp = 0;
    for (let i = 0; i < 4; i++) { const p = (H.mano + i) % 4; if (vals[p] > best) { best = vals[p]; bp = p; } }
    const pts = this.envitPts(level);
    this.emit({ e: 'envitShow', p: bp, val: best, wt: bp % 2, pts });
    this.addScore(bp % 2, pts);
    this.snap();
    await this.sleep(1600);
  }

  // ---------- Torn ----------
  async takeTurn(p) {
    const H = this.H;
    H.turn = p;
    while (true) {
      if (H.over) return;
      let act;
      if (this.isHuman(p)) act = await this.ask(p, 'turn', {});
      else { this.snap(); await this.sleep(650 + Math.random() * 500); act = this.botTurn(p); }
      if (H.over) return;
      if (act.type === 'play') {
        const card = H.hands[p].splice(act.idx, 1)[0];
        this.forgetSign(p, card);
        H.played.push({ p, card });
        H.gone.push({ p, card });
        H.turn = null;
        this.snap(); this.emit({ e: 'play', p, card });
        return;
      }
      if (act.type === 'fold') {
        const t = 1 - p % 2, pts = TRUC_VALUE[H.trucLevel];
        this.endHand(t, pts, { how: 'fold', p });
        return;
      }
      await this.negotiate(act.type, p);
      if (H.over) return;
      H.turn = p; this.snap();
    }
  }

  // ---------- Una mà ----------
  async playHand() {
    const G = this.G, deck = shuffle(makeDeck(), this.dealRnd);
    const H = this.H = {
      hands: [[], [], [], []], initial: [], mano: (G.dealer + 1) % 4, trucLevel: 0, trucOwner: null,
      envitLevel: 0, envitDone: false, envitPending: false, tricks: [], played: [], trickNo: 0, turn: null,
      over: false, winPlayer: null, dealt: false, result: null, gone: [], acts: [],
      info: [[], [], [], []], caught: [[], []], say: [null, null, null, null], ask: [false, false, false, false]
    };
    for (let p = 0; p < 4; p++) {
      H.hands[p] = deck.splice(0, 3).sort((a, b) => cardRank(b) - cardRank(a));
      H.initial[p] = H.hands[p].slice();
    }
    this.stats.hands++;
    this.snap(); this.emit({ e: 'deal', dealer: G.dealer, mano: H.mano });
    await this.sleep(900);
    this.signsReset();
    H.dealt = true; this.snap();
    let leader = H.mano, winnerTeam;
    for (let t = 0; t < 3 && !H.over; t++) {
      H.trickNo = t; H.played = []; H.winPlayer = null;
      H.say = [null, null, null, null];
      if (t > 0) H.ask = [false, false, false, false];
      this.snap();
      await this.botAnnounce();
      for (let i = 0; i < 4 && !H.over; i++) await this.takeTurn((leader + i) % 4);
      if (H.over) break;
      const w = trickWinner(H.played);
      H.tricks.push(w.team); H.winPlayer = w.tie ? null : w.player;
      this.snap(); this.emit({ e: 'trick', team: w.team, tie: w.tie });
      await this.sleep(1500);
      leader = w.player; H.played = []; H.winPlayer = null;
      winnerTeam = handDecision(H.tricks, H.mano % 2);
      if (winnerTeam !== undefined) break;
    }
    if (!H.over) this.endHand(winnerTeam, TRUC_VALUE[H.trucLevel], { how: 'win' });
    H.turn = null; this.snap();
    await this.sleep(700);
    await this.finishHand();
    H.dealt = false; this.snap();
    await this.sleep(2100);
  }

  // ---------- Partida ----------
  // Un cantó a 24; torna la parella que el guanya.
  async playCanton() {
    const G = this.G;
    G.scores = [0, 0];
    this.snap();
    while (G.scores[0] < 24 && G.scores[1] < 24) {
      await this.playHand();
      G.dealer = (G.dealer + 1) % 4;
    }
    return G.scores[0] >= 24 ? 0 : 1;
  }
  async run() {
    const G = this.G;
    G.cantons = [0, 0];
    while (G.cantons[0] < 2 && G.cantons[1] < 2) {
      const w = await this.playCanton();
      G.cantons[w]++;
      this.snap();
      const over = G.cantons[w] >= 2;
      this.emit({ e: over ? 'game' : 'canton', w, scores: G.scores.slice(), cantons: G.cantons.slice() });
      if (!over) await this.sleep(4000);
    }
  }
}

module.exports = { Game, makeDeck, cardRank, envitValue, trickWinner, handDecision, signOf, SIGN_DUR, LEVELS, LEVEL_IDS, BASE, mulberry32, solveHand };
