const test=require('node:test'),assert=require('node:assert/strict'),core=require('../extension/watchdog-core.js');
const cfg={enabled:true,delayMs:0,maxSends:0,verifyWindowMs:12000,errorBackoffMs:1,rateCooldownMs:100};
const obs=(key,changes={})=>({completedAssistantKey:key,latestAssistantKey:key,latestTurnRole:'assistant',generating:false,composerEmpty:true,canSend:true,visible:true,errorBanner:false,retryAvailable:false,rateLimited:false,conversationMaxed:false,connectionInterrupted:false,hasStopButton:false,...changes});
test('10000 sequential completions produce exactly one send per completed source',()=>{
 let s=core.initialState(),now=1000,key='answer0',sent=0;
 const seen=new Set();
 for(let i=0;i<10000;i++){
  let r=core.decide(s,obs(key),cfg,++now);s=r.state;
  if(r.action!=='send'){r=core.decide(s,obs(key),cfg,++now);s=r.state;}
  assert.equal(r.action,'send');assert.ok(!seen.has(key));seen.add(key);sent++;
  r=core.decide(s,obs(null,{generating:true,completedAssistantKey:null,sentConfirmed:true,latestTurnRole:'user'}),cfg,++now);s=r.state;
  assert.equal(r.action,'none');
  key='answer'+(i+1);
  r=core.decide(s,obs(key,{responseCompleted:true}),cfg,++now);s=r.state;
  assert.equal(r.action,'none');assert.equal(s.sentPending,false);
 }
 assert.equal(sent,10000);
});
test('5000 unsafe conditions never submit a new user message',()=>{
 let s=core.initialState(),now=100;
 for(let i=0;i<5000;i++){
  const mode=i%5;
  const o=obs('turn'+i,{rateLimited:mode===0,generating:mode===1,composerEmpty:mode!==2,canSend:mode!==3,conversationMaxed:mode===4});
  const r=core.decide(s,o,cfg,now+=200);s=r.state;
  assert.notEqual(r.action,'send');
  if(mode===4)s=core.initialState();
 }
});
test('ambiguous delivery never blindly resends',()=>{
 let s=core.initialState(),now=500;
 s=core.decide(s,obs('old'),cfg,now++).state;
 let r=core.decide(s,obs('old'),cfg,now++);assert.equal(r.action,'send');s=r.state;
 for(let i=0;i<100;i++){r=core.decide(s,obs('old'),cfg,now+=1000);s=r.state;assert.notEqual(r.action,'send');}
 assert.equal(s.blocked,true);
 r=core.decide(s,obs('new'),cfg,now++);
 assert.equal(r.reason,'recovered-confirmed-response');
});
test('maximum conversation length remains terminal',()=>{
 let s=core.initialState();
 for(let i=0;i<1000;i++){let r=core.decide(s,obs('same',{conversationMaxed:true}),cfg,i+1);s=r.state;assert.equal(r.action,'none');}
});