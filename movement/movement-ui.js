(function(root){
'use strict';
const el=id=>document.getElementById(id);
let route,data,session=null,engine=null,watch=null,timer=null,offMotion=null,revision=0,context=null;
let lastMotion=-Infinity,lastRender=-Infinity,latest=null,lastTime=0,recording=false,events=[],truncated=false;
const MAX_EVENTS=36000,MAX_BYTES=12*1024*1024;let bytes=0;
const sensors=root.cemSensors;
let gpsFix=null,gpsRunning=false,gpsFault=null;
function showGps(t){
  const badge=el('gps-live');if(!badge)return;
  let text='GPS: a aguardar',quality='waiting';
  if(gpsFault===1){text='GPS: acesso recusado';quality='bad';}
  else if(gpsFix&&Number.isFinite(gpsFix.accuracy)&&gpsFix.accuracy>=0){
    const age=Number.isFinite(gpsFix.stamp)?Math.max(0,t-gpsFix.stamp):Infinity;
    const label=!gpsRunning?'última leitura':age>10000?'leitura antiga':gpsFix.accuracy<=5?'melhor precisão':gpsFix.accuracy<=10?'precisão limitada':'precisão fraca';
    text=`GPS ±${gpsFix.accuracy.toFixed(1)} m · ${label}`;
    quality=!gpsRunning?'waiting':age>10000||gpsFix.accuracy>10?'bad':gpsFix.accuracy>5?'limited':'better';
    badge.title=`Precisão horizontal indicada pelo aparelho, não força do sinal. Leitura há ${Number.isFinite(age)?Math.round(age/1000)+' s':'tempo desconhecido'}. Mesmo ±5 m pode confundir panoramas próximos.`;
  }else if(gpsFault){text='GPS: localização indisponível';quality='bad';}
  if(badge.textContent!==text)badge.textContent=text;badge.dataset.quality=quality;
}
function time(){lastTime=Math.max(lastTime,Date.now());return lastTime;}
function record(e){if(!recording)return;const line=JSON.stringify(e);if(events.length>=MAX_EVENTS||bytes+line.length*2>MAX_BYTES){recording=false;truncated=true;el('movement-info').textContent+=' · Registo cheio';return;}events.push(JSON.parse(line));bytes+=line.length*2;}
function send(e){record(e);latest=engine.update(e);render(e.t);return latest;}
function render(t,force=false){
  if(!latest||!context||!force&&t-lastRender<200)return;lastRender=t;
  if(document.body.dataset.walkState==='preparing')return;
  if(latest.id){context.openNode(latest.id);record({type:'display',t,id:latest.id});}
  if(latest.along!==null)root.TourMap?.update(latest.position??route.position(latest.along),latest.uncertainty,true,latest.along);
  const sensor=sensors.diagnostics().streams.motion;
  const motionGood=t-lastMotion<2000;
  const method=el('movement-method').value;
  el('movement-info').textContent=`${method==='route-steps'?'Passos + percurso':method==='gps-activity'?'GPS + atividade':'GPS'} · ${latest.steps??0} passos · ${latest.rate?latest.rate.toFixed(0)+' Hz':'sem frequência'} · ${motionGood?'movimento disponível':sensor?.status==='denied'?'movimento recusado; GPS':sensor?.status==='unavailable'?'sem sensor; GPS':'a aguardar movimento'}`;
  const messages={stationary:'Estás parado. A manter a imagem.', 'direction-required':'Confirma o sentido da caminhada.',
    'prediction-budget-exceeded':'A aguardar uma localização melhor para continuar.', 'gps-unavailable':'Sem localização recente. A aguardar sinal.',
    'ambiguous-panorama':'A confirmar a posição entre imagens próximas.', 'ambiguous-segment':'A confirmar em que parte do percurso estás.',
    'outside-route':'A localização está fora do percurso. Aproxima-te ou termina e recomeça.',
    'reanchor-required':'A localização mudou demasiado. Termina e recomeça num ponto conhecido.',
    'gps-invalid-or-old':'A aguardar uma localização recente e mais precisa.',
    'anchor-or-gps-required':'A aguardar uma posição inicial identificável.',
    'motion-unavailable':'Sem passos confirmados. A aguardar sensores ou GPS.'};
  const label=latest.id?data.nodes.find(n=>n.id===latest.id)?.title:'Posição por confirmar';
  context.status(`tour-mov 0.3 · ${method}\n${label}\nProgresso: ${latest.along?.toFixed(1)??'?'} m; incerteza operacional: ${latest.uncertainty?.toFixed(1)??'?'} m\nAtividade: ${latest.activity}; motivo: ${latest.reason}\nPassos: ${latest.steps??0}; sentido: ${latest.direction??'?'}\n${truncated?'Registo truncado.':''}`,
    messages[latest.reason]??`${label}. Continua a caminhar; podes olhar à volta.`);
}
function stop(){
  gpsRunning=false;showGps(Date.now());
  revision++;if(watch!==null)navigator.geolocation.clearWatch(watch);watch=null;
  if(timer!==null)clearInterval(timer);timer=null;offMotion?.();offMotion=null;
  recording=false;
  el('movement-direction-tools').hidden=true;
  el('export-session').disabled=!session||!events.length;
  context=null;engine=null;
}
function start(ctx){
  ctx.stopTracking();context=ctx;const run=++revision;
  if(!root.isSecureContext||!navigator.geolocation){ctx.status('É necessário HTTPS e acesso à localização.');return;}
  const method=el('movement-method').value,remote=el('gps-mode').value==='relative';
  gpsFix=null;gpsFault=null;gpsRunning=true;showGps(time());
  const stepMeters=Number(el('step-meters').value);
  if(!Number.isFinite(stepMeters)||stepMeters<.2||stepMeters>1.5){ctx.status('Escolhe um comprimento de passo entre 0,2 e 1,5 m.');return;}
  // Invoke permission in the same synchronous user gesture as the Start button.
  sensors.request(['motion']).then(()=>{if(run===revision&&latest)render(time(),true);});
  const initialDirection=Number(el('travel-direction').value)===-1?-1:1;
  el('live-direction').value=String(initialDirection);
  const startAlong=route.panoramas.find(p=>p.id===ctx.first.id).along;
  const params={...root.TourFusion.PARAMETERS,stepMeters},detectorParams={...root.TourSteps.PARAMETERS,sensitivity:Number(el('step-sensitivity').value)};
  engine=root.TourReplay.createEngine(method,data.nodes,route,{params,detectorParams});
  session={schema:'cem-pano-session-1',appVersion:'tour-mov-0.3',routeId:route.id,routeVersion:route.version,
    referenceKind:remote?'virtual':'physical',testMode:remote?el('remote-path').value:'benfica',engineOptions:{params,detectorParams},
    detectorParameters:{source:'cem-adaptive-peaks-v1',values:detectorParams},startedAt:new Date().toISOString(),truncated:false};
  events=[];bytes=0;truncated=false;recording=el('record-session').checked;lastMotion=-Infinity;lastRender=-Infinity;lastTime=0;latest=null;
  el('export-session').disabled=true;el('movement-direction-tools').hidden=false;
  send({type:'direction',t:time(),direction:initialDirection});
  offMotion=sensors.subscribe('tour-mov-walk',['motion'],sample=>{
    if(run!==revision)return;
    const valid=v=>v&&['x','y','z'].every(k=>Number.isFinite(v[k]));
    if(valid(sample.acceleration)||valid(sample.gravity))lastMotion=time();
    send({...sample,t:time(),sourceTime:sample.t});
  });
  let preparing=true,origin=null,axis=null,rotation=null,originAccuracy=0;
  const preparation=root.TourGpsStart.createPreparation();
  function finish(result,manual=false){
    const chosen=manual?result.fallback:{...result.position,accuracy:result.accuracy};if(!chosen||run!==revision)return;
    preparing=false;origin={lat:chosen.lat,lng:chosen.lng};originAccuracy=chosen.accuracy;
    el('use-position').hidden=true;ctx.walkState('walking');
    if(remote||el('confirm-anchor').checked){
      // Remote origin is an explicitly defined virtual reference, not a claimed precise GPS fix.
      send({type:'anchor',t:time(),id:ctx.first.id,along:startAlong,uncertainty:remote?.5:1,
        source:remote?'remote-defined-reference':'confirmed-physical-presence'});
      send({type:'direction',t:time(),direction:initialDirection});
      ctx.openNode(ctx.first.id);
    }
    reading({coords:{latitude:chosen.lat,longitude:chosen.lng,accuracy:chosen.accuracy},timestamp:Date.now()});
  }
  function report(result){
    if(result.ready){finish(result);return;}
    el('use-position').hidden=!result.fallback;
    ctx.status(`Preparação GPS: ${result.count} leituras; ${Math.floor(result.elapsed/1000)} s; precisão ${result.accuracy??'?'} m`,
      result.fallback?'A posição ainda oscila. Podes aguardar ou começar com a localização disponível.':'Fica parado durante a preparação da localização.');
  }
  el('use-position').onclick=()=>{if(run===revision&&preparing){const r=preparation.snapshot(Date.now());if(r.fallback)finish(r,true);}};
  function reading(position){
    if(run!==revision)return;
    const t=time(),c=position.coords;
    const raw={type:'rawGps',t,stamp:position.timestamp,lat:c.latitude,lng:c.longitude,accuracy:c.accuracy,
      speed:Number.isFinite(c.speed)?c.speed:null,heading:Number.isFinite(c.heading)?c.heading:null};
    gpsFix=raw;gpsFault=null;showGps(t);
    record(raw);
    if(preparing){report(preparation.add(position));return;}
    if(!Number.isFinite(raw.accuracy)||raw.accuracy<0||raw.accuracy>20||t-raw.stamp>10000||raw.stamp>t)return;
    const gpsOnly=t-lastMotion>3000;
    el('gps-quality').textContent=`GPS: ±${Math.round(raw.accuracy)} m`;
    if(!remote){send({...raw,type:'gps',gpsOnly});return;}
    const displacement=root.TourGeo.distance(origin,raw),physicalBearing=root.TourGeo.bearing(origin,raw);
    if(axis===null&&displacement>=Math.max(8,2*(originAccuracy+raw.accuracy))){
      axis=physicalBearing;
      const index=data.nodes.indexOf(ctx.first),next=data.nodes[index+initialDirection]??data.nodes[index-initialDirection];
      rotation=root.TourGeo.bearing(ctx.first,next)-axis;
    }
    if(axis===null){
      if(latest)render(t,true);
      ctx.status(el('technical-status').textContent+'\nEixo remoto por definir.',
        latest?.reason==='prediction-budget-exceeded'?'Continua fisicamente em linha reta para definir o eixo GPS. A imagem aguarda confirmação.':'Caminha em linha reta para definir o eixo GPS. Os passos confirmados estimam o avanço.');return;
    }
    const accuracy=originAccuracy+raw.accuracy;
    if(el('remote-path').value==='straight'){
      const angle=(physicalBearing-axis)*Math.PI/180;
      send({type:'routeFix',t,stamp:raw.stamp,along:startAlong+initialDirection*displacement*Math.cos(angle),
        offset:Math.abs(displacement*Math.sin(angle)),accuracy,gpsOnly,remoteOriginAccuracy:originAccuracy});
    }else{
      const virtual=root.TourGeo.relativePosition(origin,raw,ctx.first,rotation);
      send({...raw,...virtual,type:'gps',accuracy,gpsOnly,remoteOriginAccuracy:originAccuracy});
    }
  }
  watch=navigator.geolocation.watchPosition(reading,error=>{
    if(run!==revision)return;
    gpsFault=error.code;showGps(time());
    if(error.code===1){ctx.stopTracking();ctx.walkState('error');ctx.status('Localização recusada. Verifica a permissão do navegador.');}
    else ctx.status(`GPS: ${error.code} · ${error.message}`,'A localização está temporariamente indisponível. A aguardar sinal.');
  },{enableHighAccuracy:true,maximumAge:0,timeout:25000});
  ctx.activeTracking();ctx.walkState('preparing');
  root.TourMap?.reset();report(preparation.snapshot(Date.now()));
  timer=setInterval(()=>{if(run!==revision)return;showGps(time());if(preparing)report(preparation.snapshot(Date.now()));
    else{send({type:'tick',t:time()});render(time(),true);}},1000);
}
async function init(nodeData){
  data=nodeData;const response=await fetch('route.json?v=0.3');if(!response.ok)throw new Error('Não foi possível carregar o percurso tour-mov.');
  route=root.TourRouteCore.createRoute(await response.json());
  el('reference-panorama').replaceChildren(...data.nodes.map(n=>{const option=document.createElement('option');option.value=n.id;option.textContent=n.title;return option;}));
  el('confirm-direction').onclick=()=>{if(engine){send({type:'direction',t:time(),direction:Number(el('live-direction').value)});render(time(),true);}};
  el('mark-reference').onclick=()=>{if(engine&&recording){record({type:'reference',t:time(),kind:'position',expectedId:el('reference-panorama').value});el('reference-feedback').textContent='Referência guardada.';}else el('reference-feedback').textContent='Ativa a gravação antes de iniciar.';};
  el('export-session').onclick=()=>{
    if(!session||!events.length)return;
    const exported={...session,truncated,events,exportedAt:new Date().toISOString()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(exported)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='tour-mov-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&context){const ctx=context;ctx.stopTracking();ctx.status('A caminhada terminou ao sair da página. Recomeça para preparar uma nova origem.');}});
}
root.TourMovement={init,start,stop,enabled:()=>!!route&&['gps','gps-activity','route-steps'].includes(el('movement-method').value)};
})(window);

