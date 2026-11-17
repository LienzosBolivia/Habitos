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
    handleAuthClick,ensureToken,requestDriveAuthorization,restoreDriveAuthorization,expireDriveAuthorization,driveTokenValid,silentTokenRenew,saveDriveSession,loadDriveSession,fetchDrive,disconnectDrive,failDriveAuthAttempt,
    get authAttempt(){return driveAuthAttempt;},get authToken(){return driveAccessToken;},get authExpiry(){return driveTokenExpiry;},get authEmail(){return driveUserEmail;},get identityPending(){return driveIdentityPending;},
    restoreAuthForTest(){driveSessionLoaded=false;restoreDriveAuthorization();},
    setFollowAlarm(fn){fireDeadlineAlarm=fn;},
    followToday,followState,followKey,syncFollowDay,setFollowEnabled,selectFollowEntry,saveFollowPlan,followTick,settleFollowDays,followEntryDone,followTimeAt,startFollowEntry,collectFollowPenalties,validateFollowState,openFollowPrompt,closeFollowPrompt,confirmFollowTime,pauseTask,
    loanQuote,loanState,requestLoan,repayLoan,canRepayLoan,validateLoans,
    setLoanCommit(fn){commitLoanSnapshot=fn;},
    parseDriveArchiveLink,validArchiveDate,archiveEntries,filteredArchiveEntries,saveArchiveEntry,editArchiveEntry,deleteArchiveEntry,openArchivePreview,closeArchivePreview,computeBackupRichness,
    validateBackup, buildMasterBackupJSON, importMasterBackup, commitRestoredBackup,
    saveRecoveryPoint, showRecoveryPoints, uploadDriveBackup, autoRestoreFromDrive,
    periodSummary, openAIPlanPreview, validateAIPlan, generateAIPlan, resetAll,
    rpgState,xpForLevel,nowMs,openShopModal,welcomeAvailability,claimWelcomePack,
    useRpgItem,useBooster,checkDeadlineAlarms,enableAlarm,taskCoinAmount,openEditEvidenceModal,openViewEvidenceModal,saveEvidence,addCoins,useCoin,buyShopItem,updateLiveTimers,tickCoins,markDone,unmarkDone,creditCompletionCoins,
    setNow(fn){nowMs=fn;},
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
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),35);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.locator('[data-action="commerce-section"][data-section="inventory"]').first().click();
  assert.equal(await page.locator('[data-commerce-view="inventory"]').count(),1);
  assert.equal(await page.locator('[data-rpg-buy]').count(),0);
  assert.match(await page.locator('[data-commerce-view="inventory"]').innerText(),/1 disponible/);
  await page.locator('[data-action="commerce-section"][data-section="shop"]').first().click();
  assert.equal(await page.locator('[data-rpg-buy]').count(),6);
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

