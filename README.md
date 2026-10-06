# Truc mallorquí en línia

Web per jugar al Truc mallorquí per internet, en 3D i amb senyes: **https://trucmallorqui.com**

## Què té

- **Partides de 4 en 2 parelles**, amb amics (sala amb codi de 4 lletres o enllaç), amb desconeguts o contra bots.
- **Sales mixtes**: «Buscar rivals» dins una sala, «Jugar amb desconeguts» per anar sol i llista de **sales obertes**. Si en 60 s no hi ha ningú, s'ofereix jugar contra bots.
- **Senyes amb la cara** i frases al company («Vaig a tu», «Vina a mi», «Demana envit»).
- **Resposta en parella**: als cants contesten els dos de la parella i mana el que més vol (pujar > vull > no vull).
- **Baralla espanyola** dibuixada (36 cartes, sense 2, 8 ni 9) i **aspectes** per jugador: personatge, capell i revers de les cartes.
- **Mode joc a pantalla completa**, **mode simple 2D** si el navegador no pot fer 3D i **dreceres de teclat** (1·2·3 tirar, T truc, E envit, F me'n vaig; V vull, N no vull, P pujar).
- **Partida guiada** («Aprendre a jugar») amb consells mentre jugues.
- **Revenja** en acabar la partida.
- **Instal·lable com una app** al mòbil (PWA) i pàgina **/regles** amb la guia completa.
- **Protecció**: límits per IP i filtre de noms ofensius.

## Fitxers

```
server.js              servidor web + WebSocket (sales, emparellament, límits, pàgines)
game.js                regles del joc, bots, senyes i mirada (tot passa al servidor)
public/index.html      el joc (3D amb Three.js, sala, menú)
public/regles.html     guia «Com es juga al truc mallorquí» (i public/reglas.html, en castellà)
tools/genera-regles.js torna a generar les dues guies (node tools/genera-regles.js)
public/manifest.webmanifest, public/sw.js, public/icon-*.png   app instal·lable
public/og.png, public/favicon.svg   imatge per compartir i icona
sim.js                 proves automàtiques amb jugadors simulats (npm test)
render.yaml            configuració per a Render
```

## Provar-ho a l'ordinador

```
npm install
npm start          # http://localhost:3000
npm test           # 4 partides simulades: han d'acabar amb «TOT OK»
```

## Publicació (Render)

Cada `git push` a `main` desplega automàticament. Variables d'entorn:

| Variable | Per a què | Valor |
|---|---|---|
| `CANONICAL_HOST` | Redirigeix `*.onrender.com` al domini propi | `trucmallorqui.com` |
| `GOATCOUNTER` | (opcional) Activa les estadístiques de visites sense galetes | codi del compte de goatcounter.com |
| `STATS_KEY` | (opcional) Activa `/stats?key=...` amb dades en directe | una clau secreta |

El domini és a Namecheap (registre A `@` → `216.24.57.1` i CNAME `www` → `trucmallorqui.onrender.com`).
