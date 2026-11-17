const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {IDBFactory} = require('fake-indexeddb');
const source = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');

function openApp(){
  const dom=new JSDOM(source,{url:'https://bitacora.test/',runScripts:'outside-only',pretendToBeVisual:true});
  const w=dom.window;
  w.indexedDB=new IDBFactory();w.structuredClone=structuredClone;
  w.fetch=async()=>{throw new Error('External requests disabled in tests');};
  w.AbortController=AbortController;w.Response=Response;w.alert=()=>{};w.confirm=()=>true;w.prompt=()=>null;
  const script=[...w.document.querySelectorAll('script')].at(-1).textContent;
  w.eval(script.replace('  /* ===================== Arranque ===================== */\n  init();',`
    window.api={
      init,initDB,defaultState,persist,storageGet,storageSet,dbSet,dbGet,dbReadAllWithCursor,
      handleAuthClick,ensureToken,requestDriveAuthorization,restoreDriveAuthorization,expireDriveAuthorization,driveTokenValid,silentTokenRenew,saveDriveSession,loadDriveSession,fetchDrive,disconnectDrive,failDriveAuthAttempt,
    get authAttempt(){return driveAuthAttempt;},get authToken(){return driveAccessToken;},get authExpiry(){return driveTokenExpiry;},get authEmail(){return driveUserEmail;},get identityPending(){return driveIdentityPending;},
    restoreAuthForTest(){driveSessionLoaded=false;restoreDriveAuthorization();},
    setFollowAlarm(fn){fireDeadlineAlarm=fn;},
    followToday,followState,followKey,syncFollowDay,setFollowEnabled,selectFollowEntry,saveFollowPlan,followTick,settleFollowDays,followEntryDone,followTimeAt,startFollowEntry,collectFollowPenalties,validateFollowState,openFollowPrompt,closeFollowPrompt,confirmFollowTime,pauseTask,
    loanQuote,loanState,requestLoan,repayLoan,canRepayLoan,validateLoans,commitLoanSnapshot,
      setLoanCommit(fn){commitLoanSnapshot=fn;},
      parseDriveArchiveLink,validArchiveDate,archiveEntries,filteredArchiveEntries,saveArchiveEntry,editArchiveEntry,deleteArchiveEntry,openArchivePreview,closeArchivePreview,computeBackupRichness,
    validateBackup,buildMasterBackupJSON,importMasterBackup,commitRestoredBackup,saveRecoveryPoint,
      uploadDriveBackup,autoRestoreFromDrive,keepLocalDriveVersion,periodSummary,openAIPlanPreview,validateAIPlan,
      generateAIPlan,todayStr,addDays,render,renderEstadisticas,resetAll,showRecoveryPoints,
      WELCOME_PACKS,welcomeAvailability,claimWelcomePack,renderWelcomeRewards,
      creditCompletionCoins,creditTaskCoins,completionTask,autoMarkSubtaskDone,
      tickCoins,updateLiveTimers,flushTime,getThinkingLiveSeconds,getTaskLiveSeconds,renderMasterSwitch,useRpgItem,useBooster,checkDeadlineAlarms,enableAlarm,taskCoinAmount,openEditEvidenceModal,openViewEvidenceModal,saveEvidence,addCoins,buyShopItem,
      setNow(fn){nowMs=fn;},
      setWelcomeDay(fn){welcomeDay=fn;},setWelcomeCommit(fn){commitWelcomeGrant=fn;},
      rpgState,xpForLevel,getLevelFromXp,addXp,getHabitDailyReward,payHabitStreakReward,habitStreak,checkHabitShields,triggerTraversalAudit,buyRpgItem,useCondenser,consumeReroll,useCoin,openShopModal,toggleDifficulty,markDone,unmarkDone,earnFromTaskSeconds,playTask,nowMs,
      get state(){return state;},get dirty(){return bitacora_needs_sync;},get ready(){return dataReady;},
      get revision(){return localRevision;},get conflict(){return syncConflict;},get saveFailed(){return localSaveFailed;},
      async seed(patch={}){await initDB();state=Object.assign(defaultState(),patch);state.tracking.autoStartEnabled=false;dataReady=true;await persist();render();},
      setStorage(fn){storageSet=fn;},setCommit(fn){commitRestoredBackup=fn;},
      setDrive(known){driveAccessToken='test-token';driveTokenExpiry=Date.now()+3600000;if(known)setKnownRemoteModTime(known);else localStorage.removeItem(DRIVE_KNOWN_MODTIME_KEY);},
      clean(){markSyncComplete(localRevision);},setKey(key){setGroqKey(key);},
      showStats(){activeTab='estadisticas';render();},setStatsOffset(n){statsOffsetDays=n;},
      async points(){return await dbGetAppData(RECOVERY_KEY)||[];}
    };
  `).replace('setTimeout(function(){ window.location.reload(); }, 1200);','/* No navigation in unit tests. */'));
  return {dom,w,a:w.api,close:()=>w.close()};
}
async function fixture(fn){const app=openApp();try{await fn(app);}finally{app.close();}}
const plain=value=>JSON.parse(JSON.stringify(value));
const wait=()=>new Promise(r=>setTimeout(r,15));

test('startup and task submission preserve existing mobile controls and persist across reload',()=>fixture(async({w,a})=>{
  a.init();while(!a.ready)await wait();a.state.tracking.autoStartEnabled=false;
  const form=w.document.querySelector('form[data-action="add-task"]');form.elements.text.value='Lectura en familia';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await a.persist();
  assert.equal(JSON.parse(await a.storageGet('bitacora-app-data')).oneoff[0].text,'Lectura en familia');
  for(const tab of ['calendario','habitos','proyectos','estadisticas','evidencias','hoy']){
    w.document.querySelector(`[data-tab="${tab}"]`).click();assert.ok(w.document.querySelector('#app').textContent.trim());
  }
  assert.ok(w.document.querySelector('[data-action="open-class-recorder"]'));
  assert.ok(w.document.querySelector('[data-action="toggle-master"]'));
  const task=w.document.querySelector('form[data-action="add-task"]'), focus=w.document.querySelector('.master-switch-panel');
  assert.ok(focus.compareDocumentPosition(task)&w.Node.DOCUMENT_POSITION_FOLLOWING);
  a.init();await wait();assert.match(w.document.querySelector('#app').textContent,/Lectura en familia/);
}));

test('corrupt startup data is neither replaced nor silently reset',()=>fixture(async({w,a})=>{
  await a.initDB();await a.storageSet('bitacora-app-data','{broken');a.init();await wait();
  assert.equal(a.ready,false);assert.equal(await a.storageGet('bitacora-app-data'),'{broken');assert.match(w.document.querySelector('#app').textContent,/No se pudo abrir/);
}));

test('local save failure remains pending and backup exports latest memory',()=>fixture(async({a})=>{
  await a.seed();a.setStorage(async()=>false);a.state.oneoff.push({id:'unsaved',text:'No perder',date:a.todayStr()});
  assert.equal(await a.persist(),false);assert.equal(a.dirty,true);assert.equal(a.saveFailed,true);
  assert.equal((await a.buildMasterBackupJSON()).state.oneoff[0].text,'No perder');
}));

test('legacy evidence with null note is valid; secrets never enter backup or recovery points',()=>fixture(async({a})=>{
  await a.seed({groqApiKey:'not-for-export'});a.setKey('session-only');
  await a.dbSet('2026-11-13_t1',JSON.stringify({note:null,image:null,taskName:'Foto'}));
  const backup=await a.buildMasterBackupJSON();assert.equal(Object.keys(a.validateBackup(backup)).length,1);
  assert.doesNotMatch(JSON.stringify(backup),/not-for-export|session-only/);assert.equal(a.state.groqApiKey,'not-for-export');
  await a.saveRecoveryPoint('Prueba');assert.doesNotMatch(JSON.stringify(await a.points()),/not-for-export|session-only/);
}));

test('invalid, incomplete and future backups are rejected before any data changes',()=>fixture(async({w,a})=>{
  await a.seed({oneoff:[{id:'keep',text:'Conservar',date:a.todayStr()}]});const valid=await a.buildMasterBackupJSON(),before=JSON.stringify(a.state);
  const cases=[{}, {state:[]}, {...valid,state:{...valid.state,habits:'bad'}}, {...valid,_meta:{...valid._meta,totalEvidenceKeys:7}}, {...valid,state:{...valid.state,projects:[{id:'p',text:'bad',tasks:'wrong'}]}}, {...valid,_meta:{version:999}}, {...valid,state:{...valid.state,tracking:[]}}];
  for(const data of cases)assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(data)],'bad.json')),false);
  assert.equal(JSON.stringify(a.state),before);assert.equal((await a.points()).length,0);
}));

test('aborting atomic restore after clear rolls back photos and state together',()=>fixture(async({a})=>{
  await a.seed({oneoff:[{id:'keep',text:'Antes',date:a.todayStr()}]});await a.dbSet('old',JSON.stringify({note:'Foto antigua',image:null}));
  const {IDBObjectStore}=require('fake-indexeddb');const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(this.name==='appData'&&key==='bitacora-app-data'){this.transaction.abort();throw new Error('simulated quota failure');}return original.call(this,value,key);};
  try{await assert.rejects(a.commitRestoredBackup(a.defaultState(),{new:JSON.stringify({note:'nueva'})}));}finally{IDBObjectStore.prototype.put=original;}
  await wait();assert.equal(JSON.parse(await a.storageGet('bitacora-app-data')).oneoff[0].text,'Antes');assert.equal(JSON.parse(await a.dbGet('old')).note,'Foto antigua');assert.equal(await a.dbGet('new'),null);
}));

test('restore with no evidence clears previous photos atomically',()=>fixture(async({a})=>{
  await a.seed();await a.dbSet('old',JSON.stringify({note:null,image:null}));await a.commitRestoredBackup(a.defaultState(),{});
  assert.deepEqual(plain(await a.dbReadAllWithCursor()),{});
}));