test('coin and purchased breaks stop wheels and smoke, survive reload and resume after expiry',async()=>withPage(async page=>{
  await page.evaluate(async()=>{const now=appTest.nowMs();await appTest.seed({coins:{balance:20},tracking:{status:'thinking',startTime:now,sessionEndsAt:now+3600000}});});
  await page.locator('#coinBtn').click();
  await page.locator('.train-track-container.status-paused').waitFor();
  assert.match(await page.locator('.ms-label').innerText(),/Sistema apagado/);
  assert.equal(await page.locator('.loco-wheelset').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  assert.equal(await page.locator('.loco-smoke').evaluate(el=>getComputedStyle(el).display),'none');
  await page.waitForFunction(()=>document.querySelector('[data-live-break-countdown]')?.textContent!=='00:03:00');
  assert.equal(await page.evaluate(()=>appTest.state.tracking.startTime),null);
  await page.reload();await page.evaluate(()=>appTest.init());await page.waitForFunction(()=>appTest.ready);
  await page.locator('.train-track-container.status-paused').waitFor();
  await page.evaluate(()=>{appTest.state.tracking.autoStartEnabled=false;const after=appTest.state.coins.breakUntil+1000;appTest.setNow(()=>after);appTest.tickCoins();});
  await page.locator('.train-track-container.status-thinking').waitFor();
  // A game pass goes through the same complete shutdown instead of animating "thinking".
  page.on('dialog',dialog=>dialog.accept('Juego de prueba'));
  await page.evaluate(()=>{appTest.setNow(()=>Date.now());appTest.buyShopItem('game');appTest.useRpgItem('game');});
  await page.locator('.train-track-container.status-paused').waitFor();
  assert.equal(await page.locator('.loco-wheelset').first().evaluate(el=>getComputedStyle(el).animationName),'none');
}));

test('saving task evidence grants a completion coin in addition to accumulated time',async()=>withPage(async page=>{
  await page.evaluate(async()=>{const ds=appTest.todayStr();await appTest.seed({oneoff:[{id:'t',text:'Trabajo terminado',date:ds}],timeLog:{[ds]:{thinking:0,tasks:{t:1200},taskLimits:{t:1800}}},tracking:{status:'thinking',startTime:null,sessionEndsAt:appTest.nowMs()+3600000}});});
  await page.locator('[data-action="play-task"][data-id="t"]').click();await page.locator('[data-action="stop-task"][data-id="t"]').click();await page.locator('[data-action="edit-evidence"][data-id="t"]').click();await page.locator('#evidenceNote').fill('Trabajo completado y revisado');await page.locator('#evidenceSaveBtn').click();
  await page.waitForFunction(()=>appTest.state.coins.balance===1);assert.equal(await page.locator('#coinCount').innerText(),'1');
  await page.evaluate(async()=>{const ds=appTest.todayStr();appTest.unmarkDone(ds,'t');appTest.markDone(ds,'t');await appTest.creditCompletionCoins(ds,'t');});
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),1);
}));

test('daily subtask checkboxes credit their parent evidence without paying the parent again',async()=>withPage(async page=>{
  await page.evaluate(async()=>{const ds=appTest.todayStr();await appTest.seed({oneoff:[{id:'t',text:'Trabajo dividido',date:ds,subtasks:[{id:'a',text:'Paso uno',done:false},{id:'b',text:'Paso dos',done:false}]}]});await appTest.dbSet(ds+'_t',JSON.stringify({note:'Avance con evidencia',image:null}));});
  await page.locator('[data-action="toggle-subtasks-view"][data-id="t"]').click();
  await page.locator('[data-action="toggle-subtask"][data-subid="a"]').check();await page.waitForFunction(()=>appTest.state.coins.balance===1);
  await page.locator('[data-action="toggle-subtask"][data-subid="b"]').check();await page.waitForFunction(()=>appTest.state.coins.balance===2);
  await page.evaluate(()=>appTest.markDone(appTest.todayStr(),'t'));assert.equal(await page.evaluate(()=>appTest.state.coins.balance),2);
}));

test('unified store stocks passes and inventory activates them without another charge',async()=>withPage(async page=>{
  page.on('dialog',d=>d.accept('Una aplicación'));
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:20}});});
  await page.locator('[data-tab="tienda"]').click();await page.locator('[data-rpg-buy="scroll"]').click();
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),14);assert.equal(await page.evaluate(()=>!!appTest.state.coins.breakUntil),false);
  await page.evaluate(()=>{appTest.state.tracking.status='thinking';appTest.state.tracking.sessionEndsAt=appTest.nowMs()+3600000;});
  await page.locator('[data-section="inventory"]').first().click();await page.locator('[data-rpg-use="scroll"]').click();
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),14);assert.equal(await page.evaluate(()=>appTest.rpgState().inv.scroll),0);
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="monedas"]').click();
  await page.waitForFunction(()=>document.querySelector('#evGalleryContainer').textContent.includes('Control de monedas'));
  assert.match(await page.locator('#evGalleryContainer').innerText(),/Pase de scroll/);
  assert.match(await page.locator('#evGalleryContainer').innerText(),/sin nuevo cobro/);
}));

