'use strict';
// Botiga: aspectes de pagament. Només estètica: res del que es compra fa guanyar partides.
// Els pagaments van per Lemon Squeezy o per Stripe (la pàgina de pagament és seva; aquí no passa cap targeta).
// Lemon Squeezy és el venedor de registre (merchant of record): ven en nom nostre, cobra, fa la factura i s'encarrega de l'IVA.
// Si hi ha clau de Lemon Squeezy, es fa servir aquesta; si no, la de Stripe.
//
// Variables d'entorn:
//   SHOP                         off (per defecte) | testers | on   — qui veu la botiga
//   SHOP_TESTERS                 identificadors de compte separats per comes que la veuen en mode «testers»
//   LEMONSQUEEZY_API_KEY         clau de l'API (Settings → API)
//   LEMONSQUEEZY_STORE_ID        número de la botiga (Settings → Stores)
//   LEMONSQUEEZY_VARIANTS        número de variant de cada article: fundador:123456,festes:654321
//   LEMONSQUEEZY_WEBHOOK_SECRET  el secret del webhook (Settings → Webhooks) que avisa a /lemonsqueezy/webhook
//   LEMONSQUEEZY_TEST=1          mentre la botiga de Lemon Squeezy és en mode de prova (no es cobra res)
//   STRIPE_SECRET_KEY            sk_test_... (proves) o sk_live_... (de veres)
//   STRIPE_WEBHOOK_SECRET        whsec_...: Stripe ens avisa dels pagaments a /stripe/webhook
//   SHOP_SIMULATED=1             sense cap dels dos: pagament simulat (només per provar a l'ordinador)
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
const LS_KEY = (process.env.LEMONSQUEEZY_API_KEY || '').trim();
const LS_STORE = (process.env.LEMONSQUEEZY_STORE_ID || '').trim();
const LS_SECRET = (process.env.LEMONSQUEEZY_WEBHOOK_SECRET || '').trim();
const LS_TEST = (process.env.LEMONSQUEEZY_TEST || '').trim() === '1';
const LS_API = (process.env.LEMONSQUEEZY_API_URL || 'https://api.lemonsqueezy.com/v1').trim(); // només es canvia a les proves
const LS_VARIANTS = {};
for (const kv of (process.env.LEMONSQUEEZY_VARIANTS || '').split(',')) {
  const [k, v] = kv.split(':').map(s => (s || '').trim());
  if (ITEMS[k] && /^\d+$/.test(v || '')) LS_VARIANTS[k] = v;
}
const USE_LEMON = !!LS_KEY, USE_STRIPE = !!STRIPE_KEY && !USE_LEMON;
const SIMULATED = process.env.SHOP_SIMULATED === '1' && !STRIPE_KEY && !LS_KEY;
const ENABLED = MODE !== 'off' && (USE_LEMON || USE_STRIPE || SIMULATED);
// En proves (mode de prova, clau sk_test o simulat) no es cobra res: la botiga ho diu ben clar.
const TEST = SIMULATED || (USE_LEMON ? LS_TEST : STRIPE_KEY.startsWith('sk_test_'));
// Qui fa el pagament (surt a les condicions i a la privacitat). Lemon Squeezy, a més, és qui ven.
const PAY_NAME = USE_STRIPE ? 'Stripe' : 'Lemon Squeezy';
const PAY_ENTITY = USE_STRIPE ? 'Stripe Payments Europe, Ltd.' : 'Lemon Squeezy, LLC';
const MOR = !USE_STRIPE;
if (USE_LEMON) {
  const falta = [!LS_STORE && 'LEMONSQUEEZY_STORE_ID', !LS_SECRET && 'LEMONSQUEEZY_WEBHOOK_SECRET',
    ...Object.keys(ITEMS).filter(k => !LS_VARIANTS[k]).map(k => 'la variant de «' + k + '» a LEMONSQUEEZY_VARIANTS')].filter(Boolean);
  if (falta.length) console.warn('BOTIGA (Lemon Squeezy): falta ' + falta.join(', '));
}

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

