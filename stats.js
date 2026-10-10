'use strict';
// Estadístiques pròpies, sense galetes: només comptadors per dia (visites, d'on venen, quin aparell,
// accions del joc i partides). No guardam la IP ni res que identifiqui ningú.
// Amb DATABASE_URL es desen a Postgres (taula «stats_daily»); sense, en memòria.
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const KEEP_DAYS = 400;
const REFS = ['instagram', 'tiktok', 'google', 'cercador', 'facebook', 'whatsapp', 'x', 'youtube', 'invitacio', 'repte', 'app', 'directe', 'altres'];
// Accions del joc que es poden comptar (la resta s'ignoren, perquè ningú pugui omplir la taula de brossa)
const EVENTS = new Set(['partida-bots-facil', 'partida-bots-normal', 'partida-bots-dificil', 'partida-bots-mestre', 'sala-creada', 'jugar-desconeguts',
  'tutorial', 'convida-whatsapp', 'compartir-resultat', 'repte-obert', 'canto-acabat', 'partida-acabada', 'revenja', 'suggeriment', 'botiga',
  'obert-com-app', 'app-installada']);

const day = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); // AAAA-MM-DD, hora de Mallorca
const pending = new Map(); // «dia|clau» -> quantitat encara no desada
function inc(key, n = 1) { const k = day() + '|' + key; pending.set(k, (pending.get(k) || 0) + n); }

function device(ua) {
  ua = String(ua || '');
  if (/iPad|Tablet/i.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tauleta';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobil';
  return 'ordinador';
}
// Un avís del navegador: {t:'v', r: d'on ve, b: si ja havia vingut} o {t:'e', n: nom de l'acció}
function hit(m, ua) {
  if (!m || typeof m !== 'object') return false;
  if (m.t === 'v') {
    const r = REFS.includes(m.r) ? m.r : 'altres';
    inc('visita'); inc('ref:' + r); inc('aparell:' + device(ua)); inc(m.b ? 'visita:repetida' : 'visita:nova');
    return true;
  }
  if (m.t === 'e' && EVENTS.has(m.n)) { inc('accio:' + m.n); return true; }
  return false;
}

function pgStore() {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(DATABASE_URL);
  const pool = new Pool({ connectionString: DATABASE_URL, max: 1, ssl: local ? false : { rejectUnauthorized: true }, idleTimeoutMillis: 30000 });
  pool.on('error', e => console.error('db stats', e.message));
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS stats_daily (
    day DATE NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key))`);
  ready.catch(e => console.error('db stats init', e.message));
  const purge = () => ready.then(() => pool.query(`DELETE FROM stats_daily WHERE day < current_date - ${KEEP_DAYS}`))
    .catch(e => console.error('db stats purge', e.message));
  purge(); setInterval(purge, 24 * 3600e3).unref();
  return {
    async save(rows) {
      await ready;
      await pool.query(`INSERT INTO stats_daily (day, key, n) SELECT * FROM unnest($1::date[], $2::text[], $3::int[])
        ON CONFLICT (day, key) DO UPDATE SET n = stats_daily.n + EXCLUDED.n`, [rows.map(r => r.day), rows.map(r => r.key), rows.map(r => r.n)]);
    },
    async read(days) {
      await ready;
      return (await pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, key, n FROM stats_daily WHERE day > current_date - $1::int`, [days])).rows;
    }
  };
}
function memStore() {
  const m = new Map();
  return {
    async save(rows) { for (const r of rows) { const k = r.day + '|' + r.key; m.set(k, (m.get(k) || 0) + r.n); } },
    async read(days) {
      const from = day(new Date(Date.now() - days * 864e5));
      return Array.from(m, ([k, n]) => { const [d, key] = k.split('|'); return { day: d, key, n }; }).filter(r => r.day > from);
    }
  };
}
const store = DATABASE_URL ? pgStore() : memStore();

// Desa el que hi ha pendent (cada minut i en aturar el servidor)
let saving = null;
function flush() {
  if (saving || !pending.size) return saving || Promise.resolve();
  const rows = Array.from(pending, ([k, n]) => { const [d, key] = k.split('|'); return { day: d, key, n }; });
  pending.clear();
  saving = store.save(rows).catch(e => {
    console.error('stats no desades', e.message);
    for (const r of rows) { const k = r.day + '|' + r.key; pending.set(k, (pending.get(k) || 0) + r.n); }
  }).finally(() => { saving = null; });
  return saving;
}
setInterval(flush, 60e3).unref();
// En aturar-se, el servidor (server.js) passa les sales al nou i llavors crida flush() abans de sortir

