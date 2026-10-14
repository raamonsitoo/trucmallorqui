'use strict';
// Comptes de jugador: entrar amb Google, progrés (experiència) i nivells.
// S'activa només si hi ha les variables d'entorn GOOGLE_CLIENT_ID, SESSION_SECRET i DATABASE_URL.
// Sense elles el joc funciona igual, però sense comptes.
const crypto = require('crypto');

const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const SESSION_SECRET = (process.env.SESSION_SECRET || '').trim();
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
// Només per a les proves automàtiques: accepta credencials falses «test:<id>» i guarda en memòria.
const TEST_AUTH = process.env.NODE_ENV === 'test' && process.env.TRUC_TEST_AUTH === '1';
const ENABLED = !!(GOOGLE_CLIENT_ID && SESSION_SECRET && (DATABASE_URL || TEST_AUTH));
const SESSION_DAYS = 180;

// ---------- Nivells ----------
// Experiència necessària per arribar al nivell L: 50·L·(L−1)  →  2: 100, 3: 300, 4: 600, 5: 1000…
const xpForLevel = L => 50 * L * (L - 1);
function levelOf(xp) { let L = 1; while (xpForLevel(L + 1) <= xp) L++; return L; }
const TITLES = [[1, 'Aprenent'], [3, 'Jugador de cafè'], [6, 'Trucador'], [10, "Mestre de l'envit"], [15, 'Amo de la taula'], [20, 'Llegenda del truc']];
function titleOf(L) { let t = TITLES[0][1]; for (const [n, name] of TITLES) if (L >= n) t = name; return t; }
// Experiència d'una partida acabada
function xpForGame({ won, cantons, hands, vsBots }) {
  let xp = 20 + (won ? 40 : 0) + 10 * cantons + Math.min(30, hands);
  if (vsBots) xp = Math.round(xp / 2);
  return xp;
}

function publicProfile(p) {
  if (!p) return null;
  const level = levelOf(p.xp);
  return {
    name: p.name, look: p.look, hat: p.hat, back: p.back,
    xp: p.xp, level, title: titleOf(level), levelXp: xpForLevel(level), nextXp: xpForLevel(level + 1),
    games: p.games, wins: p.wins, cantons: p.cantons, hands: p.hands, hidden: !!p.hidden,
    since: p.created_at instanceof Date ? p.created_at.toISOString().slice(0, 10) : String(p.created_at || '').slice(0, 10)
  };
}

// ---------- Sessions (testimoni signat, sense base de dades) ----------
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signSession(id) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const body = `v1.${id}.${exp}`;
  return body + '.' + b64u(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
}
function verifySession(tok) {
  if (!ENABLED || typeof tok !== 'string' || tok.length > 200) return null;
  const parts = tok.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const body = parts.slice(0, 3).join('.');
  const want = b64u(crypto.createHmac('sha256', SESSION_SECRET).update(body).digest());
  const a = Buffer.from(want), b = Buffer.from(parts[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(parts[2]) < Date.now() / 1000) return null;
  const id = Number(parts[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ---------- Codi d'amic ----------
// Cada compte té un codi curt per afegir-lo com a amic sense haver jugat junts (també dins l'enllaç ?amic=…).
// És l'identificador del compte més tres lletres de control signades: no es pot endevinar el d'un altre.
const FC_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sense lletres que es confonen (I, O, 0, 1)
function fcEnc(n, len) { let s = ''; do { s = FC_ABC[n % 32] + s; n = Math.floor(n / 32); } while (n > 0); return s.padStart(len, 'A'); }
function fcCheck(id) { const h = crypto.createHmac('sha256', SESSION_SECRET).update('amic:' + id).digest(); return FC_ABC[h[0] % 32] + FC_ABC[h[1] % 32] + FC_ABC[h[2] % 32]; }
function friendCode(id) { const s = fcEnc(id, 3) + fcCheck(id); return s.slice(0, s.length - 3) + '-' + s.slice(-3); }
// Torna l'identificador del compte, o null si el codi no és bo
function friendCodeId(code) {
  const s = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 6 || s.length > 10 || /[^ABCDEFGHJKLMNPQRSTUVWXYZ2-9]/.test(s)) return null;
  let id = 0; for (const ch of s.slice(0, -3)) id = id * 32 + FC_ABC.indexOf(ch);
  if (!id || id > 2147483647 || fcCheck(id) !== s.slice(-3)) return null;
  return id;
}

// ---------- Verificació del testimoni de Google ----------
let jwks = { keys: [], until: 0 };
async function googleKeys() {
  if (jwks.keys.length && Date.now() < jwks.until) return jwks.keys;
  const r = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!r.ok) throw new Error('No puc baixar les claus de Google');
  const m = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
  jwks = { keys: (await r.json()).keys || [], until: Date.now() + (m ? Number(m[1]) * 1000 : 3600e3) };
  return jwks.keys;
}
// Torna l'identificador de Google («sub») si el testimoni és vàlid; si no, null.
async function verifyGoogle(credential) {
  if (!ENABLED || typeof credential !== 'string' || credential.length > 4000) return null;
  if (TEST_AUTH && credential.startsWith('test:')) return 'test-' + credential.slice(5, 40);
  const parts = credential.split('.');
  if (parts.length !== 3) return null;
  let head, claims;
  try {
    head = JSON.parse(Buffer.from(parts[0], 'base64url').toString());
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch (e) { return null; }
  if (head.alg !== 'RS256') return null;
  const jwk = (await googleKeys()).find(k => k.kid === head.kid);
  if (!jwk) return null;
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!ok) return null;
  const now = Date.now() / 1000;
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)) return null;
  if (claims.aud !== GOOGLE_CLIENT_ID || !(claims.exp > now) || !claims.sub) return null;
  return String(claims.sub);
}

