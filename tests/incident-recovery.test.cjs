const test=require('node:test'),assert=require('node:assert/strict'),policy=require('../extension/incident-recovery.js');
const base={online:true,composerEmpty:true,errorBanner:false,connectionInterrupted:false,
 generating:false,hasStopButton:false,retryAvailable:false,rateLimited:false,conversationMaxed:false,
 latestAssistantKey:'old',latestAssistantLength:100,latestTurnRole:'assistant',
 completedAssistantKey:null};
function step(e,patch,now){return policy.transition(e,{...base,...patch},now)}
test('retry: refresh before first-party Retry, release only on a new completed answer',()=>{
 let r=step(null,{errorBanner:true,retryAvailable:true},1000);
 assert.equal(r.action,'persist');let s=r.incident;
 r=step(s,{errorBanner:true,retryAvailable:true},1000+15000);
 assert.equal(r.action,'wait'); // quiet window, no premature retry
 r=step(s,{errorBanner:true,retryAvailable:true},1000+31000);
 assert.equal(r.action,'reload');assert.equal(r.incident.refreshes,1);s=r.incident;
 r=step(s,{errorBanner:true,retryAvailable:true},1000+62000);
 assert.equal(r.action,'retry');assert.equal(r.incident.retries,1);s=r.incident;
 r=step(s,{errorBanner:false,retryAvailable:false,
  latestAssistantKey:'new',latestAssistantLength:90,completedAssistantKey:'new'},1000+64000);
 assert.equal(r.action,'release');
});
test('interruption: reload then wait for recovery; Stop only once when no progress',()=>{
 let r=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},2000),s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true},2000+46000);
 assert.equal(r.action,'reload');s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true},2000+65000);
 assert.equal(r.action,'wait');
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true},2000+78000);
 assert.equal(r.action,'stop');assert.equal(r.incident.stops,1);s=r.incident;
 r=step(s,{connectionInterrupted:true,hasStopButton:false},2000+95000);
 assert.equal(r.action,'release-partial');
});
test('server progress after refresh prevents Stop and permits natural completion',()=>{
 let r=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},10000),s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true},60000);s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true,
  latestAssistantLength:140},65000);assert.equal(r.action,'wait');s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true,
  latestAssistantLength:140},95000);assert.equal(r.action,'stop'); // exactly 30s quiet
});
test('reload and stop are never repeated, rate limit and drafts always block',()=>{
 let r=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},1000);
 const first=r.incident;
 for(const extra of [{rateLimited:true},{composerEmpty:false},{online:false}]){
   r=step(first,{connectionInterrupted:true,generating:true,hasStopButton:true,...extra},100000);
   assert.notEqual(r.action,'reload');
 }
 r=step(first,{connectionInterrupted:true,generating:true,hasStopButton:true},100000);
 let s=r.incident;
 r=step(s,{connectionInterrupted:true,generating:true,hasStopButton:true},140000);
 assert.equal(r.action,'stop');
 s=r.incident;
 r=step(s,{connectionInterrupted:true,hasStopButton:true},200000);
 assert.notEqual(r.action,'stop');
});
test('ambiguous user turn never causes a new prompt after reload',()=>{
 let r=step(null,{errorBanner:true,latestTurnRole:'user',latestAssistantKey:null,
  latestAssistantLength:0},1000);
 r=step(r.incident,{errorBanner:true,latestTurnRole:'user',
  latestAssistantKey:null,latestAssistantLength:0},35000);
 assert.equal(r.action,'reload');
 r=step(r.incident,{latestTurnRole:'user',latestAssistantKey:null,
  latestAssistantLength:0},70000);
 assert.equal(r.action,'hold');
});
test('stopped interruption retains resolved key and never loops into another incident',()=>{
 let r=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},1000);
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:true},47000);
 assert.equal(r.action,'reload');
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:true},79000);
 assert.equal(r.action,'stop');
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:false},126000);
 assert.equal(r.action,'release-partial');assert.equal(r.incident.partial,true);
 assert.equal(r.incident.resolvedKey,'old');
 for(let i=0;i<1000;i++)assert.equal(step(r.incident,{
  connectionInterrupted:true,generating:true,hasStopButton:false
 },126001+i*40).action,'pass');
});
test('late text growth after Stop blocks new sending',()=>{
 let r=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},1000);
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:true},47000);
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:true},79000);
 r=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:false},126000);
 const growth=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:false,
  latestAssistantLength:101},127000);
 assert.equal(growth.action,'hold');assert.equal(growth.incident.phase,'hold');
});
test('completed response after reload needs no text growth to reconcile safely',()=>{
 let r=step(null,{errorBanner:true,retryAvailable:true},1000);
 r=step(r.incident,{errorBanner:true,retryAvailable:true},33000);
 assert.equal(r.action,'reload');
 r=step(r.incident,{errorBanner:false,retryAvailable:false,
  completedAssistantKey:'old'},65000);
 assert.equal(r.action,'release');
});
test('stale in_progress marker after Stop cannot permanently block stable partial recovery',()=>{
 let e=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},1000).incident;
 e=step(e,{connectionInterrupted:true,generating:true,hasStopButton:true},50000).incident;
 e=step(e,{connectionInterrupted:true,generating:true,hasStopButton:true},82000).incident;
 const r=step(e,{connectionInterrupted:true,generating:true,hasStopButton:false},100000);
 assert.equal(r.action,'release-partial');
 const after=step(r.incident,{connectionInterrupted:true,generating:true,hasStopButton:false},101000);
 assert.equal(after.action,'pass');
});
test('a different failed assistant after a resolved incident starts a new episode',()=>{
 let e=step(null,{errorBanner:true},1000).incident;
 e=step(e,{errorBanner:true},32000).incident;
 const good=step(e,{latestAssistantKey:'new',latestAssistantLength:120,completedAssistantKey:'new'},33000);
 assert.equal(good.action,'release');
 const fresh=step(good.incident,{errorBanner:true,latestAssistantKey:'next',latestAssistantLength:15},40000);
 assert.equal(fresh.action,'persist');assert.equal(fresh.incident.refreshes,0);
});
test('continued output postpones stop even after the reload observation interval',()=>{
 let e=step(null,{connectionInterrupted:true,generating:true,hasStopButton:true},1000).incident;
 e=step(e,{connectionInterrupted:true,generating:true,hasStopButton:true},50000).incident;
 const more=step(e,{connectionInterrupted:true,generating:true,hasStopButton:true,latestAssistantLength:160},81000);
 assert.equal(more.action,'wait');
 const second=step(more.incident,{connectionInterrupted:true,generating:true,hasStopButton:true,latestAssistantLength:180},105000);
 assert.equal(second.action,'wait');
});
