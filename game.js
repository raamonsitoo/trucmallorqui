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
const SIGN_IDS = Object.keys(SIGN_DUR);

function makeDeck() { const d = []; for (const s of SUITS) for (const n of NUMS) d.push({ n, s }); return d; }
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
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
const trucThr = level => 3.4 + 1.15 * (level - 1);

class Abort extends Error {}

class Game {
  constructor(room, opts = {}) {
    this.room = room;
    this.speed = opts.speed == null ? 1 : opts.speed;
    this.timerMs = opts.timerMs == null ? 40000 : opts.timerMs;
    this.token = 0;
    this.G = { cantons: [0, 0], scores: [0, 0], dealer: Math.floor(Math.random() * 4) };
    this.H = null;
    this.pending = null;
    this.lastBy = null;
    this.gaze = [-1, -1, -1, -1];
    this.gzT = [0, 0, 0, 0];
    this.signNext = [0, 0, 0, 0];
    this.signIdx = [0, 0, 0, 0];
    this.signUntil = [0, 0, 0, 0];
    this.signCd = [0, 0, 0, 0];
    this.gazeDirty = false;
    this.lastGazeSend = 0;
    this.iv = null;
    this.finished = false;
    this.stats = { hands: 0, timeouts: 0 };
  }

  // ---------- Utilitats ----------
  isHuman(s) { const x = this.room.seats[s]; return !!(x && x.human && x.connected); }
  isBot(s) { return !this.isHuman(s); }
  sleep(ms) {
    const t = this.token;
    return new Promise((res, rej) => setTimeout(() => (t === this.token ? res() : rej(new Abort())), ms * this.speed));
  }
  emit(e) { this.room.sendAll({ t: 'ev', e }); }
  emitTo(s, e) { this.room.sendSeat(s, { t: 'ev', e }); }
  snapFor(s) {
    const H = this.H, G = this.G;
    const out = { t: 'snap', phase: this.room.phase, g: { cantons: G.cantons, scores: G.scores, dealer: G.dealer }, h: null };
    if (H) {
      const p = this.pending && this.pending.seats.includes(s) ? this.pending : null;
      out.h = {
        mano: H.mano, turn: H.turn, over: H.over, trickNo: H.trickNo, tricks: H.tricks, played: H.played,
        trucLevel: H.trucLevel, trucOwner: H.trucOwner, envitLevel: H.envitLevel, envitDone: H.envitDone,
        envitPending: H.envitPending, winPlayer: H.winPlayer, dealt: H.dealt,
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
      // Si encara hi ha un altre humà que pot respondre, l'esperam a ell.
      if (!p.seats.length) { clearTimeout(p.timer); this.pending = null; p.by = s; p.resolve(this.fallback(p.kind, s, p.data)); }
    }
    this.snap();
  }
  onReconnect(s) {
    this.room.sendSeat(s, this.snapFor(s));
    this.room.sendSeat(s, { t: 'gz', g: this.gaze.slice() });
  }

  // ---------- Preguntar a una persona ----------
  // `seats` pot ser un seient o una llista: el primer que contesta decideix.
  // Resol amb la resposta; el seient que ha contestat queda a `this.lastBy`.
  ask(seats, kind, data) {
    seats = Array.isArray(seats) ? seats.slice() : [seats];
    return new Promise((resolve, reject) => {
      const p = { seats, kind, data, deadline: Date.now() + this.timerMs, resolve: v => { this.lastBy = p.by; resolve(v); }, reject, timer: null, by: seats[0] };
      p.timer = setTimeout(() => {
        if (this.pending !== p) return;
        this.pending = null; this.stats.timeouts++;
        for (const s of p.seats) this.emit({ e: 'timeout', p: s, a: kind === 'turn' ? 'play' : 'no' });
        p.by = p.seats[0];
        p.resolve(kind === 'turn' ? this.timeoutPlay(p.seats[0]) : 'no');
      }, this.timerMs);
      this.pending = p;
      this.snap();
    });
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
      if (a === 'raise' && p.data.level >= 4) return;
    }
    clearTimeout(p.timer); this.pending = null; p.by = seat; p.resolve(a);
  }

