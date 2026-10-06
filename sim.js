process.env.TRUC_SPEED='0.01';
process.env.TRUC_TIMER_MS='400';
process.env.PORT='0';
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
        if(r<0.2&&h.trickNo===0&&!h.envitDone&&h.trucLevel===0)return this.send({t:'act',a:{type:'envit'}});
        return this.send({t:'act',a:{type:'play',idx:Math.floor(Math.random()*h.mine.length)}});
      }
      const r=Math.random();
      this.send({t:'act',a:r<0.55?'vull':r<0.8?'no':(p.data.level<4?'raise':'vull')});
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
server.listen(0,async()=>{
  port=server.address().port;
  try{
    await scenario1();await scenario2();await scenario3();await scenario4();
    console.log('TOT OK');process.exit(0);
  }catch(e){console.error('FALLA',e);process.exit(1);}
});
