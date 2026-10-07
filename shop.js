'use strict';
// Botiga: aspectes de pagament. Només estètica: res del que es compra fa guanyar partides.
// Els pagaments van per Stripe Checkout (la pàgina de pagament és de Stripe; aquí no passa cap targeta).
//
// Variables d'entorn:
//   SHOP                   off (per defecte) | testers | on   — qui veu la botiga
//   SHOP_TESTERS           identificadors de compte separats per comes que la veuen en mode «testers»
//   STRIPE_SECRET_KEY      sk_test_... (proves) o sk_live_... (de veres)
//   STRIPE_WEBHOOK_SECRET  whsec_...: Stripe ens avisa dels pagaments a /stripe/webhook
//   SHOP_SIMULATED=1       sense Stripe: pagament simulat (només per provar a l'ordinador)
const crypto = require('crypto');

// Preus en cèntims d'euro. `gives`: el que desbloqueja (revers o insígnia).
const ITEMS = {
  fundador: {
    name: 'Pack Fundador', price: 499, gives: ['back:fundador', 'badge:fundador'],
    desc: "Revers exclusiu «Fundador» i una estrella al costat del teu nom. Només per als primers que donen suport al joc."
  },
  festes: {
    name: 'Pack Festes de Mallorca', price: 199, gives: ['back:dimonis', 'back:foguero', 'back:cossiers'],
    desc: 'Tres reversos de cartes: dimonis de Sant Antoni, fogueró i cossiers.'
  }
};
const PREMIUM_BACKS = new Set();
for (const it of Object.values(ITEMS)) for (const g of it.gives) if (g.startsWith('back:')) PREMIUM_BACKS.add(g.slice(5));

const MODE = ['on', 'testers'].includes((process.env.SHOP || '').trim()) ? process.env.SHOP.trim() : 'off';
const TESTERS = new Set((process.env.SHOP_TESTERS || '').split(',').map(s => Number(s.trim())).filter(n => n > 0));
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY || '').trim();
const WEBHOOK_SECRET = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const SIMULATED = process.env.SHOP_SIMULATED === '1' && !STRIPE_KEY;
const ENABLED = MODE !== 'off' && (!!STRIPE_KEY || SIMULATED);
// En proves (clau sk_test o simulat) no es cobra res: la botiga ho diu ben clar.
const TEST = SIMULATED || STRIPE_KEY.startsWith('sk_test_');

// La veu aquest compte? Sense compte, només si la botiga és oberta a tothom.
function visibleTo(uid) {
  if (!ENABLED) return false;
  return MODE === 'on' || (!!uid && TESTERS.has(uid));
}
// Què té desbloquejat qui ha comprat aquests articles
function entitlements(items) {
  const out = new Set();
  for (const id of items || []) if (ITEMS[id]) for (const g of ITEMS[id].gives) out.add(g);
  return out;
}
const catalog = () => Object.entries(ITEMS).map(([id, it]) => ({ id, name: it.name, desc: it.desc, price: it.price, gives: it.gives }));

// ---------- Stripe ----------
async function stripe(method, pathname, params) {
  const r = await fetch('https://api.stripe.com/v1' + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params ? new URLSearchParams(params).toString() : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Stripe ' + r.status + ': ' + ((j.error && j.error.message) || 'error'));
  return j;
}
const simSessions = new Map(); // id -> { uid, item, paid, at }

// Crea la pàgina de pagament i torna on s'ha d'anar.
async function createCheckout(uid, itemId, origin) {
  const it = ITEMS[itemId];
  if (!it) throw new Error('article desconegut');
  if (SIMULATED) {
    const id = 'sim_' + crypto.randomBytes(12).toString('hex');
    simSessions.set(id, { uid, item: itemId, paid: false, at: Date.now() });
    for (const [k, v] of simSessions) if (Date.now() - v.at > 3600e3) simSessions.delete(k);
    return origin + '/compra-simulada?s=' + id;
  }
  const s = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(it.price),
    'line_items[0][price_data][product_data][name]': it.name,
    'line_items[0][price_data][product_data][description]': it.desc,
    client_reference_id: String(uid),
    'metadata[uid]': String(uid),
    'metadata[item]': itemId,
    // El comprador ha marcat la casella de renúncia al desistiment abans d'anar a pagar
    'metadata[desistiment]': new Date().toISOString(),
    'payment_intent_data[metadata][uid]': String(uid),
    'payment_intent_data[metadata][item]': itemId,
    success_url: origin + '/?compra={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?compra=cancel',
    locale: 'auto'
  });
  return s.url;
}
// Mira una sessió de pagament: { paid, uid, item, amount }
async function getSession(id) {
  if (typeof id !== 'string' || id.length > 200) return null;
  if (SIMULATED) {
    const s = simSessions.get(id);
    return s ? { paid: s.paid, uid: s.uid, item: s.item, amount: s.paid ? ITEMS[s.item].price : 0 } : null;
  }
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return null;
  const s = await stripe('GET', '/checkout/sessions/' + id);
  return { paid: s.payment_status === 'paid', uid: Number(s.metadata && s.metadata.uid), item: s.metadata && s.metadata.item, amount: s.amount_total || 0 };
}
function simulatePay(id) { const s = simSessions.get(id); if (!s) return false; s.paid = true; return true; }

// Avís de Stripe: comprova la signatura (capçalera Stripe-Signature) i torna l'esdeveniment, o null.
function verifyWebhook(raw, header, secret = WEBHOOK_SECRET, now = Date.now()) {
  if (!secret || typeof header !== 'string') return null;
  let t = 0; const sigs = [];
  for (const kv of header.split(',')) {
    const i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
    if (k === 't') t = Number(v); else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || Math.abs(now / 1000 - t) > 300) return null;
  const want = crypto.createHmac('sha256', secret).update(t + '.' + raw).digest('hex');
  const ok = sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
  if (!ok) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

module.exports = { ITEMS, PREMIUM_BACKS, MODE, ENABLED, TEST, SIMULATED, visibleTo, entitlements, catalog, createCheckout, getSession, simulatePay, verifyWebhook };
