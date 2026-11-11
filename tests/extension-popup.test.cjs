const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');

const extension=path.join(__dirname,'..','extension');
async function start(){
 const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const context=await browser.newContext();
 await context.addInitScript(()=>{
   const defaultState={enabled:false,message:'ادامه بده',delaySeconds:3,maxSends:0};
   const listeners=[];
   window.browser={
     runtime:{async sendMessage(req){window.__exportRequest=req;return {ok:true,filename:'AutoContinue/diagnostics/test.json'}}},
     tabs:{async query(){return [{url:'https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc'}]}},
     storage:{
       local:{
         async get(defaults={}){
           const values=JSON.parse(window.localStorage.getItem('test-popup-storage')||'{}');
           return {...defaults,...values};
         },
         async set(next){
           const before=JSON.parse(window.localStorage.getItem('test-popup-storage')||'{}');
           window.localStorage.setItem('test-popup-storage',JSON.stringify({...before,...next}));
           for(const fn of listeners)fn(Object.fromEntries(
             Object.entries(next).map(([k,newValue])=>[k,{oldValue:before[k],newValue}])
           ),'local');
         }
       },
       onChanged:{addListener(fn){listeners.push(fn)}}
     }
   };
 });
 await context.route('http://addon.test/*',route=>{
   const name=new URL(route.request().url()).pathname.slice(1);
   if(!['popup.html','popup.js','conversation-settings.js','trace.js'].includes(name))return route.abort();
   return route.fulfill({
     status:200,contentType:name.endsWith('html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8',
     body:fs.readFileSync(path.join(extension,name))
   });
 });
 const page=await context.newPage();
 await page.goto('http://addon.test/popup.html');
 return {browser,page};
}

test('Clicking visible switch turns Enabled ON and persists the value',async()=>{
 const {browser,page}=await start();
 try{
  const check=page.locator('#enabled');
  assert.equal(await check.isChecked(),false);
  const slider=page.locator('.switch');
  await slider.click({position:{x:36,y:12}});
  assert.equal(await check.isChecked(),true);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']?.enabled===true);
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.slider')).backgroundColor==='rgb(16, 163, 127)');
  await page.reload();
  assert.equal(await page.locator('#enabled').isChecked(),true,'Enabled survives reopening the popup');
 }finally{await browser.close();}
});

test('Clicking the switch again turns Enabled OFF and persists disabled state',async()=>{
 const {browser,page}=await start();
 try{
  await page.locator('.switch').click({position:{x:34,y:12}});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']?.enabled===true);
  await page.locator('.switch').click({position:{x:8,y:12}});
  assert.equal(await page.locator('#enabled').isChecked(),false);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']?.enabled===false);
  await page.reload();
  assert.equal(await page.locator('#enabled').isChecked(),false);
 }finally{await browser.close();}
});

test('Enabled text and keyboard accessibility also toggle the same checkbox',async()=>{
 const {browser,page}=await start();
 try{
  await page.getByText('Enabled',{exact:true}).click();
  assert.equal(await page.locator('#enabled').isChecked(),true);
  await page.locator('#enabled').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#enabled').isChecked(),false);
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']?.enabled===false);
 }finally{await browser.close();}
});

test('In-page settings use the same browser storage and can save independently',async()=>{
 const {browser,page}=await start();
 try{
  await page.addScriptTag({path:path.join(extension,'conversation-settings.js')});
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  await page.evaluate(()=>{
    window.__ui=window.ContinueInPageUI.create({
      storage:browser.storage.local,
      onSaved:values=>window.ContinueConversationSettings.save(browser.storage.local,'/c/12345678-1234-1234-1234-123456789abc',values),
      defaults:{enabled:false,message:'ادامه بده',delaySeconds:3,maxSends:0}
    });
  });
  await page.locator('#chatdesk-auto-continue-controls').evaluate(host=>host.shadowRoot.getElementById('launcher').click());
  await page.locator('#chatdesk-auto-continue-controls').evaluate(host=>{
    const enabled=host.shadowRoot.getElementById('enabled');
    enabled.checked=true;
    enabled.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']?.enabled===true);
  await page.reload();
  assert.equal(await page.locator('#enabled').isChecked(),true,'Toolbar popup reads settings saved by the in-page UI');
 }finally{await browser.close();}
});
test('Export diagnostics requests a background download',async()=>{
 const {browser,page}=await start();
 try{
  await page.locator('#activity summary').click();
  await page.locator('#exportDiagnostics').click();
  await page.waitForFunction(()=>window.__exportRequest?.type==='autoContinue:exportDiagnostics');
  assert.match(await page.locator('#saved').textContent(),/Saved to Downloads/);
 }finally{await browser.close();}
});
test('floating control stays compact and its panel fits a narrow viewport',async()=>{
 const {browser,page}=await start();
 try{
  await page.setViewportSize({width:375,height:667});
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  await page.evaluate(()=>window.__ui=ContinueInPageUI.create({storage:browser.storage.local}));
  const host=page.locator('#chatdesk-auto-continue-controls');
  const rect=await host.evaluate(el=>{
   const r=el.shadowRoot.getElementById('launcher').getBoundingClientRect();
   return {width:r.width,height:r.height,right:r.right,bottom:r.bottom};
  });
  assert.ok(rect.width<=40 && rect.height<=40);
  assert.ok(rect.right<=375 && rect.bottom<=667);
  await host.evaluate(el=>el.shadowRoot.getElementById('launcher').click());
  const panel=await host.evaluate(el=>{
   const p=el.shadowRoot.getElementById('settings').getBoundingClientRect();
   return {left:p.left,right:p.right,top:p.top,bottom:p.bottom};
  });
  assert.ok(panel.left>=0 && panel.right<=375 && panel.top>=0 && panel.bottom<=667,
   JSON.stringify(panel));
  await page.evaluate(()=>{
   const input=document.createElement('input');
   input.id='native-editor';input.style.cssText='position:fixed;top:24px;left:16px;width:140px;height:34px;z-index:2';
   document.body.appendChild(input);
  });
  await page.mouse.click(40,40);
  assert.equal(await host.evaluate(el=>el.shadowRoot.getElementById('settings').hidden),true);
  await page.keyboard.type('Typing remains focused');
  assert.equal(await page.locator('#native-editor').inputValue(),'Typing remains focused');
 }finally{await browser.close();}
});
test('repeated identical status does not cause needless DOM updates',async()=>{
 const {browser,page}=await start();
 try{
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  const count=await page.evaluate(async()=>{
   const ui=ContinueInPageUI.create({storage:browser.storage.local});
   const status=ui.shadow.getElementById('runtime');
   let changes=0;
   const observer=new MutationObserver(records=>{changes+=records.length;});
   observer.observe(status,{childList:true,characterData:true,subtree:true});
   for(let i=0;i<15;i++)ui.updateStatus('Waiting for ChatGPT response');
   await new Promise(resolve=>setTimeout(resolve,0));
   observer.disconnect();
   return changes;
  });
  assert.equal(count,1);
 }finally{await browser.close();}
});
test('storage refresh preserves unsaved settings, and Save persists the user edit',async()=>{
 const {browser,page}=await start();
 try{
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  await page.evaluate(()=>window.__ui=ContinueInPageUI.create({
   storage:browser.storage.local,defaults:{enabled:true,message:'ادامه بده',delaySeconds:3,maxSends:1},
   onSaved:values=>ContinueConversationSettings.save(browser.storage.local,
    '/c/12345678-1234-1234-1234-123456789abc',values)
  }));
  const host=page.locator('#chatdesk-auto-continue-controls');
  await host.evaluate(el=>el.shadowRoot.getElementById('launcher').click());
  await host.evaluate(el=>{
   const text=el.shadowRoot.getElementById('message');
   text.value='Keep this unsaved text';
   text.dispatchEvent(new Event('input',{bubbles:true}));
   window.__ui.updateConfig({enabled:true,message:'from external storage',delaySeconds:8,maxSends:2});
  });
  assert.equal(await host.evaluate(el=>el.shadowRoot.getElementById('message').value),
   'Keep this unsaved text');
  await host.evaluate(el=>el.shadowRoot.getElementById('save').click());
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')
   ['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']
   ?.message==='Keep this unsaved text');
 }finally{await browser.close();}
});
test('pending settings save never writes into a different conversation',async()=>{
 const {browser,page}=await start();
 try{
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  const values=await page.evaluate(async()=>{
   let current='/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
   let writes=0;
   const ui=ContinueInPageUI.create({
    storage:browser.storage.local,getScope:()=>current,
    onSaved:async()=>{writes++;}
   });
   ui.setOpen(true);
   const message=ui.shadow.getElementById('message');
   message.value='Do not save into new chat';
   message.dispatchEvent(new Event('input',{bubbles:true}));
   ui.shadow.getElementById('save').click();
   current='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
   ui.resetForNavigation();
   ui.updateConfig({enabled:false,message:'new chat',delaySeconds:3,maxSends:1});
   await new Promise(resolve=>setTimeout(resolve,100));
   return {writes,text:message.value,hidden:ui.shadow.getElementById('settings').hidden};
  });
  assert.equal(values.writes,0);
  assert.equal(values.text,'new chat');
  assert.equal(values.hidden,true);
 }finally{await browser.close();}
});
test('toolbar status follows per-chat Enabled state',async()=>{
 const {browser,page}=await start();
 try{
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Off');
  await page.locator('.switch').click({position:{x:36,y:12}});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='On');
  assert.equal(await page.locator('#status').getAttribute('data-on'),'true');
  await page.locator('.switch').click({position:{x:8,y:12}});
  await page.waitForFunction(()=>document.getElementById('status').textContent==='Off');
 }finally{await browser.close();}
});
test('toolbar draft mode persists and is restored for the same conversation',async()=>{
 const {browser,page}=await start();
 try{
  const field=page.locator('#draftMode');
  assert.equal(await field.inputValue(),'append');
  await field.selectOption('replace');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')
   ['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']
   ?.draftMode==='replace');
  await page.reload();
  assert.equal(await field.inputValue(),'replace');
  await field.selectOption('preserve');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')
   ['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']
   ?.draftMode==='preserve');
 }finally{await browser.close();}
});
test('in-page draft mode is selectable and persisted',async()=>{
 const {browser,page}=await start();
 try{
  await page.addScriptTag({path:path.join(extension,'in-page-ui.js')});
  await page.evaluate(()=>window.__ui=ContinueInPageUI.create({
   storage:browser.storage.local,
   onSaved:values=>ContinueConversationSettings.save(browser.storage.local,
    '/c/12345678-1234-1234-1234-123456789abc',values)
  }));
  const host=page.locator('#chatdesk-auto-continue-controls');
  await host.evaluate(el=>el.shadowRoot.getElementById('launcher').click());
  await host.evaluate(el=>{
   const select=el.shadowRoot.getElementById('draftMode');
   select.value='replace';
   select.dispatchEvent(new Event('input',{bubbles:true}));
   el.shadowRoot.getElementById('save').click();
  });
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('test-popup-storage')||'{}')
   ['autoContinue:conversation:/c/12345678-1234-1234-1234-123456789abc']
   ?.draftMode==='replace');
 }finally{await browser.close();}
});
