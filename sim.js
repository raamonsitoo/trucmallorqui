process.env.TRUC_SPEED='0.01';
process.env.TRUC_TIMER_MS='400';
process.env.PORT='0';
// comptes en mode de prova (memòria i credencials falses «test:...»)
process.env.NODE_ENV='test';process.env.TRUC_TEST_AUTH='1';process.env.GOOGLE_CLIENT_ID='test-client';process.env.SESSION_SECRET='test-secret';delete process.env.DATABASE_URL;
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
  console.log(`9) nivells: fàcil guanya ${(100*fn).toFixed(0)}% contra normal, mestre ${(100*mn).toFixed(0)}%`);
}
server.listen(0,async()=>{
  port=server.address().port;
  try{
    scenario5();await scenario9();await scenario7();await scenario6();await scenario1();await scenario2();await scenario3();await scenario4();await scenario8();
    console.log('TOT OK');process.exit(0);
  }catch(e){console.error('FALLA',e);process.exit(1);}
});