test('gallery evidence can be viewed and edited while retaining the original photo',async()=>withPage(async page=>{
  await page.evaluate(async()=>{const ds=appTest.todayStr();await appTest.seed({oneoff:[{id:'edit',text:'Informe',date:ds}],log:{[ds]:{edit:true}}});await appTest.dbSet(ds+'_edit',JSON.stringify({taskName:'Informe',note:'Primera nota',image:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}));});
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-action="view-evidence-from-gallery"]').first().click();
  await page.locator('[data-action="edit-viewed-evidence"]').click();await page.waitForFunction(()=>!document.querySelector('#evidenceSaveBtn').disabled);await page.locator('#evidenceNote').fill('Primera nota, con más detalles');await page.locator('#evidenceSaveBtn').click();
  await page.waitForFunction(()=>document.querySelector('#viewEvidenceContent').textContent.includes('con más detalles'));
  assert.equal(await page.locator('#viewEvidenceContent img').count(),1);
}));

test('Archive on mobile saves, searches, filters, previews, edits and reloads Drive links',async()=>withPage(async(page,context)=>{
  await context.route('https://drive.google.com/file/d/**/preview*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="background:#eed8ad"><p>Vista de archivo de prueba</p></body></html>'}));
  await page.evaluate(async()=>{await appTest.seed({});});
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="archivo"]').click();
  const form=page.locator('[data-action="archive-save"]');
  await form.locator('[name="archiveName"]').fill('Álbum familiar');await form.locator('[name="archiveUrl"]').fill('https://drive.google.com/file/d/family_photo/view?resourcekey=0-safe');await form.locator('[name="archiveDate"]').fill('2026-10-20');await form.locator('button[type="submit"]').click();
  await page.locator('.archive-card').waitFor();
  await form.locator('[name="archiveName"]').fill('Factura de noviembre');await form.locator('[name="archiveUrl"]').fill('https://drive.google.com/file/d/invoice_pdf/view');await form.locator('[name="archiveDate"]').fill('2026-11-02');await form.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.archive-card').length===2);
  await page.locator('#archiveSearch').fill('album');assert.equal(await page.locator('.archive-card').count(),1);
  await page.locator('#evFilterMonth').fill('2026-11');assert.equal(await page.locator('.archive-card').count(),0);
  await page.locator('[data-action="archive-clear-filters"]').click();assert.equal(await page.locator('.archive-card').count(),2);
  const album=page.locator('.archive-card').filter({hasText:'Álbum familiar'});
  await album.locator('[data-action="archive-preview"]').first().click();
  assert.equal(await page.locator('#archiveViewerModal.open').count(),1);
  assert.match(await page.locator('#archiveViewerContent iframe').getAttribute('src'),/family_photo\/preview\?resourcekey=0-safe/);
  assert.match(await page.frameLocator('#archiveViewerContent iframe').locator('body').innerText(),/Vista de archivo de prueba/);
  await page.locator('[data-action="archive-close"]').click();assert.equal(await page.locator('#archiveViewerContent iframe').count(),0);
  await album.locator('[data-action="archive-edit"]').click();await form.locator('[name="archiveName"]').fill('Recuerdo familiar');await form.locator('button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('.archive-grid').textContent.includes('Recuerdo familiar'));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:320,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload();await page.evaluate(()=>appTest.init());await page.waitForFunction(()=>appTest.ready);await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="archivo"]').click();
  await page.locator('.archive-card').first().waitFor();assert.equal(await page.locator('.archive-card').count(),2);assert.match(await page.locator('.archive-grid').innerText(),/Recuerdo familiar/);
}));

