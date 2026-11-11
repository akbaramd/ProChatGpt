const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../extension/watchdog-core.js');

const CFG={enabled:true,delayMs:3000,maxSends:0,maxRetries:2,errorBackoffMs:8000,rateCooldownMs:60000,verifyWindowMs:6000};
const idle={generating:false,visible:true,composerEmpty:true,canSend:true,errorBanner:false,rateLimited:false};
const gen={...idle,generating:true};

function step(state,obs,cfg,now){return core.decide(state,obs,cfg||CFG,now);}

test('finish -> scheduled -> send after delay -> confirmed when generating starts',()=>{
  let st=core.initialState();
  // generating
  let r=step(st,gen,CFG,1000); st=r.state; assert.equal(r.reason,'generating');
  // finished -> scheduled at 1200+3000
  r=step(st,idle,CFG,1200); st=r.state; assert.equal(r.reason,'scheduled'); assert.equal(st.dueAt,4200);
  // waiting
  r=step(st,idle,CFG,3000); st=r.state; assert.equal(r.reason,'waiting');
  // due -> send
  r=step(st,idle,CFG,4200); st=r.state; assert.equal(r.action,'send'); assert.equal(r.reason,'send');
  assert.equal(st.sends,1); assert.equal(st.sentPending,true);
  // generation starts -> confirmed, pending cleared
  r=step(st,gen,CFG,4500); st=r.state; assert.equal(r.reason,'generating');
  assert.equal(st.sentPending,false); assert.equal(st.retries,0);
});

test('unconfirmed send pauses without creating duplicate user messages',()=>{
  let st={...core.initialState(),dueAt:1000};
  let r=step(st,idle,CFG,1000);st=r.state;
  assert.equal(r.action,'send');
  assert.equal(st.sentPending,true);
  r=step(st,idle,CFG,3000);st=r.state;
  assert.equal(r.reason,'awaiting-generation');
  r=step(st,idle,CFG,7001);st=r.state;
  assert.equal(r.action,'none');
  assert.equal(r.reason,'send-unconfirmed');
  assert.equal(st.blocked,true);
  r=step(st,idle,CFG,14000);
  assert.equal(r.action,'none');
  assert.equal(r.reason,'paused-unconfirmed');
});

test('fast completed reply after confirmed user turn re-arms next continuation',()=>{
  let st={...core.initialState(),sentPending:true,verifyAt:9000,sends:1};
  const obs={...idle,sentConfirmed:true,responseCompleted:true};
  const result=step(st,obs,CFG,2500);
  assert.equal(result.reason,'scheduled');
  assert.equal(result.state.sentPending,false);
  assert.equal(result.state.dueAt,5500);
});

test('error in input stream uses first-party Retry before any new prompt',()=>{
  let st=core.initialState();
  const errored={...idle,errorBanner:true,retryAvailable:true};
  let r=step(st,errored,CFG,1000);st=r.state;
  assert.equal(r.reason,'error-backoff');
  r=step(st,errored,CFG,1000+CFG.errorBackoffMs);st=r.state;
  assert.equal(r.action,'retry-error');
  r=step(st,errored,CFG,1001+CFG.errorBackoffMs);st=r.state;
  assert.equal(r.action,'none');
  r=step(st,{...idle,errorBanner:false,retryAvailable:false},CFG,1500+CFG.errorBackoffMs);st=r.state;
  assert.equal(r.reason,'awaiting-response');
  assert.equal(st.errorRetryAttempted,false);
  assert.equal(st.dueAt,null);
});

test('rate limit never sends and sets a cooldown',()=>{
  let st={...core.initialState(),dueAt:1000};
  const r=step(st,{...idle,rateLimited:true},CFG,1000);
  assert.equal(r.action,'none'); assert.equal(r.reason,'rate-limited');
  assert.equal(r.state.dueAt,1000+CFG.rateCooldownMs);
});

test('an error without a Retry control never sends another user prompt',()=>{
  let st={...core.initialState(),dueAt:1000};
  let r=step(st,{...idle,errorBanner:true,retryAvailable:false},CFG,1000);
  st=r.state;
  assert.equal(r.reason,'error-awaiting-retry');
  assert.equal(st.dueAt,1000+CFG.errorBackoffMs);
  r=step(st,{...idle,errorBanner:true,retryAvailable:false},CFG,12000);
  assert.equal(r.action,'none');
  assert.equal(r.reason,'error-awaiting-retry');
});