test('recovery retains latest three complete snapshots',()=>fixture(async({a})=>{
  await a.seed();await a.dbSet('photo',JSON.stringify({note:'Foto',image:null}));
  for(let i=0;i<4;i++)await a.saveRecoveryPoint('Punto '+i);
  const points=await a.points();assert.deepEqual(plain(points.map(p=>p.reason)),['Punto 3','Punto 2','Punto 1']);assert.equal(Object.keys(a.validateBackup(points[0].backup)).length,1);
}));

test('failed restore preserves local state and known Drive version',()=>fixture(async({w,a})=>{
  await a.seed({oneoff:[{id:'keep',text:'Original',date:a.todayStr()}]});a.setDrive('known');
  const backup=await a.buildMasterBackupJSON();backup.state.oneoff=[];a.setCommit(async()=>{throw new Error('quota failure');});
  assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(backup)],'restore.json'),{remoteModTime:'new'}),false);
  assert.equal(a.state.oneoff[0].text,'Original');assert.equal(w.localStorage.getItem('bitacora_drive_known_modtime'),'known');assert.equal((await a.points()).length,1);assert.equal(w.isImportingBackup,false);
}));

test('cancelled restore neither acknowledges Drive nor creates a recovery snapshot',()=>fixture(async({w,a})=>{
  await a.seed();a.setDrive('known');w.confirm=()=>false;const backup=await a.buildMasterBackupJSON();
  assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(backup)],'restore.json'),{remoteModTime:'new'}),false);
  assert.equal(w.localStorage.getItem('bitacora_drive_known_modtime'),'known');assert.equal((await a.points()).length,0);
}));

test('Drive conflict refuses upload and auto-restore, retaining local changes',()=>fixture(async({w,a})=>{
  await a.seed({oneoff:[{id:'keep',text:'Solo local',date:a.todayStr()}]});a.setDrive('old');const methods=[];
  w.fetch=async(url,opts={})=>{methods.push(opts.method||'GET');return new Response(JSON.stringify({files:[{id:'r',modifiedTime:'new'}]}),{status:200});};
  assert.equal(await a.uploadDriveBackup(true),false);assert.equal(await a.autoRestoreFromDrive({id:'r',modifiedTime:'new'}),false);
  assert.deepEqual(methods,['GET']);assert.equal(a.state.oneoff[0].text,'Solo local');assert.equal(a.dirty,true);assert.ok(a.conflict);assert.equal((await a.points()).length,1);
}));

test('unknown remote version, metadata failures and duplicate remote files never cause overwrite',async()=>{
  for(const mode of ['unknown','error','duplicate'])await fixture(async({w,a})=>{
    await a.seed();a.setDrive(mode==='unknown'?null:'v1');let writes=0;
    w.fetch=async(url,opts={})=>{if(opts.method)writes++;return new Response(JSON.stringify({files:mode==='duplicate'?[{id:'a'},{id:'b'}]:[{id:'r',modifiedTime:'v1'}]}),{status:mode==='error'?500:200});};
    assert.equal(await a.uploadDriveBackup(true),false);assert.equal(writes,0);assert.equal(a.dirty,true);
  });
});

test('upload never clears changes made while it was in flight or starts a duplicate',()=>fixture(async({w,a})=>{
  await a.seed();a.setDrive('v1');let writes=0;
  w.fetch=async(url,opts={})=>{
    if(opts.method){writes++;assert.equal(await a.uploadDriveBackup(false),false);a.state.oneoff.push({id:'later',text:'Cambio durante subida',date:a.todayStr()});await a.persist();return new Response(JSON.stringify({id:'r',modifiedTime:'v2'}),{status:200});}
    return new Response(JSON.stringify({files:[{id:'r',modifiedTime:'v1'}]}),{status:200});
  };
  assert.equal(await a.uploadDriveBackup(true),true);assert.equal(writes,1);assert.equal(a.dirty,true);assert.equal(w.localStorage.getItem('bitacora_drive_known_modtime'),'v2');
}));

test('confirmed upload clears exactly the uploaded revision',()=>fixture(async({w,a})=>{
  await a.seed();a.setDrive('v1');w.fetch=async(url,opts={})=>new Response(JSON.stringify(opts.method?{id:'r',modifiedTime:'v2'}:{files:[{id:'r',modifiedTime:'v1'}]}),{status:200});
  assert.equal(await a.uploadDriveBackup(true),true);assert.equal(a.dirty,false);
}));

test('choosing the local version archives both versions before replacing Drive',()=>fixture(async({w,a})=>{
  await a.seed({oneoff:[{id:'local',text:'Trabajo local',date:a.todayStr()}]});a.setDrive('old');
  const remote=await a.buildMasterBackupJSON();remote.state.oneoff=[{id:'remote',text:'Trabajo remoto',date:a.todayStr()}];let upload='';
  w.fetch=async(url,opts={})=>{
    if(opts.method){upload=opts.body;return new Response(JSON.stringify({id:'r',modifiedTime:'v2'}),{status:200});}
    if(String(url).includes('alt=media'))return new Response(JSON.stringify(remote),{status:200});
    return new Response(JSON.stringify({files:[{id:'r',modifiedTime:'v1'}]}),{status:200});
  };
  assert.equal(await a.keepLocalDriveVersion(),true);assert.match(upload,/Trabajo local/);assert.doesNotMatch(upload,/Trabajo remoto/);
  const points=await a.points();assert.equal(points[0].backup.state.oneoff[0].text,'Trabajo remoto');assert.equal(points[1].backup.state.oneoff[0].text,'Trabajo local');assert.equal(a.dirty,false);
}));

test('successful restore preserves previous snapshot and commits a valid empty backup',()=>fixture(async({w,a})=>{
  await a.seed({oneoff:[{id:'keep',text:'Antes de restaurar',date:a.todayStr()}]});await a.dbSet('photo',JSON.stringify({note:'Evidencia anterior',image:null}));
  const backup=await a.buildMasterBackupJSON();backup.state.oneoff=[];backup.evidenceByYear={};backup._meta.totalEvidenceKeys=0;
  assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(backup)],'restore.json'),{remoteModTime:'v2'}),true);
  assert.equal(a.state.oneoff.length,0);assert.deepEqual(plain(await a.dbReadAllWithCursor()),{});assert.equal((await a.points())[0].backup.state.oneoff[0].text,'Antes de restaurar');assert.equal(a.dirty,false);
}));

test('AI generation previews a validated proposal without adding it automatically',()=>fixture(async({w,a})=>{
  await a.seed({projects:[{id:'p',text:'Proyecto',status:'active',createdAt:a.todayStr(),deadline:a.addDays(a.todayStr(),7),tasks:[]}]});a.setKey('session-key');w.prompt=()=> 'Recursos disponibles';let chatCalls=0;
  w.fetch=async url=>new Response(JSON.stringify(String(url).endsWith('/models')?{data:[{id:'llama-3.3-70b-versatile'}]}:{choices:[{message:{content:++chatCalls===1?'¿Qué recursos tienes?':JSON.stringify({tasks:[{text:'Propuesta',subtasks:['Primer paso']}]})}}]}),{status:200});
  const button=w.document.createElement('button');button.textContent='Planificar';await a.generateAIPlan('p',button);
  assert.ok(w.document.getElementById('aiPlanPreview'));assert.equal(a.state.projects[0].tasks.length,0);assert.equal(button.disabled,false);assert.equal(w.sessionStorage.getItem('bitacora_groq_key'),'session-key');
}));

test('temporary AI errors preserve credentials and project data',()=>fixture(async({w,a})=>{
  await a.seed({projects:[{id:'p',text:'Proyecto',status:'active',createdAt:a.todayStr(),deadline:a.addDays(a.todayStr(),7),tasks:[]}]});a.setKey('session-key');
  w.fetch=async()=>new Response('{}',{status:429});const button=w.document.createElement('button');button.textContent='Planificar';await a.generateAIPlan('p',button);
  assert.equal(w.sessionStorage.getItem('bitacora_groq_key'),'session-key');assert.equal(a.state.projects[0].tasks.length,0);assert.equal(button.disabled,false);
}));

test('period stats count real task time once and project completions by date',()=>fixture(async({w,a})=>{
  const today=a.todayStr(),prior=a.addDays(today,-1);
  await a.seed({firstUseDate:prior,habits:[{id:'h',text:'Hábito',createdAt:prior}],oneoff:[{id:'o',text:'Tarea',date:today}],
    log:{[prior]:{h:true},[today]:{h:true,o:true}},timeLog:{[today]:{thinking:60,tasks:{o:120},subtasks:{sub:120},bonus:{o:120}}},
    projects:[{id:'p',text:'Proyecto',status:'completed',createdAt:prior,completedAt:today,tasks:[{id:'pt',text:'Paso',done:true,doneAt:today}]}]});
  const result=a.periodSummary(prior,today);assert.equal(result.taskSeconds,120);assert.equal(result.thinkingSeconds,60);assert.equal(result.rate,100);assert.equal(result.oneoffDone,1);assert.equal(result.projectTasksDone,1);assert.equal(result.projectsDone,1);
  a.showStats();for(const days of [30,90,7]){w.document.querySelector(`[data-action="stats-period"][data-days="${days}"]`).click();assert.equal(w.document.querySelector(`[data-days="${days}"]`).getAttribute('aria-pressed'),'true');}
}));

test('AI preview safely edits, deselects, deduplicates and saves only selected tasks',()=>fixture(async({w,a})=>{
  await a.seed({projects:[{id:'p',text:'Proyecto',status:'active',createdAt:a.todayStr(),deadline:a.addDays(a.todayStr(),7),tasks:[{id:'existing',text:'Ya existe',done:false}]}]});
  a.openAIPlanPreview('p',[{text:'Ya existe',subtasks:[]},{text:'<img src=x onerror=alert(1)>',subtasks:['Paso']},{text:'No incluir',subtasks:[]}]);
  const modal=w.document.getElementById('aiPlanPreview');assert.equal(modal.querySelector('img'),null);assert.equal(a.state.projects[0].tasks.length,1);
  modal.querySelector('#ai-text-1').value='Tarea revisada';modal.querySelector('#ai-subs-1').value='Uno\nDos';modal.querySelector('#ai-include-2').checked=false;
  modal.querySelector('button.primary').click();await wait();
  assert.equal(a.state.projects[0].tasks.length,2);assert.equal(a.state.projects[0].tasks[1].text,'Tarea revisada');assert.deepEqual(plain(a.state.projects[0].tasks[1].subtasks.map(s=>s.text)),['Uno','Dos']);
  assert.equal(w.document.getElementById('aiPlanPreview'),null);
}));

