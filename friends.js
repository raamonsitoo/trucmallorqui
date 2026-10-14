'use strict';
// Amics: sol·licituds (en acabar una partida), llista amb qui està connectat i on, i invitacions a la sala.
// Només per a qui ha entrat amb Google. Qui està connectat es calcula aquí, en memòria: no es desa enlloc.
const INVITE_MS = 30000;      // temps per contestar una invitació
const INVITE_GAP_MS = 15000;  // no tornar a convidar el mateix amic abans d'això
const ASKS_PER_HOUR = 30;     // sol·licituds d'amistat per compte i hora

module.exports = function makeFriends({ acc, send, err, roomOf, joinable, stats }) {
  const online = new Map();   // uid → Set de connexions
  const cache = new Map();    // uid → { hidden, list: Map(id → fila de la base de dades) }  (dels connectats)
  const sentKey = new WeakMap(); // connexió → la darrera llista que se li ha enviat (per enviar-la només si canvia)
  const gone = new Map();     // uid → quan es va desconnectar
  const invited = new Map();  // 'de>a' → hora de la darrera invitació
  const asks = new Map();     // uid → hores de les sol·licituds enviades
  let soonT = null;

  const levelOf = xp => acc.levelOf(xp || 0);
  const socks = uid => online.get(uid) || new Set();
  const isOn = uid => socks(uid).size > 0;

  // On és (com el veuen els amics): off, on (al menú), room (a una sala d'espera) o game (jugant)
  function statusOf(uid) {
    const me = cache.get(uid);
    if (!isOn(uid) || (me && me.hidden)) return { st: 'off' };
    let best = { st: 'on' };
    for (const ws of socks(uid)) {
      const r = roomOf(ws); if (!r) continue;
      if (r.phase === 'playing') {
        const t = ws.ctx.seat % 2, g = r.game && r.game.G;
        return { st: 'game', sc: g ? [g.scores[t], g.scores[1 - t]] : null, bots: r.humans() <= 1, ask: joinable(r) ? r.code : null };
      }
      best = { st: 'room', code: r.seats.some(x => !x.human) ? r.code : null };
    }
    return best;
  }
  function row(me, f) {
    const s = f.ok ? statusOf(f.id) : { st: 'off' };
    const live = cache.get(f.id), hid = live ? live.hidden : f.hidden;
    const seen = gone.get(f.id) || (f.last_seen ? new Date(f.last_seen).getTime() : 0);
    return Object.assign({ id: f.id, name: f.name, look: f.look, hat: f.hat, lvl: levelOf(f.xp), ok: f.ok, mine: f.asker === me,
      ago: s.st === 'off' && f.ok && !hid && seen ? Math.max(0, Math.round((Date.now() - seen) / 1000)) : null }, s);
  }
  function listFor(uid) {
    const me = cache.get(uid); if (!me) return [];
    return Array.from(me.list.values()).map(f => row(uid, f));
  }
  // Envia la llista si ha canviat res del que veu (on és cada amic, el marcador…); «fa quant» no compta,
  // perquè canvia cada segon: el client el va sumant tot sol
  function sendList(ws, force) {
    const uid = ws.ctx && ws.ctx.uid; if (!uid) return;
    const me = cache.get(uid), list = listFor(uid), hidden = !!(me && me.hidden);
    const key = JSON.stringify([hidden, list.map(f => Object.assign({}, f, { ago: f.ago == null ? null : 1 }))]);
    if (!force && sentKey.get(ws) === key) return;
    sentKey.set(ws, key);
    send(ws, { t: 'friends', list, hidden });
  }
  const pushTo = uid => { for (const ws of socks(uid)) sendList(ws); };
  async function load(uid) {
    const rows = await acc.store.friendList(uid);
    const prev = cache.get(uid);
    cache.set(uid, { hidden: prev ? prev.hidden : false, list: new Map(rows.map(r => [r.id, r])) });
  }
  // Ha canviat on és: que ho vegin els amics connectats
  function notify(uid) {
    const me = cache.get(uid); if (!me) return;
    for (const [id, f] of me.list) if (f.ok && isOn(id)) pushTo(id);
  }
  // Ha canviat una amistat entre a i b: es torna a llegir per als dos (si són connectats)
  async function reload(a, b) {
    for (const u of [a, b]) if (isOn(u)) await load(u);
    pushTo(a); pushTo(b);
  }
  const nameIn = (uid, of) => { const e = cache.get(uid), f = e && e.list.get(of); return f ? f.name : null; };

  return {
    // Acaba d'entrar amb el seu compte
    async onAuth(ws, profile) {
      const uid = ws.ctx.uid; if (!uid) return;
      if (!online.has(uid)) online.set(uid, new Set());
      online.get(uid).add(ws);
      try { await load(uid); } catch (e) { console.error('amics', e.message); return; }
      cache.get(uid).hidden = !!(profile && profile.hidden);
      gone.delete(uid);
      sendList(ws, true);
      notify(uid);
    },
    // Surt (tanca la sessió, esborra el compte o se'n va): els amics el veuen desconnectat
    onLeave(ws) {
      const uid = ws.ctx && ws.ctx.uid; if (!uid || !online.has(uid)) return;
      const set = online.get(uid); set.delete(ws);
      if (set.size) return;
      online.delete(uid); gone.set(uid, Date.now());
      notify(uid);
      cache.delete(uid);
    },
    // Ha esborrat el compte: els seus amics el deixen de veure
    async onDeleted(uid, friendIds) {
      for (const id of friendIds) if (isOn(id)) { try { await load(id); } catch (e) { /* res */ } pushTo(id); }
    },
    friendIds(uid) { const e = cache.get(uid); return e ? Array.from(e.list.keys()) : []; },
    // Algú ha entrat o sortit d'una sala, o ha començat o acabat una partida: que els amics ho vegin aviat
    soon() { if (!soonT) soonT = setTimeout(() => { soonT = null; try { this.tick(); } catch (e) { console.error('amics', e); } }, 300); },
    // Cada pocs segons (i just després d'entrar o sortir d'una sala): a qui li ha canviat res de la llista, la hi torna a enviar
    tick() {
      for (const uid of online.keys()) pushTo(uid);
      const now = Date.now();
      for (const [k, t] of invited) if (now - t > INVITE_MS) invited.delete(k);
    },
    async handle(ws, m) {
      const c = ws.ctx, me = c.uid;
      if (!acc.ENABLED) return;
      if (!me) return err(ws, 'Entra amb Google per tenir amics.');
      const id = Number(m.id), ent = cache.get(me);
      if (!ent) return;
      const f = Number.isInteger(id) ? ent.list.get(id) : null;
      try {
        switch (m.t) {
          case 'friends': sendList(ws); return;
          // En acabar una partida (o a la sala): «＋ Amic» a qui ha jugat amb tu
          case 'frAdd': {
            const r = roomOf(ws), x = r && Number.isInteger(m.seat) && r.seats[m.seat];
            const other = x && x.human && x.uid;
            if (!other || other === me) return;
            const now = Date.now(), mine = (asks.get(me) || []).filter(t => now - t < 3600e3);
            if (mine.length >= ASKS_PER_HOUR) return err(ws, "Has enviat moltes sol·licituds. Torna-ho a provar d'aquí a una estona.");
            mine.push(now); asks.set(me, mine);
            const res = await acc.store.friendAsk(me, other);
            send(ws, { t: 'frRes', seat: m.seat, res, name: x.name });
            if (res === 'asked' || res === 'accepted') {
              await reload(me, other);
              stats.inc(res === 'asked' ? 'accio:amic-demana' : 'accio:amic-accepta');
              const myName = r.seats[c.seat] ? r.seats[c.seat].name : 'Algú';
              for (const w of socks(other)) send(w, res === 'asked' ? { t: 'frReq', id: me, name: nameIn(other, me) || myName } : { t: 'frOk', id: me, name: nameIn(other, me) || myName });
            }
            return;
          }
          // Amb el codi d'amic (escrit a mà o des de l'enllaç ?amic=…), sense haver jugat junts
          case 'frCode': {
            const now = Date.now(), mine = (asks.get(me) || []).filter(t => now - t < 3600e3);
            if (mine.length >= ASKS_PER_HOUR) return err(ws, "Has provat massa codis. Torna-ho a provar d'aquí a una estona.");
            mine.push(now); asks.set(me, mine);
            const other = acc.friendCodeId(m.code);
            if (!other) return send(ws, { t: 'frRes', res: 'nocode' });
            if (other === me) return send(ws, { t: 'frRes', res: 'self' });
            const res = await acc.store.friendAsk(me, other);
            if (res === 'asked' || res === 'accepted') await reload(me, other);
            const name = nameIn(me, other) || '';
            send(ws, { t: 'frRes', res, name });
            if (res === 'asked' || res === 'accepted') {
              stats.inc(res === 'asked' ? 'accio:amic-demana' : 'accio:amic-accepta');
              for (const w of socks(other)) send(w, { t: res === 'asked' ? 'frReq' : 'frOk', id: me, name: nameIn(other, me) || 'Algú' });
            }
            return;
          }
          case 'frAns': {
            if (!f || f.ok || f.asker === me) return;
            const yes = !!m.ok;
            if (await acc.store.friendAnswer(me, id, yes)) {
              await reload(me, id);
              if (yes) { stats.inc('accio:amic-accepta'); for (const w of socks(id)) send(w, { t: 'frOk', id: me, name: nameIn(id, me) || 'Algú' }); }
            }
            return;
          }
          case 'frDel': if (f) { await acc.store.friendRemove(me, id); await reload(me, id); } return;
          case 'frBlock': if (Number.isInteger(id) && id !== me) { await acc.store.block(me, id); await reload(me, id); } return;
          case 'frHide': {
            await acc.store.setHidden(me, !!m.on);
            ent.hidden = !!m.on;
            // els amics connectats també ho tenen a la seva llista (per quan es desconnecti)
            for (const [fid] of ent.list) { const e = cache.get(fid), r = e && e.list.get(me); if (r) r.hidden = !!m.on; }
            pushTo(me); notify(me);
            return;
          }
          // Convidar un amic connectat a la sala on ets (a la sala d'espera, amb lloc)
          case 'frInvite': {
            if (!f || !f.ok) return;
            const r = roomOf(ws);
            if (!r || r.phase !== 'lobby') return err(ws, 'Per convidar, primer has de ser a una sala.');
            if (!r.seats.some(x => !x.human)) return err(ws, 'La sala ja és plena.');
            const s = statusOf(id);
            if (s.st === 'off') return err(ws, `${f.name} ja no està connectat.`);
            if (s.st === 'game') return err(ws, `${f.name} està jugant una partida. Prova-ho quan acabi.`);
            if (r.seats.some(x => x.human && x.uid === id)) return;
            const k = me + '>' + id, now = Date.now();
            if (now - (invited.get(k) || 0) < INVITE_GAP_MS) return;
            invited.set(k, now);
            const from = nameIn(id, me) || (r.seats[c.seat] && r.seats[c.seat].name) || 'Un amic';
            const meRow = (cache.get(id) || { list: new Map() }).list.get(me) || {};
            for (const w of socks(id)) send(w, { t: 'frInvite', id: me, name: from, look: meRow.look, hat: meRow.hat, code: r.code, ms: INVITE_MS });
            send(ws, { t: 'frInvited', id, name: f.name });
            stats.inc('accio:amic-convida');
            return;
          }
          // Resposta a una invitació (si diu que sí, el client entra a la sala amb el codi)
          case 'frInvAns': {
            if (!f || !f.ok) return;
            const k = id + '>' + me;
            if (!invited.has(k)) return;
            invited.delete(k);
            if (m.ok) stats.inc('accio:amic-entra');
            for (const w of socks(id)) send(w, { t: 'frInvAns', id: me, name: nameIn(id, me) || 'El teu amic', ok: !!m.ok });
            return;
          }
        }
      } catch (e) {
        console.error('amics', e.message);
        err(ws, 'Ara mateix no podem accedir als amics. Torna-ho a provar més tard.');
      }
    }
  };
};