  // ---------- Regles de crida ----------
  canCallTruc(p) { const H = this.H; return !!H && !H.over && H.trucLevel < 4 && (H.trucOwner === null || H.trucOwner === p % 2); }
  canCallEnvit(p) { const H = this.H; return !!H && !H.over && H.trickNo === 0 && !H.envitDone && H.trucLevel === 0; }

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
    if (H.result) { this.addScore(H.result.t, H.result.pts); this.snap(); }
  }

  // ---------- IA dels bots ----------
  botStrength(p, noise = true) {
    const H = this.H;
    let s = H.hands[p].reduce((a, c) => a + cardPower(c), 0);
    for (const r of H.tricks) { if (r === p % 2) s += 1.5; else if (r !== null) s -= 1.2; }
    return s + (noise ? Math.random() - 0.5 : 0);
  }
  partnerEstimate(q) {
    const H = this.H, n = H.hands[q].length, ids = H.info[q];
    if (!ids.length) return 1.18 * n;
    const known = ids.filter(id => id !== 'buit').length;
    return infoPower(ids) + Math.max(0, n - known) * (ids.includes('buit') ? 0.2 : 0.7);
  }
  teamStrength(p) {
    const H = this.H, q = (p + 2) % 4, a = this.botStrength(p);
    const b = this.isBot(q) ? this.botStrength(q) : this.partnerEstimate(q);
    let s = 0.65 * Math.max(a, b) + 0.35 * Math.min(a, b);
    s -= 0.4 * infoPower(H.caught[1 - p % 2]);
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
    const s = this.teamStrength(p), thr = trucThr(level);
    if (level < 4 && s >= thr + 1.8) return 'raise';
    if (s >= thr) return 'vull';
    if (Math.random() < 0.1) return 'vull';
    return 'no';
  }
  botWantsTruc(p) {
    const level = this.H.trucLevel + 1, s = this.teamStrength(p), thr = trucThr(level) + 1.0;
    if (s >= thr && Math.random() < 0.6) return true;
    if (level === 1 && s < thr && Math.random() < 0.04) return true;
    return false;
  }
  botRespondEnvit(p, level) {
    const H = this.H;
    let e = this.teamEnvit(p) + (Math.random() * 2 - 1);
    const c = H.caught[1 - p % 2];
    if (c.includes('amo') || c.includes('madona')) e -= 2;
    const acc = [0, 25, 27, 29, 33][level], rai = [0, 30, 32, 34, 99][level];
    if (level < 4 && e >= rai) return 'raise';
    if (e >= acc) return 'vull';
    if (Math.random() < 0.08) return 'vull';
    return 'no';
  }
  botWantsEnvit(p) {
    const e = this.teamEnvit(p);
    if (e >= 27 && Math.random() < 0.65) return true;
    if (e < 24 && Math.random() < 0.05) return true;
    return false;
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
    const H = this.H, hand = H.hands[p];
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
      if (H.trickNo === 0) return sorted[Math.floor((sorted.length - 1) / 2)].i;
      return highest.i;
    }
    let best = trick[0];
    for (const x of trick) if (cardRank(x.card) > cardRank(best.card)) best = x;
    const bestRank = cardRank(best.card);
    if (best.p % 2 === p % 2) return lowest.i;
    const beating = sorted.filter(x => x.r > bestRank);
    if (beating.length) return beating[0].i;
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
      if (w && Math.random() < (partnerHuman ? 0.85 : 0.35)) {
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
  signsReset() {
    const n = Date.now() / 1000;
    for (let p = 0; p < 4; p++) { this.signNext[p] = n + 1.5 + Math.random() * 2.5; this.signIdx[p] = 0; }
  }
  chooseSign(p) {
    const H = this.H;
    const partnerHuman = this.isHuman((p + 2) % 4);
    if (!partnerHuman && Math.random() < 0.08) return SIGN_IDS[Math.floor(Math.random() * SIGN_IDS.length)];
    const ids = H.hands[p].map(signOf).filter(Boolean);
    if (!ids.length) return 'buit';
    this.signIdx[p] = (this.signIdx[p] + 1) % ids.length;
    return ids[this.signIdx[p]];
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
      if (!this.isBot(p) || now < this.signUntil[p] || now < this.signNext[p] || H.hands[p].length === 0) continue;
      const q = (p + 2) % 4, o1 = (p + 1) % 4, o2 = (p + 3) % 4;
      const watching = this.gaze[q] === p;
      const danger = this.gaze[o1] === p || this.gaze[o2] === p;
      if (watching && (!danger || Math.random() < 0.12)) {
        const id = this.chooseSign(p);
        this.emit({ e: 'sign', p, id });
        this.signUntil[p] = now + SIGN_DUR[id];
        this.signNext[p] = now + 2.6 + Math.random() * 3.2;
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
    while (true) {
      this.emit({ e: 'call', p: callerP, kind, level });
      this.snap();
      await this.sleep(900);
      const respTeam = 1 - callerTeam;
      const { d, by: responder } = await this.respond(callerP, kind, level);
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
          this.snap(); this.emit({ e: 'envitOk', level });
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
    const pts = ENVIT_VALUE[level];
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
    const G = this.G, deck = shuffle(makeDeck());
    const H = this.H = {
      hands: [[], [], [], []], initial: [], mano: (G.dealer + 1) % 4, trucLevel: 0, trucOwner: null,
      envitLevel: 0, envitDone: false, envitPending: false, tricks: [], played: [], trickNo: 0, turn: null,
      over: false, winPlayer: null, dealt: false, result: null,
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
  async run() {
    const G = this.G;
    G.cantons = [0, 0];
    while (G.cantons[0] < 2 && G.cantons[1] < 2) {
      G.scores = [0, 0];
      this.snap();
      while (G.scores[0] < 24 && G.scores[1] < 24) {
        await this.playHand();
        G.dealer = (G.dealer + 1) % 4;
      }
      const w = G.scores[0] >= 24 ? 0 : 1;
      G.cantons[w]++;
      this.snap();
      const over = G.cantons[w] >= 2;
      this.emit({ e: over ? 'game' : 'canton', w, scores: G.scores.slice(), cantons: G.cantons.slice() });
      if (!over) await this.sleep(4000);
    }
  }
}

module.exports = { Game, makeDeck, cardRank, envitValue, trickWinner, handDecision, signOf, SIGN_DUR };
