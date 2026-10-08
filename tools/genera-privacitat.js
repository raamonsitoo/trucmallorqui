// Genera public/privacitat.html (català) i public/privacidad.html (castellà).
// Ús: node tools/genera-privacitat.js
// El correu de contacte el posa el servidor amb la variable d'entorn CONTACT_EMAIL (__CONTACT__).
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'public');
const UPDATED = '7 d\'octubre de 2026', UPDATED_ES = '7 de octubre de 2026';

const T = {
  ca: {
    lang: 'ca', file: 'privacitat.html', path: '/privacitat', other: { lang: 'es', path: '/privacidad', label: 'Leer en castellano' },
    title: 'Política de privacitat · Truc mallorquí online', h1: 'Política de privacitat', updated: 'Última actualització: ' + UPDATED,
    back: 'Tornar al joc',
    body: `
<p>Aquesta pàgina explica quines dades tracta <b>trucmallorqui.com</b>, per què i quins drets tens. La idea és senzilla: <b>guardam el mínim</b> perquè puguis jugar i, si vols, conservar el teu progrés.</p>

<h2>Qui és el responsable</h2>
<p>El responsable del tractament és el titular de trucmallorqui.com. Per a qualsevol qüestió sobre les teves dades pots escriure a <a href="mailto:__CONTACT__">__CONTACT__</a>.</p>

<h2>Si jugues sense compte</h2>
<p>No et demanam cap dada personal. El nom i l'aspecte que tries es guarden <b>només al teu navegador</b> (emmagatzematge local) perquè no els hagis de tornar a escriure, i s'envien al servidor mentre jugues perquè els altres jugadors els vegin. Quan acaba la partida, el servidor no els conserva.</p>
<p>El servidor, com qualsevol web, rep l'adreça IP de la connexió. La feim servir només mentre estàs connectat, per evitar abusos (per exemple, que algú obri centenars de sales). No la guardam.</p>

<h2>Si entres amb Google</h2>
<p>Pots crear un compte amb el botó «Continuar amb Google» per guardar el teu progrés. Google ens confirma qui ets amb un identificador intern del teu compte de Google. <b>No guardam el teu correu ni el teu nom real</b>; només guardam:</p>
<ul>
<li>l'identificador que ens dona Google (un número que no permet saber qui ets);</li>
<li>el nom de jugador i l'aspecte que tries dins el joc;</li>
<li>el teu progrés: experiència, nivell, partides jugades i guanyades, cantons i mans guanyades;</li>
<li>la data en què vas crear el compte i la darrera vegada que vas entrar.</li>
</ul>
<p>El teu nom de jugador i el teu nivell els veuen els altres jugadors de la teva partida.</p>
<p>Per mantenir la sessió oberta, el teu navegador guarda un testimoni de sessió a l'emmagatzematge local. És imprescindible perquè funcioni el compte i no s'usa per a res més.</p>

<h2>Estadístiques de visites</h2>
<p>Comptam les visites de manera <b>agregada i anònima</b>: quantes n'hi ha cada dia, de quina web o xarxa venen (per exemple, Instagram o Google), si és un mòbil, una tauleta o un ordinador, quantes partides es juguen i quines opcions del joc es fan servir. Només guardam aquests totals per dia: <b>no feim servir galetes, no guardam la IP</b> i no podem saber qui ets. Perquè una visita no es compti dues vegades, el navegador recorda mentre tens la pestanya oberta que ja s'ha comptat. Ho feim per saber si el joc arriba a la gent i millorar-lo (interès legítim, art. 6.1.f del RGPD).</p>

<h2>Si compres a la botiga</h2>
<p>Si compres un aspecte, guardam al teu compte quin article has comprat, quan, l'import i la referència del pagament, perquè el tenguis desbloquejat. El pagament el gestiona <b>Stripe</b>, que tracta les dades del pagament (la targeta i el correu per enviar-te el rebut) segons la seva pròpia política de privacitat: nosaltres no veim la teva targeta. La base legal és l'execució del contracte de compra (art. 6.1.b del RGPD). Si esborres el compte, s'esborren també les compres; Stripe conserva el registre del pagament el temps que li exigeix la llei. Vegeu també les <a href="/condicions">condicions de venda</a>.</p>

<h2>Si ens envies un suggeriment</h2>
<p>Des de l'enllaç «Suggeriments» pots enviar-nos idees, millores o errades. És anònim: guardam el text que escrius, el tipus (idea, millora o errada), on eres (inici, sala o partida), la mida de la pantalla i el tipus d'aparell i navegador (per exemple, «Android · Chrome»), que ens ajuden a reproduir les errades. No el vinculam ni al teu compte ni a la teva IP. Per favor, no hi posis dades personals. Els feim servir només per millorar el joc, sobre la base del nostre interès legítim a fer-ho (art. 6.1.f del RGPD), i els esborram automàticament al cap d'un any.</p>

<h2>Per a què les feim servir i amb quina base</h2>
<p>Les dades del compte serveixen només per oferir-te el servei que demanes: guardar i mostrar el teu progrés, el teu nivell i el que has comprat. La base legal és l'execució del servei que sol·licites en crear el compte (art. 6.1.b del RGPD). No feim perfils, no venem dades i no les feim servir per a publicitat.</p>

<h2>Quant de temps les guardam</h2>
<p>Mentre tenguis el compte. El pots <b>esborrar quan vulguis</b> des de «El meu progrés» → «Esborrar el meu compte»: s'esborra tot a l'instant i no es pot recuperar.</p>

<h2>Qui ens ajuda a oferir el servei</h2>
<ul>
<li><b>Render</b> (Render Services, Inc.): allotjament del servidor del joc.</li>
<li><b>Neon</b> (Neon, Inc.): base de dades on es guarden els comptes i els suggeriments, en servidors de la Unió Europea.</li>
<li><b>Google</b> (Google Ireland Ltd.): inici de sessió amb Google, si el fas servir. Google tracta les teves dades segons la seva pròpia política de privacitat.</li>
<li><b>Stripe</b> (Stripe Payments Europe, Ltd.): pagaments de la botiga, si hi compres.</li>
</ul>
<p>Alguns d'aquests proveïdors són empreses dels Estats Units i poden accedir a les dades des d'allà. Ho fan amb les garanties que preveu el RGPD (clàusules contractuals tipus o el Marc de privacitat de dades UE-EUA).</p>

<h2>Galetes i publicitat</h2>
<p>Ara mateix la web no fa servir galetes de publicitat ni de seguiment. Si en el futur hi posam anuncis, t'ho demanarem abans amb un avís de consentiment i actualitzarem aquesta pàgina.</p>

<h2>Edat mínima</h2>
<p>Per crear un compte has de tenir com a mínim <b>14 anys</b>. Si en tens menys, pots jugar igualment sense compte.</p>

<h2>Els teus drets</h2>
<p>Pots demanar accedir a les teves dades, corregir-les, esborrar-les, limitar-ne el tractament, oposar-t'hi o rebre-les en un format portable, escrivint a <a href="mailto:__CONTACT__">__CONTACT__</a>. També pots esborrar el compte tu mateix des del joc. Si creus que no hem tractat bé les teves dades, pots presentar una reclamació a l'Agència Espanyola de Protecció de Dades (<a href="https://www.aepd.es" rel="noopener">aepd.es</a>).</p>
`
  },
  es: {
    lang: 'es', file: 'privacidad.html', path: '/privacidad', other: { lang: 'ca', path: '/privacitat', label: 'Llegir en català' },
    title: 'Política de privacidad · Truc mallorquí online', h1: 'Política de privacidad', updated: 'Última actualización: ' + UPDATED_ES,
    back: 'Volver al juego',
    body: `
<p>Esta página explica qué datos trata <b>trucmallorqui.com</b>, para qué y qué derechos tienes. La idea es sencilla: <b>guardamos lo mínimo</b> para que puedas jugar y, si quieres, conservar tu progreso.</p>

<h2>Quién es el responsable</h2>
<p>El responsable del tratamiento es el titular de trucmallorqui.com. Para cualquier cuestión sobre tus datos puedes escribir a <a href="mailto:__CONTACT__">__CONTACT__</a>.</p>

<h2>Si juegas sin cuenta</h2>
<p>No te pedimos ningún dato personal. El nombre y el aspecto que eliges se guardan <b>solo en tu navegador</b> (almacenamiento local) para que no tengas que volver a escribirlos, y se envían al servidor mientras juegas para que los demás jugadores los vean. Cuando termina la partida, el servidor no los conserva.</p>
<p>El servidor, como cualquier web, recibe la dirección IP de la conexión. La usamos solo mientras estás conectado, para evitar abusos (por ejemplo, que alguien abra cientos de salas). No la guardamos.</p>

<h2>Si entras con Google</h2>
<p>Puedes crear una cuenta con el botón «Continuar con Google» para guardar tu progreso. Google nos confirma quién eres con un identificador interno de tu cuenta de Google. <b>No guardamos tu correo ni tu nombre real</b>; solo guardamos:</p>
<ul>
<li>el identificador que nos da Google (un número que no permite saber quién eres);</li>
<li>el nombre de jugador y el aspecto que eliges dentro del juego;</li>
<li>tu progreso: experiencia, nivel, partidas jugadas y ganadas, «cantons» y manos ganadas;</li>
<li>la fecha en que creaste la cuenta y la última vez que entraste.</li>
</ul>
<p>Tu nombre de jugador y tu nivel los ven los demás jugadores de tu partida.</p>
<p>Para mantener la sesión abierta, tu navegador guarda un testigo de sesión en el almacenamiento local. Es imprescindible para que funcione la cuenta y no se usa para nada más.</p>

<h2>Estadísticas de visitas</h2>
<p>Contamos las visitas de forma <b>agregada y anónima</b>: cuántas hay cada día, de qué web o red vienen (por ejemplo, Instagram o Google), si es un móvil, una tableta o un ordenador, cuántas partidas se juegan y qué opciones del juego se usan. Solo guardamos esos totales por día: <b>no usamos cookies, no guardamos la IP</b> y no podemos saber quién eres. Para que una visita no se cuente dos veces, el navegador recuerda mientras tienes la pestaña abierta que ya se ha contado. Lo hacemos para saber si el juego llega a la gente y mejorarlo (interés legítimo, art. 6.1.f del RGPD).</p>

<h2>Si compras en la tienda</h2>
<p>Si compras un aspecto, guardamos en tu cuenta qué artículo has comprado, cuándo, el importe y la referencia del pago, para que lo tengas desbloqueado. El pago lo gestiona <b>Stripe</b>, que trata los datos del pago (la tarjeta y el correo para enviarte el recibo) según su propia política de privacidad: nosotros no vemos tu tarjeta. La base legal es la ejecución del contrato de compra (art. 6.1.b del RGPD). Si borras la cuenta, se borran también las compras; Stripe conserva el registro del pago el tiempo que le exige la ley. Consulta también las <a href="/condicions">condiciones de venta</a>.</p>

<h2>Si nos envías una sugerencia</h2>
<p>Desde el enlace «Suggeriments» puedes enviarnos ideas, mejoras o errores. Es anónimo: guardamos el texto que escribes, el tipo (idea, mejora o error), dónde estabas (inicio, sala o partida), el tamaño de la pantalla y el tipo de dispositivo y navegador (por ejemplo, «Android · Chrome»), que nos ayudan a reproducir los errores. No lo vinculamos ni a tu cuenta ni a tu IP. Por favor, no incluyas datos personales. Los usamos solo para mejorar el juego, sobre la base de nuestro interés legítimo en hacerlo (art. 6.1.f del RGPD), y los borramos automáticamente al cabo de un año.</p>

<h2>Para qué los usamos y con qué base</h2>
<p>Los datos de la cuenta sirven solo para ofrecerte el servicio que pides: guardar y mostrar tu progreso, tu nivel y lo que has comprado. La base legal es la ejecución del servicio que solicitas al crear la cuenta (art. 6.1.b del RGPD). No hacemos perfiles, no vendemos datos y no los usamos para publicidad.</p>

<h2>Cuánto tiempo los guardamos</h2>
<p>Mientras tengas la cuenta. La puedes <b>borrar cuando quieras</b> desde «El meu progrés» → «Esborrar el meu compte»: se borra todo al instante y no se puede recuperar.</p>

<h2>Quién nos ayuda a ofrecer el servicio</h2>
<ul>
<li><b>Render</b> (Render Services, Inc.): alojamiento del servidor del juego.</li>
<li><b>Neon</b> (Neon, Inc.): base de datos donde se guardan las cuentas y las sugerencias, en servidores de la Unión Europea.</li>
<li><b>Google</b> (Google Ireland Ltd.): inicio de sesión con Google, si lo usas. Google trata tus datos según su propia política de privacidad.</li>
<li><b>Stripe</b> (Stripe Payments Europe, Ltd.): pagos de la tienda, si compras en ella.</li>
</ul>
<p>Algunos de estos proveedores son empresas de Estados Unidos y pueden acceder a los datos desde allí. Lo hacen con las garantías que prevé el RGPD (cláusulas contractuales tipo o el Marco de privacidad de datos UE-EE. UU.).</p>

<h2>Cookies y publicidad</h2>
<p>Ahora mismo la web no usa cookies de publicidad ni de seguimiento. Si en el futuro ponemos anuncios, te lo pediremos antes con un aviso de consentimiento y actualizaremos esta página.</p>

<h2>Edad mínima</h2>
<p>Para crear una cuenta debes tener como mínimo <b>14 años</b>. Si tienes menos, puedes jugar igualmente sin cuenta.</p>

<h2>Tus derechos</h2>
<p>Puedes pedir acceder a tus datos, corregirlos, borrarlos, limitar su tratamiento, oponerte o recibirlos en un formato portable, escribiendo a <a href="mailto:__CONTACT__">__CONTACT__</a>. También puedes borrar la cuenta tú mismo desde el juego. Si crees que no hemos tratado bien tus datos, puedes presentar una reclamación ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" rel="noopener">aepd.es</a>).</p>
`
  }
};

