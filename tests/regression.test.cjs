const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Test-only access is injected into the served copy, never the production HTML.
const instrumented = source.replace('  /* ===================== Arranque ===================== */\n  init();', `
  window.appTest = {
    init, initDB, defaultState, persist, storageGet, storageSet, dbSet, dbGet, dbReadAllWithCursor,
    validateBackup, buildMasterBackupJSON, importMasterBackup, commitRestoredBackup,
    saveRecoveryPoint, showRecoveryPoints, uploadDriveBackup, autoRestoreFromDrive,
    periodSummary, openAIPlanPreview, validateAIPlan, generateAIPlan, resetAll,
    rpgState,xpForLevel,nowMs,openShopModal,welcomeAvailability,claimWelcomePack,
    setWelcomeDay(fn){welcomeDay=fn;},
    todayStr, addDays, render, renderEstadisticas,
    get state(){return state;}, get dirty(){return bitacora_needs_sync;},
    get ready(){return dataReady;}, get revision(){return localRevision;},
    get conflict(){return syncConflict;}, get saveFailed(){return localSaveFailed;},
    async seed(patch){
      await initDB(); state = Object.assign(defaultState(), patch);
      state.tracking.autoStartEnabled = false; dataReady = true;
      await persist(); render();
    },
    setStorage(fn){storageSet=fn;},
    setCommit(fn){commitRestoredBackup=fn;},
    setDrive(known){driveAccessToken='test-token';driveTokenExpiry=Date.now()+3600000;setKnownRemoteModTime(known);},
    setClean(){markSyncComplete(localRevision);},
    setKey(key){setGroqKey(key);},
    showStats(){activeTab='estadisticas';render();},
    setStatsOffset(n){statsOffsetDays=n;},
    async points(){return await dbGetAppData(RECOVERY_KEY)||[];}
  };
`);
assert.notEqual(instrumented, source, 'test injection anchor must exist');

let browser, server, origin;
before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/test.html') { res.setHeader('Content-Type', 'text/html'); res.end(instrumented); }
    else if (req.url === '/index.html' || req.url === '/') { res.setHeader('Content-Type','text/html');res.end(source); }
    else if (req.url === '/sw.js') { res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(root,'sw.js'))); }
    else if (req.url === '/manifest.json') { res.setHeader('Content-Type','application/json');res.end('{"name":"Bitácora","start_url":"/index.html","display":"standalone"}'); }
    else if (/icon-\d+\.png/.test(req.url)) {res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=','base64'));}
    else { res.statusCode=404;res.end('Not found'); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless:true, executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args:['--no-sandbox']});
});
after(async()=>{await browser?.close(); await new Promise(resolve=>server?.close(resolve));});

