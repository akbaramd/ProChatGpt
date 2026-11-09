'use strict';

/**
 * One opt-in recurring message job, scoped to one existing ChatGPT conversation.
 * The worker uses only the browser UI. No cookies, HTTP endpoints, or credentials.
 * An active job is persisted; missed intervals are never replayed in a burst.
 */
const fs=require('node:fs');
const path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const {permittedConversationUrl}=require('./chat-controller.cjs');
const {inspectDeliveryError}=require('./delivery-recovery.cjs');

const MIN_INTERVAL_SECONDS=60;
const MAX_INTERVAL_SECONDS=86400;
const EFFORTS=new Set(['instant','medium','high']);
const EDITOR='[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]';
const STOP='button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop response"]';
const validId=id=>typeof id==='string'&&id.length>0&&id.length<=90&&/^[\w:-]+$/.test(id);
const uniqueId=()=>require('node:crypto').randomUUID();

function validateSchedule(options){
 if(!options||typeof options!=='object')throw Error('Invalid recurring job');
 const remoteUrl=permittedConversationUrl(options.remoteUrl);
 if(!remoteUrl)throw Error('Select a linked ChatGPT conversation first');
 const intervalSeconds=Number(options.intervalSeconds);
 if(!Number.isInteger(intervalSeconds)||intervalSeconds<MIN_INTERVAL_SECONDS||intervalSeconds>MAX_INTERVAL_SECONDS)
   throw Error('Interval must be between 1 and 1440 minutes');
 if(typeof options.prompt!=='string'||!options.prompt.trim()||options.prompt.length>12000)
   throw Error('A non-empty fixed message is required (up to 12000 characters)');
 if(!EFFORTS.has(options.effort))throw Error('Invalid Thinking mode');
 const chatId='remote:'+new URL(remoteUrl).pathname.split('/').at(-1);
 return {remoteUrl,chatId,intervalSeconds,prompt:options.prompt.trim(),effort:options.effort};
}

