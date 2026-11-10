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