test('invalid and discarded AI plans leave project unchanged',()=>fixture(async({w,a})=>{
  await a.seed({projects:[{id:'p',text:'Proyecto',status:'active',tasks:[]}]});
  for(const plan of [{tasks:[]},{tasks:[{text:42}]},{tasks:[{text:'Bien',subtasks:[{}]}]}])assert.throws(()=>a.validateAIPlan(plan));
  a.openAIPlanPreview('p',[{text:'No guardar',subtasks:[]}]);w.document.querySelector('#aiPlanPreview .btn-secondary').click();assert.equal(a.state.projects[0].tasks.length,0);
}));

test('90-day calibrated schedule pays exactly 166 once, then forges permanently',()=>fixture(async({a})=>{
  const start=a.addDays(a.todayStr(),-89);await a.seed({habits:[{id:'h',text:'Hábito',createdAt:start}]});
  for(let day=1;day<=90;day++){
    const ds=a.addDays(start,day-1);a.state.log[ds]={h:true};a.payHabitStreakReward(ds,'h');
    const balance=a.state.coins.balance;a.payHabitStreakReward(ds,'h');assert.equal(a.state.coins.balance,balance);
  }
  assert.equal(a.state.coins.balance,166);assert.ok(a.state.rpg.forged.h);
  delete a.state.log[a.addDays(a.todayStr(),-1)];a.state.rpg.habitPaid={};a.payHabitStreakReward(a.todayStr(),'h');assert.equal(a.state.coins.balance,166);
  assert.equal(a.getHabitDailyReward(91),0);assert.equal(a.getHabitDailyReward(0),0);
  await a.persist();const saved=JSON.parse(await a.storageGet('bitacora-app-data'));assert.equal(saved.coins.balance,166);assert.ok(saved.rpg.forged.h);
}));

test('XP accumulates partial minutes exactly and uses rounded level thresholds',()=>fixture(async({a})=>{
  await a.seed();for(let i=0;i<60;i++)a.earnFromTaskSeconds(1);assert.equal(a.rpgState().xp,1);
  a.rpgState().damagedUntil=a.nowMs()+3600000;for(let i=0;i<60;i++)a.earnFromTaskSeconds(1);assert.equal(a.rpgState().xp,1.5);
  for(let lvl=2;lvl<=50;lvl++){const threshold=a.xpForLevel(lvl);assert.equal(a.getLevelFromXp(threshold),lvl);assert.equal(a.getLevelFromXp(threshold-1),lvl-1);}
}));

test('fractional balances cannot buy a one-coin break; level 10 shortens cooldown',()=>fixture(async({a})=>{
  await a.seed({coins:{balance:.5,progressSec:0},tracking:{status:'thinking',startTime:null}});a.useCoin();assert.equal(a.state.coins.balance,.5);assert.equal(a.state.coins.breakUntil,undefined);
  a.state.coins.balance=1;a.rpgState().xp=a.xpForLevel(10);a.rpgState().xpUnits=a.rpgState().xp*120;
  a.useCoin();assert.equal(a.state.coins.balance,0);assert.equal(a.state.coins.cooldownUntil-a.state.coins.breakUntil,480000);
}));

test('unified shop respects unlock levels, costs and all six items',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:50}});assert.equal(a.buyRpgItem('shield'),false);assert.equal(a.state.coins.balance,50);
  a.rpgState().xp=a.xpForLevel(5);assert.equal(a.buyRpgItem('shield'),true);assert.equal(a.state.coins.balance,45);assert.equal(a.rpgState().inv.shield,1);
  assert.equal(a.buyRpgItem('reroll'),true);assert.equal(a.consumeReroll(),true);assert.equal(a.consumeReroll(),false);
  a.openShopModal();assert.ok(w.document.querySelector('[data-commerce-view="shop"]'));assert.equal(w.document.querySelectorAll('[data-rpg-buy]').length,6);
}));

test('shields preserve yesterday streak without completion, payout or repeated consumption',()=>fixture(async({a})=>{
  const today=a.todayStr(),yesterday=a.addDays(today,-1),before=a.addDays(today,-2);
  await a.seed({firstUseDate:before,habits:[{id:'h',text:'Con racha',createdAt:before},{id:'empty',text:'Sin racha',createdAt:before}],log:{[before]:{h:true}}});
  a.rpgState().inv.shield=2;a.checkHabitShields();assert.equal(a.rpgState().inv.shield,1);assert.equal(a.habitStreak(a.state.habits[0]),2);
  assert.equal(a.state.log[yesterday],undefined);a.payHabitStreakReward(yesterday,'h');assert.equal((a.state.coins||{}).balance||0,0);
  a.checkHabitShields();assert.equal(a.rpgState().inv.shield,1);
}));

test('old condensers migrate once to boosters, preserve task time and double work coins only',()=>fixture(async({a})=>{
  let now=a.nowMs();a.setNow(()=>now);await a.seed({coins:{balance:20},tracking:{status:'task',targetLimit:600,startTime:null},rpg:{xp:0,inv:{condenser:3}}});
  assert.equal(a.rpgState().inv.booster,3);assert.equal(a.rpgState().inv.booster,3);
  assert.equal(a.useBooster(),true);assert.equal(a.state.tracking.targetLimit,600);assert.equal(a.useBooster(),false);assert.equal(a.rpgState().inv.booster,2);
  assert.equal(a.addCoins(1,'Tarea',true,{kind:'completion'}),2);assert.equal(a.addCoins(5,'Regalo',true,{kind:'welcome'}),5);
  now+=1800001;assert.equal(a.addCoins(1,'Tarea',true,{kind:'completion'}),1);
}));

test('audit penalizes only confirmed pending discipline failures once',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:12,progressSec:80}});a.rpgState().xp=a.xpForLevel(6);a.rpgState().xpUnits=a.rpgState().xp*120;
  a.state.tracking.needsAudit=true;w.confirm=()=>false;a.triggerTraversalAudit();assert.equal(a.state.coins.balance,12);assert.equal(a.getLevelFromXp(a.rpgState().xp),6);
  a.state.tracking.needsAudit=true;w.confirm=()=>true;const now=a.nowMs();a.triggerTraversalAudit();assert.equal(a.state.coins.balance,0);assert.equal(a.getLevelFromXp(a.rpgState().xp),5);assert.ok(a.rpgState().damagedUntil>=now+48*3600000);
  a.triggerTraversalAudit();assert.equal(a.getLevelFromXp(a.rpgState().xp),5);
}));

test('marking a habit twice does not duplicate its daily reward',()=>fixture(async({a})=>{
  const today=a.todayStr();await a.seed({habits:[{id:'h',text:'Hábito',createdAt:today}]});a.markDone(today,'h');a.unmarkDone(today,'h');a.markDone(today,'h');await a.persist();assert.equal(a.state.coins.balance,.5);
  const b=await a.buildMasterBackupJSON();assert.ok(a.validateBackup(b));assert.equal(b.state.rpg.habitPaid[today+'_h'],true);
}));

test('welcome week grants exactly 45 coins and distributed items over seven days',()=>fixture(async({a})=>{
  let day='2026-11-13';a.setWelcomeDay(()=>day);await a.seed();
  assert.equal(a.WELCOME_PACKS.reduce((sum,p)=>sum+p.coins,0),45);
  for(let n=1;n<=7;n++){
    day=a.addDays('2026-11-13',n-1);assert.equal(a.welcomeAvailability().next,n);
    assert.equal(await a.claimWelcomePack(n),true);assert.equal(await a.claimWelcomePack(n),false);
    if(n<7)assert.equal(await a.claimWelcomePack(n+1),false);
    assert.equal(a.rpgState().inv.booster,1,"Duplicador desde el día 1, sin repetirse el día 4");
  }
  assert.equal(a.state.coins.balance,45);assert.deepEqual(plain(a.rpgState().inv),{reroll:2,booster:1,shield:1,scroll:0,game:0,social:0});
  assert.equal(a.welcomeAvailability().complete,true);assert.equal(await a.claimWelcomePack(8),false);
  const backup=await a.buildMasterBackupJSON();assert.ok(a.validateBackup(backup));assert.equal(backup.state.rpg.starter.claims.length,7);
}));

test('missed days retain packs but never allow a bulk claim',()=>fixture(async({a})=>{
  let day='2026-11-13';a.setWelcomeDay(()=>day);await a.seed();a.rpgState();await a.persist();
  day='2026-11-20';assert.equal(await a.claimWelcomePack(7),false);assert.equal(await a.claimWelcomePack(1),true);
  assert.equal(await a.claimWelcomePack(2),false);day='2026-11-21';assert.equal(await a.claimWelcomePack(2),true);assert.equal(a.state.coins.balance,10);
}));

test('double click and failed saving never duplicate welcome grants',()=>fixture(async({a})=>{
  a.setWelcomeDay(()=>'2026-11-13');await a.seed();
  assert.deepEqual(await Promise.all([a.claimWelcomePack(1),a.claimWelcomePack(1)]),[true,false]);assert.equal(a.state.coins.balance,5);
  a.setWelcomeDay(()=>'2026-11-14');a.setWelcomeCommit(async()=>{throw new Error('simulated quota failure');});
  assert.equal(await a.claimWelcomePack(2),false);assert.equal(a.state.coins.balance,5);assert.equal(a.rpgState().inv.reroll,0);assert.equal(a.rpgState().starter.claims.length,1);
}));