// ---------- Lemon Squeezy ----------
async function lemon(method, pathname, body) {
  const r = await fetch(LS_API + pathname, {
    method,
    headers: { Authorization: 'Bearer ' + LS_KEY, Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const j = await r.json().catch(() => ({}));
  const e = j.errors && j.errors[0];
  if (!r.ok) throw new Error('Lemon Squeezy ' + r.status + ': ' + ((e && (e.detail || e.title)) || 'error'));
  return j;
}
// Pagaments oberts (ref -> { uid, item, paid, amount, at }). L'avís de Lemon Squeezy els marca com a pagats.
// Si el servidor es reinicia es perden, però no passa res: l'avís desbloqueja la compra igualment.
const lsPending = new Map();
const LS_REF = /^ls_[a-f0-9]{24}$/;
async function lemonCheckout(uid, itemId, it, origin) {
  const variant = LS_VARIANTS[itemId];
  if (!LS_STORE || !variant) throw new Error('Lemon Squeezy: falta la botiga o la variant de ' + itemId);
  const ref = 'ls_' + crypto.randomBytes(12).toString('hex');
  const j = await lemon('POST', '/checkouts', { data: {
    type: 'checkouts',
    attributes: {
      custom_price: it.price, // el preu el posa el joc (el mateix que surt a la botiga)
      product_options: { name: it.name, description: it.desc, redirect_url: origin + '/?compra=' + ref },
      // el comprador ha marcat la casella de renúncia al desistiment abans d'anar a pagar
      checkout_data: { custom: { uid: String(uid), item: itemId, ref, desistiment: new Date().toISOString() } },
      expires_at: new Date(Date.now() + 2 * 3600e3).toISOString(),
      test_mode: LS_TEST
    },
    relationships: {
      store: { data: { type: 'stores', id: LS_STORE } },
      variant: { data: { type: 'variants', id: variant } }
    }
  } });
  const url = j.data && j.data.attributes && j.data.attributes.url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) throw new Error('Lemon Squeezy: no ha donat la pàgina de pagament');
  for (const [k, v] of lsPending) if (Date.now() - v.at > 3 * 3600e3) lsPending.delete(k);
  lsPending.set(ref, { uid, item: itemId, paid: false, amount: 0, at: Date.now() });
  return url;
}
// Avís de Lemon Squeezy: comprova la signatura (capçalera X-Signature, HMAC-SHA256 del cos) i torna l'esdeveniment, o null
function verifyLemonWebhook(raw, sig, secret = LS_SECRET) {
  if (!secret || typeof sig !== 'string' || !/^[a-f0-9]{64}$/i.test(sig)) return null;
  const want = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig.toLowerCase()), Buffer.from(want))) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}
// D'un avís, la comanda pagada que desbloqueja: { uid, item, ref, amount }, o null.
// Una comanda de prova no desbloqueja res a la botiga de veres.
function lemonOrder(ev, test = TEST) {
  const meta = ev && ev.meta, d = ev && ev.data, a = d && d.attributes;
  if (!meta || meta.event_name !== 'order_created' || !a || a.status !== 'paid') return null;
  if (meta.test_mode && !test) return null;
  const cd = meta.custom_data || {}, uid = Number(cd.uid), item = cd.item;
  if (!(uid > 0) || !ITEMS[item]) return null;
  const ref = LS_REF.test(cd.ref || '') ? cd.ref : 'ls_order_' + String(d.id || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 40);
  const o = { uid, item, ref, amount: Number(a.total) || 0 };
  const p = lsPending.get(ref);
  if (p && p.uid === uid && p.item === item) { p.paid = true; p.amount = o.amount; }
  return o;
}

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
  if (USE_LEMON) return lemonCheckout(uid, itemId, it, origin);
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
// Mira una sessió de pagament: { paid, uid, item, amount } (wait: encara no ha arribat l'avís, val la pena tornar-hi)
async function getSession(id) {
  if (typeof id !== 'string' || id.length > 200) return null;
  if (SIMULATED) {
    const s = simSessions.get(id);
    return s ? { paid: s.paid, uid: s.uid, item: s.item, amount: s.paid ? ITEMS[s.item].price : 0 } : null;
  }
  if (LS_REF.test(id)) {
    const s = lsPending.get(id);
    return s ? { paid: s.paid, uid: s.uid, item: s.item, amount: s.amount, wait: !s.paid } : null;
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

module.exports = { ITEMS, PREMIUM_BACKS, MODE, ENABLED, TEST, SIMULATED, PAY_NAME, PAY_ENTITY, MOR, visibleTo, entitlements, catalog,
  createCheckout, getSession, simulatePay, verifyWebhook, verifyLemonWebhook, lemonOrder };
