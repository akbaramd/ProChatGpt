const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require('playwright');

const dir=path.resolve(__dirname,'../extension');
const conversation='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';

async function fixture({error=false,staleStop=false,initiallyGenerating=false,preparedDraft=false,
  maxSends=1,delaySeconds=0,targetConversation=null,interrupted=false,
  stuckProgressAfterStop=false,initialReceipt=null,oldError=false,maxed=false,domVariant=null,urlVariant=null,enableIncident=false,
  remountEditor=false,remountEmptyEditor=false,remountSend=false,delayedSend=false,
  timeoutError=false,staleInProgressNoStop=false}={}){
  const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  const context=await browser.newContext();
  await context.addInitScript(({maxSends,delaySeconds,targetConversation,initialReceipt})=>{
    window.__autoState=JSON.parse(localStorage.getItem('__fixtureStore')||'null')||{
      enabled:true,message:'ادامه بده',delaySeconds,maxSends,targetConversation,
      autoContinueReceipt:initialReceipt,autoContinueRunId:null,
      logs:[],metrics:{}
    };
    window.__autoState['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc'] ||= {enabled:true,message:'ادامه بده',delaySeconds,maxSends,autoContinueRunId:null};
    window.__autoState['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:receipt'] ??=initialReceipt;
    const listeners=new Set();
    window.browser={
      storage:{
        local:{
          async get(d={}){return {...d,...window.__autoState}},
          async set(v){
            const changes=Object.fromEntries(Object.entries(v).map(([k,value])=>
              [k,{oldValue:window.__autoState[k],newValue:value}]));
            Object.assign(window.__autoState,v);
            localStorage.setItem('__fixtureStore',JSON.stringify(window.__autoState));
            for(const listener of listeners)listener(changes,'local');
          }
        },
        onChanged:{addListener(fn){listeners.add(fn)}}
      }
    };
  },{maxSends,delaySeconds,targetConversation,initialReceipt});
  await context.route('https://chatgpt.com/**',route=>route.fulfill({
    status:200,contentType:'text/html; charset=utf-8',
    body:`<!doctype html><html><body>
      <main style="padding:40px">
        <div id="transcript">
          ${oldError?'<div data-talvt-turn-state="complete"><div data-chatgpt-search-unit-key="old:assistant"><div role="alert">Error in input stream</div><button aria-label="Retry" id="old-retry" onclick="window.__oldRetried++">Retry</button></div></div>':''}
          <div data-talvt-turn-state="${initiallyGenerating||interrupted||staleInProgressNoStop?'in_progress':'complete'}" id="assistant-wrapper">
            <div data-chatgpt-search-unit-key="initial:assistant">
              <p>Previous answer</p>
              ${interrupted?'<div id="interrupted-banner">Connection interrupted. Waiting for the complete answer</div>':''}
            </div>
          </div>
          ${staleStop||initiallyGenerating||interrupted?'<button data-testid="stop-button" id="stale-stop" onclick="endStop()">Stop</button>':''}
          ${error?`<div role="alert" id="delivery-error"><span>${timeoutError?'Message delivery timed out. Please try again.':'Error in input stream'}</span><div class="flex gap-2 shrink-0 mt-2 min-w-fit"><button type="button" class="no-drag cursor-interaction rounded-full border px-2 py-0.5" id="retry" onclick="recover()">Retry</button></div></div>`:''}
          ${maxed?'<div role="alert" id="max-warning">You have reached the maximum length for this conversation, but you can keep talking by starting a new chat.</div>':''}
        </div>
        <div id="prompt-textarea" contenteditable="true" role="textbox" aria-label="Ask ChatGPT"
          style="width:600px;min-height:35px;border:1px solid #ddd"></div>
        <button data-testid="send-button" id="send" disabled onclick="send()">Send</button>
      </main>
      <script>
      window.__sent=JSON.parse(localStorage.getItem('__fixtureSent')||'[]');
      window.__retried=Number(localStorage.getItem('__fixtureRetried')||0);
      window.__loads=Number(localStorage.getItem('__fixtureLoads')||0)+1;
      localStorage.setItem('__fixtureLoads',String(window.__loads));
      window.__oldRetried=0;
      let editor=document.getElementById('prompt-textarea');
      let button=document.getElementById('send');
      let editorRemounted=false,sendRemounted=false;
      function onEditorInput(){
        button.disabled=!(editor.innerText||editor.textContent||'').trim();
        button.style.display=document.getElementById('stale-stop')?'none':'';
        if(${delayedSend}){
          button.setAttribute('aria-disabled','true');
          setTimeout(()=>button.removeAttribute('aria-disabled'),750);
        }
        if(${remountEditor} && !editorRemounted){
          editorRemounted=true;
          const next=editor.cloneNode(!${remountEmptyEditor});
          editor.replaceWith(next);
          editor=next;
          editor.addEventListener('input',onEditorInput);
        }
        if(${remountSend} && !sendRemounted){
          sendRemounted=true;
          const next=button.cloneNode(true);
          button.replaceWith(next);
          button=next;
        }
      }
      editor.addEventListener('input',onEditorInput);
      // While Stop exists, ChatGPT exposes Stop instead of Send.
      if(document.getElementById('stale-stop'))button.style.display='none';
      function send(){
        if(button.disabled)return;
        const text=(editor.innerText||editor.textContent||'').trim();
        window.__sent.push(text);
        localStorage.setItem('__fixtureSent',JSON.stringify(window.__sent));
        const transcript=document.getElementById('transcript');
        const user=document.createElement('div');
        user.setAttribute('data-chatgpt-search-unit-key','test'+window.__sent.length+':user');
        user.textContent=text;transcript.appendChild(user);
        const complete=document.createElement('div');
        complete.setAttribute('data-talvt-turn-state','complete');
        const answer=document.createElement('div');
        answer.setAttribute('data-chatgpt-search-unit-key','reply'+window.__sent.length+':assistant');
        answer.innerHTML='<div class="MarkdownRoot-text">Finished</div>';
        complete.appendChild(answer);transcript.appendChild(complete);
        editor.textContent='';button.disabled=true;
      }
      function endStop(){
        document.getElementById('stale-stop')?.remove();
        if(!${stuckProgressAfterStop}){
          document.getElementById('assistant-wrapper')
            ?.setAttribute('data-talvt-turn-state','complete');
          document.getElementById('interrupted-banner')?.remove();
        }
      }
      function recover(){
        window.__retried++;
        localStorage.setItem('__fixtureRetried',String(window.__retried));
        document.getElementById('delivery-error').remove();
        // Retry must finish an assistant response, not just hide a banner.
        const wrapper=document.createElement('div');
        wrapper.setAttribute('data-talvt-turn-state','complete');
        const reply=document.createElement('div');
        reply.setAttribute('data-chatgpt-search-unit-key','recovered'+window.__retried+':assistant');
        reply.textContent='Recovered answer';
        wrapper.appendChild(reply);
        document.getElementById('transcript').appendChild(wrapper);
      }
      </script>
    </body></html>`
  }));
  const page=await context.newPage();
  await page.goto(urlVariant||conversation);
  if(preparedDraft)await page.evaluate(()=>{
    const editor=document.getElementById('prompt-textarea');
    editor.textContent='ادامه بده';
    editor.dispatchEvent(new InputEvent('input',{bubbles:true}));
  });
  if(domVariant)await page.evaluate(variant=>{
    const initial=document.querySelector('[data-chatgpt-search-unit-key="initial:assistant"]');
    initial.removeAttribute('data-chatgpt-search-unit-key');
    if(variant==='legacy'){
      initial.setAttribute('data-message-author-role','assistant');
      initial.setAttribute('data-message-id','initial');
    }else if(variant==='section'){
      const section=document.createElement('section');
      section.setAttribute('data-turn','assistant');
      section.setAttribute('data-turn-key','initial');
      section.innerHTML=initial.innerHTML;
      initial.replaceWith(section);
    }
    const btn=document.getElementById('send');
    btn.removeAttribute('data-testid');
    btn.id='composer-submit-button';
  },domVariant);
  const extensionFiles=['watchdog-core.js','conversation-settings.js','trace.js',
    'recovery-policy.js',...(enableIncident?['incident-recovery.js']:[]),
    'storage.js','in-page-ui.js','content.js'];
  if(enableIncident){
    await context.addInitScript(()=>{
      const rawNow=Date.now.bind(Date);
      Date.now=()=>rawNow()+Number(localStorage.getItem('__timeOffset')||0);
    });
    page.on('domcontentloaded',()=>{
      (async()=>{
        if(Number(await page.evaluate(()=>window.__loads))<=1)return;
        for(const file of extensionFiles)await page.addScriptTag({path:path.join(dir,file)});
      })().catch(()=>{});
    });
  }
  for(const file of extensionFiles){
    if(interrupted && file==='content.js'){
      await page.evaluate(()=>{
        window.ContinueWatchdog.DEFAULT_CFG.interruptWaitMs=1200;
        window.ContinueWatchdog.DEFAULT_CFG.interruptStableMs=800;
      });
    }
    await page.addScriptTag({path:path.join(dir,file)});
  }
  return {browser,page,context};
}
async function waitFor(page,condition,timeout=13000){
  try{
    await page.waitForFunction(condition,null,{timeout,polling:150});
  }catch(error){
    const debug=await page.evaluate(async()=>({
      sends:window.__sent,
      logs:window.__autoState?.logs?.slice(-12),
      metrics:window.__autoState?.metrics,
      trace:(await window.AutoContinueTrace?.readAll(window.browser.storage.local))?.events?.slice(-30),
      stopButton:!!window.ContinueWatchdog?.stopButton(document),
      observation:window.ContinueWatchdog?.observe(document,window),
      latestTurn:window.ContinueWatchdog?.lastVisibleTurn(document)?.key,
      ui:document.querySelector('#chatdesk-auto-continue-controls')
        ?.shadowRoot?.getElementById('runtime')?.textContent
    })).catch(e=>({error:String(e)}));
    console.error('WATCHDOG_TEST_DIAGNOSTICS',JSON.stringify(debug).slice(0,5000));
    throw error;
  }
}

