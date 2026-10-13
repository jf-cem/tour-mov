'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..');
const geo=require('../../geo.js');
const server=http.createServer((req,res)=>{
 const relative=decodeURIComponent(new URL(req.url,'http://localhost').pathname),target=path.resolve(root,'.'+(relative==='/'?'/index.html':relative));
 if(!target.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
 if(!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404);return res.end();}
 const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.xml':'application/xml','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
 res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');fs.createReadStream(target).pipe(res);
});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{channel:'msedge'}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const NativeDate=Date;window.__clock=NativeDate.now();window.__cleared=[];window.__permissionCalls=0;
  window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__clock]));}static now(){return window.__clock;}};
  Object.defineProperty(navigator,'geolocation',{value:{watchPosition(fn,err){window.__gps=fn;window.__gpsError=err;return 0;},clearWatch(id){window.__cleared.push(id);},getCurrentPosition(fn){window.__gps=fn;}}});
  Object.defineProperty(window,'DeviceMotionEvent',{value:class extends Event{static requestPermission(){window.__permissionCalls++;return Promise.resolve(window.__denyMotion?'denied':'granted');}}});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/`);
 try{await page.waitForFunction(()=>!document.getElementById('follow').disabled,null,{timeout:60000});}
 catch(e){console.log('Page errors:',errors);console.log('UI status:',await page.locator('#status').textContent());throw e;}
 assert.equal(await page.title(),'tour-mov — ensaio de movimento');
 await page.locator('#record-session').check();
 await page.locator('#follow').click();
 assert.equal(await page.evaluate(()=>window.__permissionCalls),1,'motion permission from Start gesture');
 async function reading(m,advance=2000,accuracy=3){const coords=geo.destination({lat:40,lng:-8},m,90);
  await page.evaluate(({coords,advance,accuracy})=>{window.__clock+=advance;window.__gps({coords:{latitude:coords.lat,longitude:coords.lng,accuracy},timestamp:Date.now()});},{coords,advance,accuracy});}
 for(let i=0;i<6;i++)await reading(0);
 assert.match(await page.locator('#gps-live').textContent(),/GPS ±3\.0 m/);
 await page.locator('#visit-panel > summary').click();
 assert.ok(await page.locator('#gps-live').isVisible(),'GPS accuracy remains visible with panel collapsed');
 await page.locator('#visit-panel > summary').click();
 assert.equal(await page.locator('body').getAttribute('data-walk-state'),'walking');
 await page.evaluate(()=>{
  for(let dt=20;dt<=4500;dt+=20){window.__clock+=20;const event=new Event('devicemotion');
   Object.assign(event,{accelerationIncludingGravity:{x:0,y:0,z:9.81+2.5*Math.sin(dt/1000*4*Math.PI)},rotationRate:{alpha:0,beta:0,gamma:0},interval:20});window.dispatchEvent(event);}
 });
 assert.match(await page.locator('#technical-status').textContent(),/Passos: [4-9]/);
 assert.ok(Number((await page.locator('#technical-status').textContent()).match(/Progresso: ([\d.]+)/)[1])>2);
 await reading(14,100,3); // define axis with an informative displacement; source error is preserved
 await page.locator('#live-direction').selectOption('-1');await page.locator('#confirm-direction').click();
 assert.match(await page.locator('#technical-status').textContent(),/sentido: -1/);
 await page.evaluate(()=>window.__clock+=11000);
 await page.waitForFunction(()=>document.getElementById('gps-live').textContent.includes('leitura antiga'));
 await reading(14,100,32);
 assert.match(await page.locator('#gps-live').textContent(),/±32\.0 m · precisão fraca/,'rejected weak fixes still show their accuracy');
 await reading(14,100,3);
 assert.match(await page.locator('#gps-live').textContent(),/melhor precisão/);
 await page.getByText('Marcar uma referência do ensaio',{exact:true}).click();
 await page.locator('#reference-panorama').selectOption('node3');await page.locator('#mark-reference').click();
 assert.equal(await page.locator('#reference-feedback').textContent(),'Referência guardada.');
 const before=await page.locator('#current-label').textContent();
 await page.locator('#stop').click();assert.ok((await page.evaluate(()=>window.__cleared)).includes(0));
 const downloadPromise=page.waitForEvent('download');await page.locator('#export-session').click();const download=await downloadPromise;
 const stream=await download.createReadStream();let content='';for await(const chunk of stream)content+=chunk;
 const session=JSON.parse(content);assert.equal(session.appVersion,'tour-mov-0.3');
 assert.ok(session.events.some(e=>e.type==='motion'));assert.ok(session.events.some(e=>e.type==='rawGps'));
 assert.ok(session.events.some(e=>e.type==='reference'));assert.equal(session.truncated,false);
 const compared=require('../replay-core.js').compare(session,require('../../route.json'),require('../../nodes.json').nodes);
 assert.ok(compared.results['route-steps'].trace.at(-1).state.steps>0);
 await page.evaluate(()=>{window.__clock+=1000;window.__gps({coords:{latitude:40,longitude:-8,accuracy:3},timestamp:Date.now()});});
 assert.equal(await page.locator('#current-label').textContent(),before,'cancelled GPS callback cannot change panorama');
 await page.locator('#movement-method').selectOption('gps-activity');
 await page.evaluate(()=>window.__denyMotion=true);
 await page.locator('#follow').click();for(let i=0;i<6;i++)await reading(0);
 await reading(14);await reading(20);await reading(20);
 assert.notEqual(await page.locator('#current-label').textContent(),'Panorama 01','GPS fallback progresses without motion');
 await page.locator('#stop').click();
 await page.getByRole('button',{name:'Estou no local da visita'}).click();
 assert.ok(await page.locator('#start-panorama').isVisible(),'physical start selector remains available');
 await page.locator('#start-panorama').selectOption('node7');
 await page.locator('#movement-method').selectOption('route-steps');
 await page.getByText('Calibração e início no local',{exact:true}).click();
 await page.locator('#confirm-anchor').check();
 await page.evaluate(()=>window.__denyMotion=false);
 await page.locator('#follow').click();
 const physical=require('../../nodes.json').nodes[4];
 for(let i=0;i<6;i++)await page.evaluate(physical=>{window.__clock+=2000;window.__gps({coords:{latitude:physical.lat,longitude:physical.lng,accuracy:1},timestamp:Date.now()});},physical);
 assert.equal(await page.locator('#current-label').textContent(),'Panorama 05');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert.equal(await page.locator('body').getAttribute('data-walk-state'),'ready','hiding page stops the session');
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:false}));
 const shots=process.env.SHOTS_DIR||path.join(root,'movement/tests');
 await page.screenshot({path:path.join(shots,'tour-mov-mobile.png')});
 assert.deepEqual(errors,[]);
 console.log('PASS browser: real UI, GPS preparation, motion permission, detected steps, axis, direction, reference/export/replay, watch ID 0, stale callback, GPS fallback, confirmed physical anchor, hidden teardown; no page errors.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});

