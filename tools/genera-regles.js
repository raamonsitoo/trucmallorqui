// Genera public/regles.html (català) i public/reglas.html (castellà) amb les cartes del joc.
// Ús: node tools/genera-regles.js  (cal tornar-ho a executar si es canvia la baralla a index.html)
const fs=require('fs');
const path=require('path');
const PUB=path.join(__dirname,'..','public');
const html=fs.readFileSync(path.join(PUB,'index.html'),'utf8');
const a=html.indexOf('// ---------- Dibuix de cartes'),b=html.indexOf('// ---------- Aspectes: capells i reversos');
if(a<0||b<0)throw new Error('No trob la secció de les cartes a index.html');
const isAmo=c=>c.n===11&&c.s==='bastos',isMadona=c=>c.n===10&&c.s==='oros';
eval(html.slice(a,b)+';global.cardSVG=cardSVG;');
const SUITS=['oros','copes','espases','bastos'];
// Els degradats de les cartes es posen una sola vegada a la pàgina (SHARED_DEFS) i cada carta hi fa referència
const normIds=s=>s.replace(/(id="|url\(#)c[0-9a-z]+?(?=[A-Z])/g,'$1tm');
const SHARED_DEFS=normIds(cardSVG({n:1,s:'oros'}).match(/<defs>[\s\S]*?<\/defs>/)[0]);
const card=c=>normIds(cardSVG(c).replace(/<defs>[\s\S]*?<\/defs>/,'')).replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" ');
const S4=n=>SUITS.map(s=>({n,s}));
const TIER_CARDS=[[{n:11,s:'bastos'}],[{n:10,s:'oros'}],[{n:1,s:'espases'}],[{n:1,s:'bastos'}],[{n:7,s:'espases'}],[{n:7,s:'oros'}],S4(3),[{n:1,s:'copes'},{n:1,s:'oros'}],S4(12),
 [{n:11,s:'espases'},{n:11,s:'copes'},{n:11,s:'oros'}],[{n:10,s:'espases'},{n:10,s:'copes'},{n:10,s:'bastos'}],[{n:7,s:'copes'},{n:7,s:'bastos'}],S4(6),S4(5),S4(4)];
const tile="<svg xmlns='http://www.w3.org/2000/svg' width='36' height='24' viewBox='0 0 36 24'><rect width='36' height='24' fill='#2a4a9a'/><path d='M0 24C0 12 9 6 18 0C27 6 36 12 36 24Z' fill='#f3ece0'/><path d='M6 24C6 15 12 10 18 6C24 10 30 15 30 24Z' fill='#b8322a'/><path d='M12 24C12 18 15 15 18 12C21 15 24 18 24 24Z' fill='#2a4a9a'/></svg>";

const L={
ca:{
 lang:'ca',locale:'ca_ES',path:'/regles',file:'regles.html',other:{lang:'es',path:'/reglas',label:'Leer en castellano'},
 title:'Com es juga al truc mallorquí: regles, envits i senyes · Juga online',
 desc:"Regles del truc mallorquí explicades fàcil: ordre de les cartes, l'amo i la madona, el truc i l'envit, els punts i les senyes. I juga online gratis.",
 ogt:'Com es juga al truc mallorquí',ogd:'Regles, envits, punts i senyes del truc mallorquí, explicades fàcil.',
 brand:'Truc mallorquí',play:'Jugar ara',h1:'Com es juga al truc mallorquí',
 lead:"El truc és el joc de cartes més popular de Mallorca: es juga per parelles, amb la baralla espanyola, i té de tot: trucs, envits, l'amo i la madona i, sobretot, les senyes amb el company. Aquí tens les regles explicades fàcil.",
 cta1:'Jugar online gratis',cta2:'Jugar contra bots',tocT:'En aquesta guia',
 toc:['El bàsic',"L'ordre de les cartes",'Com va una mà','El truc',"L'envit",'Les senyes','El cantó i la partida','Detalls que convé saber','Preguntes freqüents'],
 basic:`<ul>
<li><b>4 jugadors en 2 parelles.</b> Els companys s'asseuen l'un davant l'altre.</li>
<li><b>36 cartes</b> de la baralla espanyola: l'1, el 3, 4, 5, 6, 7, la sota (10), el cavall (11) i el rei (12) de cada pal. <b>No hi entren el 2, el 8 ni el 9.</b></li>
<li>Cada jugador rep <b>3 cartes</b>. Es juguen fins a <b>3 rondes</b>: qui en guanya dues, guanya la mà.</li>
<li>La partida es juga a <b>dos cantons de 24 punts</b>.</li></ul>`,
 cartesP:"De la carta que mata més a la que mata menys. Les dues més importants tenen nom propi: <b>l'amo</b> (el cavall de bastos) i <b>la madona</b> (la sota d'oros).",
 tiers:["L'amo (cavall de bastos)","La madona (sota d'oros)","As d'espases","As de bastos","7 d'espases","7 d'oros","Els quatre 3","As de copes i as d'oros","Els reis (12)","Els altres cavalls (11)","Les altres sotes (10)","7 de copes i de bastos","Els 6","Els 5","Els 4"],
 ma:`<p>Comença el jugador que és <b>mà</b> (el que va just després de qui reparteix) i es tira per torns. A cada ronda guanya la carta més alta; la parella que guanya dues rondes s'endú la mà.</p>
<ul><li>Si les dues cartes més altes d'una ronda són iguals i de parelles diferents, la ronda queda <b>empatada</b>.</li>
<li>Si s'empata la primera, guanya la mà qui guanyi la segona. Si s'empata la segona, guanya qui va guanyar la primera. Si s'empaten les tres, guanya la parella que és mà.</li>
<li>La ronda següent la comença qui ha guanyat l'anterior.</li>
<li>En qualsevol moment, al teu torn, te'n pots anar (<b>«me'n vaig»</b>): els rivals s'enduen els punts que hi havia en joc.</li></ul>`,
 trucP:"Una mà sense cants val 1 punt. Al teu torn, abans de tirar, pots cantar <b>truc</b> per jugar-te'n més. Els rivals poden dir <b>«vull»</b> (acceptar), <b>«no vull»</b> (i et donen els punts d'abans) o <b>pujar</b>: retruc, val 9 i, al final, <b>tots</b> (el cantó sencer).",
 th:['Cant','Si es vol','Si no es vol'],trucRows:[['Sense cant','1','—'],['Truc','3','1'],['Retruc','6','3'],['Val 9','9','6'],['Tots','el cantó','9']],
 trucNote:"Després d'un «vull», només pot tornar a pujar la parella que ha acceptat.",
 envitP:"L'envit és una aposta sobre quin jugador té millors <b>dues cartes</b> per sumar. Només es pot cantar a la <b>primera ronda</b>, i també s'hi val si ja s'ha cantat i acceptat el truc. Els envits es canten i s'accepten durant la mà, però <b>no es diuen fins que la mà s'acaba</b>.",
 envitH:"Com es compta l'envit",
 envitList:`<ul><li><b>Dues cartes del mateix pal</b>: 20 + el valor de cada carta. La sota, el cavall i el rei valen 0.</li>
<li><b>Sense dues cartes del mateix pal</b>: val la carta més alta d'un dígit.</li>
<li><b>L'amo val 28</b> i <b>la madona 27</b>, i s'ajunten amb <b>qualsevol</b> carta: hi sumes el valor de l'altra.</li>
<li><b>Amo i madona junts fan 35</b>, la jugada màxima.</li></ul>`,
 exH:'Exemples',ex:['7 i 6 de copes: 20 + 7 + 6 = <b>33</b>',"Rei i 3 d'espases: 20 + 0 + 3 = <b>23</b>",'Madona i 5 de bastos: 27 + 5 = <b>32</b>','Amo i madona: <b>35</b>',"7 d'oros i 5 de copes (pals diferents): <b>7</b>"],
 envitRows:[['Envit','2','1'],['Jo envit','4','2'],['2 més','6','4'],['Envit tots','el que falta a la parella que va davant per arribar a 24','6']],
 envitNote:"<b>Envit tots:</b> val els punts que falten a la parella que va davant per arribar a 24. Per exemple, si anau 15 a 9, l'envit tots val 9. Només es pot pujar a tots si val més que el «2 més». Si dos jugadors empaten a envit, guanya el que és més a prop de la mà. Un envit acceptat es compta encara que la mà acabi abans, i els seus punts se sumen abans dels de la mà.",
 senyesP:"El més bonic del truc mallorquí: amb gests de la cara, dius al teu company quines cartes bones duus. <b>Dreta i esquerra són les de qui fa la seña</b> (quan el teu company et mira de cara, la seva dreta és la teva esquerra).",
 sth:['Gest','Vol dir'],
 signs:[['Pujar les celles',"L'amo (cavall de bastos)"],['Guinyar un ull',"La madona (sota d'oros)"],['Treure la llengua cap a la seva dreta',"As d'espases"],['Treure la llengua cap a la seva esquerra','As de bastos'],['Moure el llavi cap a la seva dreta',"7 d'espases"],['Moure el llavi cap a la seva esquerra',"7 d'oros"],['Mossegar-se el llavi','Un 3'],['Guinyar els dos ulls','No du cap carta bona (va buit)']],
 senyesNote:"Compte: si un rival et mira just quan fas la seña, també la veu i la farà servir contra tu. També es pot parlar en veu alta: <b>«Vaig a tu»</b> (tira tu la bona), <b>«Vina a mi»</b> (la tir jo) o <b>«Demana envit»</b>, però els rivals ho senten.",
 cantoP:"Els punts de cada mà es van sumant. La primera parella que arriba a <b>24 punts</b> guanya el <b>cantó</b>, i qui guanya <b>dos cantons</b> guanya la partida.",
 detP:'A cada poble i a cada colla es juga un poc diferent. Aquestes són les regles que fa servir <a href="/">trucmallorqui.com</a>:',
 det:["Tens 40 segons per tirar o contestar. Si s'acaba el temps, es tira la carta més baixa o es diu «no vull».","Quan una parella ha de contestar un cant, contesten tots dos. Si un diu «no vull» i l'altre vol, mana el que vol.","Els seients buits els juguen bots, i si algú es desconnecta, un bot juga per ell fins que torna."],
 faq:[['Es pot jugar al truc mallorquí online gratis?',"Sí. A trucmallorqui.com pots jugar gratis des del navegador del mòbil o de l'ordinador, sense instal·lar res."],
  ['Puc jugar amb els meus amics?',"Sí. Crea una sala i comparteix l'enllaç o el codi de 4 lletres. Els seients buits els juguen bots."],
  ['Puc jugar si no tenc amics connectats?',"Sí. Amb «Jugar amb desconeguts» et juntam amb altres jugadors, i amb «Jugar contra bots» pots començar a l'instant."],
  ["Quines cartes no s'utilitzen al truc mallorquí?","Es juga amb 36 cartes de la baralla espanyola: no hi entren el 2, el 8 ni el 9."],
  ['Quina és la carta més alta del truc?',"L'amo, que és el cavall de bastos. Després ve la madona (sota d'oros), l'as d'espases i l'as de bastos."]],
 endBox:'<b>Ja ho tens?</b> Prova-ho ara: pots jugar amb amics, amb desconeguts o contra bots, des del mòbil o l\'ordinador.',endCta:'Jugar al truc',
 footer:'Truc mallorquí online',follow:'Segueix-nos a X'
},
es:{
 lang:'es',locale:'es_ES',path:'/reglas',file:'reglas.html',other:{lang:'ca',path:'/regles',label:'Llegir en català'},
 title:'Cómo se juega al truc mallorquín: reglas, envites y señas · Juega online',
 desc:'Reglas del truc mallorquín explicadas fácil: orden de las cartas, el amo y la madona, el truc y el envit, los puntos y las señas. Y juega online gratis.',
 ogt:'Cómo se juega al truc mallorquín',ogd:'Reglas, envites, puntos y señas del truc mallorquín, explicadas fácil.',
 brand:'Truc mallorquí',play:'Jugar ahora',h1:'Cómo se juega al truc mallorquín',
 lead:'El truc es el juego de cartas más popular de Mallorca: se juega por parejas, con la baraja española, y lo tiene todo: trucs, envites, el amo y la madona y, sobre todo, las señas con el compañero. Aquí tienes las reglas explicadas de forma sencilla.',
 cta1:'Jugar online gratis',cta2:'Jugar contra bots',tocT:'En esta guía',
 toc:['Lo básico','El orden de las cartas','Cómo va una mano','El truc','El envit','Las señas','El cantó y la partida','Detalles que conviene saber','Preguntas frecuentes'],
 basic:`<ul>
<li><b>4 jugadores en 2 parejas.</b> Los compañeros se sientan uno frente al otro.</li>
<li><b>36 cartas</b> de la baraja española: el 1, 3, 4, 5, 6, 7, la sota (10), el caballo (11) y el rey (12) de cada palo. <b>No se usan el 2, el 8 ni el 9.</b></li>
<li>Cada jugador recibe <b>3 cartas</b>. Se juegan hasta <b>3 rondas</b>: quien gana dos, gana la mano.</li>
<li>La partida se juega a <b>dos «cantons» de 24 puntos</b>.</li></ul>`,
 cartesP:'De la carta que más mata a la que menos. Las dos más importantes tienen nombre propio: <b>el amo</b> (el caballo de bastos) y <b>la madona</b> (la sota de oros).',
 tiers:['El amo (caballo de bastos)','La madona (sota de oros)','As de espadas','As de bastos','7 de espadas','7 de oros','Los cuatro 3','As de copas y as de oros','Los reyes (12)','Los demás caballos (11)','Las demás sotas (10)','7 de copas y de bastos','Los 6','Los 5','Los 4'],
 ma:`<p>Empieza el jugador que es <b>mano</b> (el que va justo después de quien reparte) y se tira por turnos. En cada ronda gana la carta más alta; la pareja que gana dos rondas se lleva la mano.</p>
<ul><li>Si las dos cartas más altas de una ronda son iguales y de parejas distintas, la ronda queda <b>empatada</b>.</li>
<li>Si se empata la primera, gana la mano quien gane la segunda. Si se empata la segunda, gana quien ganó la primera. Si se empatan las tres, gana la pareja que es mano.</li>
<li>La ronda siguiente la empieza quien ganó la anterior.</li>
<li>En cualquier momento, en tu turno, puedes irte (<b>«me'n vaig»</b>): los rivales se llevan los puntos que había en juego.</li></ul>`,
 trucP:'Una mano sin cantos vale 1 punto. En tu turno, antes de tirar, puedes cantar <b>truc</b> para jugarte más. Los rivales pueden decir <b>«vull»</b> (aceptar), <b>«no vull»</b> (y te dan los puntos de antes) o <b>subir</b>: retruc, val 9 y, al final, <b>tots</b> (el «cantó» entero).',
 th:['Canto','Si se acepta','Si no se acepta'],trucRows:[['Sin canto','1','—'],['Truc','3','1'],['Retruc','6','3'],['Val 9','9','6'],['Tots','el cantó','9']],
 trucNote:'Después de un «vull», solo puede volver a subir la pareja que ha aceptado.',
 envitP:'El envit es una apuesta sobre qué jugador tiene mejores <b>dos cartas</b> para sumar. Solo se puede cantar en la <b>primera ronda</b>, y también vale si ya se ha cantado y aceptado el truc. Los envites se cantan y se aceptan durante la mano, pero <b>no se dicen hasta que la mano termina</b>.',
 envitH:'Cómo se cuenta el envit',
 envitList:`<ul><li><b>Dos cartas del mismo palo</b>: 20 + el valor de cada carta. La sota, el caballo y el rey valen 0.</li>
<li><b>Sin dos cartas del mismo palo</b>: vale la carta más alta de un dígito.</li>
<li><b>El amo vale 28</b> y <b>la madona 27</b>, y se juntan con <b>cualquier</b> carta: sumas el valor de la otra.</li>
<li><b>Amo y madona juntos hacen 35</b>, la jugada máxima.</li></ul>`,
 exH:'Ejemplos',ex:['7 y 6 de copas: 20 + 7 + 6 = <b>33</b>','Rey y 3 de espadas: 20 + 0 + 3 = <b>23</b>','Madona y 5 de bastos: 27 + 5 = <b>32</b>','Amo y madona: <b>35</b>','7 de oros y 5 de copas (palos distintos): <b>7</b>'],
 envitRows:[['Envit','2','1'],['Jo envit','4','2'],['2 més','6','4'],['Envit tots','lo que le falta a la pareja que va delante para llegar a 24','6']],
 envitNote:'<b>Envit tots:</b> vale los puntos que le faltan a la pareja que va delante para llegar a 24. Por ejemplo, si vais 15 a 9, el envit tots vale 9. Solo se puede subir a tots si vale más que el «2 més». Si dos jugadores empatan a envit, gana el que está más cerca de la mano. Un envit aceptado se cuenta aunque la mano acabe antes, y sus puntos se suman antes que los de la mano.',
 senyesP:'Lo más bonito del truc mallorquín: con gestos de la cara le dices a tu compañero qué cartas buenas llevas. <b>Derecha e izquierda son las de quien hace la seña</b> (cuando tu compañero te mira de frente, su derecha es tu izquierda).',
 sth:['Gesto','Significa'],
 signs:[['Levantar las cejas','El amo (caballo de bastos)'],['Guiñar un ojo','La madona (sota de oros)'],['Sacar la lengua hacia su derecha','As de espadas'],['Sacar la lengua hacia su izquierda','As de bastos'],['Mover el labio hacia su derecha','7 de espadas'],['Mover el labio hacia su izquierda','7 de oros'],['Morderse el labio','Un 3'],['Guiñar los dos ojos','No lleva ninguna carta buena (va «buit»)']],
 senyesNote:'Cuidado: si un rival te mira justo cuando haces la seña, también la ve y la usará contra ti. También se puede hablar en voz alta: <b>«Vaig a tu»</b> (tira tú la buena), <b>«Vina a mi»</b> (la tiro yo) o <b>«Demana envit»</b> (pide envit), pero los rivales lo oyen.',
 cantoP:'Los puntos de cada mano se van sumando. La primera pareja que llega a <b>24 puntos</b> gana el <b>«cantó»</b>, y quien gana <b>dos cantons</b> gana la partida.',
 detP:'En cada pueblo y en cada grupo se juega un poco distinto. Estas son las reglas que usa <a href="/">trucmallorqui.com</a>:',
 det:['Tienes 40 segundos para tirar o contestar. Si se acaba el tiempo, se tira la carta más baja o se dice «no vull».','Cuando una pareja tiene que contestar un canto, contestan los dos. Si uno dice «no vull» y el otro quiere, manda el que quiere.','Los asientos vacíos los juegan bots, y si alguien se desconecta, un bot juega por él hasta que vuelve.'],
 faq:[['¿Se puede jugar al truc mallorquín online gratis?','Sí. En trucmallorqui.com puedes jugar gratis desde el navegador del móvil o del ordenador, sin instalar nada.'],
  ['¿Puedo jugar con mis amigos?','Sí. Crea una sala y comparte el enlace o el código de 4 letras. Los asientos vacíos los juegan bots.'],
  ['¿Puedo jugar si no tengo amigos conectados?','Sí. Con «Jugar amb desconeguts» te juntamos con otros jugadores, y con «Jugar contra bots» puedes empezar al instante.'],
  ['¿Qué cartas no se usan en el truc mallorquín?','Se juega con 36 cartas de la baraja española: no se usan el 2, el 8 ni el 9.'],
  ['¿Cuál es la carta más alta del truc?','El amo, que es el caballo de bastos. Después vienen la madona (sota de oros), el as de espadas y el as de bastos.']],
 endBox:'<b>¿Ya lo tienes?</b> Pruébalo ahora: puedes jugar con amigos, con desconocidos o contra bots, desde el móvil o el ordenador. (El juego está en catalán, pero es muy fácil de seguir.)',endCta:'Jugar al truc',
 footer:'Truc mallorquí online',follow:'Síguenos en X'
}};

function page(T){
 const card2=cs=>cs.map(card).join('');
 const exCards=[[{n:7,s:'copes'},{n:6,s:'copes'}],[{n:12,s:'espases'},{n:3,s:'espases'}],[{n:10,s:'oros'},{n:5,s:'bastos'}],[{n:11,s:'bastos'},{n:10,s:'oros'}],[{n:7,s:'oros'},{n:5,s:'copes'}]];
 const ids=['basic','cartes','ma','truc','envit','senyes','canto','detalls','preguntes'];
 const table=(th,rows)=>`<table><thead><tr>${th.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
 const ld={"@context":"https://schema.org","@graph":[
  {"@type":"WebPage","name":T.ogt,"url":"__SITE__"+T.path,"inLanguage":T.lang,"isPartOf":{"@type":"WebSite","name":"Truc mallorquí online","url":"__SITE__/"}},
  {"@type":"FAQPage","mainEntity":T.faq.map(([q,a])=>({"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}}))}]};
 return `<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${T.title}</title>
<meta name="description" content="${T.desc}">
<link rel="canonical" href="__SITE__${T.path}">
<link rel="alternate" hreflang="ca" href="__SITE__/regles">
<link rel="alternate" hreflang="es" href="__SITE__/reglas">
<link rel="alternate" hreflang="x-default" href="__SITE__/regles">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="theme-color" content="#10302e">
<meta property="og:type" content="article">
<meta property="og:locale" content="${T.locale}">
<meta property="og:site_name" content="Truc mallorquí">
<meta property="og:title" content="${T.ogt}">
<meta property="og:description" content="${T.ogd}">
<meta property="og:url" content="__SITE__${T.path}">
<meta property="og:image" content="__SITE__/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@trucmallorqui">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Young+Serif&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<!--ANALYTICS-->
<style>
:root{--bg:#e4eee9;--ink:#10302e;--muted:#486562;--panel:#f6fbf8;--line:#b7cbc4;--red:#b8322a;--blue:#2a4a9a;--gold:#e0a21f;
--serif:'Young Serif',Georgia,serif;--sans:'Atkinson Hyperlegible',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0a1b1d;--ink:#e2eeea;--muted:#8fb0aa;--panel:#112629;--line:#24444a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:17px;line-height:1.6}
.band{height:14px;background:url("data:image/svg+xml,${encodeURIComponent(tile)}") repeat-x;background-size:auto 100%}
main{max-width:760px;margin:0 auto;padding:16px 16px 48px}
nav{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 18px}
nav a.brand{font-family:var(--serif);font-size:1.4rem;color:var(--ink);text-decoration:none}
nav .right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-family:var(--serif);font-weight:400;font-size:clamp(1.9rem,6vw,2.6rem);line-height:1.15;margin:.2em 0 .4em}
h2{font-family:var(--serif);font-weight:400;font-size:1.55rem;margin:1.8em 0 .5em;line-height:1.2}
h3{font-size:1.05rem;margin:1.3em 0 .4em}
p,li{max-width:68ch}
a{color:var(--blue)}
@media (prefers-color-scheme:dark){a{color:#8fb3ff}}
.lead{font-size:1.1rem;color:var(--muted)}
.cta{display:inline-block;background:var(--red);color:#fff!important;text-decoration:none;font-weight:700;padding:.7rem 1.3rem;border-radius:12px;margin:6px 8px 6px 0}
.cta.alt{background:var(--blue)}
.box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:14px 18px;margin:14px 0}
.toc ol{margin:.3em 0;padding-left:1.3em}
ol.tiers{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.tier{display:grid;grid-template-columns:28px auto 1fr;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:6px 10px}
.tier .n{font-weight:700;color:var(--muted);text-align:center}
.mini{display:flex;gap:4px;flex-wrap:wrap}
.mini svg{width:42px;height:auto;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.tier .lab{font-weight:700;font-size:.95rem}
table{border-collapse:collapse;width:100%;max-width:520px;margin:8px 0;background:var(--panel);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line)}
th{font-size:.9rem;color:var(--muted)}
.ex{display:flex;align-items:center;gap:12px;margin:8px 0}
.ex .mini{flex-wrap:nowrap;flex:none}
.ex .mini svg{width:46px}
details{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin:8px 0}
summary{font-weight:700;cursor:pointer}
footer{margin-top:40px;font-size:.9rem;color:var(--muted)}
@media (max-width:480px){.mini svg{width:34px}.tier{grid-template-columns:22px 1fr}.tier .lab{grid-column:2}}
</style>
</head>
<body>
<svg width="0" height="0" style="position:absolute" aria-hidden="true">${SHARED_DEFS}</svg>
<div class="band" aria-hidden="true"></div>
<main>
<nav><a class="brand" href="/">${T.brand}</a><span class="right"><a href="${T.other.path}" hreflang="${T.other.lang}" lang="${T.other.lang}">${T.other.label}</a><a class="cta" href="/">${T.play}</a></span></nav>
<article>
<h1>${T.h1}</h1>
<p class="lead">${T.lead}</p>
<p><a class="cta" href="/">${T.cta1}</a><a class="cta alt" href="/">${T.cta2}</a></p>
<div class="box toc"><b>${T.tocT}</b><ol>${T.toc.map((t,i)=>`<li><a href="#${ids[i]}">${t}</a></li>`).join('')}</ol></div>
<h2 id="basic">${T.toc[0]}</h2>
${T.basic}
<h2 id="cartes">${T.toc[1]}</h2>
<p>${T.cartesP}</p>
<ol class="tiers">${TIER_CARDS.map((cs,i)=>`<li class="tier"><span class="n">${i+1}</span><span class="mini">${card2(cs)}</span><span class="lab">${T.tiers[i]}</span></li>`).join('')}</ol>
<h2 id="ma">${T.toc[2]}</h2>
${T.ma}
<h2 id="truc">${T.toc[3]}</h2>
<p>${T.trucP}</p>
${table(T.th,T.trucRows)}
<p>${T.trucNote}</p>
<h2 id="envit">${T.toc[4]}</h2>
<p>${T.envitP}</p>
<h3>${T.envitH}</h3>
${T.envitList}
<h3>${T.exH}</h3>
${exCards.map((cs,i)=>`<div class="ex"><span class="mini">${card2(cs)}</span><span>${T.ex[i]}</span></div>`).join('\n')}
${table(T.th,T.envitRows)}
<p>${T.envitNote}</p>
<h2 id="senyes">${T.toc[5]}</h2>
<p>${T.senyesP}</p>
${table(T.sth,T.signs)}
<p>${T.senyesNote}</p>
<h2 id="canto">${T.toc[6]}</h2>
<p>${T.cantoP}</p>
<h2 id="detalls">${T.toc[7]}</h2>
<p>${T.detP}</p>
<ul>${T.det.map(d=>`<li>${d}</li>`).join('')}</ul>
<h2 id="preguntes">${T.toc[8]}</h2>
${T.faq.map(([q,a])=>`<details><summary>${q}</summary><p>${a}</p></details>`).join('\n')}
<div class="box">${T.endBox}<br><a class="cta" href="/">${T.endCta}</a></div>
</article>
<footer>${T.footer} · <a href="/">trucmallorqui.com</a> · <a href="${T.other.path}" hreflang="${T.other.lang}">${T.other.label}</a> · ${T.follow}: <a href="https://x.com/trucmallorqui" rel="noopener">@trucmallorqui</a></footer>
</main>
</body>
</html>
`;
}
for(const k of ['ca','es']){const T=L[k];const out=page(T);fs.writeFileSync(path.join(PUB,T.file),out);console.log(T.file,out.length,'bytes');}