async function withPage(fn, options={}) {
  const context = await browser.newContext({viewport:{width:393,height:851},timezoneId:'America/La_Paz',serviceWorkers:options.serviceWorkers||'block'});
  await context.route('**/*', route=>{
    if(route.request().url().startsWith(origin)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors=[];page.on('pageerror',err=>errors.push(err.message));
  try { await page.goto(origin+'/test.html'); await page.waitForFunction(()=>window.appTest); await fn(page,context); assert.deepEqual(errors,[],'no unhandled browser errors'); }
  finally { await context.close(); }
}

test('startup, mobile navigation, daily task persistence, original controls',async()=>withPage(async page=>{
  await page.evaluate(()=>appTest.init());
  await page.waitForFunction(()=>appTest.ready);
  await page.evaluate(()=>{appTest.state.tracking.autoStartEnabled=false;});
  await page.locator('form[data-action="add-task"] input[name="text"]').fill('Leer con la familia');
  await page.locator('form[data-action="add-task"] button[type="submit"]').click();
  await page.waitForFunction(async()=>JSON.parse(await appTest.storageGet('bitacora-app-data')).oneoff.some(t=>t.text==='Leer con la familia'));
  assert.match(await page.locator('#app').innerText(),/Leer con la familia/);
  assert.equal(await page.locator('[data-action="open-class-recorder"]').count(),1);
  assert.equal(await page.locator('[data-action="toggle-master"]').count(),1);
  const order=await page.evaluate(()=>{
    const task=document.querySelector('form[data-action="add-task"]');const focus=document.querySelector('.master-switch-panel');
    return !!(focus.compareDocumentPosition(task)&Node.DOCUMENT_POSITION_FOLLOWING);
  });assert.equal(order,true);
  for (const tab of ['calendario','habitos','proyectos','estadisticas','tienda','evidencias','hoy']) {
    await page.locator(`.nav-btn[data-tab="${tab}"]`).click();
    assert.ok((await page.locator('#app').innerText()).length>0);
  }
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
  await page.reload();await page.evaluate(()=>appTest.init());await page.waitForFunction(()=>appTest.ready);
  assert.match(await page.locator('#app').innerText(),/Leer con la familia/);
}));

test('corrupt stored JSON remains intact and startup refuses to overwrite it',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.initDB();await appTest.storageSet('bitacora-app-data','{corrupt');appTest.init();
    await new Promise(r=>setTimeout(r,100));
    return {ready:appTest.ready,raw:await appTest.storageGet('bitacora-app-data'),message:document.getElementById('app').textContent};
  });assert.equal(result.ready,false);assert.equal(result.raw,'{corrupt');assert.match(result.message,/No se pudo abrir/);
}));

test('failed local write is visible and export still uses the latest in-memory state',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({});appTest.setStorage(async()=>false);appTest.state.oneoff.push({id:'unsaved',text:'No perder',date:appTest.todayStr()});
    const saved=await appTest.persist();const backup=await appTest.buildMasterBackupJSON();
    return {saved,dirty:appTest.dirty,failed:appTest.saveFailed,text:backup.state.oneoff[0].text};
  });assert.deepEqual(result,{saved:false,dirty:true,failed:true,text:'No perder'});
}));

test('backups exclude credentials, preserve source state and accept legacy null notes',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({groqApiKey:'secret-not-for-export'});appTest.setKey('session-secret');
    await appTest.dbSet('2026-11-13_t1',JSON.stringify({note:null,image:null,taskName:'Original'}));
    const backup=await appTest.buildMasterBackupJSON();const evidence=appTest.validateBackup(backup);
    return {serialized:JSON.stringify(backup),original:appTest.state.groqApiKey,count:Object.keys(evidence).length};
  });assert.doesNotMatch(result.serialized,/secret/);assert.equal(result.original,'secret-not-for-export');assert.equal(result.count,1);
}));

test('invalid and incomplete backups are rejected before modifying any data',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({oneoff:[{id:'keep',text:'Conservar',date:'2026-11-13'}]});
    const before=JSON.stringify(appTest.state);let refused=0;
    const valid=await appTest.buildMasterBackupJSON();
    const cases=[{}, {state:[]}, {...valid,state:{...valid.state,habits:'bad'}}, {...valid,_meta:{...valid._meta,totalEvidenceKeys:7}}, {...valid,state:{...valid.state,projects:[{id:'p',text:'bad',tasks:'wrong'}]}}, {...valid,_meta:{version:999}}];
    for(const data of cases){if(!await appTest.importMasterBackup(new File([JSON.stringify(data)],'bad.json')))refused++;}
    return {refused,before,after:JSON.stringify(appTest.state),points:(await appTest.points()).length};
  });assert.equal(result.refused,6);assert.equal(result.before,result.after);assert.equal(result.points,0);
}));