test('never overwrites a draft; background tabs may continue if explicitly enabled',()=>{
  const due={...core.initialState(),dueAt:1000};
  assert.equal(step(due,{...idle,composerEmpty:false},CFG,1000).reason,'skip-draft');
  assert.equal(step(due,{...idle,visible:false},CFG,1000).action,'send');
  assert.equal(step(due,{...idle,canSend:false},CFG,1000).reason,'skip-send-disabled');
  assert.equal(step(due,{...idle,composerEmpty:false},CFG,1000).state.dueAt,1000);
});

test('maxSends caps continues; 0 is unlimited',()=>{
  let st={...core.initialState(),dueAt:1000,sends:3};
  let r=step(st,idle,{...CFG,maxSends:3},1000);
  assert.equal(r.reason,'max-reached'); assert.equal(r.action,'none');
  r=step({...core.initialState(),dueAt:1000,sends:99},idle,{...CFG,maxSends:0},1000);
  assert.equal(r.action,'send');
});

test('disabled resets runtime state',()=>{
  const r=step({...core.initialState(),dueAt:5000,sends:4,sentPending:true},idle,{...CFG,enabled:false},9000);
  assert.equal(r.reason,'disabled');
  assert.deepEqual(r.state,{...core.initialState(),wasGenerating:false});
});

test('metrics: reasons map to counters, unknown reasons are ignored',()=>{
  assert.equal(core.metricKeyForReason('send'),'sends');
  assert.equal(core.metricKeyForReason('rate-limited'),'rateLimited');
  assert.equal(core.metricKeyForReason('waiting'),null);
  let m=core.bumpMetrics({},'send',1000);
  m=core.bumpMetrics(m,'send',1200);
  m=core.bumpMetrics(m,'rate-limited',1300);
  m=core.bumpMetrics(m,'waiting',1400);
  assert.equal(m.sends,2);
  assert.equal(m.rateLimited,1);
  assert.equal(m.lastReason,'waiting');
  assert.equal(m.lastEventAt,1400);
});

test('appendLog keeps a capped ring buffer, newest retained',()=>{
  let logs=[];
  for(let i=0;i<10;i++)logs=core.appendLog(logs,{i},4);
  assert.equal(logs.length,4);
  assert.deepEqual(logs.map(e=>e.i),[6,7,8,9]);
});
test('awaiting response resumes after a different completed assistant turn, even without transient generation',()=>{
  const before={...core.initialState(),awaitingResponse:true,awaitingResponseSince:1000,
    lastScheduledCompletedKey:'answer-1'};
  const next=step(before,{...idle,completedAssistantKey:'answer-2',responseCompleted:false},CFG,9000);
  assert.equal(next.reason,'scheduled');
  assert.equal(next.state.dueAt,12000);
  assert.equal(next.state.awaitingResponse,false);
});

test('uncertain delivery stays blocked until a different completed answer is visible',()=>{
  const before={...core.initialState(),blocked:true,lastScheduledCompletedKey:'answer-1'};
  assert.equal(step(before,{...idle,completedAssistantKey:'answer-1'},CFG,9000).reason,'paused-unconfirmed');
  const recovered=step(before,{...idle,completedAssistantKey:'answer-2'},CFG,10000);
  assert.equal(recovered.reason,'recovered-confirmed-response');
  assert.equal(recovered.state.blocked,false);
  assert.equal(recovered.state.dueAt,13000);
});

test('error disappears after Retry but not yet completed: do not send another prompt',()=>{
  const before={...core.initialState(),errorRetryAttempted:true,
    lastScheduledCompletedKey:'answer-1'};
  const next=step(before,{...idle,errorBanner:false,completedAssistantKey:'answer-1'},CFG,10000);
  assert.equal(next.reason,'awaiting-response');
  assert.equal(next.state.dueAt,null);
  assert.equal(next.state.awaitingResponse,true);
});

test('stable last assistant fallback can complete the waiting response',()=>{
  const before={...core.initialState(),awaitingResponse:true,
    lastScheduledCompletedKey:'answer-1'};
  const next=step(before,{...idle,completedAssistantKey:'answer-2',generating:false},CFG,14000);
  assert.equal(next.reason,'scheduled');
});
test('interruption must be sustained and answer unchanged before Stop',()=>{
  const c={...CFG,interruptWaitMs:1000,interruptStableMs:800};
  let st=core.initialState();
  const broken={...idle,connectionInterrupted:true,hasStopButton:true,
    generating:true,latestAssistantKey:'reply-3',latestAssistantText:'partial'};
  let r=step(st,{...broken,answerStableMs:0},c,100);st=r.state;
  assert.equal(r.reason,'connection-interrupted');
  r=step(st,{...broken,answerStableMs:300},c,1500);st=r.state;
  assert.equal(r.reason,'connection-interrupted');
  r=step(st,{...broken,answerStableMs:900},c,1700);st=r.state;
  assert.equal(r.action,'stop-interrupted');
  r=step(st,{...broken,answerStableMs:2000},c,2200);
  assert.equal(r.action,'none','Stop is at most once per interrupted episode');
});

