const test=require('node:test'),assert=require('node:assert/strict'),r=require('../extension/recovery-policy.js');
const now=1000000,obs={generating:false,hasStopButton:false,rateLimited:false,errorBanner:false,connectionInterrupted:false,conversationMaxed:false,composerEmpty:true,latestTurnRole:'user'};
const safe={now,enabled:true,leader:true,busy:false,online:true,state:{awaitingResponse:true,awaitingResponseSince:now-400000},obs};
test('guarded reload only for stalled unanswered user turn',()=>{
 assert.equal(r.eligible(safe),true);
 for(const patch of [{leader:false},{busy:true},{online:false},{enabled:false},{state:{awaitingResponse:true,awaitingResponseSince:now-10000}},
  ...['generating','hasStopButton','rateLimited','errorBanner','connectionInterrupted','conversationMaxed'].map(k=>({obs:{...obs,[k]:true}})),
  {obs:{...obs,composerEmpty:false}},{obs:{...obs,latestTurnRole:'assistant'}}])
 assert.equal(r.eligible({...safe,...patch}),false,JSON.stringify(patch));
});
test('stall reload max two per hour, min ten-minute cooldown',()=>{
 const first=r.next(null,now);assert.equal(first.allowed,true);
 assert.equal(r.next(first.record,now+1).reason,'cooldown');
 const second=r.next(first.record,now+r.COOLDOWN_MS+1);assert.equal(second.allowed,true);
 assert.equal(r.next(second.record,now+r.COOLDOWN_MS*2+2).reason,'hourly-cap');
 assert.equal(r.next(second.record,now+r.WINDOW_MS+1).allowed,true);
});