test('welcome receipt survives reload and blocks same-day repeat claims',()=>fixture(async({a})=>{
  a.setWelcomeDay(()=>'2026-11-13');await a.seed();assert.equal(await a.claimWelcomePack(1),true);
  const saved=JSON.parse(await a.storageGet('bitacora-app-data'));await a.seed(saved);
  assert.equal(await a.claimWelcomePack(1),false);assert.equal(await a.claimWelcomePack(2),false);assert.equal(a.state.coins.balance,5);
}));

test('welcome backup validation rejects duplicate days, future packs and invalid dates',()=>fixture(async({a})=>{
  a.setWelcomeDay(()=>'2026-11-13');await a.seed();a.rpgState();const backup=await a.buildMasterBackupJSON();
  for(const claims of [[{day:2,claimedOn:'2026-11-14'}],[{day:1,claimedOn:'2026-11-13'},{day:2,claimedOn:'2026-11-13'}],[{day:1,claimedOn:'not-a-date'}]]){
    backup.state.rpg.starter.claims=claims;assert.throws(()=>a.validateBackup(backup));
  }
}));

test('coin break turns locomotive off, freezes thinking time and resumes only after expiry',()=>fixture(async({a})=>{
  let now=a.nowMs();a.setNow(()=>now);const ds=a.todayStr();
  await a.seed({coins:{balance:2,progressSec:0},timeLog:{[ds]:{thinking:10,tasks:{}}},tracking:{status:'thinking',startTime:now-1000,sessionEndsAt:now+3600000}});
  a.useCoin();const before=a.getThinkingLiveSeconds(ds),until=a.state.coins.breakUntil,sessionEnd=a.state.tracking.sessionEndsAt;
  assert.match(a.renderMasterSwitch(),/status-paused/);assert.match(a.renderMasterSwitch(),/Sistema apagado/);assert.doesNotMatch(a.renderMasterSwitch(),/status-thinking|data-live-master/);
  now+=120000;a.updateLiveTimers();a.flushTime();assert.equal(a.getThinkingLiveSeconds(ds),before);assert.equal(a.state.tracking.startTime,null);assert.equal(a.state.tracking.sessionEndsAt,sessionEnd);
  await a.persist();const saved=JSON.parse(await a.storageGet('bitacora-app-data'));await a.seed(saved);assert.match(a.renderMasterSwitch(),/status-paused/);
  now=until+1000;a.tickCoins();assert.equal(a.state.tracking.startTime,until);assert.match(a.renderMasterSwitch(),/status-thinking/);assert.equal(a.getThinkingLiveSeconds(ds),before+1);
}));

test('scroll and game passes stop execution for their full duration',async()=>{
  for(const kind of ['scroll','game'])await fixture(async({w,a})=>{
    let now=a.nowMs();a.setNow(()=>now);w.prompt=()=>'Permiso de prueba';const ds=a.todayStr();
    await a.seed({coins:{balance:20},tracking:{status:'task',taskId:'t',taskDs:ds,startTime:now-2000,sessionEndsAt:now+3600000},oneoff:[{id:'t',text:'Tarea',date:ds}]});
    a.buyShopItem(kind);a.useRpgItem(kind);assert.equal(a.state.coins.balance,14);const seconds=a.getTaskLiveSeconds(ds,'t');
    now+=300000;a.updateLiveTimers();assert.match(a.renderMasterSwitch(),/status-paused/);assert.equal(a.getTaskLiveSeconds(ds,'t'),seconds);assert.equal(a.getThinkingLiveSeconds(ds),0);
    assert.equal(a.state.tracking.taskId,null);assert.equal(a.state.tracking.startTime,null);
  });
});

test('a session that ends during free time does not restart when the permit expires',()=>fixture(async({a})=>{
  let now=a.nowMs();a.setNow(()=>now);await a.seed({coins:{balance:1},tracking:{status:'thinking',startTime:now,sessionEndsAt:now+60000}});
  a.useCoin();const until=a.state.coins.breakUntil;now+=61000;a.updateLiveTimers();assert.equal(a.state.tracking.status,'inactive');assert.match(a.renderMasterSwitch(),/status-paused/);
  now=until+1;a.tickCoins();assert.equal(a.state.tracking.status,'inactive');assert.equal(a.state.tracking.startTime,null);assert.doesNotMatch(a.renderMasterSwitch(),/status-thinking/);
}));

test('a scheduled task never backfills the paid break after restarting',()=>fixture(async({a})=>{
  let now=a.nowMs();a.setNow(()=>now);const ds=a.todayStr();
  await a.seed({coins:{balance:1},oneoff:[{id:'scheduled',text:'Tarea programada',date:ds}],reminders:{[ds+'|scheduled']:'00:00'},tracking:{status:'thinking',startTime:now,sessionEndsAt:now+3600000}});
  a.useCoin();const end=a.state.coins.breakUntil;now=end+1000;a.updateLiveTimers();
  assert.equal(a.state.tracking.status,'task');assert.ok(a.state.tracking.startTime>=end);assert.ok(a.getTaskLiveSeconds(ds,'scheduled')<=1.01);
}));