test('atomic restore abort rolls back both state and photos, including a clear()',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({oneoff:[{id:'keep',text:'Antes',date:appTest.todayStr()}]});await appTest.dbSet('old',JSON.stringify({note:'foto antigua',image:null}));
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){if(this.name==='appData'&&key==='bitacora-app-data'){this.transaction.abort();throw new Error('simulated write failure');}return originalPut.call(this,value,key);};
    let failed=false;try{await appTest.commitRestoredBackup(appTest.defaultState(),{new:JSON.stringify({note:'new'})});}catch{failed=true;}finally{IDBObjectStore.prototype.put=originalPut;}
    return {failed,raw:JSON.parse(await appTest.storageGet('bitacora-app-data')).oneoff[0].text,old:JSON.parse(await appTest.dbGet('old')).note,newPhoto:await appTest.dbGet('new')};
  });assert.deepEqual(result,{failed:true,raw:'Antes',old:'foto antigua',newPhoto:null});
}));

test('empty evidence restore clears old photos together with state',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({});await appTest.dbSet('old',JSON.stringify({note:null,image:null}));
    await appTest.commitRestoredBackup(appTest.defaultState(),{});
    return await appTest.dbReadAllWithCursor();
  });assert.deepEqual(result,{});
}));

test('recovery points retain the latest three complete copies without credentials',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({groqApiKey:'private-key'});await appTest.dbSet('old',JSON.stringify({note:'Foto',image:null}));
    for(let i=0;i<4;i++)await appTest.saveRecoveryPoint('Punto '+i);
    const points=await appTest.points();return {reasons:points.map(p=>p.reason),count:appTest.validateBackup(points[0].backup),text:JSON.stringify(points)};
  });assert.deepEqual(result.reasons,['Punto 3','Punto 2','Punto 1']);assert.equal(Object.keys(result.count).length,1);assert.doesNotMatch(result.text,/private-key/);
}));

test('restore failure preserves active state, remote version and recovery copy',async()=>withPage(async page=>{
  page.on('dialog',dialog=>dialog.accept());
  const result=await page.evaluate(async()=>{
    await appTest.seed({oneoff:[{id:'keep',text:'Original',date:appTest.todayStr()}]});appTest.setDrive('known');
    const backup=await appTest.buildMasterBackupJSON();backup.state.oneoff=[];
    appTest.setCommit(async()=>{throw new Error('simulated quota failure');});
    const ok=await appTest.importMasterBackup(new File([JSON.stringify(backup)],'restore.json'),{remoteModTime:'new'});
    return {ok,text:appTest.state.oneoff[0].text,known:localStorage.getItem('bitacora_drive_known_modtime'),points:(await appTest.points()).length,locked:!!window.isImportingBackup};
  });assert.deepEqual(result,{ok:false,text:'Original',known:'known',points:1,locked:false});
}));

test('Drive conflict preserves pending local changes and does not upload or import',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({oneoff:[{id:'keep',text:'Solo local',date:appTest.todayStr()}]});appTest.setDrive('old');
    const calls=[];window.fetch=async(url,options={})=>{calls.push(options.method||'GET');return new Response(JSON.stringify({files:[{id:'remote',modifiedTime:'new'}]}),{status:200});};
    const ok=await appTest.uploadDriveBackup(true);return {ok,calls,dirty:appTest.dirty,text:appTest.state.oneoff[0].text,conflict:!!appTest.conflict,points:(await appTest.points()).length};
  });assert.equal(result.ok,false);assert.deepEqual(result.calls,['GET']);assert.equal(result.text,'Solo local');assert.equal(result.dirty,true);assert.equal(result.conflict,true);assert.equal(result.points,1);
}));

test('unknown first Drive version and metadata errors never trigger overwrite',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({});appTest.setDrive(null);localStorage.removeItem('bitacora_drive_known_modtime');
    let writes=0;window.fetch=async(url,opts={})=>{if(opts.method)writes++;return new Response(JSON.stringify({files:[{id:'r',modifiedTime:'v1'}]}),{status:200});};
    await appTest.uploadDriveBackup(true);return {writes,dirty:appTest.dirty};
  });assert.deepEqual(result,{writes:0,dirty:true});
}));

