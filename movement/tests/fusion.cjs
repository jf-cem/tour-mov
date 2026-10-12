'use strict';
const assert=require('node:assert/strict');
const {createRoute}=require('../route-core.js'),{createFusion}=require('../fusion-core.js');
const {compare}=require('../replay-core.js'),{createDetector}=require('../step-detector.js');
const route=createRoute(require('../../route.json')),data=require('../../nodes.json');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS: '+name);}
function anchor(engine,t=0,along=0){engine.update({type:'anchor',t,along,uncertainty:.5});engine.update({type:'direction',t,direction:1});}
function step(engine,t){engine.update({type:'activity',t,activity:'walking'});return engine.update({type:'step',t});}
function gps(engine,t,along=0,accuracy=5){return engine.update({type:'routeFix',t,stamp:t,along,offset:0,accuracy});}
test('passos avançam com erro GPS de 5 m sem arrastar a âncora',()=>{
 const e=createFusion(route);anchor(e);gps(e,1,5);for(let t=500;t<5000;t+=500){gps(e,t,5);step(e,t+1);}
 assert.ok(e.snapshot().along>5);assert.ok(e.snapshot().along<7);assert.equal(e.snapshot().direction,1);
});
test('incerteza cresce com passos e fixes fracos não a apagam',()=>{
 const e=createFusion(route);anchor(e);step(e,500);const u=e.snapshot().uncertainty;gps(e,1000,0,10);
 assert.equal(e.snapshot().uncertainty,u);step(e,1500);assert.ok(e.snapshot().uncertainty>u);
});
test('previsão termina sem GPS; não há salto de passos descartados',()=>{
 const e=createFusion(route);anchor(e);for(let t=500;t<20000;t+=500)step(e,t);
 const stopped=e.snapshot().along;assert.ok(stopped<=8);assert.equal(e.snapshot().reason,'prediction-budget-exceeded');
 gps(e,21000,stopped,5);assert.equal(e.snapshot().along,stopped);step(e,21500);assert.ok(e.snapshot().along-stopped<1);
});
test('passos não avançam sem âncora ou sentido',()=>{
 const e=createFusion(route);step(e,500);assert.equal(e.snapshot().along,null);
 e.update({type:'anchor',t:1000,along:5,uncertainty:.5});step(e,1500);assert.equal(e.snapshot().along,5);
});
test('confirmação de regresso recua sem usar orientação do telefone',()=>{
 const e=createFusion(route);anchor(e,0,20);step(e,500);
 e.update({type:'orientation',t:600,alpha:180});assert.equal(e.snapshot().direction,1);
 e.update({type:'direction',t:1000,direction:-1});step(e,1500);assert.ok(Math.abs(e.snapshot().along-20)<.001);
});
test('inversão GPS pede duas evidências e suspende os passos intermédios',()=>{
 const e=createFusion(route);anchor(e,0,30);gps(e,1,30,.1);gps(e,1000,27,.1);
 assert.equal(e.snapshot().direction,0);const before=e.snapshot().along;step(e,1500);assert.equal(e.snapshot().along,before);
 gps(e,2000,26,.1);assert.equal(e.snapshot().direction,-1);
});
test('saída do percurso e salto grande não reancoram silenciosamente',()=>{
 const e=createFusion(route);anchor(e);gps(e,1,0,.1);
 assert.equal(e.update({type:'routeFix',t:1000,stamp:1000,along:1,accuracy:1,offset:40}).reason,'outside-route');
 step(e,1500);assert.equal(e.snapshot().along,0,'steps cannot advance after an outside-route fix');
 assert.equal(gps(e,2000,40,1).reason,'reanchor-required');assert.equal(e.snapshot().along,0);
});
test('fixes repetidos e antigos rejeitados',()=>{
 const e=createFusion(route);anchor(e);gps(e,1);
 assert.equal(e.update({type:'routeFix',t:1000,stamp:1,along:0,accuracy:5,offset:0}).reason,'gps-invalid-or-old');
 assert.equal(e.update({type:'routeFix',t:20000,stamp:100,along:0,accuracy:5,offset:0}).reason,'gps-invalid-or-old');
});
test('fallback GPS com campos de movimento ausentes',()=>{
 const e=createFusion(route);anchor(e);e.update({type:'gps',t:1000,stamp:1000,...route.position(10),accuracy:5,gpsOnly:true});
 assert.ok(Math.abs(e.snapshot().along-10)<.01);assert.ok(e.snapshot().uncertainty>=5);
});
test('detetor distingue paragem, cadência e falhas em 25/50/100 Hz',()=>{
 for(const hz of [25,50,100]){
  const d=createDetector();let last;
  for(let t=0;t<3000;t+=1000/hz)last=d.add({t,gravity:{x:0,y:0,z:9.81},rotation:{alpha:0,beta:0,gamma:0}});
  assert.equal(last.steps,0);assert.equal(last.activity,'stationary');
  for(let t=3000;t<13000;t+=1000/hz)last=d.add({t,gravity:{x:0,y:0,z:9.81+2.5*Math.sin(t/1000*4*Math.PI)},rotation:{alpha:0,beta:0,gamma:0}});
  assert.ok(last.steps>=15&&last.steps<=22,`${hz} Hz: ${last.steps}`);
  assert.equal(d.snapshot(15000).activity,'uncertain');
 }
});
test('rodar/abanar parado não desloca no cenário controlado',()=>{
 const e=createFusion(route);anchor(e);gps(e,1,0,5);
 for(let t=20;t<5000;t+=20)e.update({type:'motion',t,gravity:{x:0,y:0,z:9.81+2*Math.sin(t/1000*4*Math.PI)},rotation:{alpha:400,beta:0,gamma:0}});
 assert.equal(e.snapshot().along,0);assert.equal(e.snapshot().steps,0);
});
test('replay de motion usa o mesmo motor e conserva marcadores independentes',()=>{
 const events=[{type:'anchor',t:0,id:data.start,along:0,uncertainty:.5},{type:'direction',t:1,direction:1},
  {type:'routeFix',t:2,stamp:2,along:0,offset:0,accuracy:5}];
 for(let t=20;t<4000;t+=20)events.push({type:'motion',t,gravity:{x:0,y:0,z:9.81+2.5*Math.sin(t/1000*4*Math.PI)},rotation:{alpha:0,beta:0,gamma:0}});
 const session={schema:'cem-pano-session-1',routeId:route.id,routeVersion:route.version,referenceKind:'synthetic',events};
 const a=compare(session,require('../../route.json'),data.nodes);assert.ok(a.results['route-steps'].trace.at(-1).state.along>1);
 assert.deepEqual(a,compare(session,require('../../route.json'),data.nodes));
});
console.log(passed+' cenários de fusão/deteção passaram.');