test('Archive rejects unsupported links and removing a record never sends a Drive deletion',async()=>withPage(async page=>{
  const driveDeletes=[];page.on('request',r=>{if(r.method()==='DELETE'&&r.url().includes('google'))driveDeletes.push(r.url());});
  await page.evaluate(async()=>{await appTest.seed({});});await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="archivo"]').click();
  const form=page.locator('[data-action="archive-save"]');await form.locator('[name="archiveName"]').fill('Archivo');await form.locator('[name="archiveUrl"]').fill('https://drive.google.com.evil.test/file/d/id/view');await form.locator('button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>appTest.archiveEntries().length),0);assert.equal(await page.locator('.archive-card').count(),0);
  await form.locator('[name="archiveUrl"]').fill('https://drive.google.com/file/d/private_file/view');await form.locator('button[type="submit"]').click();await page.locator('.archive-card').waitFor();
  assert.equal(await page.locator('.archive-card a').getAttribute('href'),'https://drive.google.com/file/d/private_file/view');
  page.once('dialog',d=>d.accept());await page.locator('[data-action="archive-delete"]').click();await page.waitForFunction(()=>appTest.archiveEntries().length===0);
  await page.locator('.archive-card').waitFor({state:'detached'});assert.deepEqual(driveDeletes,[]);
  assert.equal(await page.locator('.archive-card').count(),0);
}));

test('Archive limits embedded previews and loads more without hiding search matches',async()=>withPage(async page=>{
  await page.evaluate(async()=>{const stamp=new Date().toISOString();await appTest.seed({archiveLinks:Array.from({length:25},(_,i)=>({id:'file_'+i,name:'Archivo '+i,url:'https://drive.google.com/file/d/file_'+i+'/view',date:'2026-11-16',createdAt:stamp,updatedAt:stamp}))});});
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="archivo"]').click();await page.locator('.archive-card').first().waitFor();
  assert.equal(await page.locator('.archive-card').count(),12);await page.locator('[data-action="archive-more"]').click();assert.equal(await page.locator('.archive-card').count(),24);
  await page.locator('#archiveSearch').fill('Archivo 24');assert.equal(await page.locator('.archive-card').count(),1);assert.match(await page.locator('.archive-card h3').innerText(),/Archivo 24/);
}));


test('benefits loan on mobile shows the quote, creates one debt, persists and records its credit',async()=>withPage(async page=>{
  page.on('dialog',dialog=>dialog.accept());await page.evaluate(async()=>{await appTest.seed({coins:{balance:0}});});
  await page.locator('#welcomeGiftBtn').click();await page.locator('[data-action="benefits-section"][data-section="loan"]').click();
  await page.locator('#loanAmount').fill('100');assert.match(await page.locator('#loanQuote').innerText(),/Total a devolver: 110/);
  await page.locator('[data-action="loan-request"] button[type="submit"]').click();
  await page.waitForFunction(()=>appTest.loanState().active?.principal===100);
  await page.locator('[data-action="loan-repay"]').waitFor();assert.equal(await page.locator('[data-action="loan-request"]').count(),0);
  assert.equal(await page.locator('[data-action="loan-repay"]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:320,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload();await page.evaluate(()=>appTest.init());await page.waitForFunction(()=>appTest.ready);
  await page.locator('#welcomeGiftBtn').click();await page.locator('[data-action="benefits-section"][data-section="loan"]').click();
  await page.locator('[data-action="loan-repay"]').waitFor();assert.equal(await page.evaluate(()=>appTest.loanState().active.total),110);
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="monedas"]').click();
  await page.waitForFunction(()=>document.querySelector('#evGalleryContainer').textContent.includes('Préstamo recibido'));
}));

test('repaying from benefits leaves a reserve, unlocks the next loan and records the interest',async()=>withPage(async page=>{
  page.on('dialog',dialog=>dialog.accept());await page.evaluate(async()=>{await appTest.seed({coins:{balance:12}});});
  await page.locator('#welcomeGiftBtn').click();await page.locator('[data-action="benefits-section"][data-section="loan"]').click();
  await page.locator('#loanAmount').fill('100');await page.locator('[data-action="loan-request"] button[type="submit"]').click();
  await page.waitForFunction(()=>appTest.loanState().active?.principal===100);await page.locator('[data-action="loan-repay"]:not([disabled])').click();
  await page.waitForFunction(()=>!appTest.loanState().active);await page.locator('[data-action="loan-request"]').waitFor();
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),2);
  assert.equal(await page.evaluate(()=>appTest.loanState().history[0].interest),10);
  await page.locator('#loanAmount').fill('25');await page.locator('[data-action="loan-request"] button[type="submit"]').click();
  await page.waitForFunction(()=>appTest.loanState().active?.principal===25);assert.equal(await page.evaluate(()=>appTest.state.coins.balance),27);
}));