// ---------- Emmagatzematge ----------
// Només guardam: l'identificador de Google, el nom i l'aspecte que tries al joc, i el progrés. Cap correu.
const COLS = 'id, name, look, hat, back, xp, games, wins, cantons, hands, created_at, hidden';
const MAX_FRIENDS = 200;
// Resultat de demanar amistat: 'asked' (sol·licitud enviada), 'accepted' (l'altre ja ens l'havia demanada: ara sou amics),
// 'already' (ja ho sou), 'pending' (ja l'havíem demanada), 'blocked' (un dels dos ha bloquejat l'altre), 'full' (massa amics),
// 'nocode' (aquest compte no existeix)
function pgStore() {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 3, ssl: local ? false : { rejectUnauthorized: true }, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('db', e.message));
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    google_sub TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL DEFAULT 'Jugador',
    look TEXT, hat TEXT, back TEXT,
    xp INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    cantons INTEGER NOT NULL DEFAULT 0,
    hands INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`)
    // «hidden»: mode invisible (els amics el veuen com a desconnectat)
    .then(() => pool.query('ALTER TABLE players ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT false'));
  // Amics: una fila per parella (lo < hi). ok = false mentre la sol·licitud (d'«asker») espera resposta.
  const readyFriends = ready.then(() => pool.query(`CREATE TABLE IF NOT EXISTS friends (
    lo INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    hi INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    asker INTEGER NOT NULL,
    ok BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (lo, hi), CHECK (lo < hi))`))
    .then(() => pool.query(`CREATE TABLE IF NOT EXISTS blocks (
    who INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    whom INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (who, whom))`));
  readyFriends.catch(e => console.error('db init amics', e.message));
  // Compres de la botiga: una fila per article comprat. `ref` és la sessió de pagament (no es pot repetir).
  const readyShop = ready.then(() => pool.query(`CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    ref TEXT UNIQUE NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`));
  ready.catch(e => console.error('db init', e.message));
  readyShop.catch(e => console.error('db init compres', e.message));
  const one = async (q, v) => { await ready; return (await pool.query(q, v)).rows[0] || null; };
  return {
    async login(sub, d) {
      return one(`INSERT INTO players (google_sub, name, look, hat, back) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (google_sub) DO UPDATE SET last_seen = now() RETURNING ${COLS}`, [sub, d.name, d.look, d.hat, d.back]);
    },
    async get(id) { return one(`UPDATE players SET last_seen = now() WHERE id = $1 RETURNING ${COLS}`, [id]); },
    async prefs(id, d) {
      return one(`UPDATE players SET name = $2, look = $3, hat = $4, back = $5 WHERE id = $1 RETURNING ${COLS}`, [id, d.name, d.look, d.hat, d.back]);
    },
    async addGame(id, r) {
      return one(`UPDATE players SET xp = xp + $2, games = games + 1, wins = wins + $3, cantons = cantons + $4, hands = hands + $5
        WHERE id = $1 RETURNING ${COLS}`, [id, r.xp, r.won ? 1 : 0, r.cantons, r.hands]);
    },
    async remove(id) { await ready; await pool.query('DELETE FROM players WHERE id = $1', [id]); },
    // Articles comprats (llista d'identificadors, sense repetir)
    async owned(id) {
      await readyShop;
      return (await pool.query('SELECT DISTINCT item FROM purchases WHERE player_id = $1', [id])).rows.map(r => r.item);
    },
    // Apunta una compra; si aquesta sessió de pagament ja s'havia apuntat, no fa res. Torna true si és nova.
    async grant(id, item, ref, amount) {
      await readyShop;
      const r = await pool.query(`INSERT INTO purchases (player_id, item, ref, amount) VALUES ($1,$2,$3,$4)
        ON CONFLICT (ref) DO NOTHING RETURNING id`, [id, item, ref, amount]);
      return r.rowCount > 0;
    },
    // ---------- Amics ----------
    async friendList(id) {
      await readyFriends;
      return (await pool.query(`SELECT p.id, p.name, p.look, p.hat, p.xp, p.last_seen, p.hidden, f.ok, f.asker
        FROM friends f JOIN players p ON p.id = CASE WHEN f.lo = $1 THEN f.hi ELSE f.lo END
        WHERE f.lo = $1 OR f.hi = $1 ORDER BY p.name`, [id])).rows;
    },
    async friendAsk(me, other) {
      await readyFriends;
      const lo = Math.min(me, other), hi = Math.max(me, other);
      if (!(await pool.query('SELECT 1 FROM players WHERE id = $1', [other])).rowCount) return 'nocode';
      const b = await pool.query('SELECT 1 FROM blocks WHERE (who = $1 AND whom = $2) OR (who = $2 AND whom = $1)', [me, other]);
      if (b.rowCount) return 'blocked';
      const f = (await pool.query('SELECT asker, ok FROM friends WHERE lo = $1 AND hi = $2', [lo, hi])).rows[0];
      if (f) {
        if (f.ok) return 'already';
        if (f.asker === me) return 'pending';
        await pool.query('UPDATE friends SET ok = true WHERE lo = $1 AND hi = $2', [lo, hi]);
        return 'accepted';
      }
      const n = (await pool.query('SELECT count(*)::int AS n FROM friends WHERE lo = $1 OR hi = $1', [me])).rows[0].n;
      if (n >= MAX_FRIENDS) return 'full';
      await pool.query('INSERT INTO friends (lo, hi, asker) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [lo, hi, me]);
      return 'asked';
    },
    // Contesta una sol·licitud que li han fet; torna true si n'hi havia
    async friendAnswer(me, other, yes) {
      await readyFriends;
      const lo = Math.min(me, other), hi = Math.max(me, other);
      const r = yes ? await pool.query('UPDATE friends SET ok = true WHERE lo = $1 AND hi = $2 AND asker = $3 AND NOT ok', [lo, hi, other])
        : await pool.query('DELETE FROM friends WHERE lo = $1 AND hi = $2 AND asker = $3 AND NOT ok', [lo, hi, other]);
      return r.rowCount > 0;
    },
    async friendRemove(me, other) {
      await readyFriends;
      await pool.query('DELETE FROM friends WHERE lo = $1 AND hi = $2', [Math.min(me, other), Math.max(me, other)]);
    },
    async block(me, other) {
      await readyFriends;
      await pool.query('DELETE FROM friends WHERE lo = $1 AND hi = $2', [Math.min(me, other), Math.max(me, other)]);
      await pool.query('INSERT INTO blocks (who, whom) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, other]);
    },
    async setHidden(id, on) { await ready; await pool.query('UPDATE players SET hidden = $2 WHERE id = $1', [id, !!on]); },
    async close() { await pool.end(); }
  };
}
function memStore() {
  const bySub = new Map(), byId = new Map(), buys = []; let next = 1;
  const links = new Map(), blocks = new Set(); // amics: 'lo:hi' → {asker, ok}; bloquejos: 'qui>a qui'
  const key = (a, b) => Math.min(a, b) + ':' + Math.max(a, b);
  const copy = p => p && Object.assign({}, p);
  return {
    async login(sub, d) {
      let p = bySub.get(sub);
      if (!p) { p = { id: next++, sub, name: d.name, look: d.look, hat: d.hat, back: d.back, xp: 0, games: 0, wins: 0, cantons: 0, hands: 0, hidden: false, created_at: new Date(), last_seen: new Date() }; bySub.set(sub, p); byId.set(p.id, p); }
      p.last_seen = new Date();
      return copy(p);
    },
    async get(id) { const p = byId.get(id); if (p) p.last_seen = new Date(); return copy(p); },
    async prefs(id, d) { const p = byId.get(id); if (!p) return null; Object.assign(p, d); return copy(p); },
    async addGame(id, r) {
      const p = byId.get(id); if (!p) return null;
      p.xp += r.xp; p.games++; p.wins += r.won ? 1 : 0; p.cantons += r.cantons; p.hands += r.hands; return copy(p);
    },
    async remove(id) {
      const p = byId.get(id); if (p) { byId.delete(id); bySub.delete(p.sub); }
      for (let i = buys.length - 1; i >= 0; i--) if (buys[i].id === id) buys.splice(i, 1);
      for (const k of Array.from(links.keys())) if (k.split(':').map(Number).includes(id)) links.delete(k);
      for (const k of Array.from(blocks)) if (k.split('>').map(Number).includes(id)) blocks.delete(k);
    },
    async friendList(id) {
      const out = [];
      for (const [k, f] of links) {
        const [a, b] = k.split(':').map(Number);
        if (a !== id && b !== id) continue;
        const p = byId.get(a === id ? b : a); if (!p) continue;
        out.push({ id: p.id, name: p.name, look: p.look, hat: p.hat, xp: p.xp, last_seen: p.last_seen, hidden: !!p.hidden, ok: f.ok, asker: f.asker });
      }
      return out.sort((x, y) => x.name.localeCompare(y.name));
    },
    async friendAsk(me, other) {
      if (!byId.has(me) || !byId.has(other)) return 'nocode';
      if (blocks.has(me + '>' + other) || blocks.has(other + '>' + me)) return 'blocked';
      const f = links.get(key(me, other));
      if (f) { if (f.ok) return 'already'; if (f.asker === me) return 'pending'; f.ok = true; return 'accepted'; }
      if ((await this.friendList(me)).length >= MAX_FRIENDS) return 'full';
      links.set(key(me, other), { asker: me, ok: false });
      return 'asked';
    },
    async friendAnswer(me, other, yes) {
      const f = links.get(key(me, other));
      if (!f || f.ok || f.asker !== other) return false;
      if (yes) f.ok = true; else links.delete(key(me, other));
      return true;
    },
    async friendRemove(me, other) { links.delete(key(me, other)); },
    async block(me, other) { links.delete(key(me, other)); blocks.add(me + '>' + other); },
    async setHidden(id, on) { const p = byId.get(id); if (p) p.hidden = !!on; },
    async owned(id) { return Array.from(new Set(buys.filter(b => b.id === id).map(b => b.item))); },
    async grant(id, item, ref, amount) {
      if (!byId.has(id) || buys.some(b => b.ref === ref)) return false;
      buys.push({ id, item, ref, amount }); return true;
    },
    async close() {}
  };
}
const store = !ENABLED ? null : DATABASE_URL ? pgStore() : memStore();

module.exports = {
  ENABLED, GOOGLE_CLIENT_ID: ENABLED ? GOOGLE_CLIENT_ID : '', store, MAX_FRIENDS,
  signSession, verifySession, verifyGoogle, publicProfile, levelOf, titleOf, xpForLevel, xpForGame, friendCode, friendCodeId
};
