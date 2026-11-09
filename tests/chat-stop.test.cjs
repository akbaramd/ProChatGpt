const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {createChatController}=require('../scripts/chat-controller.cjs');

test('Stop button clicks the visible ChatGPT Stop control and unblocks UI',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try {
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({
   status:200,contentType:'text/html',
   body:`<!doctype html><html><body>
    <button aria-label="Select ChatGPT model" onclick="document.getElementById('power').hidden=false">Select ChatGPT model</button>
    <div id="power" role="menuitem" hidden>Power</div>
    <div role="slider" aria-valuenow="1"></div>
    <div contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div>
    <button aria-label="Send" onclick="document.getElementById('stop').hidden=false">Send</button>
    <button id="stop" aria-label="Stop" hidden onclick="this.hidden=true;window.__stopped=true">Stop</button>
    </body></html>`
  }));
  await page.goto('https://chatgpt.com/');
  const events=[];
  const chat=createChatController({browser,emit:e=>events.push(e),signedIn:async()=>true});
  const run=chat.send({type:'chat_send',id:'stop-1',chatId:'local:test',prompt:'Test Stop',effort:'medium'});
  await page.waitForFunction(()=>!document.getElementById('stop').hidden,null,{timeout:8500});
  const clicked=await chat.cancel('stop-1');
  await run;
  assert.equal(clicked,true);
  assert.equal(await page.evaluate(()=>window.__stopped),true);
  assert.equal(events.some(e=>e.event==='cancelled'),true);
  assert.equal(chat.busy,false);
 }finally{await browser.close();}
});

test('Stop requested before the Send control is ready does not leave a pending operation',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({
   status:200,contentType:'text/html',
   body:'<!doctype html><html><body><div contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div></body></html>'
  }));
  await page.goto('https://chatgpt.com/');
  const events=[];
  const chat=createChatController({browser,emit:e=>events.push(e),signedIn:async()=>true});
  const request=chat.send({type:'chat_send',id:'early-1',chatId:'local:early',prompt:'Test early stop',effort:'medium'});
  await chat.cancel('early-1');
  await request;
  assert.equal(events.some(e=>e.event==='cancelled'),true);
  assert.equal(chat.busy,false);
 }finally{await browser.close();}
});