test('changes made during upload remain pending; duplicate upload is blocked',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({});appTest.setDrive('v1');let writes=0;
    window.fetch=async(url,opts={})=>{
      if(opts.method){writes++;const duplicate=await appTest.uploadDriveBackup(false);if(duplicate)throw new Error('duplicate upload');appTest.state.oneoff.push({id:'later',text:'Cambio durante subida',date:appTest.todayStr()});await appTest.persist();return new Response(JSON.stringify({id:'r',modifiedTime:'v2'}),{status:200});}
      return new Response(JSON.stringify({files:[{id:'r',modifiedTime:'v1'}]}),{status:200});
    };
    const ok=await appTest.uploadDriveBackup(true);return {ok,writes,dirty:appTest.dirty,known:localStorage.getItem('bitacora_drive_known_modtime')};
  });assert.deepEqual(result,{ok:true,writes:1,dirty:true,known:'v2'});
}));

test('period summaries use actual parent task seconds and completion dates',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    const day=appTest.todayStr(),prior=appTest.addDays(day,-1);
    await appTest.seed({firstUseDate:prior,habits:[{id:'h',text:'Hábito',createdAt:prior}],oneoff:[{id:'o',text:'Tarea',date:day}],
      log:{[prior]:{h:true},[day]:{h:true,o:true}},timeLog:{[day]:{thinking:60,tasks:{o:120},subtasks:{s:120},bonus:{o:120}}},
      projects:[{id:'p',text:'Proyecto',status:'completed',completedAt:day,tasks:[{id:'pt',text:'Paso',done:true,doneAt:day}]}]});
    return appTest.periodSummary(prior,day);
  });assert.equal(result.taskSeconds,120);assert.equal(result.thinkingSeconds,60);assert.equal(result.done,2);assert.equal(result.rate,100);assert.equal(result.oneoffDone,1);assert.equal(result.projectTasksDone,1);assert.equal(result.projectsDone,1);
  await page.evaluate(()=>appTest.showStats());
  for(const days of [30,90,7]){await page.locator(`[data-action="stats-period"][data-days="${days}"]`).click();assert.equal(await page.locator(`[data-days="${days}"]`).getAttribute('aria-pressed'),'true');}
}));

test('AI preview safely edits, deselects and deduplicates tasks before saving',async()=>withPage(async page=>{
  await page.evaluate(async()=>{
    await appTest.seed({projects:[{id:'p',text:'Mi proyecto',status:'active',createdAt:appTest.todayStr(),deadline:appTest.addDays(appTest.todayStr(),7),tasks:[{id:'existing',text:'Ya existe',done:false}]}]});
    appTest.openAIPlanPreview('p',[{text:'Ya existe',subtasks:[]},{text:'<img src=x onerror=alert(1)>',subtasks:['Paso uno']},{text:'No incluir',subtasks:[]}]);
  });
  assert.equal(await page.locator('#aiPlanPreview img').count(),0);
  assert.equal(await page.evaluate(()=>appTest.state.projects[0].tasks.length),1);
  await page.locator('#ai-text-1').fill('Tarea revisada');await page.locator('#ai-subs-1').fill('Uno\nDos');await page.locator('#ai-include-2').uncheck();
  await page.getByRole('button',{name:'Agregar tareas seleccionadas',exact:true}).click();
  await page.waitForFunction(()=>!document.getElementById('aiPlanPreview'));
  const tasks=await page.evaluate(()=>appTest.state.projects[0].tasks);assert.equal(tasks.length,2);assert.equal(tasks[1].text,'Tarea revisada');assert.deepEqual(tasks[1].subtasks.map(s=>s.text),['Uno','Dos']);
}));

test('discarded and malformed AI plans leave project unchanged',async()=>withPage(async page=>{
  const result=await page.evaluate(async()=>{
    await appTest.seed({projects:[{id:'p',text:'Proyecto',status:'active',tasks:[]}]});let rejected=0;
    for(const plan of [{tasks:[]},{tasks:[{text:42}]},{tasks:[{text:'Bien',subtasks:[{}]}]}]){try{appTest.validateAIPlan(plan);}catch{rejected++;}}
    appTest.openAIPlanPreview('p',[{text:'No guardar',subtasks:[]}]);return rejected;
  });assert.equal(result,3);
  await page.getByRole('button',{name:'Descartar plan',exact:true}).click();assert.equal(await page.evaluate(()=>appTest.state.projects[0].tasks.length),0);
}));