test('completion adds one coin independently of timed coins and never creates XP by itself',()=>fixture(async({a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo',date:ds}],log:{[ds]:{t:true}},timeLog:{[ds]:{thinking:0,tasks:{t:1800}}}});
  await a.dbSet(ds+'_t',JSON.stringify({note:'Resultado terminado',image:null}));
  assert.equal(await a.creditCompletionCoins(ds,'t'),1);assert.equal(a.state.coins.balance,1);assert.equal(a.rpgState().xp,0);
  a.creditTaskCoins(ds,'t');await wait();await a.persist();assert.equal(a.state.coins.balance,2);assert.equal(a.rpgState().xp,30);
  a.creditTaskCoins(ds,'t');await wait();assert.equal(a.state.coins.balance,2);assert.equal(a.rpgState().xp,30);
}));

test('subtasks share parent evidence and pay instead of the parent, including partial completion',()=>fixture(async({a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo por partes',date:ds,subtasks:[{id:'a',text:'Uno',done:true},{id:'b',text:'Dos',done:true},{id:'c',text:'Tres',done:false}]}]});
  await a.dbSet(ds+'_t',JSON.stringify({note:'Avance documentado',image:null}));
  assert.equal(await a.creditCompletionCoins(ds,'t'),2);assert.equal(a.state.log[ds],undefined);
  a.state.oneoff[0].subtasks[2].done=true;assert.equal(await a.creditCompletionCoins(ds,'t'),1);
  a.markDone(ds,'t');await wait();assert.equal(a.state.coins.balance,3);assert.equal(await a.creditCompletionCoins(ds,'t'),0);
}));

test('no evidence means no completion coin, then adding evidence settles completed subtasks once',()=>fixture(async({a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo',date:ds,subtasks:[{id:'a',text:'Uno',done:true}]}]});
  assert.equal(await a.creditCompletionCoins(ds,'t'),0);
  await a.dbSet(ds+'_t',JSON.stringify({note:'   ',image:null}));assert.equal(await a.creditCompletionCoins(ds,'t'),0);
  await a.dbSet(ds+'_t',JSON.stringify({note:null,image:'data:image/png;base64,YQ=='}));assert.equal(await a.creditCompletionCoins(ds,'t'),1);
  assert.equal(await a.creditCompletionCoins(ds,'t'),0);
}));

test('completion receipts survive reload and prevent repeat payout after rescheduling or remarking',()=>fixture(async({a})=>{
  const ds=a.todayStr(),before=a.addDays(ds,-1);await a.seed({oneoff:[{id:'t',text:'Trabajo',date:before}],log:{[before]:{t:true}}});
  await a.dbSet(before+'_t',JSON.stringify({note:'Terminado',image:null}));assert.equal(await a.creditCompletionCoins(before,'t'),1);
  const saved=JSON.parse(await a.storageGet('bitacora-app-data'));await a.seed(saved);
  a.state.oneoff[0].date=ds;a.state.log[ds]={t:true};assert.equal(await a.creditCompletionCoins(ds,'t'),0);
  a.unmarkDone(ds,'t');a.markDone(ds,'t');await wait();assert.equal(a.state.coins.balance,1);
  const backup=await a.buildMasterBackupJSON();assert.ok(a.validateBackup(backup));assert.ok(backup.state.coins.completionRewards['task:t'].paid.main);
}));

test('recurring subtasks pay separately by date and require that day’s parent evidence',()=>fixture(async({a})=>{
  const ds=a.todayStr(),before=a.addDays(ds,-1);await a.seed({habits:[{id:'h',text:'Hábito',createdAt:before,subtasks:[{id:'s',text:'Paso'}]}],log:{[before]:{s:true},[ds]:{s:true}}});
  await a.dbSet(before+'_h',JSON.stringify({note:'Ayer',image:null}));assert.equal(await a.creditCompletionCoins(before,'h'),1);assert.equal(await a.creditCompletionCoins(ds,'h'),0);
  await a.dbSet(ds+'_h',JSON.stringify({note:'Hoy',image:null}));assert.equal(await a.creditCompletionCoins(ds,'h'),1);assert.equal(a.state.coins.balance,2);
}));

test('changing between task and subtask modes cannot double the parent reward',async()=>{
  await fixture(async({a})=>{
    const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo',date:ds}],log:{[ds]:{t:true}}});await a.dbSet(ds+'_t',JSON.stringify({note:'Prueba'}));assert.equal(await a.creditCompletionCoins(ds,'t'),1);
    a.state.oneoff[0].subtasks=[{id:'s',text:'Nuevo paso',done:true}];assert.equal(await a.creditCompletionCoins(ds,'t'),0);assert.equal(a.state.coins.balance,1);
  });
  await fixture(async({a})=>{
    const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo',date:ds,subtasks:[{id:'s',text:'Paso',done:true}]}],log:{[ds]:{t:true}}});await a.dbSet(ds+'_t',JSON.stringify({note:'Prueba'}));assert.equal(await a.creditCompletionCoins(ds,'t'),1);
    a.state.oneoff[0].subtasks=[];assert.equal(await a.creditCompletionCoins(ds,'t'),0);assert.equal(a.state.coins.balance,1);
  });
});

test('simultaneous credits pay once and purchased permissions never pay',()=>fixture(async({a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Trabajo',date:ds},{id:'bought',text:'Permiso comprado',date:ds,purchased:true}],log:{[ds]:{t:true,bought:true}}});
  await a.dbSet(ds+'_t',JSON.stringify({note:'Prueba'}));await a.dbSet(ds+'_bought',JSON.stringify({note:'Prueba'}));
  const paid=await Promise.all([a.creditCompletionCoins(ds,'t'),a.creditCompletionCoins(ds,'t')]);assert.equal(paid.reduce((a,b)=>a+b,0),1);assert.equal(await a.creditCompletionCoins(ds,'bought'),0);assert.equal(a.state.coins.balance,1);
}));

test('project subtasks pay from the planning modal and do not require parent completion',()=>fixture(async({w,a})=>{
  const ds=a.todayStr();await a.seed({projects:[{id:'p',text:'Proyecto',createdAt:ds,deadline:a.addDays(ds,7),status:'active',tasks:[{id:'t',text:'Trabajo',done:false,subtasks:[{id:'s',text:'Paso',done:false}]}]}]});
  await a.dbSet(ds+'_t',JSON.stringify({note:'Avance'}));w.document.querySelector('[data-tab="proyectos"]').click();w.document.querySelector('[data-action="plan-project"]').click();
  w.document.querySelector('[data-action="toggle-proj-subtask-modal"]').click();await wait();assert.equal(a.state.coins.balance,1);assert.equal(a.state.projects[0].tasks[0].done,false);
}));

test('a project keeps its parent evidence reference when the first subtask is completed on another day',()=>fixture(async({a})=>{
  const ds=a.todayStr(),before=a.addDays(ds,-1);
  await a.seed({projects:[{id:'p',text:'Proyecto',createdAt:before,deadline:a.addDays(ds,7),status:'active',tasks:[{id:'t',text:'Trabajo',done:true,doneAt:before,subtasks:[{id:'s',text:'Paso',done:false}]}]}]});
  await a.dbSet(before+'_t',JSON.stringify({note:'Evidencia de la principal'}));assert.equal(await a.creditCompletionCoins(before,'t'),0);
  const parent=a.state.projects[0].tasks[0];parent.done=false;delete parent.doneAt;parent.subtasks[0].done=true;parent.subtasks[0].doneAt=ds;
  assert.equal(await a.creditCompletionCoins(ds,'t'),1);assert.equal(a.state.coins.balance,1);
}));

test('stocked passes charge only on purchase and ledger reconciles to opening balance',()=>fixture(async({w,a})=>{
  let now=a.nowMs();a.setNow(()=>now);await a.seed({coins:{balance:30}});
  assert.equal(a.buyRpgItem('scroll'),true);assert.equal(a.state.coins.balance,24);assert.equal(a.state.coins.breakUntil,undefined);
  assert.equal(a.useRpgItem('scroll'),false);assert.equal(a.rpgState().inv.scroll,1);
  a.state.tracking.status='thinking';a.state.tracking.sessionEndsAt=now+3600000;w.prompt=()=>null;
  assert.equal(a.useRpgItem('scroll'),false);assert.equal(a.rpgState().inv.scroll,1);
  w.prompt=()=>'Lectura';assert.equal(a.useRpgItem('scroll'),true);assert.equal(a.state.coins.balance,24);assert.equal(a.rpgState().inv.scroll,0);
  assert.equal(a.state.coins.ledgerOpeningBalance+a.state.coins.ledger.reduce((n,t)=>n+t.amount,0),24);
  assert.equal(a.state.coins.ledger.filter(t=>t.kind==='purchase').length,1);assert.equal(a.state.coins.ledger.filter(t=>t.kind==='item-use').length,1);
}));

test('alarm recovers expired break once without train audio and sounds session expiry',()=>fixture(async({w,a})=>{
  const tones=[];class Audio{constructor(){this.state='suspended';this.currentTime=0;this.destination={};}async resume(){this.state='running';}createOscillator(){return {frequency:{},connect(){},start(t){tones.push(t);},stop(){},disconnect(){}};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){}},connect(){}};}}
  w.AudioContext=Audio;let now=a.nowMs();a.setNow(()=>now);await a.seed({coins:{balance:1,breakUntil:now-1},tracking:{status:'thinking',startTime:null,sessionEndsAt:now+100000}});
  await a.enableAlarm();assert.ok(tones.length>=8);a.updateLiveTimers();const n=tones.length;a.updateLiveTimers();assert.equal(tones.length,n);
  assert.equal(Object.keys(a.state.alarm.fired).filter(k=>k.startsWith('break:')).length,1);
  now+=100001;a.updateLiveTimers();assert.equal(a.state.tracking.status,'inactive');assert.ok(Object.keys(a.state.alarm.fired).some(k=>k.startsWith('session:')));
}));

test('editing viewed evidence preserves image and original metadata and does not duplicate reward',()=>fixture(async({w,a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Tarea',date:ds}],log:{[ds]:{t:true}}});
  await a.dbSet(ds+'_t',JSON.stringify({taskName:'Tarea',note:'Antes',image:'data:image/png;base64,AA==',savedAt:'2026-01-01T00:00:00Z',custom:'preservar'}));
  await a.creditCompletionCoins(ds,'t');const balance=a.state.coins.balance;
  a.openViewEvidenceModal(ds,'t');await wait();assert.ok(w.document.querySelector('[data-action="edit-viewed-evidence"]'));
  w.document.querySelector('[data-action="edit-viewed-evidence"]').click();await wait();w.document.getElementById('evidenceNote').value='Antes y después';a.saveEvidence();await wait();await wait();
  const ev=JSON.parse(await a.dbGet(ds+'_t'));assert.equal(ev.note,'Antes y después');assert.equal(ev.image,'data:image/png;base64,AA==');assert.equal(ev.custom,'preservar');assert.equal(ev.savedAt,'2026-01-01T00:00:00Z');assert.equal(a.state.coins.balance,balance);
}));

test('Drive archive parses file, editor, published and folder links and preserves resource keys',()=>fixture(async({a})=>{
  await a.seed();
  for(const url of ['https://drive.google.com/file/d/photo_123/view?usp=sharing&resourcekey=0-secret','https://drive.google.com/open?id=photo_123&resourcekey=0-secret','https://drive.google.com/uc?export=download&id=photo_123&resourcekey=0-secret']){
    const link=a.parseDriveArchiveLink(url);assert.equal(link.id,'photo_123');assert.equal(link.url,'https://drive.google.com/file/d/photo_123/view?resourcekey=0-secret');assert.equal(link.previewUrl,'https://drive.google.com/file/d/photo_123/preview?resourcekey=0-secret');
  }
  assert.equal(a.parseDriveArchiveLink('https://docs.google.com/document/d/document_123/edit').previewUrl,'https://docs.google.com/document/d/document_123/preview');
  assert.equal(a.parseDriveArchiveLink('https://docs.google.com/spreadsheets/d/e/published_id/pubhtml').previewUrl,'https://docs.google.com/spreadsheets/d/e/published_id/pubhtml');
  assert.equal(a.parseDriveArchiveLink('https://drive.google.com/drive/u/0/folders/folder_123').kind,'folder');
  for(const url of ['javascript:alert(1)','http://drive.google.com/file/d/id/view','https://drive.google.com.evil.test/file/d/id/view','https://drive.google.com@evil.test/file/d/id/view','https://user@drive.google.com/file/d/id/view','https://drive.google.com/','https://docs.google.com/unknown/d/id/edit','https://drive.google.com/open?id=%22%3E%3Cscript%3E'])assert.equal(a.parseDriveArchiveLink(url),null,url);
}));

test('Archive saves, searches without accents, filters by date, edits and survives backup restoration',()=>fixture(async({w,a})=>{
  await a.seed();w.document.querySelector('[data-tab="evidencias"]').click();w.document.querySelector('[data-view="archivo"]').click();await wait();
  const form=w.document.querySelector('[data-action="archive-save"]');
  form.elements.archiveName.value='Álbum familiar';form.elements.archiveUrl.value='https://drive.google.com/file/d/family_photo/view?resourcekey=0-keep';form.elements.archiveDate.value='2026-10-20';assert.equal(await a.saveArchiveEntry(form),true);
  form.elements.archiveName.value='Factura';form.elements.archiveUrl.value='https://drive.google.com/file/d/invoice_file/view';form.elements.archiveDate.value='2026-11-01';assert.equal(await a.saveArchiveEntry(form),true);
  const search=w.document.getElementById('archiveSearch');search.value='album';search.dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal(w.document.querySelectorAll('.archive-card').length,1);
  const month=w.document.getElementById('evFilterMonth');month.value='2026-11';month.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.querySelectorAll('.archive-card').length,0);
  w.document.querySelector('[data-action="archive-clear-filters"]').click();assert.equal(w.document.querySelectorAll('.archive-card').length,2);
  const id=a.state.archiveLinks.find(x=>x.name==='Álbum familiar').id;a.editArchiveEntry(id);form.elements.archiveName.value='Foto familiar ampliada';assert.equal(await a.saveArchiveEntry(form),true);assert.equal(a.state.archiveLinks.length,2);
  const saved=JSON.parse(await a.storageGet('bitacora-app-data'));assert.equal(saved.archiveLinks.length,2);
  const backup=await a.buildMasterBackupJSON();assert.doesNotThrow(()=>a.validateBackup(backup));assert.equal(a.computeBackupRichness(backup).archive,2);
  const copy=plain(backup.state);a.state.archiveLinks=[];assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(backup)],'archivo.json')),true);assert.equal(a.state.archiveLinks.find(x=>x.id===id).name,'Foto familiar ampliada');
  const old=plain(backup);delete old.state.archiveLinks;assert.doesNotThrow(()=>a.validateBackup(old));
}));