test('first welcome pack gives a duplicator immediately and shield costs five coins',async()=>withPage(async page=>{
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:0}});});
  await page.locator('#welcomeGiftBtn').click();
  assert.match(await page.locator('.welcome-pack').first().innerText(),/Duplicador/);
  await page.locator('[data-action="claim-welcome"][data-day="1"]').click();
  await page.waitForFunction(()=>appTest.rpgState().inv.booster===1);
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),5);
  await page.evaluate(()=>{const r=appTest.rpgState();r.xp=appTest.xpForLevel(5);r.xpUnits=r.xp*120;appTest.openShopModal();});
  assert.match(await page.locator('[data-rpg-buy="shield"]').innerText(),/5 🪙/);
  await page.locator('[data-rpg-buy="shield"]').click();assert.equal(await page.evaluate(()=>appTest.state.coins.balance),0);assert.equal(await page.evaluate(()=>appTest.rpgState().inv.shield),1);
}));

async function seedFollowPage(page){
  await page.evaluate(async()=>{
    const ds=appTest.todayStr();window.followClock=appTest.followTimeAt(ds,'10:00');appTest.setNow(()=>window.followClock);
    await appTest.seed({coins:{balance:20},oneoff:[{id:'ft',text:'Informe de prueba',date:ds,subtasks:[{id:'fsub',text:'Revisión final',done:false}]}],tracking:{status:'thinking',taskDs:ds,startTime:window.followClock,sessionEndsAt:appTest.followTimeAt(ds,'23:59')}});
  });
  await page.locator('[data-action="follow-toggle"]').click();await page.locator('#followPlanModal.open').waitFor();await page.locator('[data-action="follow-later"]').click();
}

test('follow mobile checklist opts into subtasks, schedules an indefinite run and persists',async()=>withPage(async page=>{
  await seedFollowPage(page);await page.locator('.follow-picker summary').click();
  assert.equal(await page.locator('[data-action="follow-select"][data-key="task:ft"]').isChecked(),true);assert.equal(await page.locator('[data-action="follow-select"][data-key="sub:ft:fsub"]').isChecked(),false);
  await page.locator('[data-action="follow-select"][data-key="task:ft"]').uncheck();
  await page.locator('.follow-picker summary').click();await page.locator('[data-action="follow-select"][data-key="sub:ft:fsub"]').check();
  const form=page.locator('[data-action="follow-save"][data-key="sub:ft:fsub"]');await form.locator('[name="time"]').fill('10:01');await form.locator('button[type="submit"]').click();
  assert.match(await page.locator('.follow-entry').innerText(),/sin límite/);
  await page.evaluate(()=>{window.followClock=appTest.followTimeAt(appTest.todayStr(),'10:01');appTest.followTick();});
  assert.equal(await page.evaluate(()=>appTest.state.tracking.subtaskId),'fsub');assert.equal(await page.evaluate(()=>appTest.state.tracking.targetLimit),null);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.setViewportSize({width:320,height:780});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>appTest.persist());await page.reload();await page.evaluate(()=>{window.followClock=appTest.followTimeAt(appTest.todayStr(),'10:02');appTest.setNow(()=>window.followClock);appTest.init();});await page.waitForFunction(()=>appTest.ready);
  assert.equal(await page.evaluate(()=>appTest.followState().days[appTest.followToday()].entries['sub:ft:fsub'].selected),true);
  assert.equal(await page.evaluate(()=>appTest.followState().days[appTest.followToday()].entries['task:ft'].selected),false);
}));

