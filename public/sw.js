// Service worker mínim del Truc mallorquí: permet instal·lar la web com una app
// i mostra un avís si no hi ha connexió. El joc sempre necessita internet.
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sense connexió</title>'
  + '<body style="margin:0;font-family:system-ui,sans-serif;background:#10302e;color:#fbf6e9;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">'
  + '<div><h1 style="font-weight:400">Truc mallorquí</h1><p>No hi ha connexió a internet.<br>Torna-ho a provar quan en tenguis.</p>'
  + '<button onclick="location.reload()" style="font:inherit;padding:.6rem 1.2rem;border-radius:10px;border:0;background:#e0a21f;font-weight:700">Tornar-ho a provar</button></div></body>';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return; // només les pàgines; la resta va directe a la xarxa
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
