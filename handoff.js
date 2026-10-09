'use strict';
// Sales que sobreviuen als reinicis del servidor (una actualització a Render o un reinici del pla gratuït).
// Cada sala es desa (taula «room_state») quan canvia la sala d'espera i a l'inici de cada mà, amb el marcador
// d'abans de la mà. Si el servidor s'atura, el nou recupera la sala quan hi torna a entrar qualcú amb el seu
// testimoni de sessió, i la partida continua (si s'havia tallat a mitja mà, aquesta mà es torna a repartir).
//
// Una sala és del servidor que la duu mentre aquest la renova (cada LEASE_MS/3). Un altre servidor només la pot
// agafar quan el primer l'ha deixada (en aturar-se, «released») o ja no la renova (s'ha aturat de cop).
//
// Amb DATABASE_URL es desa a Postgres; amb TRUC_HANDOFF_FILE, en un fitxer (per a les proves amb diversos
// processos); sense cap de les dues, no es desa res.
const crypto = require('crypto');
const fs = require('fs');

const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const FILE = (process.env.TRUC_HANDOFF_FILE || '').trim();
const LEASE_MS = Number(process.env.TRUC_LEASE_MS) || 30000;
const KEEP_MS = 6 * 3600e3;            // una sala sense moviment fa 6 hores es descarta
const ME = crypto.randomBytes(6).toString('hex'); // aquest procés

function pgStore() {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 2, ssl: local ? false : { rejectUnauthorized: true }, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('db sales', e.message));
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS room_state (
      code TEXT PRIMARY KEY, data JSONB NOT NULL, tokens TEXT[] NOT NULL, owner TEXT NOT NULL,
      lease TIMESTAMPTZ NOT NULL, released BOOLEAN NOT NULL DEFAULT false, updated TIMESTAMPTZ NOT NULL DEFAULT now())`)
    .then(() => pool.query('CREATE INDEX IF NOT EXISTS room_state_tokens ON room_state USING GIN (tokens)'));
  ready.catch(e => console.error('db sales init', e.message));
  const lease = LEASE_MS + ' milliseconds';
  return {
    // Només hi escriu qui la duu (o si ningú no la duu ja): un servidor vell no trepitja el nou
    async save(code, data, tokens, released) {
      await ready;
      await pool.query(`INSERT INTO room_state (code, data, tokens, owner, lease, released, updated) VALUES ($1, $2, $3, $4, now(), $5, now())
        ON CONFLICT (code) DO UPDATE SET data = EXCLUDED.data, tokens = EXCLUDED.tokens, owner = EXCLUDED.owner, lease = now(), released = EXCLUDED.released, updated = now()
        WHERE room_state.owner = EXCLUDED.owner OR room_state.released OR room_state.lease < now() - $6::interval`,
        [code, JSON.stringify(data), tokens, ME, !!released, lease]);
    },
    async renew(codes) {
      if (!codes.length) return;
      await ready;
      await pool.query('UPDATE room_state SET lease = now() WHERE owner = $1 AND NOT released AND code = ANY($2)', [ME, codes]);
    },
    async remove(code) { await ready; await pool.query('DELETE FROM room_state WHERE code = $1 AND owner = $2', [code, ME]); },
    // La sala d'aquest testimoni, si es pot agafar: {code, data}; {busy:true} si encara la duu un altre servidor; null si no n'hi ha
    async claim(token) {
      await ready;
      const r = await pool.query(`UPDATE room_state SET owner = $2, lease = now(), released = false
        WHERE code = (SELECT code FROM room_state WHERE $1 = ANY(tokens) AND updated > now() - $4::interval ORDER BY updated DESC LIMIT 1)
          AND (released OR owner = $2 OR lease < now() - $3::interval) RETURNING code, data`, [token, ME, lease, KEEP_MS + ' milliseconds']);
      if (r.rows[0]) return { code: r.rows[0].code, data: r.rows[0].data };
      const b = await pool.query('SELECT 1 FROM room_state WHERE $1 = ANY(tokens) AND updated > now() - $2::interval LIMIT 1', [token, KEEP_MS + ' milliseconds']);
      return b.rows.length ? { busy: true } : null;
    },
    async purge() { await ready; await pool.query('DELETE FROM room_state WHERE updated < now() - $1::interval', [KEEP_MS + ' milliseconds']); }
  };
}

// Mateixes regles, en un fitxer JSON (escriptura atòmica: fitxer temporal i canvi de nom)
function fileStore() {
  const read = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; } };
  const write = all => { const tmp = FILE + '.' + ME + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(all)); fs.renameSync(tmp, FILE); };
  const free = (r, now) => r.released || r.owner === ME || now - r.lease > LEASE_MS;
  return {
    async save(code, data, tokens, released) {
      const all = read(), now = Date.now(), r = all[code];
      if (r && !free(r, now)) return;
      all[code] = { data, tokens, owner: ME, lease: now, released: !!released, updated: now }; write(all);
    },
    async renew(codes) {
      const all = read(), now = Date.now(); let ch = false;
      for (const c of codes) { const r = all[c]; if (r && r.owner === ME && !r.released) { r.lease = now; ch = true; } }
      if (ch) write(all);
    },
    async remove(code) { const all = read(); if (all[code] && all[code].owner === ME) { delete all[code]; write(all); } },
    async claim(token) {
      const all = read(), now = Date.now();
      const hit = Object.entries(all).filter(([, r]) => r.tokens.includes(token) && now - r.updated < KEEP_MS).sort((a, b) => b[1].updated - a[1].updated)[0];
      if (!hit) return null;
      const [code, r] = hit;
      if (!free(r, now)) return { busy: true };
      Object.assign(r, { owner: ME, lease: now, released: false }); write(all);
      return { code, data: r.data };
    },
    async purge() { const all = read(), now = Date.now(); let ch = false; for (const [c, r] of Object.entries(all)) if (now - r.updated > KEEP_MS) { delete all[c]; ch = true; } if (ch) write(all); }
  };
}

const store = DATABASE_URL ? pgStore() : FILE ? fileStore() : null;

// Les escriptures d'una sala es fan d'una en una i, si n'arriben moltes seguides, només es desa la darrera
const queue = new Map(); // code -> {job, running}
let inflight = Promise.resolve();
function enqueue(code, fn) {
  const q = queue.get(code) || { next: null, running: false };
  q.next = fn; queue.set(code, q);
  if (q.running) return;
  const step = () => {
    const f = q.next; q.next = null;
    if (!f) { q.running = false; if (queue.get(code) === q) queue.delete(code); return; }
    q.running = true;
    const p = Promise.resolve().then(f).catch(e => console.error('sala no desada', code, e.message)).then(step);
    inflight = Promise.all([inflight, p]);
  };
  step();
}
setInterval(() => { if (store) store.purge().catch(() => {}); }, 3600e3).unref();

module.exports = {
  ENABLED: !!store,
  LEASE_MS,
  save(code, data, tokens, released) { if (store) enqueue(code, () => store.save(code, data, tokens, released)); },
  remove(code) { if (store) enqueue(code, () => store.remove(code)); },
  renew(codes) { return store ? store.renew(codes).catch(e => console.error('sales renovar', e.message)) : Promise.resolve(); },
  claim(token) { return store ? store.claim(token) : Promise.resolve(null); },
  // Espera que s'hagin desat tots els canvis pendents (abans d'aturar el servidor)
  async flush() { for (let i = 0; i < 20 && queue.size; i++) await inflight; await inflight; }
};