test('offline service worker serves cached app instead of a server error page',async()=>{
  const context=await browser.newContext({serviceWorkers:'allow'});
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const page=await context.newPage();
  try{
    await page.goto(origin+'/index.html');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.reload();assert.match(await page.title(),/Bitácora/);
    assert.equal(await page.locator('.nav-btn').count(),7);
  }finally{await context.close();}
});

test('RPG inventory works on mobile and keeps the original permissions shop reachable',async()=>withPage(async page=>{
  await page.evaluate(async()=>{
    await appTest.seed({coins:{balance:40}});const r=appTest.rpgState();r.xp=appTest.xpForLevel(5);r.xpUnits=r.xp*120;
    appTest.openShopModal();
  });
  await page.locator('[data-rpg-buy="shield"]').click();
  assert.equal(await page.evaluate(()=>appTest.rpgState().inv.shield),1);
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),20);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-action="commerce-section"][data-section="inventory"]').first().click();
  assert.equal(await page.locator('[data-commerce-view="inventory"]').count(),1);
  assert.equal(await page.locator('[data-rpg-buy]').count(),0);
  assert.match(await page.locator('[data-commerce-view="inventory"]').innerText(),/1 disponible/);
  await page.locator('[data-action="commerce-section"][data-section="shop"]').first().click();
  await page.locator('#legacyShopBtn').click();assert.equal(await page.locator('#shopModal').evaluate(el=>el.classList.contains('open')),true);
}));

test('roulette reroll spends one ticket and returns to roulette before starting a task',async()=>withPage(async page=>{
  page.on('dialog',dialog=>dialog.accept());
  await page.evaluate(async()=>{
    const ds=appTest.todayStr();await appTest.seed({oneoff:[{id:'a',text:'Primera tarea',date:ds},{id:'b',text:'Segunda tarea',date:ds}],tracking:{status:'thinking',startTime:null,sessionEndsAt:appTest.nowMs()+3600000}});
    appTest.rpgState().inv.reroll=1;
  });
  await page.locator('[data-action="open-roulette"]').click();await page.locator('#rouletteSpinBtn').click();
  await page.waitForFunction(()=>appTest.rpgState().inv.reroll===0,null,{timeout:12000});
  assert.equal(await page.evaluate(()=>appTest.state.tracking.status),'thinking');
  assert.equal(await page.locator('#rouletteSpinBtn').isEnabled(),true);
}));

test('welcome tab displays seven packs, claims one and stays within mobile width',async()=>withPage(async page=>{
  await page.evaluate(async()=>{appTest.setWelcomeDay(()=>'2026-11-13');await appTest.seed({});});
  assert.equal(await page.locator('.bottom-nav [data-tab="tienda"]').count(),1);
  assert.equal(await page.locator('.bottom-nav [data-tab="bonos"]').count(),0);
  await page.locator('#welcomeGiftBtn').click();
  assert.equal(await page.locator('.welcome-pack').count(),7);
  assert.equal(await page.locator('[data-action="claim-welcome"]:enabled').count(),1);
  await page.locator('[data-action="claim-welcome"][data-day="1"]').click();
  await page.waitForFunction(()=>appTest.rpgState().starter.claims.length===1);
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),5);
  assert.equal(await page.locator('[data-action="claim-welcome"]:enabled').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>appTest.setWelcomeDay(()=>'2026-11-14'));
  await page.locator('.nav-btn[data-tab="hoy"]').click();await page.locator('#welcomeGiftBtn').click();
  await page.locator('[data-action="claim-welcome"][data-day="2"]').click();
  await page.waitForFunction(()=>appTest.rpgState().starter.claims.length===2);
  assert.equal(await page.evaluate(()=>appTest.rpgState().inv.reroll),1);
}));