test('Archive validates backups and prevents malformed or active-content links',()=>fixture(async({a})=>{
  await a.seed();const backup=await a.buildMasterBackupJSON(),stamp='2026-11-16T12:00:00Z';
  const item={id:'file1',name:'Documento',url:'https://drive.google.com/file/d/file123/view',date:'2026-11-16',createdAt:stamp,updatedAt:stamp};
  backup.state.archiveLinks=[item];assert.doesNotThrow(()=>a.validateBackup(backup));
  for(const change of [{url:'javascript:alert(1)'},{date:'2026-02-30'},{name:' '},{createdAt:'invalid'}]){
    const invalid=plain(backup);invalid.state.archiveLinks[0]=Object.assign({},item,change);assert.throws(()=>a.validateBackup(invalid),/Archivo/);
  }
  backup.state.archiveLinks.push(item);assert.throws(()=>a.validateBackup(backup),/Archivo/);
}));

test('Archive preview escapes names, clears the embedded frame on close and removes only local link',()=>fixture(async({w,a})=>{
  const stamp=new Date().toISOString();await a.seed({archiveLinks:[{id:'xss',name:'<img src=x onerror=alert(1)>',url:'https://drive.google.com/file/d/private_file/view?resourcekey=0-safe',date:'2026-11-16',createdAt:stamp,updatedAt:stamp}]});
  w.document.querySelector('[data-tab="evidencias"]').click();w.document.querySelector('[data-view="archivo"]').click();await wait();
  assert.equal(w.document.querySelectorAll('.archive-card img').length,0);a.openArchivePreview('xss');
  assert.equal(w.document.querySelector('#archiveViewerTitle').textContent,'<img src=x onerror=alert(1)>');assert.match(w.document.querySelector('#archiveViewerContent iframe').src,/resourcekey=0-safe/);
  a.closeArchivePreview();assert.equal(w.document.querySelector('#archiveViewerContent iframe'),null);
  w.confirm=()=>false;assert.equal(await a.deleteArchiveEntry('xss'),false);assert.equal(a.state.archiveLinks.length,1);
  w.confirm=()=>true;assert.equal(await a.deleteArchiveEntry('xss'),true);assert.equal(a.state.archiveLinks.length,0);
}));

test('Archive saving failure keeps form values and retry updates the same record',()=>fixture(async({w,a})=>{
  await a.seed();w.document.querySelector('[data-tab="evidencias"]').click();w.document.querySelector('[data-view="archivo"]').click();
  const form=w.document.querySelector('[data-action="archive-save"]');form.elements.archiveName.value='No perder';form.elements.archiveUrl.value='https://drive.google.com/file/d/no_perder/view';
  a.setStorage(async()=>false);assert.equal(await a.saveArchiveEntry(form),false);assert.equal(form.elements.archiveName.value,'No perder');assert.equal(a.state.archiveLinks.length,1);
  assert.equal(await a.saveArchiveEntry(form),false);assert.equal(a.state.archiveLinks.length,1);
}));


test('loans quote 1 to 100 whole coins with proportional one-time interest and reject invalid amounts',()=>fixture(async({a})=>{
  await a.seed();
  for(const [amount,interest,total] of [[1,.1,1.1],[10,1,11],[25,2.5,27.5],[100,10,110]]){
    assert.deepEqual(plain(a.loanQuote(amount)),{principal:amount,rate:10,interest,total});
  }
  for(const amount of [0,-1,101,1.5,NaN,Infinity,'100',null]){assert.equal(a.loanQuote(amount),null);assert.equal(await a.requestLoan(amount),false);}
  assert.equal(a.state.coins.balance,0);assert.equal(a.loanState().active,null);
}));

test('a loan credits the full principal only once, ignores booster and XP, and blocks a second debt',()=>fixture(async({a})=>{
  await a.seed({coins:{balance:2}});a.rpgState().inv.booster=1;a.useBooster();await a.persist();
  const xp=a.rpgState().xp;
  const results=await Promise.all([a.requestLoan(100),a.requestLoan(100)]);
  assert.equal(results.filter(Boolean).length,1);assert.equal(a.state.coins.balance,102);assert.equal(a.rpgState().xp,xp);
  assert.equal(a.loanState().active.total,110);assert.equal(await a.requestLoan(1),false);
  const loans=a.state.coins.ledger.filter(t=>t.kind==='loan-credit');assert.equal(loans.length,1);assert.equal(loans[0].amount,100);
  assert.equal(a.state.coins.ledgerOpeningBalance+a.state.coins.ledger.reduce((n,t)=>n+t.amount,0),102);
}));

test('manual repayment preserves a coin, charges principal and interest once, then unlocks borrowing',()=>fixture(async({a})=>{
  await a.seed({coins:{balance:0}});assert.equal(await a.requestLoan(100),true);const id=a.loanState().active.id;
  assert.equal(await a.repayLoan(id),false);assert.equal(a.state.coins.balance,100);
  a.addCoins(10,'Trabajo',true);await a.persist();assert.equal(a.canRepayLoan(),false);assert.equal(await a.repayLoan(id),false);
  a.addCoins(1,'Trabajo',true);await a.persist();assert.equal(a.canRepayLoan(),true);
  const result=await Promise.all([a.repayLoan(id),a.repayLoan(id)]);assert.equal(result.filter(Boolean).length,1);
  assert.equal(a.state.coins.balance,1);assert.equal(a.loanState().active,null);assert.equal(a.loanState().history.length,1);
  assert.equal(a.loanState().history[0].interest,10);assert.equal(a.state.coins.ledger.filter(t=>t.kind==='loan-repayment')[0].amount,-110);
  assert.equal(await a.repayLoan(id),false);assert.equal(await a.requestLoan(25),true);assert.equal(a.state.coins.balance,26);
  assert.equal(a.loanState().active.total,27.5);
}));

test('loan interest stays fixed over time and survives persisted state and backup restore',()=>fixture(async({w,a})=>{
  let now=a.nowMs();a.setNow(()=>now);await a.seed({coins:{balance:7}});assert.equal(await a.requestLoan(25),true);
  const id=a.loanState().active.id;now+=365*86400000;assert.equal(a.loanState().active.total,27.5);
  const saved=JSON.parse(await a.storageGet('bitacora-app-data'));assert.equal(saved.coins.loans.active.id,id);
  const backup=await a.buildMasterBackupJSON();assert.doesNotThrow(()=>a.validateBackup(backup));
  assert.equal(await a.importMasterBackup(new w.File([JSON.stringify(backup)],'loan.json')),true);assert.equal(a.loanState().active.id,id);assert.equal(await a.requestLoan(1),false);
}));

test('cancelled or failed loan transactions leave wallet, debt and ledger untouched',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:20}});w.confirm=()=>false;assert.equal(await a.requestLoan(10),false);assert.equal(a.state.coins.balance,20);
  w.confirm=()=>true;const before=plain(a.state.coins);a.setLoanCommit(async()=>{throw new Error('No se pudo guardar');});
  assert.equal(await a.requestLoan(10),false);assert.deepEqual(plain(a.state.coins),before);
}));

test('repayment failure and stale tabs cannot clear debt or duplicate its credit',()=>fixture(async({a})=>{
  await a.seed({coins:{balance:20}});assert.equal(await a.requestLoan(10),true);const id=a.loanState().active.id;
  const before=plain(a.state.coins);a.setLoanCommit(async()=>{throw new Error('Error de guardado');});
  assert.equal(await a.repayLoan(id),false);assert.deepEqual(plain(a.state.coins),before);
  const other=JSON.parse(await a.storageGet('bitacora-app-data'));other.coins.balance=42;await a.storageSet('bitacora-app-data',JSON.stringify(other));
  assert.equal(await a.repayLoan(id),false);assert.deepEqual(plain(a.state.coins),before);assert.equal(JSON.parse(await a.storageGet('bitacora-app-data')).coins.balance,42);
}));

test('backup loan validation rejects multiple active-like receipts, altered totals and duplicate IDs',()=>fixture(async({a})=>{
  await a.seed();assert.equal(await a.requestLoan(10),true);const backup=await a.buildMasterBackupJSON();
  for(const change of [{principal:101},{principal:0},{principal:1.2},{rate:-10},{interest:999},{total:1},{borrowedAt:-1},{paidAt:123}]){
    const bad=plain(backup);Object.assign(bad.state.coins.loans.active,change);assert.throws(()=>a.validateBackup(bad),/préstamo|Deuda/);
  }
  const duplicate=plain(backup);duplicate.state.coins.loans.history.push(Object.assign({},duplicate.state.coins.loans.active,{paidAt:duplicate.state.coins.loans.active.borrowedAt}));assert.throws(()=>a.validateBackup(duplicate),/préstamo|Deuda/);
  const old=plain(backup);delete old.state.coins.loans;assert.doesNotThrow(()=>a.validateBackup(old));
}));

test('loan is available from benefits after welcome packs and does not require a player level',()=>fixture(async({w,a})=>{
  await a.seed();w.document.querySelector('[data-action="open-bonos"]').click();w.document.querySelector('[data-action="benefits-section"][data-section="loan"]').click();
  const form=w.document.querySelector('[data-action="loan-request"]');assert.ok(form);form.elements.amount.value='50';form.elements.amount.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.match(w.document.getElementById('loanQuote').textContent,/55/);assert.match(w.document.getElementById('app').textContent,/reserva/);
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();await wait();assert.equal(a.state.coins.balance,50);assert.equal(a.loanState().active.total,55);
}));


test('atomic loan commit refuses a competing tab write between reading and committing',()=>fixture(async({a})=>{
  await a.seed({coins:{balance:5}});
  const commit=a.commitLoanSnapshot;
  a.setLoanCommit(async(expected,next)=>{
    const other=JSON.parse(expected);other.coins.balance=19;await a.storageSet('bitacora-app-data',JSON.stringify(other));
    return commit(expected,next);
  });
  assert.equal(await a.requestLoan(100),false);assert.equal(a.state.coins.balance,5);assert.equal(a.loanState().active,null);
  const stored=JSON.parse(await a.storageGet('bitacora-app-data'));assert.equal(stored.coins.balance,19);assert.equal(stored.coins.loans,undefined);
}));

