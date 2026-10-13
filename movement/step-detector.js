(function(root){
'use strict';
const node=typeof module==='object'&&module.exports;
const PARAMETERS=Object.freeze({algorithm:'adaptive-peaks-v1',sensorGapMs:300,minStepMs:280,maxStepMs:1600,minPeak:.12,minProminence:.20,sensitivity:1,smoothingSeconds:.07,thresholdSeconds:1.2,rotationLimit:240,stationaryMs:2000,quietEnergy:.0025});
function createDetector(params={}){
 if(params.algorithm==='legacy-fixed-v02'||params.algorithm===undefined&&Object.hasOwn(params,'peak'))return (node?require('./step-detector-v02.js'):root.TourStepsV02).createDetector(params);
 const p={...PARAMETERS,...params};
 if(!Number.isFinite(p.sensitivity)||p.sensitivity<.5||p.sensitivity>2)throw new Error('Sensibilidade inválida.');
 let last=null,gravity=9.81,filtered=0,previous=0,trough=0,rising=false,energy=0,rate=0;
 let peakTimes=[],countedThrough=-Infinity,lastStep=-Infinity,steps=0,validAt=-Infinity,threshold=p.minPeak/p.sensitivity;
 const vector=v=>v&&['x','y','z'].every(k=>Number.isFinite(v[k]));
 const snapshot=t=>({step:false,stepDelta:0,steps,rate,signal:filtered,threshold,activity:t-validAt>p.sensorGapMs?'uncertain':t-lastStep<p.stationaryMs?'walking':energy<p.quietEnergy?'stationary':'uncertain'});
 return {add(s){
  const t=s.t;if(!Number.isFinite(t)||last!==null&&t<=last)return {...snapshot(last??0),activity:'uncertain'};
  const dt=last===null?0:(t-last)/1000;last=t;
  if(!vector(s.gravity)&&!vector(s.acceleration)){peakTimes=[];return {...snapshot(t),activity:'uncertain',quality:'missing-fields'};}
  validAt=t;
  const magnitude=vector(s.gravity)?Math.hypot(s.gravity.x,s.gravity.y,s.gravity.z):Math.hypot(s.acceleration.x,s.acceleration.y,s.acceleration.z);
  if(!dt||dt*1000>p.sensorGapMs){gravity=magnitude;filtered=previous=trough=energy=0;rising=false;peakTimes=[];return {...snapshot(t),activity:'uncertain'};}
  rate=rate?rate*.9+.1/dt:1/dt;
  gravity+=(1-Math.exp(-dt/.7))*(magnitude-gravity);
  filtered+=(1-Math.exp(-dt/p.smoothingSeconds))*(magnitude-gravity-filtered);
  energy+=(1-Math.exp(-dt/p.thresholdSeconds))*(filtered*filtered-energy);
  threshold=Math.max(p.minPeak/p.sensitivity,Math.sqrt(energy));
  const rotation=Math.hypot(...['alpha','beta','gamma'].map(k=>Number.isFinite(s.rotation?.[k])?s.rotation[k]:0));
  let stepDelta=0,rejection=null;
  if(rotation>p.rotationLimit){peakTimes=[];rising=false;trough=filtered;rejection='gesture';}
  else{
   if(filtered>previous)rising=true;
   if(rising&&filtered<previous){
    rising=false;const peakAt=t-dt*1000,period=peakTimes.length?peakAt-peakTimes.at(-1):Infinity;
    if(previous<threshold||previous-trough<p.minProminence/p.sensitivity)rejection='small-peak';
    else if(period<p.minStepMs){peakTimes=[];rejection='too-fast';}
    else{
     if(period>p.maxStepMs)peakTimes=[];
     peakTimes.push(peakAt);peakTimes=peakTimes.slice(-3);
     if(peakTimes.length===3){const a=peakTimes[1]-peakTimes[0],b=peakTimes[2]-peakTimes[1];
      if(Math.max(a,b)/Math.min(a,b)<1.7){stepDelta=peakTimes.filter(stamp=>stamp>countedThrough).length;steps+=stepDelta;countedThrough=peakAt;lastStep=t;}
      else rejection='irregular-cadence';
     }
    }
    trough=filtered;
   }
   trough=Math.min(trough,filtered);
  }
  previous=filtered;
  return {...snapshot(t),step:stepDelta>0,stepDelta,rotation,quality:rotation>p.rotationLimit?'gesture':'usable',rejection};
 },snapshot};
}
const api={createDetector,PARAMETERS};if(node)module.exports=api;else root.TourSteps=api;
})(typeof window==='undefined'?globalThis:window);
