// Conservative, bounded UI reload for a response stuck after submission.
// This never creates a new prompt or bypasses service/rate limits.
(function(global){
  'use strict';
  const STALL_MS=360000, WINDOW_MS=3600000, COOLDOWN_MS=600000, MAX_RELOADS=2;
  function eligible({now,enabled,leader,busy,online,state,obs,receipt}){
    if(!enabled||!leader||busy||!online||!obs)return false;
    if(obs.generating||obs.hasStopButton||obs.rateLimited||obs.errorBanner||
       obs.connectionInterrupted||obs.conversationMaxed||!obs.composerEmpty)return false;
    if(obs.latestTurnRole!=='user')return false;
    if(!state?.awaitingResponse&&!state?.blocked)return false;
    const since=state.awaitingResponseSince||receipt?.at;
    return typeof since==='number'&&now-since>=STALL_MS;
  }
  function next(previous,now){
    const valid=previous&&typeof previous.windowStart==='number'&&
      now-previous.windowStart<WINDOW_MS;
    const count=valid?previous.count||0:0;
    const lastAt=valid?previous.lastAt||0:0;
    if(count>=MAX_RELOADS)return {allowed:false,reason:'hourly-cap'};
    if(lastAt&&now-lastAt<COOLDOWN_MS)return {allowed:false,reason:'cooldown'};
    return {allowed:true,record:{
      windowStart:valid?previous.windowStart:now,
      count:count+1,lastAt:now
    }};
  }
  const api={STALL_MS,WINDOW_MS,COOLDOWN_MS,MAX_RELOADS,eligible,next};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else global.AutoContinueRecovery=api;
})(typeof window!=='undefined'?window:globalThis);
