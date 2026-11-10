// Usage: node scripts/analyze-auto-continue-diagnostics.cjs file.json
// Evaluates exported structured traces without opening or inspecting messages.
'use strict';
const fs=require('node:fs');
function analyze(input){
  if(!input||!Array.isArray(input.events))throw Error('Not an AutoContinue diagnostic export');
  const chats=new Map(),issues=[];
  const eventCount={};
  for(const entry of input.events){
    const key=entry.chat||'unknown';
    if(!chats.has(key))chats.set(key,{chat:key,total:0,sends:0,retries:0,
      aborted:0,exceptions:0,latestStatus:null,lastEventAt:0,
      lastSendAt:null,lastEvent:null,notable:[]});
    const chat=chats.get(key);chat.total++;chat.lastEventAt=Math.max(chat.lastEventAt,entry.t||0);
    eventCount[entry.event]=(eventCount[entry.event]||0)+1;
    if(entry.event==='send-clicked'){
      chat.sends++;
      if(chat.lastSendAt!=null&&entry.t-chat.lastSendAt<1200){
        const x={chat:key,type:'rapid-consecutive-sends',at:entry.t};
        chat.notable.push(x);issues.push(x);
      }
      chat.lastSendAt=entry.t;
    }
    if(entry.event==='retry-clicked')chat.retries++;
    if(entry.event==='send-not-clicked')chat.aborted++;
    if(entry.event==='watchdog-exception'||entry.event==='send-exception'){
      chat.exceptions++;
      const x={chat:key,type:entry.event,code:entry.errorCode||null,at:entry.t};
      chat.notable.push(x);issues.push(x);
    }
    if(entry.event==='state'||entry.event==='guard'){
      chat.latestStatus=entry.reason||entry.event;
      if(['paused-unconfirmed','error-recovery-unconfirmed','web-lock-unavailable',
        'conversation-maxed'].includes(entry.reason)){
        const issue={chat:key,type:entry.reason,at:entry.t};
        chat.notable.push(issue);issues.push(issue);
      }
    }
    chat.lastEvent=entry.event;
  }
  const result=[...chats.values()].sort((a,b)=>b.lastEventAt-a.lastEventAt);
  for(const chat of result)chat.notable=chat.notable.slice(-8);
  return {schema:1,exportedAt:input.exportedAt||null,sessionCount:input.sessions?.length||0,
    eventCount:input.events.length,byEvent:eventCount,chats:result,issues};
}
if(require.main===module){
  try{
    if(!process.argv[2])throw Error('Provide a diagnostics .json file path');
    const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
    process.stdout.write(JSON.stringify(analyze(input),null,2)+'\n');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={analyze};