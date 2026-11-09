const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRecurringScheduler,validateSchedule}=require('../scripts/recurring-scheduler.cjs');

const url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
const options={remoteUrl:url,prompt:'Continue from the stopped answer.',effort:'high',intervalSeconds:60};

function fixture(){
 let now=100000,active=null,thinking=false,stopped=0,failure=null,draft='';
 const sent=[],events=[];
 const page={
  url:()=>url,isClosed:()=>false,
  goto:async()=>{},
  locator:()=>({first:()=>({waitFor:async()=>{},click:async()=>{stopped++;thinking=false;}})}),
  evaluate:async(_fn,args)=>args?.errorSource?failure:{canStop:thinking,thinking,draft}
 };
 const browser={contexts:()=>[{pages:()=>[page],newPage:async()=>page}]};
 const controller={
   get activeTask(){return active;},
   send:async message=>{sent.push(message);},
   cancel:async()=>{stopped++;active=null;thinking=false;return true;}
 };
 const scheduler=createRecurringScheduler({controller,browser,emit:e=>events.push(e),signedIn:async()=>true,
   clock:()=>now,autoStart:false,storagePath:null});
 return {scheduler,events,sent,controller,
  advance:ms=>{now+=ms;},
  setThinking:value=>{thinking=value;},
  setActive:value=>{active=value;},
  setFailure:value=>{failure=value;},
  setDraft:value=>{draft=value;},
  get stopped(){return stopped;}
 };
}
test('A scheduler is opt-in and requires a linked conversation and >=60s interval',()=>{
 assert.throws(()=>validateSchedule({...options,intervalSeconds:59}),/interval/i);
 assert.throws(()=>validateSchedule({...options,remoteUrl:'https://evil.com/c/123'}),/linked/i);
 assert.equal(validateSchedule(options).intervalSeconds,60);
 const f=fixture();
 assert.equal(f.scheduler.current,null);
 f.scheduler.close();
});
test('One cron interval sends exactly once; missed minutes do not cause a backlog',async()=>{
 const f=fixture();
 const job=f.scheduler.start(options);
 assert.equal(job.enabled,true);
 await f.scheduler.check();assert.equal(f.sent.length,0);
 f.advance(60000);await f.scheduler.check();
 assert.equal(f.sent.length,1);
 assert.deepEqual({url:f.sent[0].remoteUrl,prompt:f.sent[0].prompt,effort:f.sent[0].effort,scheduled:f.sent[0].scheduled},
  {url,prompt:options.prompt,effort:'high',scheduled:true});
 await f.scheduler.check();assert.equal(f.sent.length,1);
 f.advance(15*60000);await f.scheduler.check();
 assert.equal(f.sent.length,2,'No 15-message catch-up burst');
 f.scheduler.pause();
 f.advance(120000);await f.scheduler.check();
 assert.equal(f.sent.length,2);
 f.scheduler.close();
});
test('Stops a previous same-conversation Thinking response before sending next fixed prompt',async()=>{
 const f=fixture();
 f.scheduler.start(options);
 f.setThinking(true);
 f.setActive({id:'old-answer',remoteUrl:url,chatId:'remote:test'});
 f.advance(60000);await f.scheduler.check();
 assert.equal(f.stopped,1);
 assert.equal(f.sent.length,1);
 f.scheduler.close();
});
test('Never sends a new fixed message while ChatGPT shows an unresolved delivery timeout',async()=>{
 const f=fixture();
 f.scheduler.start(options);
 f.setFailure({kind:'delivery_timeout',message:'Message delivery timed out. Please try again.',canRetry:true});
 f.advance(60000);await f.scheduler.check();
 assert.equal(f.sent.length,0);
 assert.equal(f.scheduler.current.enabled,false);
 assert.match(f.scheduler.current.lastError,/timed out/);
 assert.equal(f.events.some(x=>x.event==='paused'),true);
 f.scheduler.close();
});
test('Never interrupts a different conversation to run the schedule',async()=>{
 const f=fixture();
 f.scheduler.start(options);
 f.setActive({id:'manual-request',remoteUrl:'https://chatgpt.com/c/99999999-9999-9999-9999-999999999999'});
 f.advance(60000);await f.scheduler.check();
 assert.equal(f.sent.length,0);
 assert.equal(f.stopped,0);
 assert.equal(f.events.some(x=>x.event==='skipped'),true);
 f.scheduler.close();
});
test('An opted-in schedule persists and restarts without replaying missed ticks',async()=>{
 const fs=require('node:fs');
 const os=require('node:os');
 const path=require('node:path');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'chatdesk-cron-test-'));
 const file=path.join(temp,'job.json');
 try{
  const f=fixture();
  const make=()=>createRecurringScheduler({controller:f.controller,browser:{
    contexts:()=>[{pages:()=>[{url:()=>url,isClosed:()=>false,locator:()=>({first:()=>({waitFor:async()=>{},click:async()=>{}})}),
      evaluate:async(_fn,args)=>args?.errorSource?null:{thinking:false,canStop:false,draft:''}}]}]
  },emit:e=>f.events.push(e),signedIn:async()=>true,clock:()=>Date.now(),autoStart:false,storagePath:file});
  const first=make();first.start(options);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).job.enabled,true);
  first.close();
  const second=make();
  assert.equal(second.current.enabled,true);
  assert.equal(second.current.intervalSeconds,60);
  assert.equal(second.current.nextRunAt>Date.now(),true,'restart should schedule a future tick');
  await second.stop();
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).job,null);
  second.close();
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