// Taula {dia: {clau: n}} dels darrers «days» dies (amb el que encara no s'ha desat)
async function table(days) {
  const out = {};
  const add = (d, key, n) => { (out[d] = out[d] || {})[key] = (out[d][key] || 0) + Number(n); };
  for (const r of await store.read(days)) add(r.day, r.key, r.n);
  for (const [k, n] of pending) { const [d, key] = k.split('|'); add(d, key, n); }
  return out;
}

// ---------- Pàgina privada (/stats?key=...) ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const REF_NAME = { instagram: 'Instagram', tiktok: 'TikTok', google: 'Google', cercador: 'Altres cercadors', facebook: 'Facebook', whatsapp: 'WhatsApp', x: 'X',
  youtube: 'YouTube', invitacio: 'Enllaç d\'una sala', repte: 'Repte compartit', app: 'App instal·lada', directe: 'Directe (sense web d\'origen)', altres: 'Altres webs' };
const ACC_NAME = { 'partida-bots-facil': 'Contra bots · Fàcil', 'partida-bots-normal': 'Contra bots · Normal', 'partida-bots-dificil': 'Contra bots · Difícil',
  'partida-bots-mestre': 'Contra bots · Mestre', 'sala-creada': 'Sala amb amics', 'jugar-desconeguts': 'Jugar ara (desconeguts)', tutorial: 'Partida guiada',
  'convida-whatsapp': 'Convidar per WhatsApp', 'compartir-resultat': 'Compartir el resultat', 'repte-obert': 'Repte obert', 'canto-acabat': 'Cantons acabats',
  'partida-acabada': 'Partides acabades (al navegador)', revenja: 'Revenges', suggeriment: 'Suggeriments enviats', botiga: 'Botiga oberta',
  'obert-com-app': 'Obert com a app', 'app-installada': 'App instal·lada',
  'xat-missatge': 'Missatges al xat de la sala', llest: 'Jugadors que han dit «Llest»', 'inici-llestos': 'Partides començades perquè tots estaven llests',
  'demana-seure': 'Peticions per seure a una partida contra bots', 'repta': 'Reptes a qui jugava contra bots (començant de nou)','entra-partida': 'Jugadors que han segut a una partida contra bots' };