for (const L of Object.values(T)) {
  const html = `<!doctype html>
<html lang="${L.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title>
<meta name="robots" content="noindex,follow">
<link rel="canonical" href="__SITE__${L.path}">
<link rel="alternate" hreflang="${L.lang}" href="__SITE__${L.path}">
<link rel="alternate" hreflang="${L.other.lang}" href="__SITE__${L.other.path}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
:root{--bg:#f6f1e4;--ink:#1d2a27;--muted:#5d6b66;--line:#e2d8c2;--accent:#1f5c4f}
@media (prefers-color-scheme:dark){:root{--bg:#0f2422;--ink:#e6efeb;--muted:#9fb6b0;--line:#244540;--accent:#8fd3bf}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 48px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:12px}
header a{color:var(--accent);font-weight:700;text-decoration:none}
h1{font-family:Georgia,serif;font-weight:400;font-size:2rem;margin:20px 0 4px}
h2{font-size:1.1rem;margin:26px 0 6px}
.upd{color:var(--muted);font-size:.9rem;margin:0}
a{color:var(--accent)}
ul{padding-left:1.2rem}
li{margin:4px 0}
</style>
</head>
<body>
<div class="wrap">
<header><a href="/">← ${L.back}</a><a href="${L.other.path}" lang="${L.other.lang}">${L.other.label}</a></header>
<h1>${L.h1}</h1>
<p class="upd">${L.updated}</p>
${L.body}
</div>
</body>
</html>
`;
  fs.writeFileSync(path.join(PUB, L.file), html);
  console.log(L.file, html.length, 'bytes');
}