test('existing welcome weeks keep their pending duplicator without receiving it twice',()=>fixture(async({a})=>{
  let day='2026-11-14';a.setWelcomeDay(()=>day);
  await a.seed({rpg:{xp:0,inv:{},starter:{version:1,startedOn:'2026-11-13',claims:[{day:1,claimedOn:'2026-11-13'}]}}});
  for(let n=2;n<=7;n++){day=a.addDays('2026-11-13',n-1);assert.equal(await a.claimWelcomePack(n),true);assert.equal(a.rpgState().inv.booster,n<4?0:1);}
  assert.equal(a.rpgState().starter.rewardSchedule,1);
  const backup=await a.buildMasterBackupJSON();assert.doesNotThrow(()=>a.validateBackup(backup));
}));

async function followFixture(a,patch={}){
  const ds=a.todayStr(),clock={now:a.followTimeAt(ds,'10:00')};a.setNow(()=>clock.now);
  await a.seed(Object.assign({coins:{balance:20},oneoff:[{id:'f1',text:'Informe',date:ds,subtasks:[{id:'fs',text:'Revisar',done:false}]}],tracking:{status:'thinking',taskDs:ds,startTime:clock.now,sessionEndsAt:a.followTimeAt(ds,'23:59')}},patch));
  a.setFollowEnabled(true);return {ds,clock,key:'task:f1',subKey:'sub:f1:fs',day:a.followState().days[ds]};
}

test('follow defaults to principal tasks today, opts into subtasks and preserves explicit exclusions',()=>fixture(async({a})=>{
  const {ds,day,key,subKey}=await followFixture(a);
  assert.equal(day.entries[key].selected,true);assert.equal(day.entries[subKey].selected,false);
  a.selectFollowEntry(key,false);a.selectFollowEntry(subKey,true);a.syncFollowDay();assert.equal(day.entries[key].selected,false);assert.equal(day.entries[subKey].selected,true);
  a.state.oneoff.push({id:'f2',text:'Otra',date:ds},{id:'future',text:'Mañana',date:a.addDays(ds,1)});a.syncFollowDay();assert.equal(day.entries['task:f2'].selected,true);assert.equal(day.entries['task:future'],undefined);
}));

test('follow blank duration removes previous limit and starts now without backfilling time',()=>fixture(async({a})=>{
  const {ds,clock,key,day}=await followFixture(a);
  a.state.timeLog[ds]={tasks:{f1:120},subtasks:{},taskLimits:{f1:600}};
  assert.equal(a.saveFollowPlan(key,'10:01',''),true);clock.now=a.followTimeAt(ds,'10:05');a.followTick();
  assert.equal(a.state.tracking.status,'task');assert.equal(a.state.tracking.targetLimit,null);assert.equal(a.state.tracking.startTime,clock.now);assert.equal(a.state.timeLog[ds].taskLimits.f1,undefined);
  clock.now+=2*3600000;a.followTick();assert.equal(a.state.tracking.status,'task');assert.equal(day.entries[key].startedAt!==null,true);assert.equal(a.getStatus? a.getStatus(ds,'f1'):'pending','pending');
}));

test('follow finite duration pauses at its limit but never invents a completion or evidence',()=>fixture(async({a})=>{
  const {ds,clock,key}=await followFixture(a);a.saveFollowPlan(key,'10:01','2');clock.now=a.followTimeAt(ds,'10:01');a.followTick();assert.equal(a.state.tracking.targetLimit,120);
  clock.now+=120000;a.followTick();assert.equal(a.state.tracking.status,'thinking');assert.equal(a.state.log[ds]?.f1,undefined);assert.equal(await a.dbGet(ds+'_f1'),null);
}));

test('follow queues collisions and never interrupts another task or a paid break',()=>fixture(async({a})=>{
  const {ds,clock,key,day}=await followFixture(a);a.state.oneoff.push({id:'f2',text:'Segunda',date:ds});a.syncFollowDay();a.saveFollowPlan(key,'10:01','');a.saveFollowPlan('task:f2','10:01','');
  a.state.coins.breakUntil=a.followTimeAt(ds,'10:03');a.state.tracking.startTime=null;clock.now=a.followTimeAt(ds,'10:02');a.followTick();assert.equal(a.state.tracking.status,'thinking');
  clock.now=a.followTimeAt(ds,'10:03');a.tickCoins();a.followTick();assert.equal(a.state.tracking.taskId,'f1');assert.equal(a.state.tracking.startTime,clock.now);
  a.followTick();assert.equal(a.state.tracking.taskId,'f1');assert.equal(day.entries['task:f2'].startedAt,null);
  a.pauseTask();a.followTick();assert.equal(a.state.tracking.taskId,'f2');
}));

test('follow emits one notification per threshold, supports confirmation and resets notices on reschedule',()=>fixture(async({a})=>{
  const notices=[];a.setFollowAlarm((key,text)=>notices.push({key,text}));const {ds,clock,key,day}=await followFixture(a);a.saveFollowPlan(key,'11:00','');
  for(const [time,stage] of [['10:30','30'],['10:45','15'],['10:50','10'],['10:55','5'],['10:57','3'],['10:58','2'],['10:59','1']]){
    clock.now=a.followTimeAt(ds,time);a.followTick();a.followTick();assert.ok(day.entries[key].notices[stage]);if(stage==='30')a.confirmFollowTime();
  }
  assert.equal(notices.length,7);a.closeFollowPrompt();a.saveFollowPlan(key,'11:30','5');assert.deepEqual(plain(day.entries[key].notices),{});
}));

test('missing follow time is requested again on return and dismissing does not reopen every second',()=>fixture(async({w,a})=>{
  const {clock}=await followFixture(a);a.followTick();assert.ok(w.document.getElementById('followPlanModal').classList.contains('open'));
  a.closeFollowPrompt();clock.now+=1000;a.followTick();assert.equal(w.document.getElementById('followPlanModal').classList.contains('open'),false);
  w.document.dispatchEvent(new w.Event('visibilitychange'));assert.equal(w.document.getElementById('followPlanModal').classList.contains('open'),true);
}));