async function page(live) {
  const t = await table(30);
  const days = Array.from({ length: 30 }, (_, i) => day(new Date(Date.now() - (29 - i) * 864e5)));
  const sum = (keyTest, from) => days.slice(from).reduce((a, d) => a + Object.entries(t[d] || {}).filter(([k]) => keyTest(k)).reduce((s, [, n]) => s + n, 0), 0);
  const v = (key, from) => sum(k => k === key, from);
  const group = (prefix, from) => {
    const m = {};
    for (const d of days.slice(from)) for (const [k, n] of Object.entries(t[d] || {})) if (k.startsWith(prefix)) m[k.slice(prefix.length)] = (m[k.slice(prefix.length)] || 0) + n;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  };
  const bars = (list, names) => {
    const max = Math.max(1, ...list.map(x => x[1]));
    return list.length ? list.map(([k, n]) => `<div class="bar"><span>${esc(names[k] || k)}</span><i style="width:${Math.round(n / max * 100)}%"></i><b>${n}</b></div>`).join('') : '<p class="hint">Encara no hi ha dades.</p>';
  };
  const games = d => Object.entries(t[d] || {}).filter(([k]) => k === 'partida:comencada').reduce((s, [, n]) => s + n, 0);
  const maxDay = Math.max(1, ...days.map(d => (t[d] || {}).visita || 0), ...days.map(games));
  const chart = days.map(d => {
    const vis = (t[d] || {}).visita || 0, g = games(d);
    return `<div class="col" title="${d}: ${vis} visites, ${g} partides"><i class="vis" style="height:${vis / maxDay * 100}%"></i><i class="gam" style="height:${g / maxDay * 100}%"></i><small>${d.slice(8)}</small></div>`;
  }).join('');
  const card = (label, from) => `<div class="card"><h3>${label}</h3><p><b>${v('visita', from)}</b> visites</p><p>${v('visita:nova', from)} noves · ${v('visita:repetida', from)} repetides</p><p><b>${v('partida:comencada', from)}</b> partides · ${v('partida:acabada', from)} acabades</p></div>`;
  const today = days.length - 1;
  return `<!doctype html><html lang="ca"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Estadístiques · Truc mallorquí</title>
<style>
body{margin:0;background:#0d2421;color:#f5eedc;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:20px 16px 40px}h1{font-family:Georgia,serif;font-weight:400;margin:0 0 4px}
h2{font-size:1.05rem;margin:26px 0 10px;color:#e9b31c}.hint{color:#a8c3b9;font-size:.85rem}
.live{display:flex;gap:10px;flex-wrap:wrap}.live div{background:rgba(255,255,255,.07);border-radius:10px;padding:8px 12px}.live b{font-size:1.3rem;display:block}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.card{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px}
.card h3{margin:0 0 6px;font-size:.85rem;color:#a8c3b9;text-transform:uppercase;letter-spacing:.05em}.card p{margin:2px 0}.card p b{font-size:1.4rem}
.chart{display:flex;align-items:flex-end;gap:3px;height:170px;background:rgba(255,255,255,.04);border-radius:12px;padding:10px 8px 22px;position:relative}
.col{flex:1;height:100%;display:flex;align-items:flex-end;gap:1px;position:relative}.col i{flex:1;display:block;border-radius:3px 3px 0 0;min-height:1px}
.col .vis{background:#5fb8a0}.col .gam{background:#e9b31c}.col small{position:absolute;bottom:-18px;left:50%;transform:translateX(-50%);font-size:.6rem;color:#a8c3b9}
.legend{font-size:.8rem;color:#a8c3b9;margin-top:6px}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 10px;vertical-align:-1px}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.bar{display:grid;grid-template-columns:minmax(120px,40%) 1fr 44px;align-items:center;gap:8px;margin:5px 0;font-size:.9rem}
.bar i{display:block;height:12px;border-radius:6px;background:#5fb8a0;min-width:2px}.bar b{text-align:right}
</style></head><body><div class="wrap">
<h1>Estadístiques</h1><p class="hint">Dades agregades per dia, sense galetes ni IPs. Hora de Mallorca.</p>
<h2>Ara mateix</h2><div class="live"><div><b>${live.connexions}</b>connexions</div><div><b>${live.jugadorsEnSales}</b>jugadors en sales</div><div><b>${live.partidesEnJoc}</b>partides en joc</div><div><b>${live.salesCercantRivals}</b>sales cercant rivals</div></div>
<h2>Resum</h2><div class="cards">${card('Avui', today)}${card('Darrers 7 dies', 23)}${card('Darrers 30 dies', 0)}</div>
<h2>Darrers 30 dies</h2><div class="chart">${chart}</div><div class="legend"><i style="background:#5fb8a0"></i>Visites<i style="background:#e9b31c"></i>Partides començades</div>
<div class="two">
<div><h2>D'on venen (30 dies)</h2>${bars(group('ref:', 0), REF_NAME)}</div>
<div><h2>Aparell (30 dies)</h2>${bars(group('aparell:', 0), { mobil: 'Mòbil', ordinador: 'Ordinador', tauleta: 'Tauleta' })}</div>
</div>
<div class="two">
<div><h2>Partides (30 dies)</h2>${bars(group('partida:', 0), { comencada: 'Començades', acabada: 'Acabades (amb algú jugant)', abandonada: 'Abandonades (tothom se\'n va anar)',
  'durada:rapida': 'Ràpides (1 cantó)', 'durada:llarga': 'Llargues (2 cantons)', 'tipus:bots': 'Contra bots', 'tipus:persones': 'Només persones', 'tipus:mixta': 'Persones i bots',
  'nivell:facil': 'Nivell Fàcil', 'nivell:normal': 'Nivell Normal', 'nivell:dificil': 'Nivell Difícil', 'nivell:mestre': 'Nivell Mestre' })}</div>
<div><h2>Què fa la gent (30 dies)</h2>${bars(group('accio:', 0), ACC_NAME)}</div>
</div>
</div></body></html>`;
}

module.exports = { inc, hit, device, flush, table, page, REFS, EVENTS, day };
