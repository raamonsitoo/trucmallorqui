# Truc mallorquí en línia

Web per jugar al Truc mallorquí per internet, en 3D i amb senyes: **https://trucmallorqui.com**

## Què té

- **Partides de 4 en 2 parelles**, amb amics (sala amb codi de 4 lletres o enllaç), amb desconeguts o contra bots.
- **Quatre nivells de bots**: Fàcil, Normal, Difícil (entrenat jugant milers de cantons) i Mestre (s'imagina les cartes dels altres i decideix segons el marcador). Tots els bots d'una partida, també el company, juguen al nivell triat.
- **Partida ràpida o llarga**: la ràpida la guanya qui fa un cantó; la llarga, qui en fa dos. Es tria a la finestra «Contra bots» i, a la sala, l'amfitrió.
- **Sales mixtes**: «Buscar rivals» dins una sala, «Jugar amb desconeguts» per anar sol i llista de **sales obertes**. Mentre cerca diu quanta gent hi ha a la web; si en 20 s no ha entrat ningú (o no hi ha ningú més connectat), s'ofereix jugar contra bots.
- **Xat a la sala d'espera** (frases ràpides i text lliure amb filtre de paraulotes, màxim 5 missatges cada 10 s, es pot silenciar algú) i botó **«Estic llest»**: quan tots els jugadors de la sala ho estan, la partida comença sola al cap de 3 s. Tots dos són a una **barra fixa a baix** de la sala, amb el darrer missatge i els no llegits (i, al mòbil, una vibració curta i l'avís al títol de la pestanya); el xat s'obre en una finestra que puja amb el teclat. Els missatges només es guarden en memòria mentre la sala existeix.
- **Historial de la mà**: les cartes de les rondes ja jugades (qui ha tirat cada carta i quina ha guanyat). Al mòbil, un desplegable davall la ronda en joc (tancat a cada mà nova); a l'ordinador, un requadre a la columna de l'esquerra i, a pantalla completa, un desplegable a baix a la dreta. La ronda en joc (i la darrera, quan s'acaba la mà) no s'hi repeteix: ja es veu en viu. A la taula 3D, les cartes de cada ronda acabada queden davant de qui les ha tirades.
- **Senyes amb la cara** i frases al company («Vaig a tu», «Vina a mi», «Demana envit»).
- **Resposta en parella**: als cants contesten els dos de la parella i mana el que més vol (pujar > vull > no vull).
- **Baralla espanyola clàssica** dibuixada (36 cartes, sense 2, 8 ni 9, amb els talls al marc i l'índex a les cantonades) i **aspectes** per jugador: personatge, capell i revers de les cartes.
- **Partida en una casa de poble mallorquina** (parets de calç i marès, bigues, rajoles hidràuliques, finestra a la Serra amb el sol de l'horabaixa) i sala d'espera de color fosc.
- **Mode joc a pantalla completa**, **mode simple 2D** si el navegador no pot fer 3D i **dreceres de teclat** (1·2·3 tirar, T truc, E envit, F me'n vaig; V vull, N no vull, P pujar).
- **Partida guiada** («Aprendre a jugar») amb consells mentre jugues.
- **Revenja** en acabar la partida.
- **Instal·lable com una app** al mòbil (PWA) i pàgina **/regles** amb la guia completa.
- **Comptes amb Google** (opcionals): guarden el nom, l'aspecte i el **progrés** (experiència, nivells, partides i victòries). Es poden esborrar des del joc. Pàgina **/privacitat** (i /privacidad).
- **Protecció**: límits per IP i filtre de noms ofensius.
- **Botiga** (desactivada per defecte): aspectes de pagament amb Stripe, només estètics. Pack Fundador (revers exclusiu i estrella al nom) i Pack Festes de Mallorca (reversos de dimonis, fogueró i cossiers). Pàgina **/condicions** amb les condicions de venda.

## Fitxers

```
server.js              servidor web + WebSocket (sales, emparellament, límits, pàgines)
game.js                regles del joc, bots (i els seus nivells), senyes i mirada (tot passa al servidor)
bots-entrenats.json    paràmetres dels bots difícil i mestre que surten de l'entrenament
tools/entrena-bots.js  entrena els bots i fa tornejos entre nivells (vegeu «Entrenar els bots»)
accounts.js            comptes: entrar amb Google, sessions, nivells, compres i base de dades (PostgreSQL)
shop.js                botiga: catàleg i preus, pagaments amb Stripe, avís de pagament i mode simulat
stats.js               estadístiques pròpies sense galetes: comptadors per dia (taula stats_daily) i pàgina /stats
public/condicions.html condicions de venda de la botiga
public/index.html      el joc (3D amb Three.js, sala, menú)
public/regles.html     guia «Com es juga al truc mallorquí» (i public/reglas.html, en castellà)
tools/genera-regles.js torna a generar les dues guies (node tools/genera-regles.js)
tools/genera-privacitat.js  torna a generar public/privacitat.html i public/privacidad.html
public/manifest.webmanifest, public/sw.js, public/icon-*.png   app instal·lable
public/og.png, public/favicon.svg   imatge per compartir i icona
sim.js                 proves automàtiques amb jugadors simulats (npm test)
render.yaml            configuració per a Render
```

## Provar-ho a l'ordinador

```
npm install
npm start          # http://localhost:3000
npm test           # partides simulades, comptes i suggeriments: han d'acabar amb «TOT OK»
```

## Entrenar els bots

Els bots juguen entre ells sense esperes (un cantó dura menys d'un mil·lisegon; amb el mestre, uns 25 ms). Cada repartiment es juga dues vegades canviant les parelles de lloc, perquè la sort de les cartes no compti.

```
node tools/entrena-bots.js torneig 300     # taula: quin percentatge de cantons guanya cada nivell contra els altres
node tools/entrena-bots.js dificil 400     # entrena el difícil: prova canvis i es queda els que guanyen
node tools/entrena-bots.js variants '[{"infer":0}]'   # compara variants del mestre contra el difícil
node tools/entrena-bots.js estil 300       # quan canten truc: a quina ronda, i a quantes mans
```

Els bots tenen **paciència amb el truc**, com la gent: a la primera ronda només el canten amb una mà clarament bona (paràmetres `early`, `earlyMin`, `earlyBluff` i, al mestre, `mEarly`); la majoria de trucs arriben després de veure la primera ronda.

L'entrenament del difícil només accepta un canvi si guanya la versió anterior i, a més, no juga pitjor contra un mestre de sparring. Els resultats es desen a `bots-entrenats.json`, que `game.js` llegeix en arrencar.

## Publicació (Render)

Cada `git push` a `main` desplega automàticament. Variables d'entorn:

| Variable | Per a què | Valor |
|---|---|---|
| `CANONICAL_HOST` | Redirigeix `*.onrender.com` al domini propi | `trucmallorqui.com` |
| `GOATCOUNTER` | (opcional) Activa les estadístiques de visites sense galetes | codi del compte de goatcounter.com |
| `STATS_KEY` | (opcional) Activa `/stats?key=...` (estadístiques pròpies amb gràfiques: visites, d'on venen, aparell, partides i accions), `/stats.json?key=...` (dades en directe) i `/suggeriments?key=...` (bústia de suggeriments) | una clau secreta |
| `GOOGLE_CLIENT_ID` | (comptes) Identificador de client OAuth de Google | `....apps.googleusercontent.com` |
| `SESSION_SECRET` | (comptes) Clau per signar les sessions; no l'has de canviar mai | una clau secreta llarga |
| `DATABASE_URL` | (comptes) Base de dades PostgreSQL (p. ex. Neon) | `postgresql://...` |
| `CONTACT_EMAIL` | Correu de contacte de la política de privacitat | el correu de la web |

Els comptes només s'activen si hi ha `GOOGLE_CLIENT_ID`, `SESSION_SECRET` i `DATABASE_URL`. Sense elles, el joc funciona igual però sense comptes.

### Actualitzar sense tallar partides

Amb `DATABASE_URL`, cada sala es desa (taula `room_state`, mòdul `handoff.js`) quan canvia la sala d'espera i a l'inici de cada mà. Així es pot fer `git push` sempre que es vulgui:

- **Actualització**: Render engega el servidor nou i, un minut després, avisa el vell (SIGTERM). El vell deixa acabar la mà en joc (com a màxim `TRUC_DRAIN_MS`, per defecte 25 s), passa cada sala al nou i s'atura. Els jugadors veuen «Actualitzant el joc…», tornen a entrar sols i la partida continua amb el mateix marcador. Si la mà no s'ha acabat a temps, es torna a repartir.
- **Aturada de cop** (un reinici del pla gratuït): el servidor nou recupera la sala quan el vell ja no la renova (30 s); la mà que es jugava es torna a repartir.
- Per deixar acabar sempre les mans: `maxShutdownDelaySeconds: 300` a `render.yaml` i `TRUC_DRAIN_MS=280000` a les variables d'entorn.
- El xat no es desa. Les còpies s'esborren en tancar la sala i, com a màxim, al cap de 6 hores.

### Botiga

Necessita els comptes activats (per comprar s'ha d'entrar amb Google). Els pagaments van per **Lemon Squeezy** (és el venedor de registre: cobra, fa la factura i s'encarrega de l'IVA; a /condicions surt com a venedor) o per **Stripe**. Si hi ha clau de Lemon Squeezy, es fa servir aquesta. Variables:

| Variable | Per a què | Valor |
|---|---|---|
| `SHOP` | Qui veu la botiga | `off` (per defecte), `testers` (només els comptes de `SHOP_TESTERS`) o `on` (tothom) |
| `SHOP_TESTERS` | Comptes que la veuen en mode `testers` | identificadors de compte separats per comes (columna `id` de la taula `players`) |
| `LEMONSQUEEZY_API_KEY` | Clau de l'API de Lemon Squeezy (Settings → API) | la clau |
| `LEMONSQUEEZY_STORE_ID` | Número de la botiga (Settings → Stores) | p. ex. `123456` |
| `LEMONSQUEEZY_VARIANTS` | Número de variant de cada article (el preu que es cobra és el del joc) | `fundador:111111,festes:222222` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Lemon Squeezy avisa dels pagaments a `https://trucmallorqui.com/lemonsqueezy/webhook` (esdeveniment `order_created`) | el secret que hi poses |
| `LEMONSQUEEZY_TEST` | `1` mentre la botiga de Lemon Squeezy és en mode de prova (no es cobra res); s'ha de llevar en passar a cobrar de veres | `1` |
| `STRIPE_SECRET_KEY` | Clau de Stripe (només si no es fa servir Lemon Squeezy) | `sk_test_...` per provar o `sk_live_...` per cobrar de veres |
| `STRIPE_WEBHOOK_SECRET` | Stripe avisa dels pagaments a `https://trucmallorqui.com/stripe/webhook` (esdeveniment `checkout.session.completed`) | `whsec_...` |
| `SELLER_NAME`, `SELLER_NIF`, `SELLER_ADDRESS` | Amb Stripe: dades del venedor a /condicions (obligatòries abans de cobrar de veres). Amb Lemon Squeezy no calen | nom, NIF i adreça |

Per provar-la a l'ordinador sense cap dels dos: `SHOP=on SHOP_SIMULATED=1` (el pagament és de mentida). Les compres es guarden a la taula `purchases`; el servidor apunta cada compra al registre («compra: compte 12, festes, 1.99 €»).

La bústia de suggeriments (enllaç «Suggeriments» a baix de tot) guarda els missatges a la taula `feedback` de `DATABASE_URL`; sense base de dades, els guarda en memòria i al registre del servidor. Es llegeixen a `/suggeriments?key=STATS_KEY` o a Neon → Tables → feedback.

El domini és a Namecheap (registre A `@` → `216.24.57.1` i CNAME `www` → `trucmallorqui.onrender.com`).
