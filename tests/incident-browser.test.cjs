const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),DIR=path.resolve(__dirname,'../extension'),CHAT_URL='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
const HTML="<!doctype html><html><body><main>\n<div id=\"transcript\"><div id=\"wrap\" data-talvt-turn-state=\"complete\"><div id=\"answer\" data-chatgpt-search-unit-key=\"old:assistant\">Previous answer</div></div></div>\n<div id=\"prompt-textarea\" role=\"textbox\" contenteditable=\"true\" style=\"min-width:600px;min-height:40px\"></div>\n<button data-testid=\"send-button\" id=\"send\" disabled>Send</button></main>\n<script>\n(()=>{\n const f=JSON.parse(localStorage.getItem('fixture'));f.visits++;const save=()=>localStorage.setItem('fixture',JSON.stringify(f));save();\n const transcript=document.getElementById('transcript'),wrap=document.getElementById('wrap'),answer=document.getElementById('answer');\n const btn=document.getElementById('send'),editor=document.getElementById('prompt-textarea');\n const showRetry=f.mode==='retry'&&!f.retried || f.mode==='ambiguous'&&f.visits===1;\n if(showRetry){\n   const alert=document.createElement('div');alert.id='alert';alert.setAttribute('role','alert');\n   alert.appendChild(document.createTextNode('Error in input stream '));\n   const retry=document.createElement('button');retry.textContent='Retry';\n   retry.addEventListener('click',()=>{\n     f.retried++;save();alert.remove();\n     const node=document.createElement('div');node.setAttribute('data-talvt-turn-state','complete');\n     const a=document.createElement('div');a.setAttribute('data-chatgpt-search-unit-key','new:assistant');\n     a.textContent='Recovered final answer';node.appendChild(a);transcript.appendChild(node);\n   });alert.appendChild(retry);transcript.appendChild(alert);\n }\n if(f.mode==='interrupted'||f.mode==='progress'){\n   wrap.setAttribute('data-talvt-turn-state','in_progress');\n   const warning=document.createElement('div');warning.id='warning';\n   warning.textContent='Connection interrupted. Waiting for the complete answer';answer.appendChild(warning);\n   const stop=document.createElement('button');stop.id='stop';stop.setAttribute('data-testid','stop-button');stop.textContent='Stop';\n   stop.addEventListener('click',()=>{f.stops++;save();stop.remove();warning.remove();wrap.setAttribute('data-talvt-turn-state','complete')});\n   transcript.appendChild(stop);btn.style.display='none';\n   if(f.mode==='progress'&&f.visits>=2){\n     let n=0;const timer=setInterval(()=>{\n       n++;answer.firstChild.textContent+='.';\n       if(n===8){clearInterval(timer);warning.remove();stop.remove();wrap.setAttribute('data-talvt-turn-state','complete')}\n     },350);\n   }\n }\n if(f.mode==='rate'){\n   const a=document.createElement('div');a.setAttribute('role','alert');a.textContent='You have reached your limit. Try again later';transcript.appendChild(a);\n }\n editor.addEventListener('input',()=>{btn.disabled=!editor.textContent.trim();btn.style.display=document.getElementById('stop')?'none':''});\n btn.addEventListener('click',()=>{\n   if(btn.disabled)return;f.sends++;save();\n   const u=document.createElement('div');u.setAttribute('data-chatgpt-search-unit-key','u'+f.sends+':user');\n   u.textContent=editor.textContent;transcript.appendChild(u);\n   const w=document.createElement('div');w.setAttribute('data-talvt-turn-state','complete');\n   const a=document.createElement('div');a.setAttribute('data-chatgpt-search-unit-key','r'+f.sends+':assistant');\n   a.textContent='New finished response';w.appendChild(a);transcript.appendChild(w);\n   editor.textContent='';btn.disabled=true;\n });\n if(f.mode==='draft'){editor.textContent='Human draft';editor.dispatchEvent(new Event('input',{bubbles:true}))}\n})();\n</script>\n<script src=\"/ext/watchdog-core.js\"></script><script src=\"/ext/conversation-settings.js\"></script>\n<script src=\"/ext/trace.js\"></script><script src=\"/ext/recovery-policy.js\"></script>\n<script src=\"/ext/incident-recovery.js\"></script><script src=\"/ext/storage.js\"></script>\n<script src=\"/ext/in-page-ui.js\"></script><script src=\"/ext/content.js\"></script></body></html>";
async function fixture(mode){
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const context=await browser.newContext();
 await context.addInitScript(mode=>{
   if(!localStorage.getItem('fixture'))localStorage.setItem('fixture',JSON.stringify({mode,visits:0,stops:0,retried:0,sends:0}));
   const key='autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc';
   if(!localStorage.getItem('ext-data'))localStorage.setItem('ext-data',JSON.stringify({
     [key]:{enabled:true,message:'ادامه بده',delaySeconds:0,maxSends:1,autoContinueRunId:null}
   }));
   const listeners=new Set(),read=()=>JSON.parse(localStorage.getItem('ext-data')||'{}');
   window.browser={storage:{local:{
     async get(defaults={}){return defaults===null?read():{...defaults,...read()}},
     async set(values){const prev=read(),changes={};
       for(const [k,v] of Object.entries(values))changes[k]={oldValue:prev[k],newValue:v};
       localStorage.setItem('ext-data',JSON.stringify({...prev,...values}));
       for(const fn of listeners)fn(changes,'local');
     },
     async remove(keys){const data=read();for(const k of keys)delete data[k];
       localStorage.setItem('ext-data',JSON.stringify(data))}
   },onChanged:{addListener(fn){listeners.add(fn)}}},runtime:{async sendMessage(){return {ok:true}}}};
 },mode);
 await context.route('https://chatgpt.com/**',route=>{
   const pathname=new URL(route.request().url()).pathname;
   if(pathname.startsWith('/ext/')){
     const name=pathname.slice(5);let body=fs.readFileSync(path.join(DIR,name),'utf8');
     if(name==='incident-recovery.js')body=body
       .replace('RETRY_GRACE_MS=10000','RETRY_GRACE_MS=300')
       .replace('INTERRUPT_GRACE_MS=45000','INTERRUPT_GRACE_MS=500')
       .replace('QUIET_MS=30000',mode==='progress'?'QUIET_MS=1800':'QUIET_MS=350')
       .replace('AFTER_RELOAD_MS=30000','AFTER_RELOAD_MS=350')
       .replace('STOP_GRACE_MS=15000','STOP_GRACE_MS=350')
       .replace('RETRY_TIMEOUT_MS=120000','RETRY_TIMEOUT_MS=6000');
     return route.fulfill({status:200,contentType:'text/javascript',body});
   }
   return route.fulfill({status:200,contentType:'text/html',body:HTML});
 });
 const page=await context.newPage();await page.goto(CHAT_URL);
 return {page,browser};
}
const read=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('fixture')));
const incident=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('ext-data'))?.['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:incident']);
const until=async(p,fn,timeout=20000)=>{
 try{return await p.waitForFunction(fn,null,{timeout,polling:150});}
 catch(e){
   const debug=await p.evaluate(()=>({
     fixture:JSON.parse(localStorage.getItem('fixture')),
     incident:JSON.parse(localStorage.getItem('ext-data'))?.[
       'autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:incident'],
     traces:Object.entries(JSON.parse(localStorage.getItem('ext-data'))||{})
       .filter(([k])=>k.startsWith('autoContinue:trace:'))
       .flatMap(([,v])=>v.events||[]).slice(-25),
     ui:document.querySelector('#chatdesk-auto-continue-controls')
       ?.shadowRoot?.getElementById('runtime')?.textContent,
     observer:window.ContinueWatchdog?.observe(document,window)
   })).catch(err=>({error:String(err)}));
   console.error('INCIDENT_BROWSER_DEBUG',JSON.stringify(debug).slice(0,12000));
   throw e;
 }
};
test('real reload precedes Retry and next prompt sends exactly once',async()=>{
 const {page,browser}=await fixture('retry');
 try{
   await until(page,()=>JSON.parse(localStorage.getItem('fixture')).sends===1);
   const f=await read(page),i=await incident(page);
   assert.equal(f.visits,2);assert.equal(f.retried,1);assert.equal(f.sends,1);
   assert.equal(f.stops,0);assert.equal(i.refreshes,1);assert.equal(i.retries,1);
 }finally{await browser.close()}
});
test('interruption reload precedes one Stop; continuation follows',async()=>{
 const {page,browser}=await fixture('interrupted');
 try{
   await until(page,()=>JSON.parse(localStorage.getItem('fixture')).sends===1);
   const f=await read(page),i=await incident(page);
   assert.equal(f.visits,2);assert.equal(f.stops,1);assert.equal(f.sends,1);
   assert.equal(i.refreshes,1);assert.equal(i.stops,1);
 }finally{await browser.close()}
});
test('active server progress after reload never receives Stop',async()=>{
 const {page,browser}=await fixture('progress');
 try{
   await until(page,()=>JSON.parse(localStorage.getItem('fixture')).sends===1,50000);
   const f=await read(page);assert.equal(f.visits,2);assert.equal(f.stops,0);
 }finally{await browser.close()}
});
test('vanished error without a new answer does not send',async()=>{
 const {page,browser}=await fixture('ambiguous');
 try{
   await until(page,()=>JSON.parse(localStorage.getItem('fixture')).visits>=2);
   await page.waitForTimeout(4500);
   const f=await read(page);assert.equal(f.sends,0);assert.equal(f.retried,0);
 }finally{await browser.close()}
});
test('rate limits and manual drafts never cause a recovery send or reload',async()=>{
 for(const mode of ['rate','draft']){
   const {page,browser}=await fixture(mode);
   try{await page.waitForTimeout(4000);const f=await read(page);
     assert.equal(f.visits,1);assert.equal(f.sends,0)}
   finally{await browser.close()}
 }
});
test('stale interruption in an earlier turn is ignored while current bottom Retry is detected',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.setContent(`<!doctype html><html><body><main>
    <div data-talvt-turn-state="complete">
      <div data-chatgpt-search-unit-key="older:assistant">Older partial answer
        <p>Connection interrupted. Waiting for the complete answer</p>
      </div>
    </div>
    <div data-talvt-turn-state="complete">
      <div data-chatgpt-search-unit-key="newer:assistant">Completed new response</div>
    </div>
    <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
    <button data-testid="send-button" disabled>Send</button>
  </main></body></html>`);
  await page.addScriptTag({path:path.join(DIR,'watchdog-core.js')});
  const initial=await page.evaluate(()=>{
    const core=window.ContinueWatchdog;
    return {interrupted:core.detectInterrupted(document,true),
      completed:core.lastCompletedAssistant(document),errored:core.detectErrorBanner(document)};
  });
  assert.deepEqual(initial,{interrupted:false,completed:'newer:assistant',errored:false});
  await page.locator('main').evaluate(root=>{
    const alert=document.createElement('div');
    alert.setAttribute('role','alert');
    alert.textContent='Error in input stream ';
    const retry=document.createElement('button');retry.textContent='Retry';
    alert.appendChild(retry);root.appendChild(alert);
  });
  const active=await page.evaluate(()=>{
    const core=window.ContinueWatchdog;
    return {interrupted:core.detectInterrupted(document,true),
      errored:core.detectErrorBanner(document),retry:!!core.retryButton(document)};
  });
  assert.deepEqual(active,{interrupted:false,errored:true,retry:true});
 }finally{await browser.close()}
});
