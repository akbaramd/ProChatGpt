'use strict';
const {setTimeout:delay}=require('node:timers/promises');
const {inspectDeliveryError,clickDeliveryRetry}=require('./delivery-recovery.cjs');
const EFFORT_VALUES=Object.freeze({instant:0,medium:1,high:2});
const permittedConversationUrl = value => {
  try {const u=new URL(value);return u.protocol==='https:'&&u.hostname==='chatgpt.com'&&/^\/c\/[\da-f-]{30,}$/i.test(u.pathname)?u.origin+u.pathname:null;}
  catch{return null;}
};
function validateChatRequest(data){
  if(data?.type!=='chat_send'||typeof data.id!=='string'||data.id.length>90||!/^[\w-]+$/.test(data.id)
    ||typeof data.chatId!=='string'||data.chatId.length>90||!/^[\w:-]+$/.test(data.chatId)
    ||typeof data.prompt!=='string'||!data.prompt.trim()||data.prompt.length>12000
    ||!Object.hasOwn(EFFORT_VALUES,data.effort))throw Error('Invalid chat command');
  if(data.remoteUrl&&!permittedConversationUrl(data.remoteUrl))throw Error('Invalid saved ChatGPT conversation URL');
}
async function applyEffort(page,effort){
  const target=EFFORT_VALUES[effort];
  const toggle=page.getByRole('button',{name:'Select ChatGPT model'}).first();
  await toggle.waitFor({state:'visible',timeout:12000});
  await toggle.click();
  try{
    const power=page.getByRole('menuitem',{name:'Power'}).first();
    await power.waitFor({state:'visible',timeout:5000});
    let current=Number(await page.locator('[role="slider"][aria-valuenow]').first().getAttribute('aria-valuenow'));
    if(!Number.isInteger(current)||current<0||current>2)throw Error('Unsupported ChatGPT reasoning effort selector');
    for(let i=0;i<Math.abs(target-current);i++)await power.press(target>current?'ArrowRight':'ArrowLeft');
    const actual=Number(await page.locator('[role="slider"][aria-valuenow]').first().getAttribute('aria-valuenow'));
    if(actual!==target)throw Error('Requested reasoning effort is unavailable in this account');
    return effort;
  }finally{await page.keyboard.press('Escape').catch(()=>{});}
}
async function inspectAnswer(page){
 return page.evaluate(()=>{
   const vis=e=>Boolean(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
   const roots=[...document.querySelectorAll('[data-chatgpt-search-unit-key$=":assistant"]')].filter(vis);
   const last=roots.at(-1);
   const markdown=last?[...last.querySelectorAll('[class*="MarkdownRoot"]')]
       .filter(el=>!el.closest('[class*="activity-header"]')).map(el=>(el.innerText||'').trim()).filter(Boolean):[];
   const copy=[...document.querySelectorAll('button[aria-label="Copy"]')].filter(vis).length;
   const stop=[...document.querySelectorAll('button')].some(el=>vis(el)&&/^(stop|stop generating|stop response)$/i.test((el.getAttribute('aria-label')||'').trim()));
   const running=[...document.querySelectorAll('[data-talvt-turn-state="in_progress"]')].filter(vis).at(-1);
   const stageRoot=running||last;
   const steps=stageRoot?[...stageRoot.querySelectorAll('[class*="activity-header"]')].filter(vis)
       .map(el=>(el.innerText||'').trim().slice(0,500)).filter(Boolean).slice(-3):[];
   const status=steps.at(-1)||[...document.querySelectorAll('[role="status"],[aria-live="polite"]')].filter(vis)
       .map(el=>(el.innerText||'').trim()).filter(t=>/^(thinking|searching|working)/i.test(t)&&t.length<90).slice(-1)[0]||null;
   const complete=last?.closest('[data-talvt-turn-state]')?.getAttribute('data-talvt-turn-state')==='complete';
   return {count:roots.length,text:markdown.join('\n\n')||last?.innerText?.trim()||'',copy,stop,status,steps,complete};
 });
}
function createChatController({browser,emit,signedIn}){
 let active=null;
 async function pageFor(url){
  const ctx=browser.contexts()[0];
  if(!ctx)throw Error('No Chromium browser context');
  const p=ctx.pages().find(p=>{try{return new URL(p.url()).hostname==='chatgpt.com'}catch{return false;}})
      ||await ctx.newPage();
  const next=url?permittedConversationUrl(url):'https://chatgpt.com/';
  if(!next)throw Error('Invalid conversation URL');
  if(p.url()!==next){
    await p.goto(next,{waitUntil:'domcontentloaded',timeout:60000});
  }
  await p.locator('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]').first()
      .waitFor({state:'visible',timeout:40000});
  if(!await signedIn(p))throw Error('ChatGPT sign-in is required. Open the Chromium view.');
  return p;
 }
 async function send(data){
  validateChatRequest(data);
  if(active)throw Error('Another message is still generating');
  const task={id:data.id,chatId:data.chatId,remoteUrl:data.remoteUrl||null,cancelled:false,cancelRequested:false,
    deliveryError:null,retryRequested:false,retryCount:0,scheduled:data.scheduled===true};
  active=task;
  const report=(event,other={})=>emit({type:'chat',id:data.id,chatId:data.chatId,event,...other});
  let page;
  try{
   report('status',{text:'Opening conversation'});
   page=await pageFor(data.remoteUrl);
   if(task.cancelRequested){task.cancelled=true;report('cancelled');return;}
   report('status',{text:'Selecting '+data.effort+' effort'});
   const actual=await applyEffort(page,data.effort);
   report('effort',{value:actual});
   if(task.cancelRequested){task.cancelled=true;report('cancelled');return;}
   const before=await inspectAnswer(page);
   const editor=page.locator('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]').first();
   await editor.fill(data.prompt);
   const sendButton=page.getByRole('button',{name:'Send',exact:true}).last();
   await sendButton.waitFor({state:'visible',timeout:12000});
   if(task.cancelRequested){task.cancelled=true;report('cancelled');return;}
   await sendButton.click();
   report('sent');
   let previous='',lastChange=Date.now(),lastStatus='',observed=false,remoteUrl=null,lastThinking='',textBeforeRetry=null;
   let maxTime=Date.now()+300000;
   let lastErrorCheck=0;
   while(Date.now()<maxTime&&!task.cancelled){
    await delay(180);
    if(page.isClosed())throw Error('Chromium page was closed');
    const currentUrl=permittedConversationUrl(page.url());
    if(currentUrl&&currentUrl!==remoteUrl){remoteUrl=currentUrl;report('conversation',{remoteUrl});}
    // ChatGPT sometimes renders an error after Thinking, alongside a Retry
    // button. Do not interpret that turn as a successfully finished answer.
    if(Date.now()-lastErrorCheck>400 || task.deliveryError){
      lastErrorCheck=Date.now();
      const failure=await inspectDeliveryError(page);
      if(failure){
        if(!task.deliveryError){
          task.deliveryError=failure;
          report('delivery_timeout',{message:failure.message,kind:failure.kind,retryAvailable:failure.canRetry});
        }
        if(!task.retryRequested){
          if(task.scheduled && task.retryCount===0 && failure.kind!=='rate_limited'){
            task.retryRequested=true;
            await delay(1500); // only the existing ChatGPT Retry UI, never resend prompt
          }else if(task.scheduled && failure.kind==='rate_limited'){
            throw Error('ChatGPT rate limit detected; scheduled messages must pause');
          }else if(task.scheduled && task.retryCount>=1){
            throw Error('ChatGPT delivery timed out again after one Retry; scheduled job must pause.');
          }else{
            await delay(200);
            continue;
          }
        }
        if(task.cancelRequested)continue;
        task.retryRequested=false;
        if(task.retryCount>=2)throw Error('Retry limit reached');
        textBeforeRetry=(await inspectAnswer(page)).text;
        await clickDeliveryRetry(page);
        task.retryCount++;
        task.deliveryError=null;
        report('retrying',{attempt:task.retryCount,message:'Retrying the existing ChatGPT response'});
        maxTime=Date.now()+300000;
        await delay(850);
        continue;
      }
      if(task.deliveryError){
        task.deliveryError=null;
        report('retrying',{attempt:task.retryCount,message:'Delivery error cleared'});
      }
    }
    const snapshot=await inspectAnswer(page);
    if(snapshot.status&&snapshot.status!==lastStatus){
      lastStatus=snapshot.status;
      report('status',{text:snapshot.status});
    }
    const thinking=JSON.stringify(snapshot.steps||[]);
    if(thinking!==lastThinking){
      lastThinking=thinking;
      if(snapshot.steps?.length)report('thinking',{steps:snapshot.steps});
    }
    if(snapshot.count>before.count ||
      (task.retryCount>0 && textBeforeRetry!==null && snapshot.text && snapshot.text!==textBeforeRetry)){
     observed=true;
     if(snapshot.text!==previous){
      previous=snapshot.text;lastChange=Date.now();
      report('snapshot',{text:previous});
     }

     if(previous&&(snapshot.complete||snapshot.copy>before.copy)&&!snapshot.stop&&Date.now()-lastChange>600){
      report('done',{text:previous,remoteUrl});return;
     }
     // Fallback if ChatGPT changes the finished-message toolbar.
     if(previous&&!snapshot.stop&&Date.now()-lastChange>9000){
      report('done',{text:previous,remoteUrl});return;
     }
    }else if(Date.now()>maxTime-299500)report('status',{text:'Waiting for ChatGPT response'});
   }
   if(task.cancelled){report('cancelled');return;}
   throw Error(observed?'Response did not finish within five minutes':'No ChatGPT response appeared within five minutes');
  }catch(e){
   if(task.cancelRequested)report('cancelled');
   else report('error',{message:e?.message||String(e)});
  }
  finally{if(active===task)active=null;}
 }
 async function retry(id){
  const task=active;
  if(!task||task.id!==id||!task.deliveryError)throw Error('No pending ChatGPT delivery error for this request');
  if(task.retryCount>=2)throw Error('Retry limit reached');
  task.retryRequested=true;
  return true;
 }
 async function cancel(id){
  const task=active;
  if(!task||task.id!==id)return false;
  task.cancelRequested=true;
  let clicked=false;
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>{
    try{return new URL(p.url()).hostname==='chatgpt.com';}catch{return false;}
  });
  if(page&&!page.isClosed()){
    const stop=page.locator('button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop response"]').first();
    try{
      // The request might still be opening the conversation or choosing a model.
      // Give ChatGPT's Stop control time to appear before ending observation.
      await stop.waitFor({state:'visible',timeout:4500});
      await stop.click({timeout:2000});
      clicked=true;
    }catch{}
  }
  task.cancelled=true;
  if(!clicked){
    emit({type:'chat',id:task.id,chatId:task.chatId,event:'status',
      text:'Stop control unavailable; stopped local observation'});
  }
  return clicked;
 }
 return {send,cancel,retry,get busy(){return Boolean(active);},
  get activeTask(){return active?{
    id:active.id,chatId:active.chatId,remoteUrl:active.remoteUrl,
    deliveryError:active.deliveryError,retryCount:active.retryCount,scheduled:active.scheduled
  }:null;}};
}
module.exports={EFFORT_VALUES,permittedConversationUrl,validateChatRequest,applyEffort,inspectAnswer,createChatController};