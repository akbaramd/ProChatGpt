(function(global){
 'use strict';
 const RETRY_GRACE_MS=10000, INTERRUPT_GRACE_MS=45000;
 const QUIET_MS=30000, AFTER_RELOAD_MS=30000, STOP_GRACE_MS=15000;
 const RETRY_TIMEOUT_MS=120000, STOP_TIMEOUT_MS=120000, INCIDENT_TTL_MS=3600000;
 const hashText=text=>{let h=2166136261;const v=String(text||'');for(let i=0;i<v.length;i++)h=Math.imul(h^v.charCodeAt(i),16777619);return (h>>>0).toString(16);};
 const cleanAssistantText=text=>String(text||'')
   .replace(/Connection interrupted\.\s*Waiting for the complete answer\.?/gi,'')
   .replace(/Error in input stream/gi,'')
   .replace(/Message delivery timed out/gi,'').trim();
 const issueOf=o=>o?.connectionInterrupted?'interrupted':o?.errorBanner?'retry':null;
 const settled=o=>!o.generating&&!o.hasStopButton&&!o.rateLimited&&!o.conversationMaxed;
 const progress=(e,o)=>Boolean(o.latestAssistantKey&&(
   o.latestAssistantKey!==e.sourceKey||
   (o.latestAssistantKey===e.sourceKey&&((o.latestAssistantLength||0)>e.sourceLength||
    (o.latestAssistantHash!=null&&e.sourceHash!=null&&o.latestAssistantHash!==e.sourceHash)))));
 function init(o,now){
   return {kind:issueOf(o),phase:'watch',startedAt:now,phaseAt:now,
     lastProgressAt:now,sourceKey:o.latestAssistantKey||null,
     sourceLength:o.latestAssistantLength||0,sourceHash:o.latestAssistantHash??null,
     sourceCompleted:Boolean(o.completedAssistantKey&&o.completedAssistantKey===o.latestAssistantKey),
     progressKey:o.latestAssistantKey||null,progressLength:o.latestAssistantLength||0,
     progressHash:o.latestAssistantHash??null,
     refreshes:0,stops:0,retries:0,finishedAt:null};
 }
 const result=(incident,action='wait',reason='observing')=>({incident,action,reason});
 function transition(previous,o,now){
   const kind=issueOf(o);
   if(o.rateLimited||o.conversationMaxed)return result(previous,'hold','service-limit');
   if(!previous)return kind?result(init(o,now),'persist','incident-detected'):result(null,'pass','healthy');
   const e={...previous};
   if(!e.startedAt||now-e.startedAt>INCIDENT_TTL_MS)return result(e,'hold','incident-expired');
   if(o.online===false)return result(e,'wait','offline-recovery-paused');
   if(e.phase==='resolved'){
     if(e.partial&&o.latestAssistantKey===e.resolvedKey &&
        (o.latestAssistantLength||0)>(e.progressLength||0)){
       e.progressLength=o.latestAssistantLength;e.lastProgressAt=now;e.phase='hold';
       return result(e,'hold','late-progress-after-stop');
     }
     if(e.partial&&o.latestTurnRole==='assistant'&&!o.hasStopButton&&
        o.composerEmpty&&o.latestAssistantKey===e.resolvedKey &&
        now-e.lastProgressAt>=QUIET_MS)return result(e,'pass','partial-recovered');
     if(kind && (o.latestTurnRole==='user' ||
        (o.latestAssistantKey&&o.latestAssistantKey!==e.resolvedKey)))
       return result(init(o,now),'persist','next-incident');
     return kind?result(e,'hold','resolved-but-error-visible'):result(e,'pass','resolved');
   }
   const len=o.latestAssistantLength||0,hash=o.latestAssistantHash??null;
   if(o.latestAssistantKey!==e.progressKey||len!==e.progressLength||hash!==e.progressHash){
     e.progressKey=o.latestAssistantKey||null;e.progressLength=len;
     e.progressHash=hash;e.lastProgressAt=now;
   }
   const hasProgress=progress(e,o);
   const completedAfterIncident=Boolean(!e.sourceCompleted &&
     o.completedAssistantKey && o.completedAssistantKey===o.latestAssistantKey);
   const hasTrustedCompletion=hasProgress||completedAfterIncident;
   if(o.latestTurnRole==='assistant'&&o.completedAssistantKey&&
      hasTrustedCompletion&&settled(o)&&!kind){
     e.phase='resolved';e.finishedAt=now;e.phaseAt=now;
     e.resolvedKey=o.latestAssistantKey;e.partial=false;
     return result(e,'release','new-completed-answer');
   }
   if(e.phase==='hold')return result(e,'hold','manual-verification-required');
   if(e.phase==='watch'){
     if(!kind&&!o.generating&&!o.hasStopButton){
       if(o.latestTurnRole==='assistant'&&o.completedAssistantKey&&
          hasTrustedCompletion&&o.latestAssistantLength>0&&now-e.lastProgressAt>=QUIET_MS){
         e.phase='resolved';e.phaseAt=now;e.finishedAt=now;
         e.resolvedKey=o.latestAssistantKey;e.partial=true;
         return result(e,'release-partial','stable-after-banner-cleared');
       }
       return result(e,'wait','await-terminal-reconciliation');
     }
     const grace=e.kind==='interrupted'?INTERRUPT_GRACE_MS:RETRY_GRACE_MS;
     if(now-e.startedAt<grace||now-e.lastProgressAt<QUIET_MS||
        o.online===false||!o.composerEmpty)return result(e,'wait','pre-reload-grace');
     if(e.refreshes>=1)return result(e,'hold','reload-cap');
     e.phase='reloaded';e.phaseAt=now;e.refreshes++;
     return result(e,'reload','refresh-after-stall');
   }
   if(e.phase==='reloaded'){
     if(now-e.phaseAt<AFTER_RELOAD_MS||now-e.lastProgressAt<QUIET_MS||
       o.online===false||!o.composerEmpty)return result(e,'wait','post-refresh-observation');
     if(o.hasStopButton){
       if(e.stops>=1)return result(e,'hold','stop-cap');
       e.phase='stopped';e.phaseAt=now;e.stops++;
       return result(e,'stop','stalled-stop-after-reload');
     }
     if(o.retryAvailable&&e.retries<1){
       e.phase='retried';e.phaseAt=now;e.retries++;
       return result(e,'retry','first-party-retry-after-reload');
     }
     if(o.latestTurnRole==='assistant'&&o.latestAssistantLength>0&&
       settled(o)&&now-e.lastProgressAt>=QUIET_MS&&
       (e.kind==='interrupted'||hasProgress)){
       e.phase='resolved';e.phaseAt=now;e.finishedAt=now;
       e.resolvedKey=o.latestAssistantKey;e.partial=true;
       return result(e,'release-partial','stable-partial-after-reload');
     }
     return result(e,'hold','unconfirmed-after-refresh');
   }
   if(e.phase==='stopped'){
     if(e.progressKey!==previous.progressKey||e.progressLength!==previous.progressLength||
        e.progressHash!==previous.progressHash){
       e.phase='hold';return result(e,'hold','progress-after-stop');
     }
     if(o.hasStopButton&&now-e.phaseAt>=STOP_TIMEOUT_MS)
       return result(e,'hold','stop-unresponsive');
     if(now-e.phaseAt<STOP_GRACE_MS||o.hasStopButton||
        now-e.lastProgressAt<QUIET_MS||!o.composerEmpty)
       return result(e,'wait','confirm-stop-settled');
     if(o.retryAvailable&&e.retries<1){
       e.phase='retried';e.phaseAt=now;e.retries++;
       return result(e,'retry','retry-after-stop');
     }
     if(o.latestTurnRole==='assistant'&&o.latestAssistantLength>0&&
        !o.hasStopButton&&!o.rateLimited&&!o.conversationMaxed&&
        (!kind||(kind==='interrupted'&&e.kind==='interrupted'))){
       e.phase='resolved';e.phaseAt=now;e.finishedAt=now;
       e.resolvedKey=o.latestAssistantKey;e.partial=true;
       return result(e,'release-partial','stable-answer-after-stop');
     }
     return result(e,'hold','no-confirmed-answer-after-stop');
   }
   if(e.phase==='retried'){
     if(now-e.phaseAt<RETRY_TIMEOUT_MS)return result(e,'wait','await-retried-answer');
     return result(e,'hold','retry-unconfirmed');
   }
   return result(e,'hold','unknown-incident-stage');
 }
 const api={transition,init,issueOf,progress,settled,RETRY_GRACE_MS,
   INTERRUPT_GRACE_MS,QUIET_MS,AFTER_RELOAD_MS,STOP_GRACE_MS,RETRY_TIMEOUT_MS,
   STOP_TIMEOUT_MS,hashText,cleanAssistantText};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 else global.AutoContinueIncident=api;
})(typeof window!=='undefined'?window:globalThis);