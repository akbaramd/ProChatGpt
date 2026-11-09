'use strict';
/** Playwright observer attached to the same in-process Chromium WebView2
 *  used by ChatDesk. No new browser window, no automatic Cloudflare challenge
 *  interaction, no credential/session export, no private ChatGPT endpoints.
 */
const {chromium}=require('playwright');
const {createChatController}=require('./chat-controller.cjs');
const {createBrowserSync}=require('./browser-sync.cjs');
const {createRecurringScheduler}=require('./recurring-scheduler.cjs');
const port=Number(process.env.CHATDESK_CDP_PORT||0);
let scheduler;
const emit=x=>{process.stdout.write(JSON.stringify(x)+'\n');if(x?.type==='chat')scheduler?.handleChatEvent(x);};
let browser,stopping=false,authed=false,checking=false,timer,lastState='',chatController,browserSync;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
function allowedUrl(value) {
  try {
    const u=new URL(value);
    return u.protocol==='https:' && u.hostname==='chatgpt.com' &&
      !/^\/(auth|login|signup|api|share)(\/|$)/i.test(u.pathname);
  }catch{return false;}
}
async function signedIn(page) {
  if(page.isClosed()||!allowedUrl(page.url())) return false;
  try {
    return await page.evaluate(()=>{
      const vis=x=>Boolean(x && x.getClientRects().length && getComputedStyle(x).visibility!=='hidden');
      // ChatGPT renders duplicate desktop/mobile controls. The first matching
      // profile button may be hidden; require ANY visible matching control.
      const anyVisible = selector => Array.from(document.querySelectorAll(selector)).some(vis);
      const prompt=anyVisible('#prompt-textarea,[data-testid="composer"],[contenteditable="true"][data-testid*="prompt"],[contenteditable="true"][role="textbox"],[contenteditable="true"]');
      const account=anyVisible(
        '[data-testid="profile-button"],[data-testid="user-menu-button"],' +
        'button[aria-label="Open profile menu"],button[aria-label*="Profile menu"],' +
        'button[aria-label*="Account menu"]'
      );
      const login=Array.from(document.querySelectorAll('button,a')).some(el=>vis(el)&&/^(log in|login|sign in|sign up)$/i.test((el.textContent||'').trim()));
      return prompt&&account&&!anyVisible('input[type="password"]')&&!login;
    });
  }catch{return false;}
}
async function scan(){
  if(checking||stopping||!browser)return;
  checking=true;
  try{
    const context=browser.contexts()[0];
    for(const page of context?.pages()||[]){
      if(await signedIn(page)){
        if(!authed){authed=true;emit({type:'authenticated',source:'embedded-playwright-visible-account-ui'});}
        else emit({type:'verified'});
        return;
      }
    }
    if(authed){authed=false;emit({type:'signed_out'});}
    const titles=await Promise.all((context?.pages()||[]).filter(p=>!p.isClosed()).map(p=>p.title().catch(()=>'')));
    const challenge=titles.some(x=>/just a moment|checking your browser|attention required/i.test(x));
    const state=challenge?'challenge':'awaiting_login';
    if(lastState!==state){
      lastState=state;
      emit({type:state,message:challenge?'Complete the Cloudflare challenge manually in the embedded Chromium browser.':'Complete sign-in in the embedded Chromium browser.'});
    }
  }catch(e){emit({type:'warning',message:e.message});}
  finally{checking=false;}
}
async function main(){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid WebView2 CDP port');
  let lastError;
  for(let i=0;i<30&&!browser;i++){
    try{browser=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:2000});}
    catch(e){lastError=e;await delay(350);}
  }
  if(!browser)throw Error('WebView2 CDP connection failed: '+lastError?.message);
  chatController=createChatController({browser,emit,signedIn});
  browserSync=createBrowserSync({browser,emit,signedIn,busy:()=>chatController.busy});
  scheduler=createRecurringScheduler({
    controller:chatController,browser,emit,signedIn,
    storagePath:process.env.CHATDESK_SCHEDULER_FILE||undefined
  });
  scheduler.status();
  emit({type:'browser_opened',engine:'playwright-chromium-webview2',embedded:true});
  const context=browser.contexts()[0];
  const listen=p=>p.on('framenavigated',frame=>{if(frame===p.mainFrame())setTimeout(scan,900);});
  for(const p of context?.pages()||[])listen(p);
  context?.on('page',p=>{listen(p);setTimeout(scan,1000);});
  browser.on('disconnected',()=>{if(!stopping)emit({type:'error',message:'WebView2 CDP was disconnected'});process.exit(0);});
  timer=setInterval(scan,1300);
  await scan();
}
async function stop(){
  stopping=true;
  scheduler?.close();
  if(timer)clearInterval(timer);
  await browser?.close().catch(()=>{});
  process.exit(0);
}
if (require.main===module) {
process.stdin.setEncoding('utf8');
let inputBuffer='';
process.stdin.on('data',chunk=>{
  inputBuffer+=chunk;
  if(inputBuffer.length>30000){inputBuffer='';emit({type:'warning',message:'Browser command exceeded maximum length'});return;}
  let pos;
  while((pos=inputBuffer.indexOf('\n'))>=0){
    const raw=inputBuffer.slice(0,pos).trim();
    inputBuffer=inputBuffer.slice(pos+1);
    if(!raw)continue;
    if(raw==='quit'){stop().catch(()=>process.exit(1));continue;}
    if(raw==='check'){lastState='';scan().catch(()=>{});continue;}
    try{
      const cmd=JSON.parse(raw);
      if(cmd.type==='chat_send'){
        if(!chatController){emit({type:'chat',event:'error',id:cmd.id||'',message:'Playwright not ready'});continue;}
        chatController.send(cmd).catch(e=>emit({type:'chat',event:'error',id:cmd.id||'',message:e.message}));
      }else if(cmd.type==='chat_cancel'){
        chatController?.cancel(cmd.id).catch(error=>emit({type:'chat',id:cmd.id||'',event:'status',text:'Stop not available: '+error.message}));
      }else if(cmd.type==='chat_retry'){
        chatController?.retry(cmd.id).catch(error=>emit({type:'chat',id:cmd.id||'',event:'retry_failed',message:error.message}));
      }else if(cmd.type==='sync'){
        browserSync?.run(cmd).catch(e=>emit({type:'sync',requestId:cmd.requestId||'',action:cmd.action||'',ok:false,error:e.message}));
      }else if(cmd.type==='schedule'){
        try{
          if(!scheduler)throw Error('Chromium scheduler is not ready');
          switch(cmd.action){
            case 'start':scheduler.start(cmd.job);break;
            case 'pause':scheduler.pause();break;
            case 'resume':scheduler.resume();break;
            case 'stop':scheduler.stop().catch(e=>emit({type:'schedule',event:'error',message:e.message}));break;
            case 'runNow':scheduler.runNow().catch(e=>emit({type:'schedule',event:'error',message:e.message}));break;
            case 'status':scheduler.status();break;
            default:throw Error('Unsupported schedule command');
          }
        }catch(e){emit({type:'schedule',event:'error',message:e.message});}
      }else emit({type:'warning',message:'Unsupported browser command'});
    }catch(error){emit({type:'warning',message:'Invalid command: '+error.message});}
  }
});
process.on('SIGTERM',()=>stop().catch(()=>process.exit(1)));
main().catch(e=>{emit({type:'error',message:e.message});process.exit(1);});
}
module.exports={allowedUrl,signedIn};