test('follow asks for confirmation at 30 minutes and accepts an edited time before the 15 minute notice',async()=>withPage(async page=>{
  await seedFollowPage(page);
  const form=page.locator('[data-action="follow-save"][data-key="task:ft"]');await form.locator('[name="time"]').fill('11:00');await form.locator('[name="duration"]').fill('20');await form.locator('button[type="submit"]').click();
  await page.evaluate(()=>{window.followNotifications=[];appTest.setFollowAlarm((id,message)=>window.followNotifications.push({id,message}));window.followClock=appTest.followTimeAt(appTest.todayStr(),'10:30');appTest.followTick();});
  await page.locator('#followPlanModal.open').waitFor();assert.match(await page.locator('#followPlanTitle').innerText(),/ejecutará/);
  await page.locator('#followPlanTime').fill('11:15');await page.locator('[data-action="follow-modal-save"] button[type="submit"]').click();
  assert.equal(await page.evaluate(()=>appTest.followState().days[appTest.followToday()].entries['task:ft'].time),'11:15');
  await page.evaluate(()=>{window.followClock=appTest.followTimeAt(appTest.todayStr(),'11:00');appTest.followTick();appTest.followTick();});
  assert.equal(await page.evaluate(()=>window.followNotifications.filter(n=>n.message.includes('Faltan 15')).length),1);
}));

test('follow closes a paused commitment once and displays its five coin penalty in the ledger',async()=>withPage(async page=>{
  await seedFollowPage(page);
  await page.evaluate(()=>{
    const ds=appTest.followToday();appTest.saveFollowPlan('task:ft','10:01','');window.followClock=appTest.followTimeAt(ds,'10:01');appTest.followTick();appTest.pauseTask();appTest.setFollowEnabled(false);window.followClock=appTest.followTimeAt(appTest.addDays(ds,1),'00:01');appTest.settleFollowDays();appTest.settleFollowDays();
  });
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),15);
  await page.locator('[data-tab="evidencias"]').click();await page.locator('[data-view="monedas"]').click();await page.waitForFunction(()=>document.querySelector('#evGalleryContainer').textContent.includes('penalización 5'));
  assert.equal(await page.evaluate(()=>appTest.state.coins.ledger.filter(t=>t.kind==='follow-penalty').length),1);
}));

async function installBrowserGoogleMock(page,context){
  await context.route('https://www.googleapis.com/oauth2/v3/userinfo',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({email:'player@example.test'})}));
  await page.evaluate(()=>{
    window.googleRequests=[];window.googleConfigs=[];window.googleRevokes=[];
    window.google={accounts:{oauth2:{initTokenClient(config){window.googleConfigs.push(config);return {requestAccessToken(options){window.googleRequests.push({options,userGesture:navigator.userActivation.isActive});}};},hasGrantedAllScopes(){return true;},revoke(token){window.googleRevokes.push(token);}}}};
  });
}

test('Drive reconnect on mobile opens once from the button, survives popup errors and preserves local data',async()=>withPage(async(page,context)=>{
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:73.5},oneoff:[{id:'keep',text:'No perder mi tarea',date:appTest.todayStr()}]});});await installBrowserGoogleMock(page,context);
  await page.locator('[data-tab="estadisticas"]').click();await page.locator('#btnDriveAuth').click();
  assert.equal(await page.evaluate(()=>window.googleRequests.length),1);assert.equal(await page.evaluate(()=>window.googleRequests[0].userGesture),true);assert.equal(await page.locator('#btnDriveAuth').isDisabled(),true);
  await page.evaluate(()=>{appTest.handleAuthClick(null);window.googleConfigs[0].error_callback({type:'popup_closed'});});
  await page.waitForFunction(()=>!appTest.authAttempt);assert.equal(await page.locator('#btnDriveAuth').isDisabled(),false);assert.match(await page.locator('#backupStatus').innerText(),/Chrome/);
  await page.locator('#btnDriveAuth').click();await page.evaluate(()=>window.googleConfigs[1].callback({access_token:'browser-token',expires_in:3600}));
  await page.waitForFunction(()=>!appTest.identityPending);assert.match(await page.locator('#driveAuthLabel').innerText(),/Conectado/);
  await page.evaluate(()=>window.googleConfigs[0].error_callback({type:'popup_closed'}));assert.equal(await page.evaluate(()=>appTest.authToken),'browser-token');assert.equal(await page.evaluate(()=>window.googleRequests.length),2);
  assert.equal(await page.evaluate(()=>appTest.state.coins.balance),73.5);assert.equal(await page.evaluate(()=>appTest.state.oneoff[0].text),'No perder mi tarea');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
}));