test('five coin follow penalty is once per started principal at midnight, including disabled and removed commitments',()=>fixture(async({a})=>{
  const {ds,clock,key,day}=await followFixture(a);a.saveFollowPlan(key,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();a.selectFollowEntry(key,false);a.setFollowEnabled(false);
  clock.now=a.followTimeAt(ds,'23:59');a.settleFollowDays();assert.equal(a.state.coins.balance,20);
  clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();a.settleFollowDays();assert.equal(a.state.coins.balance,15);assert.equal(day.penalties.f1.amount,5);assert.equal(a.state.coins.ledger.filter(t=>t.kind==='follow-penalty').length,1);
  await a.persist();const backup=await a.buildMasterBackupJSON();assert.doesNotThrow(()=>a.validateBackup(backup));await a.seed(plain(backup.state));a.settleFollowDays();assert.equal(a.state.coins.balance,15);
}));

test('follow does not fine unstarted or fulfilled commitments and unmarking before midnight restores pending status',()=>fixture(async({a})=>{
  const {ds,clock,key}=await followFixture(a);a.state.oneoff.push({id:'unstarted',text:'Sin iniciar',date:ds});a.syncFollowDay();a.saveFollowPlan(key,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();a.markDone(ds,'f1');a.followTick();
  clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();assert.equal(a.state.coins.balance,20);assert.equal(Object.keys(a.followState().days[ds].penalties).length,0);
}));

test('multiple selected subtasks and parent cost only five coins for one principal',()=>fixture(async({a})=>{
  const {ds,clock,key,subKey,day}=await followFixture(a);a.selectFollowEntry(subKey,true);a.saveFollowPlan(subKey,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();
  assert.ok(day.entries[key].startedAt);assert.ok(day.entries[subKey].startedAt);
  clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();assert.equal(a.state.coins.balance,15);assert.equal(Object.keys(day.penalties).length,1);
}));

test('a completed explicitly selected subtask fulfills its commitment without requiring the unselected parent',()=>fixture(async({a})=>{
  const {ds,clock,key,subKey}=await followFixture(a);a.selectFollowEntry(key,false);a.selectFollowEntry(subKey,true);a.saveFollowPlan(subKey,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();
  a.state.oneoff[0].subtasks[0].done=true;a.state.oneoff[0].subtasks[0].doneAt=ds;
  clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();assert.equal(a.state.coins.balance,20);
}));

test('insufficient follow penalty balance carries forward and is collected from later earnings exactly once',()=>fixture(async({a})=>{
  const {ds,clock,key}=await followFixture(a,{coins:{balance:2}});a.saveFollowPlan(key,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();
  assert.equal(a.state.coins.balance,0);assert.equal(a.state.coins.followPenaltyDue,3);a.addCoins(2,'Trabajo',true);assert.equal(a.state.coins.balance,0);assert.equal(a.state.coins.followPenaltyDue,1);
  a.addCoins(4,'Trabajo',true);assert.equal(a.state.coins.balance,3);assert.equal(a.state.coins.followPenaltyDue,0);
  const c=a.state.coins;assert.equal(c.ledgerOpeningBalance+c.ledger.reduce((n,t)=>n+t.amount,0),c.balance);
}));

test('follow validates backups, including schedules, penalty receipts and pending amounts',()=>fixture(async({a})=>{
  const {key}=await followFixture(a);a.saveFollowPlan(key,'10:10','10');const backup=await a.buildMasterBackupJSON();assert.doesNotThrow(()=>a.validateBackup(backup));
  for(const patch of [{durationMin:-1},{time:'25:00'},{selected:'yes'},{startedAt:-1}]){const bad=plain(backup);Object.assign(bad.state.follow.days[a.followToday()].entries[key],patch);assert.throws(()=>a.validateBackup(bad),/seguimiento/);}
  const bad=plain(backup);bad.state.coins.followPenaltyDue=-5;assert.throws(()=>a.validateBackup(bad),/Penalizaciones/);
  const old=plain(backup);delete old.state.follow;assert.doesNotThrow(()=>a.validateBackup(old));
}));

test('unmarking a followed completion before day end makes it pending again',()=>fixture(async({a})=>{
  const {ds,clock,key,day}=await followFixture(a);a.saveFollowPlan(key,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();a.markDone(ds,'f1');a.followTick();assert.ok(day.entries[key].completedAt);
  a.unmarkDone(ds,'f1');a.followTick();assert.equal(day.entries[key].completedAt,null);
  clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();assert.equal(a.state.coins.balance,15);
}));

test('a failed follow write retains one penalty receipt and saving again does not charge twice',()=>fixture(async({a})=>{
  const {ds,clock,key}=await followFixture(a);a.saveFollowPlan(key,'10:01','');clock.now=a.followTimeAt(ds,'10:01');a.followTick();a.pauseTask();await a.persist();
  const storage=a.storageSet;a.setStorage(async()=>false);clock.now=a.followTimeAt(a.addDays(ds,1),'00:01');a.settleFollowDays();await a.persist();assert.equal(a.state.coins.balance,15);assert.equal(a.saveFailed,true);
  a.setStorage(storage);a.settleFollowDays();await a.persist();const saved=JSON.parse(await a.storageGet('bitacora-app-data'));assert.equal(saved.coins.balance,15);assert.equal(saved.coins.ledger.filter(t=>t.kind==='follow-penalty').length,1);
}));

test('saving a follow plan does not consume the original reminder before any execution',()=>fixture(async({a})=>{
  const {ds,key,clock}=await followFixture(a);a.saveFollowPlan(key,'10:01','');assert.equal(a.state.timeLog[ds]?.autoStarts?.f1,undefined);
  a.setFollowEnabled(false);assert.equal(a.state.timeLog[ds]?.autoStarts?.f1,undefined);
  a.setFollowEnabled(true);clock.now=a.followTimeAt(ds,'10:01');a.followTick();assert.equal(a.state.timeLog[ds].autoStarts.f1,true);
}));

test('finite follow subtasks get their own limit and pause without completing parent or child',()=>fixture(async({a})=>{
  const {ds,clock,key,subKey}=await followFixture(a);a.selectFollowEntry(key,false);a.selectFollowEntry(subKey,true);a.saveFollowPlan(subKey,'10:01','1');clock.now=a.followTimeAt(ds,'10:01');a.followTick();
  assert.equal(a.state.timeLog[ds].subtaskLimits.fs,60);clock.now+=60000;a.followTick();assert.equal(a.state.tracking.status,'thinking');assert.equal(a.state.oneoff[0].subtasks[0].done,false);assert.equal(a.state.log[ds]?.f1,undefined);
}));

function mockDriveGoogle(w){
  const requests=[],configs=[],revokes=[];
  w.google={accounts:{oauth2:{initTokenClient(config){configs.push(config);return {requestAccessToken(options){requests.push({config,options});}};},hasGrantedAllScopes(){return true;},revoke(token){revokes.push(token);}}}};
  w.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('/userinfo')?{email:'player@example.test'}:{files:[]}),{status:200,headers:{'Content-Type':'application/json'}});
  return {requests,configs,revokes};
}

test('Drive startup and background return never initiate OAuth even for an expired saved session',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);w.localStorage.setItem('bitacora_drive_session',JSON.stringify({email:'player@example.test',accessToken:'expired-token',tokenExpiry:Date.now()-1000}));
  a.restoreAuthForTest();a.showStats();w.document.dispatchEvent(new w.Event('visibilitychange'));w.document.querySelector('[data-tab="hoy"]').click();a.silentTokenRenew();
  assert.equal(mock.requests.length,0);assert.equal(a.authToken,null);assert.equal(a.authEmail,'player@example.test');assert.ok(a.loadDriveSession());
}));

test('Drive restores the full remaining token lifetime and unrelated clicks do not request renewal',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w),expiry=Date.now()+30000;
  w.localStorage.setItem('bitacora_drive_session',JSON.stringify({email:'player@example.test',accessToken:'still-valid',tokenExpiry:expiry}));a.restoreAuthForTest();a.showStats();
  w.document.querySelector('[data-tab="hoy"]').click();a.silentTokenRenew();assert.equal(mock.requests.length,0);assert.equal(a.authToken,'still-valid');assert.equal(a.authExpiry,expiry);
}));

test('Drive serializes explicit OAuth, skips forced consent and persists the token before profile lookup',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);let profileResolve;w.fetch=()=>new Promise(resolve=>{profileResolve=resolve;});let calls=0;
  a.requestDriveAuthorization(()=>{calls++;});assert.equal(a.requestDriveAuthorization(()=>{calls+=100;}),false);assert.equal(mock.requests.length,1);assert.notEqual(mock.requests[0].options.prompt,'consent');
  mock.configs[0].callback({access_token:'new-token',expires_in:3600});assert.equal(a.loadDriveSession().accessToken,'new-token');assert.ok(a.authExpiry>Date.now()+3590000);assert.equal(calls,0);
  profileResolve(new Response(JSON.stringify({email:'player@example.test'}),{status:200}));await wait();assert.equal(calls,1);assert.equal(a.identityPending,null);assert.equal(a.authEmail,'player@example.test');
}));

test('a Drive popup closure never clears an existing valid grant and permits an explicit retry',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);a.setDrive();a.showStats();
  a.requestDriveAuthorization();mock.configs[0].error_callback({type:'popup_closed',message:'Popup window closed'});await new Promise(r=>setTimeout(r,650));
  assert.equal(a.authToken,'test-token');assert.equal(a.authAttempt,null);assert.equal(w.document.getElementById('backupStatus').style.display,'block');assert.match(w.document.getElementById('backupStatus').textContent,/Chrome/);
  assert.equal(a.requestDriveAuthorization(),true);assert.equal(mock.requests.length,2);
}));

test('Drive accepts a token delivered just after popup_closed and ignores later stale errors',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);a.requestDriveAuthorization();const first=mock.configs[0];
  first.error_callback({type:'popup_closed'});first.callback({access_token:'accepted-token',expires_in:3600});await wait();await new Promise(r=>setTimeout(r,650));
  assert.equal(a.authToken,'accepted-token');assert.equal(a.authAttempt,null);first.error_callback({type:'popup_closed'});assert.equal(a.authToken,'accepted-token');
}));

test('a cancelled or denied Drive authorization discards its pending operation and cannot affect a newer request',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);let old=0,current=0;
  a.requestDriveAuthorization(()=>old++);const first=mock.configs[0];first.callback({error:'access_denied'});
  a.requestDriveAuthorization(()=>current++);first.callback({access_token:'stale-token',expires_in:3600});assert.equal(a.authToken,null);
  mock.configs[1].callback({access_token:'current-token',expires_in:3600});await wait();assert.equal(old,0);assert.equal(current,1);assert.equal(a.authToken,'current-token');
}));

test('Drive expiry requests reconnection without OAuth, data loss or changing the pending-sync flag',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:73.5}});const mock=mockDriveGoogle(w);a.requestDriveAuthorization();mock.configs[0].callback({access_token:'short-token',expires_in:1});await wait();const before=plain(a.state),dirty=a.dirty;
  const dateNow=w.Date.now;w.Date.now=()=>dateNow()+2000;a.silentTokenRenew();a.showStats();
  assert.equal(a.authToken,null);assert.equal(mock.requests.length,1);assert.equal(a.dirty,dirty);assert.deepEqual(plain(a.state),before);assert.match(w.document.getElementById('driveAuthLabel').textContent,/caducado/);assert.equal(a.loadDriveSession().email,'player@example.test');
}));

test('profile failure leaves Drive authorized and prevents unverified account metadata being reused',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);a.setDrive('known-version');w.fetch=async()=>{throw new Error('Sin red');};
  a.requestDriveAuthorization();mock.configs[0].callback({access_token:'valid-without-email',expires_in:3600});await wait();assert.equal(a.authToken,'valid-without-email');assert.equal(a.driveTokenValid(),true);assert.equal(a.authEmail,null);assert.equal(a.identityPending,null);assert.equal(w.localStorage.getItem('bitacora_drive_known_modtime'),null);
}));

test('Drive 401 invalidates only the matching grant and 403 does not sign out a valid account',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:73.5}});mockDriveGoogle(w);a.setDrive();const dirty=a.dirty;
  w.fetch=async()=>new Response('{}',{status:403});await a.fetchDrive('https://www.googleapis.com/drive/v3/files',{headers:{Authorization:'Bearer test-token'}});assert.equal(a.authToken,'test-token');
  w.fetch=async()=>new Response('{}',{status:401});await assert.rejects(a.fetchDrive('https://www.googleapis.com/drive/v3/files',{headers:{Authorization:'Bearer test-token'}}),/caducó/);assert.equal(a.authToken,null);assert.equal(a.state.coins.balance,73.5);assert.equal(a.dirty,dirty);
}));

test('an old Drive request returning 401 cannot invalidate a newly authorized token',()=>fixture(async({w,a})=>{
  await a.seed();const mock=mockDriveGoogle(w);a.setDrive();let resolveOld;w.fetch=()=>new Promise(resolve=>{resolveOld=resolve;});
  const old=a.fetchDrive('https://www.googleapis.com/drive/v3/files',{headers:{Authorization:'Bearer test-token'}});a.requestDriveAuthorization();
  w.fetch=async()=>new Response(JSON.stringify({email:'player@example.test'}),{status:200});mock.configs[0].callback({access_token:'newer-token',expires_in:3600});await wait();
  resolveOld(new Response('{}',{status:401}));await assert.rejects(old,/caducó/);assert.equal(a.authToken,'newer-token');
}));

test('disconnecting Drive is local, revokes no Google consent and preserves photos and game state',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:73.5}});const mock=mockDriveGoogle(w);a.setDrive();await a.dbSet('2026-11-17_photo',JSON.stringify({note:'No perder',image:null}));const before=plain(a.state);
  a.disconnectDrive();assert.equal(mock.revokes.length,0);assert.deepEqual(plain(a.state),before);assert.ok(await a.dbGet('2026-11-17_photo'));assert.equal(a.loadDriveSession(),null);
}));