test('legacy message roles and alternative composer Send ID work',async()=>{
  const {browser,page}=await fixture({domVariant:'legacy',maxSends:1});
  try{
    await waitFor(page,()=>window.__sent.length===1,18000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    const traces=await page.evaluate(()=>window.AutoContinueTrace.readAll(browser.storage.local));
    assert.ok(traces.events.some(x=>x.event==='send-clicked'));
  }finally{await browser.close();}
});
test('section[data-turn] responses are detected in alternate ChatGPT layout',async()=>{
  const {browser,page}=await fixture({domVariant:'section',maxSends:1});
  try{
    await waitFor(page,()=>window.__sent.length===1,18000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  }finally{await browser.close();}
});
test('auto-continue inserts text before checking the initially disabled Send button',async()=>{
  const {browser,page}=await fixture();
  try{
    assert.equal(await page.locator('#send').isDisabled(),true);
    await waitFor(page,()=>window.__sent.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    assert.equal(await page.locator('[data-chatgpt-search-unit-key$=":user"]').count(),1);
    await page.waitForTimeout(1700);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده'],
      'maxSends=1 must prevent a duplicate after a fast completed answer');
    const logged=await page.evaluate(()=>window.__autoState.logs);
    assert.equal(logged.filter(x=>x.action==='send').length,1);
  }finally{await browser.close();}
});

test('error in input stream clicks first-party Retry then sends one continuation',async()=>{
  const {browser,page}=await fixture({error:true});
  try{
    await waitFor(page,()=>window.__retried===1,26000);
    assert.equal(await page.locator('#delivery-error').count(),0);
    await waitFor(page,()=>window.__sent.length===1,31000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    assert.equal(await page.evaluate(()=>window.__retried),1);
  }finally{await browser.close();}
});

test('unsent human draft is never overwritten',async()=>{
  const {browser,page}=await fixture();
  try{
    // The fixture has zero delay and might send quickly, so disable and
    // prefill a real draft before re-enabling the scheduler.
    await page.evaluate(async()=>{
      await browser.storage.local.set({'autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc':{...window.__autoState['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc'],enabled:false}});
      const e=document.getElementById('prompt-textarea');
      e.textContent='متن من';
      e.dispatchEvent(new InputEvent('input',{bubbles:true}));
      await browser.storage.local.set({'autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc':{...window.__autoState['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc'],enabled:true,delaySeconds:0,maxSends:1}});
    });
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#prompt-textarea').innerText(),'متن من');
  }finally{await browser.close();}
});
test('finished assistant schedules continue even if a stale Stop button remains visible',async()=>{
  const {browser,page}=await fixture({staleStop:true});
  try{
    assert.equal(await page.locator('#stale-stop').isVisible(),true);
    await waitFor(page,()=>window.__sent.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    assert.equal(await page.locator('#stale-stop').count(),0,'Stale Stop must be dismissed first');
    await page.waitForTimeout(1650);
    assert.equal(await page.evaluate(()=>window.__sent.length),1);
  }finally{await browser.close();}
});

test('transition from in-progress to completed turn triggers the next follow-up',async()=>{
  const {browser,page}=await fixture({initiallyGenerating:true});
  try{
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(()=>window.__sent.length),0);
    await page.locator('[data-talvt-turn-state="in_progress"]').evaluate(el=>
      el.setAttribute('data-talvt-turn-state','complete'));
    await waitFor(page,()=>window.__sent.length===1);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  }finally{await browser.close();}
});
test('prepared matching continuation is sent once after releasing stale Stop',async()=>{
  const {browser,page}=await fixture({staleStop:true,preparedDraft:true});
  try{
    assert.equal(await page.locator('#prompt-textarea').innerText(),'ادامه بده');
    await waitFor(page,()=>window.__sent.length===1,30000);
    assert.equal(await page.locator('#stale-stop').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(()=>window.__sent.length),1);
  }finally{await browser.close();}
});
test('eight consecutive completed answers trigger eight distinct continuations without refresh',async()=>{
  const {browser,page}=await fixture({maxSends:8});
  try{
    await waitFor(page,()=>window.__sent.length===8,75000);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>window.__sent.length),8);
    const texts=await page.evaluate(()=>window.__sent);
    assert.deepEqual(texts,Array(8).fill('ادامه بده'));
    const diagnostics=await page.evaluate(()=>window.__autoState);
    assert.equal(diagnostics.logs.filter(x=>x.action==='send').length,8);
    assert.equal(diagnostics.metrics.sends,8);
  }finally{await browser.close();}
});

test('a different conversation is disabled until independently configured',async()=>{
  const {browser,page}=await fixture({maxSends:2,delaySeconds:60});
  try{
    await page.evaluate(()=>history.pushState({},'','/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    await page.waitForTimeout(3500);
    assert.deepEqual(await page.evaluate(()=>window.__sent),[]);
    const status=await page.locator('#chatdesk-auto-continue-controls')
      .evaluate(host=>host.shadowRoot.getElementById('short').textContent);
    assert.equal(status,'Off');
  }finally{await browser.close();}
});

test('SPA switching loads independent settings for each conversation',async()=>{
  const {browser,page}=await fixture({maxSends:1,delaySeconds:60});
  const b='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  try{
    await page.evaluate(async path=>{
      await window.ContinueConversationSettings.save(browser.storage.local,path,{
        enabled:true,message:'Continue conversation B',maxSends:3,delaySeconds:60
      });
      history.pushState({},'',path);
    },b);
    await waitFor(page,()=>document.querySelector('#chatdesk-auto-continue-controls')
      ?.shadowRoot?.getElementById('message')?.value==='Continue conversation B',12000);
    await page.evaluate(()=>history.pushState({},'','/c/12345678-1234-1234-1234-123456789abc'));
    await waitFor(page,()=>document.querySelector('#chatdesk-auto-continue-controls')
      ?.shadowRoot?.getElementById('message')?.value==='ادامه بده',12000);
    assert.equal(await page.evaluate(()=>window.__sent.length),0,
      'Neither job sends before its configured delay');
  }finally{await browser.close();}
});

test('telemetry heartbeat persists even when the assistant is still generating',async()=>{
  const {browser,page}=await fixture({maxSends:1,initiallyGenerating:true});
  try{
    await waitFor(page,()=>window.__autoState.logs.some(x=>x.reason==='heartbeat'),16000);
    const entries=await page.evaluate(()=>window.__autoState.logs.filter(x=>x.reason==='heartbeat'));
    assert.ok(entries.length>=1);
    assert.equal(typeof entries[0].generating,'boolean');
  }finally{await browser.close();}
});
test('interrupted response releases Stop and submits one continuation',async()=>{
  const {browser,page}=await fixture({interrupted:true,maxSends:1});
  try{
    assert.equal(await page.locator('#stale-stop').count(),1);
    await waitFor(page,()=>window.__sent.length===1,35000);
    assert.equal(await page.locator('#stale-stop').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(()=>window.__sent.length),1);
    const logs=await page.evaluate(()=>window.__autoState.logs);
    assert.equal(logs.filter(x=>x.reason==='interruption-stop-clicked').length,1);
  }finally{await browser.close();}
});
test('stale in-progress marker after Stop disappears still allows visible Send',async()=>{
  const {browser,page}=await fixture({interrupted:true,stuckProgressAfterStop:true,maxSends:1});
  try{
    await waitFor(page,()=>window.__sent.length===1,35000);
    assert.equal(await page.locator('#stale-stop').count(),0);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    const logs=await page.evaluate(()=>window.__autoState.logs);
    assert.equal(logs.filter(x=>x.reason==='interruption-stop-clicked').length,1);
  }finally{await browser.close();}
});
test('durable receipt prevents resending the same assistant on a freshly loaded tab',async()=>{
  const receipt={
    conversation:'/c/12345678-1234-1234-1234-123456789abc',
    assistantKey:'initial:assistant',runId:'legacy',sends:1,at:Date.now()
  };
  const {browser,page}=await fixture({maxSends:0,initialReceipt:receipt});
  try{
    await page.waitForTimeout(6000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),[]);
    await page.evaluate(()=>{
      const wrapper=document.createElement('div');
      wrapper.setAttribute('data-talvt-turn-state','complete');
      const answer=document.createElement('div');
      answer.setAttribute('data-chatgpt-search-unit-key','next:assistant');
      answer.textContent='A different completed response';
      wrapper.appendChild(answer);
      document.getElementById('transcript').appendChild(wrapper);
    });
    await waitFor(page,()=>window.__sent.length===1,16000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  }finally{await browser.close();}
});

test('max follow-up count remains enforced after reload from durable receipt',async()=>{
  const receipt={
    conversation:'/c/12345678-1234-1234-1234-123456789abc',
    assistantKey:'prior:assistant',runId:'legacy',sends:1,at:Date.now()
  };
  const {browser,page}=await fixture({maxSends:1,initialReceipt:receipt});
  try{
    await page.waitForTimeout(7500);
    assert.equal(await page.evaluate(()=>window.__sent.length),0);
  }finally{await browser.close();}
});

test('two open tabs for one chat elect only one automatic sender',async()=>{
  const {browser,page,context}=await fixture({maxSends:2});
  try{
    const second=await context.newPage();
    await second.goto(conversation);
    for(const file of ['watchdog-core.js','conversation-settings.js','trace.js','recovery-policy.js','storage.js','in-page-ui.js','content.js'])
      await second.addScriptTag({path:path.join(dir,file)});
    await waitFor(page,()=>window.__sent.length===2,30000);
    await second.waitForTimeout(2500);
    assert.equal(await second.evaluate(()=>window.__sent.length),0);
    const status=await second.locator('#chatdesk-auto-continue-controls')
      .evaluate(host=>host.shadowRoot.getElementById('runtime').textContent);
    assert.match(status,/Another ChatGPT tab owns Auto-Continue/);
  }finally{await browser.close();}
});
test('a historical Retry error does not block a newly completed assistant turn',async()=>{
  const {browser,page}=await fixture({oldError:true,maxSends:1});
  try{
    assert.equal(await page.locator('#old-retry').count(),1);
    await waitFor(page,()=>window.__sent.length===1,21000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    assert.equal(await page.evaluate(()=>window.__oldRetried),0);
  }finally{await browser.close();}
});
test('ChatGPT maximum-conversation notice blocks automatic continuation',async()=>{
  const {browser,page}=await fixture({maxed:true,maxSends:1});
  try{
    await waitFor(page,()=>document.querySelector('#chatdesk-auto-continue-controls')
      ?.shadowRoot?.getElementById('runtime')?.textContent
      ?.includes('maximum length'),12000);
    await page.waitForTimeout(3000);
    assert.equal(await page.evaluate(()=>window.__sent.length),0);
    const obs=await page.evaluate(()=>window.ContinueWatchdog.observe(document,window));
    assert.equal(obs.conversationMaxed,true);
  }finally{await browser.close();}
});
test('uc conversation URL shares the same configuration and can submit',async()=>{
  const {browser,page}=await fixture({urlVariant:'https://chatgpt.com/uc/12345678-1234-1234-1234-123456789abc',maxSends:1});
  try{
    await waitFor(page,()=>window.__sent.length===1,16000);
    assert.equal(await page.evaluate(()=>window.ContinueConversationSettings.pathFrom(location.href)),
      '/c/12345678-1234-1234-1234-123456789abc');
  }finally{await browser.close();}
});
async function advanceIncidentClock(page,total){
 await page.evaluate(ms=>{
   localStorage.setItem('__timeOffset',String(ms));
   window.dispatchEvent(new Event('focus'));
 },total);
}
test('incident interruption reloads, stops once and continues with stale in-progress marker',async()=>{
 const {browser,page}=await fixture({interrupted:true,stuckProgressAfterStop:true,maxSends:1,enableIncident:true});
 try{
  await waitFor(page,()=>window.__autoState['autoContinue:conversation:'+location.pathname+':incident']?.phase==='watch',20000);
  await page.evaluate(()=>{
    const rawNow=Date.now.bind(Date);
    Date.now=()=>rawNow()+Number(localStorage.getItem('__timeOffset')||0);
  });
  await advanceIncidentClock(page,90000);
  await waitFor(page,()=>Number(localStorage.getItem('__fixtureLoads')||0)===2,30000);
  await advanceIncidentClock(page,180000);
  await waitFor(page,()=>!document.getElementById('stale-stop'),30000);
  await advanceIncidentClock(page,270000);
  await waitFor(page,()=>window.__sent.length===1,30000);
  assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  assert.equal(await page.evaluate(()=>window.__loads),2);
 }finally{await browser.close();}
});
test('first-party Retry for a timeout fires before any refresh, then continues once',async()=>{
 const {browser,page}=await fixture({
  error:true,timeoutError:true,staleInProgressNoStop:true,maxSends:1,enableIncident:true
 });
 try{
  await waitFor(page,()=>window.__autoState[
   'autoContinue:conversation:'+location.pathname+':incident']?.phase==='watch',18000);
  await waitFor(page,()=>window.__retried===1,24000);
  assert.equal(await page.evaluate(()=>window.__loads),1,'do not reload before the Retry button');
  assert.equal(await page.locator('#delivery-error').count(),0);
  await waitFor(page,()=>window.__sent.length===1,26000);
  assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  const events=await page.evaluate(async()=>(
   await window.AutoContinueTrace.readAll(browser.storage.local)).events);
  assert.equal(events.filter(e=>e.event==='incident-retry-clicked').length,1);
  assert.equal(events.some(e=>e.event==='incident-reload'),false);
 }finally{await browser.close();}
});
test('controlled composer remount and delayed Send enablement still sends once',async()=>{
  const {browser,page}=await fixture({
    remountEditor:true,remountSend:true,delayedSend:true,maxSends:1
  });
  try{
    await waitFor(page,()=>window.__sent.length===1,21000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(()=>window.__sent.length),1);
    const events=await page.evaluate(async()=>(
      await window.AutoContinueTrace.readAll(browser.storage.local)).events);
    assert.equal(events.filter(e=>e.event==='send-clicked').length,1);
  }finally{await browser.close();}
});
test('empty replacement editor is repaired without duplicating text or sends',async()=>{
  const {browser,page}=await fixture({
    remountEditor:true,remountEmptyEditor:true,delayedSend:true,maxSends:1
  });
  try{
    await waitFor(page,()=>window.__sent.length===1,21000);
    assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(()=>window.__sent.length),1);
  }finally{await browser.close();}
});
test('a click that sends then throws must never be resent',async()=>{
 const {browser,page}=await fixture({maxSends:1,delaySeconds:3});
 try{
  await page.evaluate(()=>{
   const btn=document.getElementById('send');
   btn.click=function(){
    HTMLElement.prototype.click.call(this);
    throw Error('failure after first-party click dispatched');
   };
  });
  await waitFor(page,()=>window.__sent.length===1,22000);
  await waitFor(page,async()=>{
   const events=(await window.AutoContinueTrace.readAll(browser.storage.local)).events;
   return events.some(e=>e.event==='send-exception'&&e.phase==='after-click');
  },16000);
  await page.waitForTimeout(5000);
  assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
  const detail=await page.evaluate(async()=>({
   events:(await window.AutoContinueTrace.readAll(browser.storage.local)).events,
   receipt:window.__autoState['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:receipt']
  }));
  assert.equal(detail.events.filter(e=>e.event==='send-prepare').length,1);
  assert.ok(detail.receipt?.assistantKey);
 }finally{await browser.close();}
});
test('rapid SPA navigation cannot let stale Web Lock release cancel new owner',async()=>{
 const {browser,page}=await fixture({maxSends:1,delaySeconds:60});
 const first='/c/12345678-1234-1234-1234-123456789abc';
 const second='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 try{
  await page.evaluate(async path=>{
   await window.ContinueConversationSettings.save(browser.storage.local,path,{
    enabled:true,message:'B continue',maxSends:1,delaySeconds:60
   });
  },second);
  await waitFor(page,async()=>{
   const events=(await window.AutoContinueTrace.readAll(browser.storage.local)).events;
   return events.some(e=>e.event==='leader-acquired');
  },18000);
  for(let i=0;i<5;i++){
   await page.evaluate(path=>history.pushState({},'',path),second);
   await page.waitForTimeout(450);
   await page.evaluate(path=>history.pushState({},'',path),first);
   await page.waitForTimeout(450);
  }
  await waitFor(page,()=>document.querySelector('#chatdesk-auto-continue-controls')
   ?.shadowRoot?.getElementById('runtime')?.textContent
   ?.includes('Next follow-up in'),18000);
  await waitFor(page,async()=>{
   const traces=(await window.AutoContinueTrace.readAll(browser.storage.local)).events;
   return traces.filter(e=>e.event==='leader-acquired').length>=2;
  },18000);
  const traces=await page.evaluate(async()=>(
   await window.AutoContinueTrace.readAll(browser.storage.local)).events);
  assert.equal(traces.some(e=>e.event==='send-clicked'),false);
 }finally{await browser.close();}
});
test('incident reload is deferred if a manual draft appears while persisting',async()=>{
 const {browser,page}=await fixture({error:true,maxSends:1,enableIncident:true});
 const key='autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:incident';
 try{
  await waitFor(page,()=>window.__autoState[
   'autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:incident'
  ]?.phase==='watch',19000);
  await page.evaluate(()=>{
   const store=window.browser.storage.local;
   const original=store.set.bind(store);
   window.__sabotagedReload=false;
   store.set=async values=>{
    const hasReload=Object.entries(values).some(([k,v])=>
     k.endsWith(':incident')&&v?.phase==='reloaded');
    await original(values);
    if(hasReload&&!window.__sabotagedReload){
     window.__sabotagedReload=true;
     const ed=document.getElementById('prompt-textarea');
     ed.textContent='Manual draft';
     ed.dispatchEvent(new InputEvent('input',{bubbles:true}));
    }
   };
   const rawNow=Date.now.bind(Date);
   Date.now=()=>rawNow()+Number(localStorage.getItem('__timeOffset')||0);
  });
  await advanceIncidentClock(page,90000);
  await waitFor(page,()=>window.__sabotagedReload,20000);
  await waitFor(page,()=>window.__autoState[
   'autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc:incident'
  ]?.phase==='watch',16000);
  assert.equal(await page.evaluate(()=>window.__loads),1);
  assert.equal(await page.locator('#prompt-textarea').innerText(),'Manual draft');
  assert.equal(await page.evaluate(()=>window.__sent.length),0);
 }finally{await browser.close();}
});
test('historical in_progress marker cannot block a stable current answer',async()=>{
 const {browser,page}=await fixture({initiallyGenerating:true,maxSends:1});
 try{
  await page.evaluate(()=>{
   const old=document.createElement('div');
   old.setAttribute('data-talvt-turn-state','in_progress');
   const oldMsg=document.createElement('div');
   oldMsg.setAttribute('data-chatgpt-search-unit-key','historical:assistant');
   oldMsg.textContent='Old unfinished turn';
   old.appendChild(oldMsg);
   document.getElementById('transcript').prepend(old);
   document.getElementById('stale-stop').remove();
   document.getElementById('assistant-wrapper')
    .removeAttribute('data-talvt-turn-state');
  });
  await waitFor(page,()=>window.__sent.length===1,26000);
  assert.deepEqual(await page.evaluate(()=>window.__sent),['ادامه بده']);
 }finally{await browser.close();}
});