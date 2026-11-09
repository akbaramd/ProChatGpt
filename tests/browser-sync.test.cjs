const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {sidebarRows,visibleHistory,createBrowserSync}=require('../scripts/browser-sync.cjs');
const UUID='12345678-1234-1234-1234-123456789abc';
const url='https://chatgpt.com/c/'+UUID;
test('Chromium DOM sidebar and messages are linked to the same remote conversation',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><body>
    <aside style="height:180px;overflow-y:auto">
      <div role="group"><a href="/c/${UUID}">Example live thread</a><button aria-label="Chat actions">More</button></div>
    </aside>
    <main>
      <div data-chatgpt-search-unit-key="fallback-turn-0:0:user">Question</div>
      <div data-talvt-turn-state="complete">
        <div data-chatgpt-search-unit-key="fallback-turn-0:2:assistant">
          <div class="MarkdownRoot-Test">Visible answer</div><div class="activity-header">Thinking summary</div>
        </div>
      </div>
      <button aria-label="Stop">Stop</button>
    </main>
    </body></html>`}));
  await page.goto(url);
  const chats=await sidebarRows(page);
  assert.equal(chats.length,1);
  assert.equal(chats[0].title,'Example live thread');
  assert.equal(chats[0].remoteUrl,url);
  const history=await visibleHistory(page);
  assert.deepEqual(history.messages.map(m=>m.role),['user','assistant']);
  assert.equal(history.messages[1].content,'Visible answer');
  assert.equal(history.canStop,true);
  assert.deepEqual(history.thinking,['Thinking summary']);
  const events=[];
  const sync=createBrowserSync({browser,emit:e=>events.push(e),signedIn:async()=>true,busy:()=>false});
  await sync.run({action:'list',requestId:'req-1',depth:1});
  assert.equal(events[0].ok,true);
  assert.equal(events[0].chats[0].id,UUID);
  await sync.run({action:'open',requestId:'req-2',remoteUrl:url});
  assert.equal(events[1].ok,true);
  assert.equal(events[1].messages[1].content,'Visible answer');
 }finally{await browser.close();}
});
test('Remote deletion refuses missing user confirmation',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',
    body:`<html><body><a href="/c/${UUID}">Example</a><main>Existing chat</main></body></html>`}));
  await page.goto(url);
  const events=[];
  const sync=createBrowserSync({browser,emit:e=>events.push(e),signedIn:async()=>true,busy:()=>false});
  await sync.run({action:'delete',requestId:'req-del',remoteUrl:url,confirmed:false});
  assert.equal(events[0].ok,false);
  assert.match(events[0].error,/explicit confirmation/);
  assert.equal(await page.locator('a[href^="/c/"]').count(),1);
 }finally{await browser.close();}
});
test('Confirmed delete uses ChatGPT menu and completion dialog before reporting success',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 try{
  const page=await browser.newPage();
  await page.route('https://chatgpt.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:`<!doctype html><html><body>
     <aside><div role="group" id="chat-row">
       <a href="/c/${UUID}">Temporary test conversation</a>
       <button aria-label="Chat actions" onclick="document.getElementById('actions').hidden=false">Chat actions</button>
     </div></aside>
     <div id="actions" role="menu" hidden><button role="menuitem" onclick="document.getElementById('confirm').hidden=false">Delete</button></div>
     <div id="confirm" role="dialog" hidden>
       <p>Delete chat?</p>
       <button onclick="document.getElementById('confirm').hidden=true">Cancel</button>
       <button onclick="document.getElementById('chat-row').remove();history.replaceState(null,'','/');document.getElementById('confirm').hidden=true">Delete chat</button>
     </div><main>Test conversation</main></body></html>`}));
  await page.goto(url);
  const events=[];
  const sync=createBrowserSync({browser,emit:e=>events.push(e),signedIn:async()=>true,busy:()=>false});
  await sync.run({action:'delete',requestId:'req-confirmed',remoteUrl:url,confirmed:true});
  assert.equal(events.at(-1)?.ok,true,events.at(-1)?.error);
  assert.equal(await page.locator('a[href^="/c/"]').count(),0);
 } finally {await browser.close();}
});