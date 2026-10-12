(function(root){
'use strict';
const finite=Number.isFinite, clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Initial engineering hypotheses, NOT physical accuracy guarantees.
const PARAMETERS=Object.freeze({stepMeters:.65,sensorGapMs:300,minStepMs:300,maxStepMs:1500,peak:1.05,release:.35,rotationLimit:240,stationaryMs:1800,directionMs:5000,gpsAgeMs:10000,maxWithoutFixMs:12000,maxPredictionMeters:6,maxUncertaintyMeters:12,correctionRate:.6,reanchorMeters:10,maxAccuracy:20,maxSpeed:3});
function createDetector(params={}){
 const p={...PARAMETERS,...params};let last=null,gravity=9.81,mean=0,energy=0,armed=true,lastPeak=null,intervals=[],lastStep=-Infinity,steps=0,validAt=-Infinity,rate=0;
 return {add(s){
  const t=s.t,dt=last===null?0:(t-last)/1000;
  if(!finite(t)||last!==null&&t<=last)return {step:false,activity:'uncertain',steps};
  last=t;const a=s.acceleration,g=s.gravity;
  const vector=v=>v&&[v.x,v.y,v.z].every(finite);
  if(!vector(a)&&!vector(g)){intervals=[];return {step:false,activity:'uncertain',steps};}
  if(!dt||dt*1000>p.sensorGapMs){mean=0;energy=0;armed=true;lastPeak=null;intervals=[];validAt=t;return {step:false,activity:'uncertain',steps};}
  rate=rate?rate*.9+.1/dt:1/dt;validAt=t;
  const norm=v=>Math.hypot(v.x,v.y,v.z),alpha=1-Math.exp(-dt/.7);
  let raw;if(vector(g)){const magnitude=norm(g);gravity+=alpha*(magnitude-gravity);raw=magnitude-gravity;}else raw=norm(a);
  mean+=(1-Math.exp(-dt/1.5))*(raw-mean);const signal=raw-mean;
  energy+=(1-Math.exp(-dt/.4))*(signal*signal-energy);
  const rotation=s.rotation,rot=rotation?Math.hypot(...['alpha','beta','gamma'].map(k=>finite(rotation[k])?rotation[k]:0)):0;
  let step=false;
  if(signal<p.release)armed=true;
  if(armed&&signal>p.peak){armed=false;const period=lastPeak===null?Infinity:t-lastPeak;lastPeak=t;
   if(rot>p.rotationLimit||period<p.minStepMs||period>p.maxStepMs)intervals=[];
   else {intervals.push(period);intervals=intervals.slice(-3);if(intervals.length>=2&&Math.max(...intervals)/Math.min(...intervals)<1.7){step=true;steps++;lastStep=t;}}
  }
  return {step,steps,activity:t-lastStep<1600?'walking':energy<.12&&t-lastStep>p.stationaryMs?'stationary':'uncertain',energy,rate,rotation:rot,quality:rot>p.rotationLimit?'gesture':'usable'};
 },snapshot(t){return {steps,rate,activity:t-validAt>p.sensorGapMs?'uncertain':t-lastStep<1600?'walking':energy<.12?'stationary':'uncertain'};}};
}
const api={createDetector,PARAMETERS};if(typeof module==='object'&&module.exports)module.exports=api;else root.TourSteps=api;
})(typeof window==='undefined'?globalThis:window);