test('interruption recovery schedules exactly once even when banner remains',()=>{
  const c={...CFG,interruptWaitMs:1000,interruptStableMs:800};
  const waiting={...core.initialState(),interruptionStopAttempted:true,
    interruptedSince:100,awaitingResponse:true,lastScheduledCompletedKey:'initial:assistant'};
  const disconnected={...idle,connectionInterrupted:true,hasStopButton:false,
    generating:false,answerStableMs:1500,latestAssistantKey:'initial:assistant',
    latestAssistantText:'partial'};
  let r=step(waiting,disconnected,c,3200);
  assert.equal(r.reason,'interruption-recovered');
  assert.equal(r.state.dueAt,6200);
  assert.equal(r.state.awaitingResponse,false);
  r=step(r.state,disconnected,c,3600);
  assert.equal(r.reason,'waiting');
  assert.equal(r.state.dueAt,6200,'timer not reset every tick');
  r=step(r.state,disconnected,c,6200);
  assert.equal(r.action,'send');
});

test('reconnection cancels interruption without Stop',()=>{
  const c={...CFG,interruptWaitMs:1000,interruptStableMs:800};
  let st=step(core.initialState(),
    {...idle,connectionInterrupted:true,hasStopButton:true,generating:true,
      latestAssistantKey:'one:assistant',latestAssistantText:'partial',answerStableMs:0},
    c,100).state;
  const r=step(st,{...gen,connectionInterrupted:false},c,1500);
  assert.equal(r.reason,'generating');
  assert.equal(r.state.interruptedSince,null);
  assert.equal(r.state.interruptionStopAttempted,false);
});
test('historical in_progress assistant does not mark a later user turn as generating',()=>{
  function turn(key,status){
    return {getAttribute(name){return name==='data-chatgpt-search-unit-key'?key:null;},
      closest(){return {getAttribute(){return status;}}},innerText:'content'};
  }
  const doc={querySelectorAll(selector){
    if(selector==='[data-chatgpt-search-unit-key]')
      return [turn('old:assistant','in_progress'),turn('new:user','complete')];
    return [];
  }};
  assert.equal(core.detectGenerating(doc),false);
  assert.equal(core.lastCompletedAssistant(doc),null);
});
test('persistent interruption without Stop recovers after stability just once',()=>{
  const c={...CFG,interruptStableMs:800};
  const broken={...idle,connectionInterrupted:true,hasStopButton:false,
    latestAssistantKey:'answer:assistant',latestAssistantText:'partial'};
  const st=step(core.initialState(),{...broken,answerStableMs:300},c,100).state;
  assert.equal(st.dueAt,null);
  let r=step(st,{...broken,answerStableMs:1000},c,1900);
  assert.equal(r.reason,'interruption-recovered');
  assert.equal(r.state.dueAt,4900);
  r=step(r.state,{...broken,answerStableMs:1300},c,2300);
  assert.equal(r.reason,'waiting');
  assert.equal(r.state.dueAt,4900);
});
test('conversation maximum length is terminal: never submit another prompt',()=>{
  const due={...core.initialState(),dueAt:1000};
  const r=step(due,{...idle,conversationMaxed:true},CFG,1200);
  assert.equal(r.action,'none');
  assert.equal(r.reason,'conversation-maxed');
  assert.equal(r.state.blocked,true);
  assert.equal(r.state.dueAt,null);
});
test('draft policy determines whether a due follow-up may send',()=>{
 const due={...core.initialState(),dueAt:1000};
 const occupied={...idle,composerEmpty:false};
 assert.equal(step(due,occupied,{...CFG,draftMode:'append'},1000).action,'send');
 assert.equal(step(due,occupied,{...CFG,draftMode:'replace'},1000).action,'send');
 assert.equal(step(due,occupied,{...CFG,draftMode:'preserve'},1000).reason,'skip-draft');
});
