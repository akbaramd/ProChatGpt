const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {inspectDeliveryError,clickDeliveryRetry}=require('../scripts/delivery-recovery.cjs');
const {createChatController}=require('../scripts/chat-controller.cjs');

const HTML=`<!doctype html><html><body>
 <button aria-label="Select ChatGPT model" onclick="document.getElementById('power').hidden=false">Model</button>
 <div id="power" role="menuitem" hidden>Power</div>
 <div role="slider" aria-valuenow="1"></div>
 <div contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div>
 <button aria-label="Send" onclick="showTimeout()">Send</button>
 <div id="turn"></div>
 <script>
 window.__retryCount=0;
 function showTimeout(){
  document.getElementById('turn').innerHTML='<div role="alert" id="problem"><span>Message delivery timed out. Please try again.</span><button onclick="onRetry()">Retry</button></div>';
 }
 function onRetry(){
  window.__retryCount++;
  document.getElementById('turn').innerHTML='<div data-talvt-turn-state="complete"><div data-chatgpt-search-unit-key="fallback-test:assistant"><div class="MarkdownRoot-Test">Response recovered</div></div></div><button aria-label="Copy">Copy</button>';
 }
 </script>
 </body></html>`;

test('Finds visible ChatGPT delivery timeout and retries the same UI response',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:HTML}));
  await page.goto('https://chatgpt.com/');
  assert.equal(await inspectDeliveryError(page),null);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  const failure=await inspectDeliveryError(page);
  assert.equal(failure.kind,'delivery_timeout');
  assert.equal(failure.canRetry,true);
  assert.match(failure.message,/Message delivery timed out/);
  await clickDeliveryRetry(page);
  assert.equal(await page.evaluate(()=>window.__retryCount),1);
  assert.equal(await inspectDeliveryError(page),null);
  assert.equal(await page.locator('[class*="MarkdownRoot"]').innerText(),'Response recovered');
 }finally{await browser.close();}
});

test('Quoting the error message without a Retry control is not a delivery failure',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<article>Message delivery timed out. Please try again.</article>');
  assert.equal(await inspectDeliveryError(page),null);
 }finally{await browser.close();}
});

test('Manual ChatDesk Retry resumes the same pending request without duplicate prompt',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:HTML}));
  await page.goto('https://chatgpt.com/');
  const events=[];
  const ctrl=createChatController({browser,emit:packet=>events.push(packet),signedIn:async()=>true});
  const run=ctrl.send({type:'chat_send',id:'manual-test',chatId:'local:test',prompt:'Fixed prompt',effort:'medium'});
  for(let i=0;i<65&&!events.some(x=>x.event==='delivery_timeout');i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(events.some(x=>x.event==='delivery_timeout'),true,JSON.stringify(events));
  assert.equal(ctrl.activeTask?.deliveryError?.kind,'delivery_timeout');
  await ctrl.retry('manual-test');
  await run;
  assert.equal(events.some(x=>x.event==='retrying'),true);
  assert.equal(events.some(x=>x.event==='done'&&x.text==='Response recovered'),true,JSON.stringify(events));
  assert.equal(await page.evaluate(()=>window.__retryCount),1);
  assert.equal(ctrl.activeTask,null);
 }finally{await browser.close();}
});
test('A scheduled message uses at most one automatic UI Retry for a delivery timeout',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:HTML}));
  await page.goto('https://chatgpt.com/');
  const events=[];
  const ctrl=createChatController({browser,emit:e=>events.push(e),signedIn:async()=>true});
  await ctrl.send({type:'chat_send',id:'scheduled-test',chatId:'remote:cron',prompt:'Continue',
    effort:'medium',scheduled:true});
  assert.equal(await page.evaluate(()=>window.__retryCount),1);
  assert.equal(events.some(x=>x.event==='delivery_timeout'),true);
  assert.equal(events.some(x=>x.event==='done'&&x.text==='Response recovered'),true);
  assert.equal(events.filter(x=>x.event==='sent').length,1,'Retry must not send a second prompt');
 }finally{await browser.close();}
});
