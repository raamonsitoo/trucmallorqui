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
    games: p.games, wins: p.wins, cantons: p.cantons, hands: p.hands,
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
const COLS = 'id, name, look, hat, back, xp, games, wins, cantons, hands, created_at';
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
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`);
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
    async close() { await pool.end(); }
  };
}
function memStore() {
  const bySub = new Map(), byId = new Map(), buys = []; let next = 1;
  const copy = p => p && Object.assign({}, p);
  return {
    async login(sub, d) {
      let p = bySub.get(sub);
      if (!p) { p = { id: next++, sub, name: d.name, look: d.look, hat: d.hat, back: d.back, xp: 0, games: 0, wins: 0, cantons: 0, hands: 0, created_at: new Date() }; bySub.set(sub, p); byId.set(p.id, p); }
      return copy(p);
    },
    async get(id) { return copy(byId.get(id)); },
    async prefs(id, d) { const p = byId.get(id); if (!p) return null; Object.assign(p, d); return copy(p); },
    async addGame(id, r) {
      const p = byId.get(id); if (!p) return null;
      p.xp += r.xp; p.games++; p.wins += r.won ? 1 : 0; p.cantons += r.cantons; p.hands += r.hands; return copy(p);
    },
    async remove(id) {
      const p = byId.get(id); if (p) { byId.delete(id); bySub.delete(p.sub); }
      for (let i = buys.length - 1; i >= 0; i--) if (buys[i].id === id) buys.splice(i, 1);
    },
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
  ENABLED, GOOGLE_CLIENT_ID: ENABLED ? GOOGLE_CLIENT_ID : '', store,
  signSession, verifySession, verifyGoogle, publicProfile, levelOf, titleOf, xpForLevel, xpForGame
};
