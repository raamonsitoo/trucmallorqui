process.env.TRUC_SPEED='0.01';
process.env.TRUC_TIMER_MS='400';
process.env.PORT='0';
// comptes en mode de prova (memòria i credencials falses «test:...»)
process.env.NODE_ENV='test';process.env.TRUC_TEST_AUTH='1';process.env.GOOGLE_CLIENT_ID='test-client';process.env.SESSION_SECRET='test-secret';delete process.env.DATABASE_URL;
// botiga oberta amb pagaments simulats (sense Stripe)
process.env.SHOP='on';process.env.SHOP_SIMULATED='1';delete process.env.STRIPE_SECRET_KEY;
process.env.STATS_KEY='clau-de-prova';
const WebSocket=require('ws');
const {server,rooms}=require('./server.js');
const assert=require('assert');
let port;
class Bot{
  constructor(name,policy='play'){this.name=name;this.policy=policy;this.events=[];this.snap=null;this.room=null;this.token=null;this.errors=[];this.acts=0;}
  connect(token){return new Promise(res=>{
    this.ws=new WebSocket('ws://127.0.0.1:'+port+'/ws');
    this.ws.on('open',()=>this.send({t:'hello',token}));
    this.ws.on('message',d=>{const m=JSON.parse(d);this.onMsg(m,res);});
  });}
  send(o){if(this.ws.readyState===1)this.ws.send(JSON.stringify(o));}
  onMsg(m,res){
    if(m.t==='hello'){this.token=m.token;this.resumed=m.resumed;res(m);}
    else if(m.t==='room')this.room=m;
    else if(m.t==='err')this.errors.push(m.m);
    else if(m.t==='ev'){this.events.push(m.e);}
    else if(m.t==='snap'){this.snap=m;this.react(m);}
    else{(this.msgs=this.msgs||[]).push(m);}
  }
  react(m){
    const h=m.h;if(!h||!h.pending||this.policy==='silent')return;
    const me=this.room.you;
    const p=h.pending;
    setTimeout(()=>{
      this.acts++;
      if(p.kind==='turn'){
        const r=Math.random();
        if(r<0.12&&h.trucLevel<4&&(h.trucOwner===null||h.trucOwner===me%2))return this.send({t:'act',a:{type:'truc'}});
        if(r<0.2&&h.trickNo===0&&!h.envitDone)return this.send({t:'act',a:{type:'envit'}});
        return this.send({t:'act',a:{type:'play',idx:Math.floor(Math.random()*h.mine.length)}});
      }
      const r=Math.random();
      const max=p.data.kind==='envit'?(h.envitMax||4):4;
      this.send({t:'act',a:r<0.55?'vull':r<0.8?'no':(p.data.level<max?'raise':'vull')});
    },5);
  }
  async until(fn,ms=30000){const t0=Date.now();while(Date.now()-t0<ms){if(fn())return true;await new Promise(r=>setTimeout(r,20));}return false;}
}
async function scenario1(){
  const a=new Bot('A'),b=new Bot('B'),c=new Bot('C'),d=new Bot('D');
  for(const x of [a,b,c,d])await x.connect();
  a.send({t:'create',name:'Anna',look:'mocador'});
  await a.until(()=>a.room);
  const code=a.room.code;
  for(const [x,n] of [[b,'Biel'],[c,'Cati'],[d,'Dani']]){x.send({t:'join',code,name:n,look:'palla'});await x.until(()=>x.room);}
  assert.equal(a.room.seats.filter(s=>s.human).length,4);
  a.send({t:'start'});
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),60000);
  assert(ok,'la partida de 4 humans no ha acabat');
  const g=a.events.find(e=>e.e==='game');
  console.log('1) 4 humans: acabada',JSON.stringify(g.cantons),'mans',a.events.filter(e=>e.e==='deal').length,'errors',[a,b,c,d].map(x=>x.errors.length).join(','));
  // totes les snaps han de coincidir en marcador
  await a.until(()=>a.room.phase==='lobby',5000);
  assert.equal(a.room.phase,'lobby');
  [a,b,c,d].forEach(x=>x.ws.close());
}
async function scenario2(){
  const a=new Bot('A');await a.connect();
  a.send({t:'create',name:'Sola',look:'barretina',quick:true});
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),60000);
  assert(ok,'la partida 1 humà + 3 bots no ha acabat');
  console.log('2) 1 humà + 3 bots: acabada',JSON.stringify(a.events.find(e=>e.e==='game').cantons),'senyes',a.events.filter(e=>e.e==='sign').length,'talk',a.events.filter(e=>e.e==='talk').length);
  a.ws.close();
}
async function scenario3(){
  const a=new Bot('A','silent');await a.connect();
  a.send({t:'create',name:'Muda',look:'palla',quick:true});
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),120000);
  assert(ok,'la partida amb temps esgotat no ha acabat');
  const to=a.events.filter(e=>e.e==='timeout').length;
  assert(to>0,'havia d\'haver timeouts');
  console.log('3) jugador mut: acabada, timeouts',to);
  a.ws.close();
}
async function scenario4(){
  const a=new Bot('A'),b=new Bot('B');
  await a.connect();await b.connect();
  a.send({t:'create',name:'Ana',look:'palla'});await a.until(()=>a.room);
  b.send({t:'join',code:a.room.code,name:'Bru',look:'palla'});await b.until(()=>b.room);
  a.send({t:'start'});
  await a.until(()=>a.snap&&a.snap.h&&a.snap.h.dealt,10000);
  const tok=b.token;b.ws.close();
  await new Promise(r=>setTimeout(r,300));
  const b2=new Bot('B2');await b2.connect(tok);
  assert(b2.resumed,'havia de reprendre la sessió');
  await b2.until(()=>b2.snap,5000);
  assert(b2.snap&&b2.room&&b2.room.you===b.room.you,'ha de recuperar el mateix seient');
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),90000);
  assert(ok,'la partida amb reconnexió no ha acabat');
  console.log('4) reconnexió: seient',b2.room.you,'recuperat i partida acabada');
  a.ws.close();b2.ws.close();
}
// Regles de l'envit, provades directament sobre el motor
function scenario5(){
  const {Game}=require('./game.js');
  const room={seats:[0,1,2,3].map(()=>({human:false})),sendAll(){},sendSeat(){},phase:'playing'};
  const g=new Game(room,{speed:0});
  g.H={over:false,trickNo:0,envitDone:false,trucLevel:2,trucOwner:1};
  assert(g.canCallEnvit(0),"s'ha de poder envidar a la primera ronda amb el truc acceptat");
  g.H.trickNo=1;assert(!g.canCallEnvit(0),'a la segona ronda ja no es pot envidar');
  g.G.scores=[15,9];assert.equal(g.envitPts(4),9);assert.equal(g.maxEnvitLevel(),4);
  g.G.scores=[3,0];assert.equal(g.envitPts(4),21);
  g.G.scores=[0,0];assert.equal(g.envitPts(4),24);
  g.G.scores=[10,20];assert.equal(g.envitPts(4),4);assert.equal(g.maxEnvitLevel(),3,'si tots val 6 o menys, no es pot pujar a tots');
  assert.equal(g.envitPts(1),2);assert.equal(g.envitPts(3),6);
  console.log('5) regles: envit després del truc i «envit tots» = el que falta (15-9 → 9; 10-20 → només fins a 2 més)');
}
// Comptes: entrar, guanyar experiència, tornar a entrar, canviar el nom i esborrar
async function scenario6(){
  const a=new Bot('A');await a.connect();
  a.send({t:'login',credential:'test:ramon',name:'Ramon',look:'palla'});
  await a.until(()=>(a.msgs||[]).some(m=>m.t==='login'),5000);
  const lg=a.msgs.find(m=>m.t==='login');
  assert(lg&&lg.session&&lg.profile.level===1&&lg.profile.name==='Ramon','login correcte');
  a.send({t:'create',name:'Ramon',look:'palla',quick:true});
  await a.until(()=>a.room&&a.room.seats[a.room.you].lvl===1,5000);
  assert.equal(a.room.seats[a.room.you].lvl,1,'el seient mostra el nivell');
  const ok=await a.until(()=>a.msgs.some(m=>m.t==='me'&&m.gained),90000);
  assert(ok,"havia de rebre l'experiència en acabar");
  const me=a.msgs.find(m=>m.t==='me'&&m.gained);
  assert(me.profile.games===1&&me.profile.xp===me.gained.xp&&me.gained.xp>0,'experiència guardada');
  a.ws.close();
  const b=new Bot('B');await b.connect();
  b.send({t:'auth',session:lg.session});
  await b.until(()=>(b.msgs||[]).some(m=>m.t==='me'),5000);
  assert.equal(b.msgs.find(m=>m.t==='me').profile.games,1,'el progrés es conserva');
  b.send({t:'prefs',name:'Ramonet',look:'barretina',hat:'barretina',back:'siurell'});
  await b.until(()=>b.msgs.filter(m=>m.t==='me').length>=2,5000);
  assert.equal(b.msgs.filter(m=>m.t==='me')[1].profile.name,'Ramonet');
  b.send({t:'auth',session:lg.session.slice(0,-2)+'xx'});
  await b.until(()=>b.msgs.some(m=>m.t==='logout'),3000);
  assert(b.msgs.some(m=>m.t==='logout'),'una sessió falsificada no val');
  b.send({t:'auth',session:lg.session});await new Promise(r=>setTimeout(r,200));
  b.send({t:'delete'});
  await b.until(()=>b.msgs.some(m=>m.t==='deleted'),3000);
  b.send({t:'auth',session:lg.session});
  await b.until(()=>b.msgs.filter(m=>m.t==='logout').length>=2,3000);
  assert.equal(b.msgs.filter(m=>m.t==='logout').length,2,'compte esborrat');
  console.log('6) comptes: entrar, +'+me.gained.xp+' XP en acabar, sessió conservada, canvi de nom i esborrat');
  b.ws.close();
}
async function scenario7(){
  const fb=require('./feedback');
  const a=new Bot('F');await a.connect();
  const fbs=()=>(a.msgs||[]).filter(m=>m.t==='fb');
  a.send({t:'feedback',kind:'errada',text:'  ',where:'partida'});
  await a.until(()=>fbs().length>=1,3000);
  assert.equal(fbs()[0].ok,false,'un text buit no es desa');
  a.send({t:'feedback',kind:'errada',text:'Les cartes <b>no</b> es veuen bé al mòbil\nquan giro la pantalla',where:'partida',screen:'390x844'});
  a.send({t:'feedback',kind:'hack',text:'x'.repeat(1500),where:'?',screen:'<script>'});
  await a.until(()=>fbs().length>=3,3000);
  assert(fbs()[1].ok&&fbs()[2].ok,'els suggeriments es desen');
  const rows=await fb.store.list(10);
  assert.equal(rows[1].kind,'errada');assert.equal(rows[1].place,'partida');assert.equal(rows[1].screen,'390x844');
  assert.equal(rows[0].kind,'idea','un tipus desconegut passa a idea');assert.equal(rows[0].text.length,1000,'text tallat a 1000');
  assert.equal(rows[0].screen,'');assert.equal(rows[0].place,'inici');
  assert(!fb.page(rows).includes('<b>no</b>'),'la pàgina escapa el text');
  for(let i=0;i<4;i++)a.send({t:'feedback',kind:'idea',text:'idea número '+i});
  await a.until(()=>fbs().length>=7,3000);
  assert.equal(fbs().filter(m=>m.ok).length,5,'màxim 5 per IP cada 10 minuts');
  assert.equal(fb.device('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'),'Android · Chrome');
  assert.equal(fb.device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'),'iPhone · Safari');
  console.log('7) bústia de suggeriments: valida, talla, escapa i limita');
  a.ws.close();
}
// Nivell dels bots: l'amfitrió el tria a la sala i la partida contra el mestre acaba bé
async function scenario8(){
  const a=new Bot('A');await a.connect();
  a.send({t:'create',name:'Aina',look:'palla',level:'dificil'});
  await a.until(()=>a.room);
  assert.equal(a.room.botLevel,'dificil','el nivell triat en crear la sala');
  a.send({t:'botlevel',level:'trampos'});a.send({t:'botlevel',level:'mestre'});
  await a.until(()=>a.room.botLevel==='mestre',3000);
  assert.equal(a.room.botLevel,'mestre',"l'amfitrió canvia el nivell (i un nivell inventat no val)");
  a.send({t:'start'});
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),120000);
  assert(ok,'la partida contra el mestre no ha acabat');
  console.log('8) nivell dels bots: triat a la sala i partida contra el mestre acabada',JSON.stringify(a.events.find(e=>e.e==='game').cantons));
  a.ws.close();
}
// Els nivells, uns contra els altres, amb repartiments fixos (sempre surt el mateix)
async function scenario9(){
  const {Game,LEVELS,mulberry32,solveHand}=require('./game.js');
  const C=(n,s)=>({n,s});
  // 3 d'oros contra 1 de copes: amb la mà a la primera ronda, guanya qui té el 3
  assert.equal(solveHand([[C(3,'oros')],[C(1,'copes')],[C(4,'oros')],[C(5,'copes')]],[0,1],[],0,0,0),1,'cerca: guanya la carta més alta');
  const room=()=>({seats:[0,1,2,3].map(()=>({human:false})),sendAll(){},sendSeat(){},phase:'playing'});
  const vs=async(A,B,n)=>{let w=0;for(let i=0;i<n;i++)for(const [x,y,me] of [[A,B,0],[B,A,1]]){
    const g=new Game(room(),{speed:0,rng:mulberry32(i*31+7),dealRng:mulberry32(i+1),params:[x,y,x,y]});
    if((await g.playCanton())===me)w++;}return w/(2*n);};
  const fn=await vs(LEVELS.facil,LEVELS.normal,150),mn=await vs(LEVELS.mestre,LEVELS.normal,60);
  assert(fn<0.45,'el fàcil ha de perdre contra el normal ('+fn+')');
  assert(mn>0.55,'el mestre ha de guanyar el normal ('+mn+')');
  // Paciència: com la gent, la majoria de trucs es canten després de la primera ronda
  const early=async P=>{let t=0,r1=0;for(let i=0;i<150;i++){let trick=0,called=false;const rm=room();
    rm.sendAll=m=>{if(m.t!=='ev')return;const e=m.e;if(e.e==='deal'){trick=0;called=false;}else if(e.e==='trick')trick++;
      else if(e.e==='call'&&e.kind==='truc'&&e.level===1&&!called){called=true;t++;if(trick===0)r1++;}};
    await new Game(rm,{speed:0,rng:mulberry32(i*31+7),dealRng:mulberry32(i+1),params:[P,P,P,P]}).playCanton();}return r1/t;};
  const en=await early(LEVELS.normal),ed=await early(LEVELS.dificil);
  assert(en<0.3&&ed<0.3,`massa trucs a la primera ronda (normal ${en}, difícil ${ed})`);
  console.log(`9) nivells: fàcil guanya ${(100*fn).toFixed(0)}% contra normal, mestre ${(100*mn).toFixed(0)}%; trucs a la 1a ronda: normal ${(100*en).toFixed(0)}%, difícil ${(100*ed).toFixed(0)}%`);
}
// Botiga: no es pot dur un revers sense comprar-lo; comprar (pagament simulat), desbloquejar i veure-ho a la taula
async function scenario10(){
  const http=require('http'),crypto=require('crypto'),shop=require('./shop');
  const a=new Bot('A');await a.connect();
  const msgs=t=>(a.msgs||[]).filter(m=>m.t===t);
  a.send({t:'login',credential:'test:compradora',name:'Marga',look:'mocador'});
  await a.until(()=>msgs('login').length,5000);
  const prof=msgs('login')[0].profile;
  assert(prof.shop&&prof.owned.length===0,'botiga visible i res comprat');
  a.send({t:'prefs',name:'Marga',look:'mocador',hat:'mocador',back:'dimonis'});
  await a.until(()=>msgs('me').length>=1,3000);
  assert.equal(msgs('me')[0].profile.back,'llenguesBlau','un revers de pagament no es pot dur sense comprar-lo');
  a.send({t:'shop'});await a.until(()=>msgs('shop').length,3000);
  assert(msgs('shop')[0].items.some(i=>i.id==='festes'&&i.price===199),'catàleg amb preus');
  a.send({t:'buy',item:'festes'});
  await a.until(()=>a.errors.length,3000);
  assert(/casella/.test(a.errors[0]),'sense marcar la casella del desistiment no es pot comprar');
  const pay=async item=>{
    const n=msgs('buy').length;a.send({t:'buy',item,consent:true});
    await a.until(()=>msgs('buy').length>n,3000);
    const sid=new URL(msgs('buy')[n].url).searchParams.get('s'),b0=msgs('bought').length;
    a.send({t:'buyCheck',session:sid});
    await a.until(()=>msgs('bought').length>b0,3000);
    assert.equal(msgs('bought')[b0].ok,false,'sense pagar no es desbloqueja');
    const loc=await new Promise((res,rej)=>http.get(`http://127.0.0.1:${port}/compra-simulada?s=${sid}&pagar=1`,r=>{r.resume();res(r.headers.location);}).on('error',rej));
    assert.equal(loc,'/?compra='+sid,'torna al joc després de pagar');
    a.send({t:'buyCheck',session:sid});a.send({t:'buyCheck',session:sid});
    await a.until(()=>msgs('bought').length>=b0+3,3000);
    assert(msgs('bought')[b0+1].ok&&msgs('bought')[b0+2].ok,'pagat: es desbloqueja (i repetir la comprovació no fa mal)');
  };
  await pay('festes');
  await a.until(()=>msgs('me').some(m=>m.profile.owned.includes('back:dimonis')),3000);
  a.send({t:'prefs',name:'Marga',look:'mocador',hat:'mocador',back:'dimonis'});
  await a.until(()=>msgs('me').some(m=>m.profile.back==='dimonis'),3000);
  a.send({t:'buy',item:'festes',consent:true});
  await a.until(()=>a.errors.length>=2,3000);
  assert(/Ja tens/.test(a.errors[1]),'no es pot comprar dues vegades');
  a.send({t:'create',name:'Marga',look:'mocador',hat:'mocador',back:'dimonis'});
  await a.until(()=>a.room,3000);
  assert.equal(a.room.seats[a.room.you].back,'dimonis','el revers comprat es veu a la taula');
  await pay('fundador');
  await a.until(()=>a.room.seats[a.room.you].badge==='fundador',3000);
  assert.equal(a.room.seats[a.room.you].badge,'fundador','la insígnia de fundador surt al seient');
  // avís de Stripe: només s'accepta amb la signatura bona i recent
  const raw=JSON.stringify({type:'prova'}),t=Math.floor(Date.now()/1000);
  const sig=crypto.createHmac('sha256','whsec_prova').update(t+'.'+raw).digest('hex');
  assert(shop.verifyWebhook(raw,`t=${t},v1=${sig}`,'whsec_prova'),'signatura bona');
  assert(!shop.verifyWebhook(raw,`t=${t},v1=${sig.slice(0,-1)+(sig.slice(-1)==='0'?'1':'0')}`,'whsec_prova'),'signatura dolenta');
  assert(!shop.verifyWebhook(raw,`t=${t},v1=${sig}`,'whsec_altra'),'secret diferent');
  assert(!shop.verifyWebhook(raw,`t=${t},v1=${sig}`,'whsec_prova',Date.now()+600e3),'avís massa antic');
  console.log('10) botiga: revers bloquejat, casella obligatòria, pagament simulat, desbloqueig sense repetir, revers i insígnia a la taula, signatura de Stripe');
  a.send({t:'leave'});a.ws.close();
}
// Senyes: cada bot fa les seves una sola vegada per mà, només quan el company el mira, i el mira mentre la fa
function scenario11(){
  const {Game,signOf}=require('./game.js');
  const sent=[];
  const room={seats:[0,1,2,3].map(()=>({human:false})),sendAll(m){if(m.t==='ev'&&m.e.e==='sign')sent.push(m.e);},sendSeat(){},phase:'playing'};
  const g=new Game(room,{speed:0});
  const C=(n,s)=>({n,s});
  g.H={over:false,dealt:true,hands:[[C(11,'bastos'),C(3,'oros'),C(4,'copes')],[C(5,'copes'),C(6,'oros'),C(4,'bastos')],[C(1,'espases'),C(3,'copes'),C(3,'bastos')],[C(10,'oros'),C(12,'copes'),C(5,'oros')]]};
  g.signsReset();
  const ticks=n=>{for(let i=0;i<n;i++){g.signUntil=[0,0,0,0];g.signNext=[0,0,0,0];g.gzT=[9,9,9,9];g.tick(0.1);}};
  g.gaze=[-1,-1,-1,-1];ticks(10);
  assert.equal(sent.length,0,'si el company no el mira, no fa senyes');
  g.gaze=[2,3,0,1];ticks(30);
  const by=p=>sent.filter(s=>s.p===p).map(s=>s.id);
  assert.deepEqual(by(0),['amo','tres'],"l'amo i el 3, una vegada cada una");
  assert.deepEqual(by(1),['buit'],'sense cartes bones: «buit» una vegada');
  assert.deepEqual(by(2),['asE','tres'],'dos tresos: la seña del 3 una sola vegada');
  assert.deepEqual(by(3),['madona']);
  assert(signOf(C(3,'oros'))==='tres');
  console.log('11) senyes: una sola vegada per mà, només quan el company mira');
}
// Estadístiques pròpies: visites (d'on venen i quin aparell), accions vàlides, partides i la pàgina privada
async function scenario12(){
  const http=require('http'),stats=require('./stats');
  const req=(method,path,body,ua)=>new Promise((res,rej)=>{const r=http.request({host:'127.0.0.1',port,method,path,headers:ua?{'User-Agent':ua}:{}},x=>{let d='';x.on('data',c=>d+=c);x.on('end',()=>res({code:x.statusCode,body:d}));});r.on('error',rej);if(body)r.write(body);r.end();});
  const iphone='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
  const before=await stats.table(1),b=(before[stats.day()]||{});
  const n=k=>(b[k]||0);
  assert.equal((await req('POST','/hit',JSON.stringify({t:'v',r:'instagram',b:false}),iphone)).code,204);
  await req('POST','/hit',JSON.stringify({t:'v',r:'trampa',b:true}),'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0');
  await req('POST','/hit',JSON.stringify({t:'e',n:'convida-whatsapp'}));
  await req('POST','/hit',JSON.stringify({t:'e',n:'<script>'}));
  await req('POST','/hit','no és json');
  const t=(await stats.table(1))[stats.day()]||{};
  assert.equal(t.visita-n('visita'),2,'dues visites');
  assert.equal(t['ref:instagram']-n('ref:instagram'),1,'una ve d\'Instagram');
  assert.equal(t['ref:altres']-n('ref:altres'),1,'un origen inventat compta com a «altres»');
  assert.equal(t['aparell:mobil']-n('aparell:mobil'),1,'l\'iPhone és un mòbil');
  assert.equal(t['visita:nova']-n('visita:nova'),1);assert.equal(t['visita:repetida']-n('visita:repetida'),1);
  assert.equal(t['accio:convida-whatsapp']-n('accio:convida-whatsapp'),1,'acció vàlida comptada');
  assert(!Object.keys(t).some(k=>k.includes('script')),'una acció inventada no es compta');
  assert(t['partida:comencada']>0&&t['partida:acabada']>0&&t['partida:tipus:bots']>0,'les partides dels altres escenaris s\'han comptat');
  assert.equal((await req('GET','/stats?key=dolenta')).code,404,'sense la clau no es veu');
  const pg=await req('GET','/stats?key=clau-de-prova');
  assert(pg.code===200&&pg.body.includes('Estadístiques')&&pg.body.includes('Instagram'),'pàgina d\'estadístiques');
  const js=JSON.parse((await req('GET','/stats.json?key=clau-de-prova')).body);
  assert('connexions' in js,'dades en directe en JSON');
  console.log('12) estadístiques: visites per origen i aparell, accions vàlides, partides i pàgina /stats amb clau');
}
// Partida ràpida (un cantó), durada triada a la sala, gent connectada i partides que acaben sense ningú
async function scenario13(){
  const stats=require('./stats');
  const today=async k=>((await stats.table(1))[stats.day()]||{})[k]||0;
  const a=new Bot('A');await a.connect();
  const r0=await today('partida:durada:rapida');
  a.send({t:'create',name:'Rapida',look:'palla',quick:true,cantons:1});
  const ok=await a.until(()=>a.events.some(e=>e.e==='game'),60000);
  assert(ok,'la partida ràpida no ha acabat');
  const g=a.events.find(e=>e.e==='game');
  assert.deepEqual(g.cantons.slice().sort(),[0,1],'la partida ràpida acaba en un sol cantó');
  assert(!a.events.some(e=>e.e==='canton'),'sense cantó entremig');
  assert.equal(a.snap.g.win,1,'el marcador sap que es juga a un cantó');
  assert.equal(await today('partida:durada:rapida')-r0,1,'comptada com a ràpida');
  a.ws.close();
  // a la sala, l'amfitrió canvia la durada (un valor inventat no val)
  const b=new Bot('B');await b.connect();
  b.send({t:'create',name:'Llarga',look:'palla'});await b.until(()=>b.room);
  assert.equal(b.room.cantons,2,'per defecte, la llarga');
  b.send({t:'cantons',n:3});b.send({t:'cantons',n:1});
  await b.until(()=>b.room.cantons===1,3000);
  assert.equal(b.room.cantons,1,"l'amfitrió tria la ràpida");
  b.send({t:'list'});
  await b.until(()=>(b.msgs||[]).some(m=>m.t==='list'),3000);
  assert(b.msgs.find(m=>m.t==='list').online>=1,'diu quanta gent hi ha connectada');
  // si tothom se'n va a mitja partida i l'acaben els bots, compta com a abandonada (no com a acabada)
  const ab0=await today('partida:abandonada'),ac0=await today('partida:acabada');
  b.send({t:'start'});
  await b.until(()=>b.snap&&b.snap.h&&b.snap.h.dealt,10000);
  b.ws.close();
  let ab=ab0;
  for(let i=0;i<600&&ab===ab0;i++){await new Promise(r=>setTimeout(r,200));ab=await today('partida:abandonada');}
  assert.equal(ab-ab0,1,'partida sense ningú: abandonada');
  assert.equal(await today('partida:acabada'),ac0,'i no compta com a acabada');
  console.log('13) partida ràpida d\'un cantó, durada triada a la sala, gent connectada i partides abandonades');
}
// Xat de la sala (filtre i límit) i «Llest»: quan tots ho estan, la partida comença sola (i es pot desfer)
async function scenario14(){
  const {cleanChat}=require('./server.js');
  assert.equal(cleanChat('  Hola,   què tal?  '),'Hola, què tal?');
  assert.equal(cleanChat('ets un puta'),'ets un •••');
  assert.equal(cleanChat('Conoces el truc? Som de la selecció española'),'Conoces el truc? Som de la selecció española','paraules normals no es tapen');
  assert.equal(cleanChat('avui hi ha pollastre'),'avui hi ha pollastre');
  assert.equal(cleanChat('f i l l d e p u t a'),null,'un insult amb les lletres separades no passa');
  assert.equal(cleanChat('   '),null);
  assert.equal(cleanChat('x'.repeat(300)).length,120);
  // les sales buides dels altres escenaris (el servidor les tanca als 10 minuts) compten per al límit de sales per IP
  for(const r of Array.from(rooms.values()))if(r.humans()===0)r.destroy();
  const a=new Bot('A'),b=new Bot('B');await a.connect();await b.connect();
  const got=(x,t)=>(x.msgs||[]).filter(m=>m.t===t);
  a.send({t:'create',name:'Aina',look:'palla'});await a.until(()=>a.room);
  b.send({t:'join',code:a.room.code,name:'Biel',look:'palla'});await b.until(()=>b.room&&a.room.seats.filter(s=>s.human).length===2);
  a.send({t:'chat',text:'Hola! <b>Som-hi</b>'});
  await b.until(()=>got(b,'chat').length,3000);
  assert.equal(got(b,'chat')[0].m.x,'Hola! <b>Som-hi</b>','el text arriba tal qual (la web l\'escapa en pintar-lo)');
  assert.equal(got(b,'chat')[0].m.n,'Aina');
  for(let i=0;i<6;i++)a.send({t:'chat',text:'missatge '+i});
  await a.until(()=>got(a,'chatno').length,3000);
  assert.equal(got(a,'chat').length,5,'màxim 5 missatges cada 10 s');
  // «Llest»: un sol no basta; tots dos sí, i es pot desfer durant el compte enrere
  a.send({t:'ready',on:true});
  await b.until(()=>b.room.seats.some(s=>s.ready),3000);
  assert.equal(b.room.startsIn,0,'amb un sol llest no comença');
  b.send({t:'ready',on:true});
  await a.until(()=>a.room.startsIn>0,3000);
  assert(a.room.startsIn>0,'tots llestos: compte enrere');
  b.send({t:'ready',on:false});
  await a.until(()=>a.room.startsIn===0,3000);
  await new Promise(r=>setTimeout(r,3500));
  assert.equal(a.room.phase,'lobby','desfet: no comença');
  b.send({t:'ready',on:true});
  const ok=await a.until(()=>a.room.phase==='playing',6000);
  assert(ok,'tots llestos: la partida comença sola');
  assert(a.room.seats.every(s=>!s.ready),'en començar, ningú queda llest');
  const n=got(b,'chat').length;
  a.send({t:'chat',text:'durant la partida'});
  await new Promise(r=>setTimeout(r,300));
  assert.equal(got(b,'chat').length,n,'durant la partida no hi ha xat');
  assert.equal(a.room.chat.length,5,'el xat queda a la sala');
  console.log('14) xat de la sala (filtre, límit) i «Llest» amb inici automàtic');
  a.ws.close();b.ws.close();
}
// Historial de la mà: el servidor guarda les cartes de cada ronda acabada i les envia a la instantània
async function scenario15(){
  const {Game,LEVELS,mulberry32}=require('./game.js');
  let checked=0,g=null;
  const room={seats:[0,1,2,3].map(()=>({human:false})),sendSeat(){},phase:'playing',sendAll(m){
    if(m.t!=='ev'||m.e.e!=='result')return;
    const H=g.H;
    assert.equal(H.past.length,H.tricks.length,'una entrada per cada ronda acabada');
    H.past.forEach((t,i)=>{assert.equal(t.played.length,4,'les quatre cartes de la ronda');assert.equal(t.team,H.tricks[i],'qui la guanya');});
    assert.deepEqual(g.snapFor(0).h.past,H.past,'la instantània duu les rondes');
    checked++;
  }};
  g=new Game(room,{speed:0,rng:mulberry32(5),dealRng:mulberry32(6),params:[LEVELS.normal,LEVELS.normal,LEVELS.normal,LEVELS.normal]});
  await g.playCanton();
  assert(checked>3,"s'han comprovat les mans");
  console.log(`15) historial de la mà: cartes de cada ronda guardades i enviades (${checked} mans)`);
}
server.listen(0,async()=>{
  port=server.address().port;
  try{
    scenario5();scenario11();await scenario9();await scenario7();await scenario6();await scenario1();await scenario2();await scenario3();await scenario4();await scenario8();await scenario10();await scenario13();await scenario14();await scenario15();await scenario12();
    console.log('TOT OK');process.exit(0);
  }catch(e){console.error('FALLA',e);process.exit(1);}
});