function createRecurringScheduler({
  controller,browser,emit,signedIn,storagePath,
  clock=()=>Date.now(),setTimer=setInterval,clearTimer=clearInterval,
  everyMs=1000,autoStart=true,
}){
 let job=null,processing=false,closed=false,timer=null;
 const issued=new Map();
 const save=()=>{
   if(!storagePath)return;
   fs.mkdirSync(path.dirname(storagePath),{recursive:true});
   const temporary=storagePath+'.'+process.pid+'.tmp';
   fs.writeFileSync(temporary,JSON.stringify({version:1,job},null,2),'utf8');
   fs.renameSync(temporary,storagePath);
 };
 const read=()=>{
   if(!storagePath||!fs.existsSync(storagePath))return;
   try{
     const json=JSON.parse(fs.readFileSync(storagePath,'utf8'));
     if(!json?.job)return;
     const data=validateSchedule(json.job);
     job={...json.job,...data,enabled:Boolean(json.job.enabled),
       nextRunAt:Boolean(json.job.enabled)?clock()+data.intervalSeconds*1000:null,
       runCount:Math.max(0,Number(json.job.runCount)||0),failureCount:0,lastError:null};
     save();
   }catch(e){
     // Never auto-execute a malformed persisted schedule.
     job=null;emit({type:'schedule',event:'error',message:'Saved recurring job is invalid: '+e.message});
   }
 };
 const state=(event='state',more={})=>{
   emit({type:'schedule',event,job:job?{...job}:null,at:clock(),...more});
 };
 const assertOpen=()=>{if(closed)throw Error('Scheduler is closed');};
 const requireJob=()=>{assertOpen();if(!job)throw Error('No recurring message job configured');};
 function start(options){
   assertOpen();
   const data=validateSchedule(options);
   if(job?.enabled)throw Error('Pause or stop the existing recurring job before replacing it');
   job={...data,id:uniqueId(),enabled:true,createdAt:clock(),nextRunAt:clock()+data.intervalSeconds*1000,
     runCount:0,failureCount:0,lastRunAt:null,lastError:null,lastResult:'scheduled'};
   save();state('started');return job;
 }
 function pause(){
   requireJob();job.enabled=false;job.nextRunAt=null;save();state('paused');return job;
 }
 function resume(){
   requireJob();job.enabled=true;job.failureCount=0;job.nextRunAt=clock()+job.intervalSeconds*1000;
   job.lastError=null;save();state('resumed');return job;
 }
 async function stop(){
   requireJob();
   const previous=job;
   job=null;save();state('stopped',{previousId:previous.id});
   // Stopping the schedule only stops future ticks. Do not kill an existing reply.
   return true;
 }
 async function ensureTarget(){
   const ctx=browser.contexts()[0];
   if(!ctx)throw Error('Chromium has no browser context');
   const page=ctx.pages().find(p=>{
     try{return !p.isClosed()&&new URL(p.url()).hostname==='chatgpt.com';}catch{return false;}
   })||await ctx.newPage();
   // Do not navigate away from a different manually-active ChatGPT chat.
   // Only the target chat's generation can be stopped by this scheduler.
   if(page.url().split('?')[0]!==job.remoteUrl){
     const other=await browserActivity(page).catch(()=>({thinking:false,canStop:false}));
     if(other.thinking||other.canStop)
       throw Error('A different ChatGPT conversation is generating; this tick was skipped');
     await page.goto(job.remoteUrl,{waitUntil:'domcontentloaded',timeout:50000});
   }
   await page.locator(EDITOR).first().waitFor({state:'visible',timeout:30000});
   if(!await signedIn(page))throw Error('ChatGPT session is not signed in');
   return page;
 }
 async function browserActivity(page){
   return page.evaluate(()=>{
     const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
     const stops=[...document.querySelectorAll('button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop response"]')];
     const inProgress=[...document.querySelectorAll('[data-talvt-turn-state="in_progress"]')].some(visible);
     const composer=document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]');
     return {canStop:stops.some(visible),thinking:inProgress,
       draft:(composer?.innerText||'').trim().slice(0,250)};
   });
 }
 async function waitIdle(ms=12000){
   const deadline=clock()+ms;
   while(controller.activeTask&&clock()<deadline)await delay(130);
   return !controller.activeTask;
 }
 async function execute(trigger='timer'){
   if(!job||!job.enabled||processing||closed)return false;
   processing=true;
   const snapshot=job;
   try{
     const active=controller.activeTask;
     if(active?.deliveryError){
       state('skipped',{reason:'ChatGPT has a delivery timeout. Retry the existing response before sending another message.'});
       return false;
     }
     if(active && active.remoteUrl!==snapshot.remoteUrl){
       state('skipped',{reason:'Another conversation is generating; this tick was skipped'});
       return false;
     }
     if(active){
       state('stopping-thinking',{reason:'Stopping previous response before sending'});
       await controller.cancel(active.id);
       if(!await waitIdle())throw Error('Previous message did not stop; no duplicate message sent');
     }
     if(!job||job.id!==snapshot.id||!job.enabled)return false;
     const page=await ensureTarget();
     if(!job||job.id!==snapshot.id||!job.enabled)return false;
     const deliveryFailure=await inspectDeliveryError(page);
     if(deliveryFailure){
       job.enabled=false;job.nextRunAt=null;
       job.lastResult='delivery_timeout';job.lastError=deliveryFailure.message;
       save();
       state('paused',{reason:'ChatGPT shows a delivery error. Use Retry in the browser before resuming.'});
       return false;
     }
     let observed=await browserActivity(page);
     if(observed.thinking||observed.canStop){
       state('stopping-thinking',{reason:'ChatGPT is generating in the scheduled conversation'});
       if(!observed.canStop){
         // Give the first-party Stop button time to appear; never send while
         // the UI still marks the turn as in_progress.
         const cutoff=clock()+5500;
         while(!observed.canStop && observed.thinking && clock()<cutoff){
           await delay(300);observed=await browserActivity(page);
         }
       }
       if(!observed.canStop && observed.thinking)
         throw Error('Thinking is active but Stop is not available; retry next tick');
       if(observed.canStop){
         await page.locator(STOP).first().click({timeout:4500});
         let settled=false;
         for(let i=0;i<25;i++){
           await delay(240);
           const after=await browserActivity(page);
           if(!after.thinking&&!after.canStop){settled=true;break;}
         }
         if(!settled)throw Error('Stop was clicked but generation is still active');
       }
     }
     // Never overwrite a draft typed manually in Chromium.
     observed=await browserActivity(page);
     if(observed.draft)throw Error('The browser contains an unsent draft; this tick was skipped');
     if(controller.activeTask)throw Error('Another ChatDesk message is already running');
     const requestId=uniqueId();
     const chatId=snapshot.chatId;
     issued.set(requestId,snapshot.id);
     job.lastRunAt=clock();job.runCount++;job.lastResult='sent';job.lastError=null;job.failureCount=0;
     save();
     state('tick-start',{requestId,chatId,remoteUrl:snapshot.remoteUrl,prompt:snapshot.prompt,trigger});
     const command={type:'chat_send',id:requestId,chatId,prompt:snapshot.prompt,
       effort:snapshot.effort,remoteUrl:snapshot.remoteUrl,scheduled:true};
     // Do not await generation: the next minute can interrupt an unfinished
     // reply using the same Stop control.
     controller.send(command).catch(e=>{
       state('error',{requestId,message:e.message});
     }).finally(()=>{issued.delete(requestId);});
     return true;
   }catch(e){
     if(job&&job.id===snapshot.id){
       job.failureCount++;job.lastResult='error';job.lastError=e.message;
       if(job.failureCount>=3){
         job.enabled=false;job.nextRunAt=null;
         save();state('paused',{reason:'Paused after three consecutive failed ticks'});
       }else{
         save();state('error',{message:e.message});
       }
     }else state('error',{message:e.message});
     return false;
   }finally{processing=false;}
 }
 async function check(){
   if(!job?.enabled||closed||processing)return;
   if(clock()<job.nextRunAt)return;
   // Missed runs are intentionally dropped: no catch-up burst.
   job.nextRunAt=clock()+job.intervalSeconds*1000;save();state('due');
   await execute('timer');
 }
 async function runNow(){
   requireJob();
   if(!job.enabled)throw Error('Resume the job first');
   if(processing)throw Error('A schedule tick is in progress');
   return execute('manual');
 }
 function handleChatEvent(packet){
   if(packet?.type!=='chat'||!issued.has(packet.id))return false;
   if(packet.event==='delivery_timeout'){
     state('delivery-timeout',{requestId:packet.id,chatId:packet.chatId,
       message:packet.message,retryAvailable:packet.retryAvailable});
   }
   if(packet.event==='retrying'){
     state('retrying',{requestId:packet.id,chatId:packet.chatId,attempt:packet.attempt,message:packet.message});
   }
   if(['done','error','cancelled'].includes(packet.event)){
     if(job && issued.get(packet.id)===job.id){
       if(packet.event==='done'){
         job.failureCount=0;job.lastError=null;job.lastResult='done';
       }else if(packet.event==='error'){
         job.failureCount++;
         job.lastError=packet.message||'ChatGPT message failed';
         job.lastResult='error';
         if(/delivery timed out again|retry limit reached|delivery error|rate limit/i.test(job.lastError)){
           job.enabled=false;job.nextRunAt=null;
           state('paused',{reason:'ChatGPT Retry failed; recurring messages paused to avoid duplicate sends'});
         }else if(job.failureCount>=3){
           job.enabled=false;job.nextRunAt=null;
           state('paused',{reason:'Paused after three failed responses'});
         }
       }else job.lastResult='cancelled';
       save();
     }
     state('tick-finished',{requestId:packet.id,chatId:packet.chatId,remoteUrl:job?.remoteUrl,
       result:packet.event,message:packet.message||null});
   }
   return true;
 }
 function status(){state('state');return job?{...job}:null;}
 function close(){
   closed=true;if(timer!==null){clearTimer(timer);timer=null;}
 }
 read();
 if(autoStart)timer=setTimer(()=>{check().catch(e=>state('error',{message:e.message}));},everyMs);
 return {start,pause,resume,stop,runNow,check,status,close,handleChatEvent,
   get current(){return job?{...job}:null;},
   get processing(){return processing;}};
}
module.exports={createRecurringScheduler,validateSchedule,MIN_INTERVAL_SECONDS,MAX_INTERVAL_SECONDS};