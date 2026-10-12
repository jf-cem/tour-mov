(function(root){
'use strict';
const node=typeof module==='object'&&module.exports;
const geometry=node?require('./route-core.js'):root.TourRouteCore;
const steps=node?require('./step-detector.js'):root.TourSteps;
const finite=Number.isFinite,clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const PARAMETERS=Object.freeze({stepMeters:.65,stepErrorFraction:.12,maxAccuracy:30,gpsAgeMs:10000,
  maxWithoutGpsMs:12000,maxPredictionMeters:8,maxUncertainty:12,maxSpeed:3,stationaryMs:2000,directionIdleMs:15000});
function createFusion(route,options={}){
  const p={...PARAMETERS,...options.params};
  if(!finite(p.stepMeters)||p.stepMeters<.2||p.stepMeters>1.5)throw new Error('Comprimento do passo inválido.');
  const detector=steps.createDetector(options.detectorParams);
  let selector=geometry.createSelector(route),along=null,uncertainty=null,id=null,direction=0,directionSource='unknown';
  let activity='unknown',activityAt=-Infinity,lastInput=-Infinity,lastGps=null,lastStamp=-Infinity;
  let anchorAt=-Infinity,directionAt=-Infinity,predicted=0,count=0,rate=0,reason='anchor-or-gps-required';
  let directionFix=null,reverse=null,stationaryFix=null,stationaryEscape=0,preciseFixes=0,blocked=false,routeBlocked=false;
  function snapshot(t=lastInput){return {id,along,uncertainty,direction,directionSource,steps:count,rate,
    activity:t-activityAt>p.stationaryMs?'unknown':activity,reason,tracking:reason==='tracking'||reason==='same-panorama'||reason==='confirming',
    gpsAgeMs:lastGps?Math.max(0,t-lastGps.t+lastGps.age):null,predictedMeters:predicted,
    position:along===null?null:route.position(along),parameters:p};}
  function decide(t){const d=selector.update({along,uncertainty,stamp:t});id=d.id;reason=d.reason;return snapshot(t);}
  function hold(why,t){if(why==='outside-route'||why==='ambiguous-segment')routeBlocked=true;reason=why;selector.update({stamp:t,suspended:true});return snapshot(t);}
  function applyStep(t){
    count++;
    if(along===null||blocked)return hold(blocked?'reanchor-required':'anchor-or-gps-required',t);
    if(routeBlocked)return hold('outside-route',t);
    if(!direction||reverse||t-directionAt>p.directionIdleMs)return hold('direction-required',t);
    const age=lastGps?t-lastGps.t+lastGps.age:t-anchorAt;
    if(age>p.maxWithoutGpsMs||predicted+p.stepMeters>p.maxPredictionMeters||uncertainty+p.stepMeters*p.stepErrorFraction>p.maxUncertainty){
      return hold('prediction-budget-exceeded',t);
    }
    if(activity!=='walking'||t-activityAt>p.stationaryMs)return hold('motion-unavailable',t);
    along=clamp(along+direction*p.stepMeters,0,route.total);
    predicted+=p.stepMeters;uncertainty+=p.stepMeters*p.stepErrorFraction;
    directionAt=t;
    return decide(t);
  }
  function update(e){
    if(!finite(e.t)||e.t<lastInput)return snapshot();
    lastInput=e.t;
    if(e.type==='anchor'){
      if(!finite(e.along)||e.along<0||e.along>route.total||!finite(e.uncertainty)||e.uncertainty<0)throw new Error('Âncora inválida.');
      along=e.along;uncertainty=e.uncertainty;anchorAt=e.t;blocked=false;routeBlocked=false;predicted=0;lastGps=null;
      directionFix=null;reverse=null;preciseFixes=0;stationaryFix=null;stationaryEscape=0;
      id=e.id??route.panoramas[route.indexAt(along)].id;selector=geometry.createSelector(route,{startId:id});
      reason='direction-required';return snapshot();
    }
    if(e.type==='direction'){
      direction=e.direction===-1?-1:e.direction===1?1:0;directionAt=e.t;directionSource='confirmed';reverse=null;
      reason=direction?'tracking':'direction-required';return snapshot();
    }
    if(e.type==='activity'){
      if(activity!==e.activity){stationaryFix=null;stationaryEscape=0;}
      activity=['walking','stationary'].includes(e.activity)?e.activity:'unknown';activityAt=e.t;return snapshot();
    }
    if(e.type==='motion'){
      const d=detector.add(e);rate=d.rate??rate;
      activity=d.activity==='uncertain'?'unknown':d.activity;activityAt=e.t;
      return d.step?applyStep(e.t):snapshot();
    }
    if(e.type==='step')return applyStep(e.t);
    if(e.type==='tick'){
      if(along!==null&&(lastGps?e.t-lastGps.t+lastGps.age:e.t-anchorAt)>p.maxWithoutGpsMs)return hold('gps-unavailable',e.t);
      if(e.t-directionAt>p.directionIdleMs){direction=0;directionSource='expired';}
      return snapshot();
    }
    if(e.type!=='gps'&&e.type!=='routeFix')return snapshot();
    const age=e.t-e.stamp;
    if(!finite(e.stamp)||e.stamp<=lastStamp||age<0||age>p.gpsAgeMs||!finite(e.accuracy)||e.accuracy<0||e.accuracy>p.maxAccuracy){
      return hold('gps-invalid-or-old',e.t);
    }
    lastStamp=e.stamp;
    let best;
    if(e.type==='routeFix'){
      if(!finite(e.along)||!finite(e.offset)||e.along< -e.accuracy||e.along>route.total+e.accuracy||e.offset>Math.max(5,e.accuracy))return hold('outside-route',e.t);
      best={along:clamp(e.along,0,route.total),offset:e.offset};
    }else{
      if(!finite(e.lat)||!finite(e.lng)||Math.abs(e.lat)>90||Math.abs(e.lng)>180)return hold('gps-invalid-or-old',e.t);
      const candidates=route.project(e).filter(c=>c.offset<=Math.max(5,e.accuracy)&&
        (along===null||!lastGps||Math.abs(c.along-along)<=p.maxSpeed*(e.stamp-lastGps.stamp)/1000+uncertainty+e.accuracy));
      if(!candidates.length)return hold('outside-route',e.t);
      const minOffset=candidates[0].offset;
      const ties=candidates.filter(c=>c.offset<=minOffset+1);
      if(along!==null)ties.sort((a,b)=>Math.abs(a.along-along)-Math.abs(b.along-along));
      best=ties[0];
      if(ties.some(c=>Math.abs(c.along-best.along)>Math.max(2,e.accuracy)&&
        (along===null||Math.abs(c.along-along)<=Math.abs(best.along-along)+uncertainty)))return hold('ambiguous-segment',e.t);
    }
    if(blocked)return hold('reanchor-required',e.t);
    routeBlocked=false;
    const observation={...best,accuracy:Math.max(.1,e.accuracy),t:e.t,stamp:e.stamp,age};
    if(along!==null&&Math.abs(best.along-along)>Math.max(15,uncertainty+e.accuracy+3)){
      blocked=true;return hold('reanchor-required',e.t);
    }
    if(activity==='stationary'&&e.t-activityAt<=p.stationaryMs&&along!==null){
      stationaryFix??=lastGps??{along,accuracy:uncertainty};
      stationaryEscape=Math.abs(best.along-stationaryFix.along)>stationaryFix.accuracy+e.accuracy+2?stationaryEscape+1:0;
      lastGps=observation;predicted=0;
      if(stationaryEscape<2)return hold('stationary',e.t);
      activity='unknown';
    }else{stationaryFix=null;stationaryEscape=0;}
    if(directionFix){
      const delta=best.along-directionFix.along;
      if(Math.abs(delta)>directionFix.accuracy+e.accuracy+1){
        const candidate=Math.sign(delta);
        if(direction&&candidate!==direction){reverse={direction:candidate};direction=0;directionSource='reversal-pending';}
        else if(reverse&&reverse.direction!==candidate){reverse={direction:candidate};direction=0;}
        else{direction=candidate;directionSource='gps-displacement';directionAt=e.t;reverse=null;directionFix=observation;}
      }
    }else directionFix=observation;
    if(along===null){along=best.along;uncertainty=observation.accuracy;}
    else{
      const innovation=best.along-along;
      // A weak fix overlapping the predicted interval does not drag a known anchor to its centre.
      const outside=Math.abs(innovation)>uncertainty+observation.accuracy;
      preciseFixes=observation.accuracy<uncertainty?preciseFixes+1:0;
      if(e.gpsOnly){along=best.along;uncertainty=Math.max(uncertainty,observation.accuracy);}
      else if(outside){along=clamp(along+innovation*.35,0,route.total);uncertainty=Math.max(uncertainty,observation.accuracy,Math.abs(best.along-along));}
      else if(preciseFixes>=3){along=clamp(along+innovation*.25,0,route.total);uncertainty=Math.max(observation.accuracy,uncertainty*.85);}
    }
    lastGps=observation;predicted=0;
    return decide(e.t);
  }
  return {update,snapshot,parameters:p};
}
const api={createFusion,PARAMETERS};if(node)module.exports=api;else root.TourFusion=api;
})(typeof window==='undefined'?globalThis:window);
