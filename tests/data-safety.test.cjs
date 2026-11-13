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
      validateBackup,buildMasterBackupJSON,importMasterBackup,commitRestoredBackup,saveRecoveryPoint,
      uploadDriveBackup,autoRestoreFromDrive,keepLocalDriveVersion,periodSummary,openAIPlanPreview,validateAIPlan,
      generateAIPlan,todayStr,addDays,render,renderEstadisticas,resetAll,showRecoveryPoints,
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

test('shop respects unlock levels and costs and retains the old shop',()=>fixture(async({w,a})=>{
  await a.seed({coins:{balance:50}});assert.equal(a.buyRpgItem('shield'),false);assert.equal(a.state.coins.balance,50);
  a.rpgState().xp=a.xpForLevel(5);assert.equal(a.buyRpgItem('shield'),true);assert.equal(a.state.coins.balance,30);assert.equal(a.rpgState().inv.shield,1);
  assert.equal(a.buyRpgItem('reroll'),true);assert.equal(a.consumeReroll(),true);assert.equal(a.consumeReroll(),false);
  a.openShopModal();assert.ok(w.document.querySelector('#shopOverlay'));w.document.getElementById('legacyShopBtn').click();assert.ok(w.document.getElementById('shopModal').classList.contains('open'));
}));

test('shields preserve yesterday streak without completion, payout or repeated consumption',()=>fixture(async({a})=>{
  const today=a.todayStr(),yesterday=a.addDays(today,-1),before=a.addDays(today,-2);
  await a.seed({firstUseDate:before,habits:[{id:'h',text:'Con racha',createdAt:before},{id:'empty',text:'Sin racha',createdAt:before}],log:{[before]:{h:true}}});
  a.rpgState().inv.shield=2;a.checkHabitShields();assert.equal(a.rpgState().inv.shield,1);assert.equal(a.habitStreak(a.state.habits[0]),2);
  assert.equal(a.state.log[yesterday],undefined);a.payHabitStreakReward(yesterday,'h');assert.equal((a.state.coins||{}).balance||0,0);
  a.checkHabitShields();assert.equal(a.rpgState().inv.shield,1);
}));

test('condenser persists matching parent and subtask limits and does not spend at minimum',()=>fixture(async({a})=>{
  const ds=a.todayStr();await a.seed({oneoff:[{id:'t',text:'Tarea',date:ds}],timeLog:{[ds]:{thinking:0,tasks:{t:150},subtasks:{s:100}}},tracking:{status:'task',taskId:'t',taskDs:ds,startTime:null,targetLimit:600}});
  a.rpgState().inv.condenser=3;assert.equal(a.useCondenser(),true);assert.equal(a.state.timeLog[ds].taskLimits.t,300);
  a.state.tracking.subtaskId='s';a.state.tracking.targetLimit=600;assert.equal(a.useCondenser(),true);assert.equal(a.state.timeLog[ds].subtaskLimits.s,300);
  a.state.tracking.targetLimit=60;assert.equal(a.useCondenser(),false);assert.equal(a.rpgState().inv.condenser,1);
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
