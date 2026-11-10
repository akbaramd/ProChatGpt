const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../extension/incident-recovery.js');
const base={online:true,composerEmpty:true,errorBanner:true,connectionInterrupted:false,
 generating:false,hasStopButton:false,retryAvailable:true,rateLimited:false,
 conversationMaxed:false,latestAssistantKey:'a0',latestAssistantLength:40,
 latestAssistantHash:'0',latestTurnRole:'assistant',completedAssistantKey:null};
test('fuzz 250 incident timelines: no duplicate reload Stop or Retry',()=>{
 let seed=123456789;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let trial=0;trial<250;trial++){
  let rec=null,time=1000,episode={reload:0,stop:0,retry:0};
  for(let step=0;step<120;step++){
   time+=200+Math.floor(rand()*3000);
   const r=rand();
   const obs={...base,online:rand()>.10,composerEmpty:rand()>.08,
    rateLimited:rand()<.02,conversationMaxed:rand()<.01,
    connectionInterrupted:r<.5,errorBanner:r>=.5,
    retryAvailable:r>=.5,hasStopButton:r<.5,generating:r<.5,
    latestAssistantLength:40+Math.floor(rand()*50),
    latestAssistantHash:String(Math.floor(rand()*40)),
    latestAssistantKey:'a'+Math.floor(step/40)};
   const result=policy.transition(rec,obs,time);
   if(result.action==='persist')episode={reload:0,stop:0,retry:0};
   if(result.action==='reload')episode.reload++;
   if(result.action==='stop')episode.stop++;
   if(result.action==='retry')episode.retry++;
   if(['reload','stop','retry'].includes(result.action)){
     assert.equal(obs.online,true,'never act while offline');
     assert.equal(obs.rateLimited,false,'never act during rate limit');
     assert.equal(obs.conversationMaxed,false,'never act at maximum length');
     assert.equal(obs.composerEmpty,true,'never act with draft');
   }
   assert.ok(episode.reload<=1,JSON.stringify({trial,step,episode}));
   assert.ok(episode.stop<=1,JSON.stringify({trial,step,episode}));
   assert.ok(episode.retry<=1,JSON.stringify({trial,step,episode}));
   rec=result.incident;
  }
 }
});
test('offline during post-refresh stages suspends actions',()=>{
 const sample={...base,connectionInterrupted:true,errorBanner:false,
  retryAvailable:false,hasStopButton:true,generating:true};
 let r=policy.transition(null,sample,1000);
 r=policy.transition(r.incident,sample,60000);
 assert.equal(r.action,'reload');
 let offline=policy.transition(r.incident,{...sample,online:false},96000);
 assert.equal(offline.action,'wait');
 const stopped={...r.incident,phase:'stopped',phaseAt:97000,stops:1};
 offline=policy.transition(stopped,{...sample,online:false,hasStopButton:false},150000);
 assert.equal(offline.action,'wait');
});
