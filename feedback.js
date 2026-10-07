'use strict';
// Bústia de suggeriments: idees, millores i errades que envia la gent des del joc.
// Amb DATABASE_URL es guarda a Postgres (taula «feedback»); sense, en memòria (els darrers 200).
// És anònim: no guardam ni la IP ni el compte; només el text, el tipus, on era i quin aparell feia servir.
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const KINDS = ['idea', 'millora', 'errada'];
const PLACES = ['inici', 'sala', 'partida'];
const MAX_TEXT = 1000;
const KEEP_DAYS = 365;

// Navegador i sistema en dues paraules («Android · Chrome»), prou per reproduir una errada
function device(ua) {
  ua = String(ua || '');
  const os = /iPhone|iPod/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Altre';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Altre';
  return os + ' · ' + br;
}

// Valida el missatge del client; null si no és vàlid
function clean(m, ua) {
  const text = String((m && m.text) || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, MAX_TEXT);
  if (text.length < 3) return null;
  return {
    kind: KINDS.includes(m.kind) ? m.kind : 'idea',
    text,
    place: PLACES.includes(m.where) ? m.where : 'inici',
    screen: /^\d{2,5}x\d{2,5}$/.test(String(m.screen || '')) ? String(m.screen) : '',
    device: device(ua)
  };
}

function pgStore() {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, ssl: local ? false : { rejectUnauthorized: true }, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('db feedback', e.message));
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    place TEXT, screen TEXT, device TEXT)`);
  ready.catch(e => console.error('db feedback init', e.message));
  const purge = () => ready.then(() => pool.query(`DELETE FROM feedback WHERE created_at < now() - interval '${KEEP_DAYS} days'`))
    .catch(e => console.error('db feedback purge', e.message));
  purge(); setInterval(purge, 24 * 3600e3).unref();
  return {
    async add(f) {
      await ready;
      await pool.query('INSERT INTO feedback (kind, text, place, screen, device) VALUES ($1,$2,$3,$4,$5)', [f.kind, f.text, f.place, f.screen, f.device]);
    },
    async list(limit) {
      await ready;
      return (await pool.query('SELECT id, created_at, kind, text, place, screen, device FROM feedback ORDER BY id DESC LIMIT $1', [limit || 300])).rows;
    },
    async close() { await pool.end(); }
  };
}
function memStore() {
  const rows = []; let next = 1;
  return {
    async add(f) { rows.unshift(Object.assign({ id: next++, created_at: new Date() }, f)); if (rows.length > 200) rows.pop(); },
    async list(limit) { return rows.slice(0, limit || 300); },
    async close() {}
  };
}
const store = DATABASE_URL ? pgStore() : memStore();

// Pàgina privada amb la llista (/suggeriments?key=...)
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LABEL = { idea: 'Idea', millora: 'Millora', errada: 'Errada' };
function page(rows) {
  const n = k => rows.filter(r => r.kind === k).length;
  const pl = (k, one, many) => k + ' ' + (k === 1 ? one : many);
  const fmt = d => { const x = new Date(d); return isNaN(x) ? '' : x.toLocaleString('ca-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  const items = rows.map(r => `<li class="${esc(r.kind)}"><div class="meta"><b>${esc(LABEL[r.kind] || r.kind)}</b> · ${esc(fmt(r.created_at))} · ${esc(r.place)} · ${esc(r.device)}${r.screen ? ' · ' + esc(r.screen) : ''}</div><p>${esc(r.text)}</p></li>`).join('');
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Suggeriments · Truc mallorquí</title>
<style>
body{margin:0;background:#0d2421;color:#f5eedc;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 40px}h1{font-family:Georgia,serif;font-weight:400;margin:0 0 4px}
.sum{color:#a8c3b9;margin:0 0 16px}ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:10px}
li{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-left:4px solid #a8c3b9;border-radius:10px;padding:10px 12px}
li.idea{border-left-color:#e9b31c}li.millora{border-left-color:#5fb8a0}li.errada{border-left-color:#e0645a}
.meta{font-size:.82rem;color:#a8c3b9}.meta b{color:#f5eedc}p{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
</style></head><body><div class="wrap"><h1>Suggeriments</h1>
<p class="sum">${rows.length} en total · ${pl(n('idea'), 'idea', 'idees')} · ${pl(n('millora'), 'millora', 'millores')} · ${pl(n('errada'), 'errada', 'errades')}</p>
<ul>${items || '<li>Encara no n\'hi ha cap.</li>'}</ul></div></body></html>`;
}

module.exports = { clean, device, store, page, KINDS, MAX_TEXT };
