'use strict';
const assert=require('node:assert/strict');
const adaptive=require('../step-detector.js'),legacy=require('../step-detector-v02.js');
function run(factory,{hz=50,amplitude=.35,frequency=2,seconds=10,params={}}={}){
 const d=factory.createDetector(params);let state;
 for(let t=0;t<3000+seconds*1000;t+=1000/hz)state=d.add({t,gravity:{x:0,y:0,z:9.81+(t<3000?0:amplitude*Math.sin((t-3000)/1000*frequency*2*Math.PI))},rotation:{alpha:0,beta:0,gamma:0}});
 return state;
}
for(const hz of [25,50,100])for(const amplitude of [.25,.35,.5]){
 const old=run(legacy,{hz,amplitude}),newCount=run(adaptive,{hz,amplitude});
 assert.equal(old.steps,0,'fixed threshold misses weak walking');
 assert.ok(newCount.steps>=18&&newCount.steps<=21,`${hz} Hz/${amplitude}: ${newCount.steps}`);
}
for(const frequency of [.8,1.2,2,3]){
 const s=run(adaptive,{frequency,amplitude:.5,seconds:20});
 assert.ok(Math.abs(s.steps-20*frequency)<=2,`${frequency} Hz: ${s.steps}`);
}
assert.equal(run(adaptive,{amplitude:.03}).steps,0,'stationary sensor noise does not become steps');
const {createFusion}=require('../fusion-core.js'),{createRoute}=require('../route-core.js');
const engine=createFusion(createRoute(require('../../route.json')));
engine.update({type:'anchor',t:0,along:0,uncertainty:.5});engine.update({type:'direction',t:0,direction:1});
engine.update({type:'routeFix',t:1,stamp:1,along:0,offset:0,accuracy:50});
for(let t=20;t<13000;t+=20)engine.update({type:'motion',t,gravity:{x:0,y:0,z:9.81+(t<3000?0:.35*Math.sin((t-3000)/1000*4*Math.PI))}});
assert.ok(engine.snapshot().steps>=18,'bad GPS stops prediction but cannot suppress detected step count');
for(const frequency of [6,8,10])assert.equal(run(adaptive,{amplitude:1.5,frequency}).steps,0,'fast shaking is not aliased into a walking cadence');
const inferredLegacy=run(adaptive,{amplitude:2.5,params:legacy.PARAMETERS});
assert.deepEqual(inferredLegacy,run(legacy,{amplitude:2.5}),'v0.2 parameters select the recorded legacy algorithm');
const d=adaptive.createDetector();
let last;for(let t=0;t<3000;t+=20)last=d.add({t,gravity:{x:0,y:0,z:9.81+.5*Math.sin(t/1000*4*Math.PI)}});
const count=last.steps;
d.add({t:8000,gravity:{x:0,y:0,z:9.81}});assert.equal(d.snapshot(8000).steps,count,'gap cannot invent missed steps');
console.log('PASS weak steps at 25/50/100 Hz, slow/normal/fast cadences, noise, high-frequency gestures, old-session replay and data gaps.');