test('expired Drive access stays local and navigation or background events open no Google dialogs',async()=>withPage(async(page,context)=>{
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:73.5}});});await installBrowserGoogleMock(page,context);
  await page.evaluate(()=>{localStorage.setItem('bitacora_drive_session',JSON.stringify({email:'player@example.test',accessToken:'expired',tokenExpiry:Date.now()-1000}));appTest.restoreAuthForTest();document.dispatchEvent(new Event('visibilitychange'));appTest.silentTokenRenew();});
  await page.locator('[data-tab="estadisticas"]').click();assert.match(await page.locator('#driveAuthLabel').innerText(),/caducado/);assert.equal(await page.evaluate(()=>window.googleRequests.length),0);
  await page.locator('[data-tab="hoy"]').click();await page.locator('[data-tab="estadisticas"]').click();assert.equal(await page.evaluate(()=>window.googleRequests.length),0);
  await page.locator('#btnDriveAuth').click();assert.equal(await page.evaluate(()=>window.googleRequests.length),1);assert.notEqual(await page.evaluate(()=>window.googleRequests[0].options.prompt),'consent');
}));

test('Drive upload waits for one successful authorization and resumes the pending operation once',async()=>withPage(async(page,context)=>{
  let uploads=0;
  await context.route('https://www.googleapis.com/drive/v3/files?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({files:[]})}));
  await context.route('https://www.googleapis.com/upload/drive/v3/files?*',route=>{uploads++;return route.fulfill({contentType:'application/json',body:JSON.stringify({id:'fake-backup',modifiedTime:'2026-11-17T23:00:00Z'})});});
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:73.5}});});await installBrowserGoogleMock(page,context);await page.locator('[data-tab="estadisticas"]').click();
  await page.locator('#btnDriveSync').click();await page.locator('#btnDriveSync').click();assert.equal(await page.evaluate(()=>window.googleRequests.length),1);assert.equal(uploads,0);
  await page.evaluate(()=>window.googleConfigs[0].callback({access_token:'upload-token',expires_in:3600}));
  await page.waitForFunction(()=>!appTest.dirty);assert.equal(uploads,1);assert.match(await page.locator('#backupStatus').innerText(),/confirmado/);assert.equal(await page.evaluate(()=>appTest.state.coins.balance),73.5);
}));

test('Drive authorization persists across reload without opening another consent window',async()=>withPage(async(page,context)=>{
  await page.evaluate(async()=>{await appTest.seed({coins:{balance:73.5}});});await installBrowserGoogleMock(page,context);
  await page.locator('[data-tab="estadisticas"]').click();await page.locator('#btnDriveAuth').click();await page.evaluate(()=>window.googleConfigs[0].callback({access_token:'reload-token',expires_in:3600}));await page.waitForFunction(()=>!appTest.identityPending);
  await page.reload();await installBrowserGoogleMock(page,context);await page.evaluate(()=>appTest.init());await page.waitForFunction(()=>appTest.ready);await page.locator('[data-tab="estadisticas"]').click();
  assert.equal(await page.evaluate(()=>appTest.authToken),'reload-token');assert.equal(await page.evaluate(()=>window.googleRequests.length),0);assert.match(await page.locator('#driveAuthLabel').innerText(),/Conectado/);
}));
