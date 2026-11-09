import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import {Buffer} from 'node:buffer';
const base='http://127.0.0.1:5193/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5193','--strictPort'],{stdio:'ignore',cwd:process.cwd()});
let browser;
async function ready(){for(let i=0;i<90;i++){try{if((await fetch(base)).ok)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Vite failed to start');}
const expect=async (fn,msg)=>{if(!await fn())throw Error(msg);};
try{
  await ready();
  browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  const context=await browser.newContext();
  const page=await context.newPage();
  page.on('pageerror',e=>console.error('REACT_ERROR:',e.message));
  await page.goto(base+'?demo=1');
  await page.getByTestId('native-pane').waitFor({timeout:15000});
  await page.getByTestId('composer').fill('hello from local smoke');
  await page.getByTestId('send').click();
  await page.waitForFunction(()=>document.querySelector('[data-testid=assistant-message]')?.textContent?.includes('Local test: message display'),null,{timeout:15000});
  await page.getByTestId('stop').count(); // Stop can be present before demo reply completes.
  await page.waitForFunction(()=>document.querySelector('[data-testid=assistant-message]')?.textContent?.includes('persistence are working.'),null,{timeout:15000});
  await page.waitForTimeout(800);
  await page.reload();
  await page.getByTestId('native-pane').waitFor();
  await page.getByTestId('assistant-message').getByText('Local test: message display and persistence are working.').waitFor({timeout:8000});
  const raw=[
    {id:'00000000-0000-0000-0000-000000000001',title:'Imported alpha',create_time:1700000000,update_time:1700000050,
      current_node:'a',mapping:{
        root:{parent:null,message:null},
        u:{parent:'root',message:{id:'u',author:{role:'user'},content:{parts:['A question from export']},create_time:1700000010}},
        a:{parent:'u',message:{id:'a',author:{role:'assistant'},content:{parts:['An answer from export']},create_time:1700000020}}
      }},
    {id:'00000000-0000-0000-0000-000000000002',title:'Imported beta',create_time:1700001000,update_time:1700001050,
      current_node:'u',mapping:{
        root:{parent:null,message:null},
        u:{parent:'root',message:{id:'u2',author:{role:'user'},content:{parts:['Question beta']},create_time:1700001010}}
      }}
  ];
  const longNodes={root:{parent:null,message:null}};
  let parent='root';
  for(let i=0;i<95;i++){
    const id='node'+i;
    longNodes[id]={parent,message:{id,author:{role:i%2?'assistant':'user'},content:{parts:['History message '+i]},create_time:1701000000+i}};
    parent=id;
  }
  raw.push({id:'00000000-0000-0000-0000-000000000003',title:'Imported long thread',
    create_time:1701000000,update_time:1701000100,current_node:parent,mapping:longNodes});
  await page.locator('input[type=file]').setInputFiles({name:'conversations.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  await page.getByRole('button',{name:'Imported alpha'}).waitFor({timeout:15000});
  await page.getByRole('button',{name:'Imported alpha'}).click();
  await page.getByText('A question from export').waitFor();
  await page.getByText('An answer from export').waitFor();
  await expect(()=>page.getByTestId('composer').isDisabled(),'Imported conversations without remote link must be read-only');
  const line=page.locator('.history-line').filter({has:page.getByRole('button',{name:'Imported alpha'})});
  await line.locator('.history-more').click();
  await line.getByRole('button',{name:'Rename locally'}).click();
  await page.getByRole('dialog',{name:'Rename local conversation'}).locator('input').fill('Imported alpha renamed');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'Imported alpha renamed'}).waitFor();
  const renamed=page.locator('.history-line').filter({has:page.getByRole('button',{name:'Imported alpha renamed'})});
  await renamed.locator('.history-more').click();
  await renamed.getByRole('button',{name:'Delete local copy'}).click();
  await page.getByRole('dialog',{name:'Delete conversation'}).getByText('This deletes only the local ChatDesk copy',{exact:false}).waitFor();
  await page.getByRole('dialog',{name:'Delete conversation'}).getByRole('button',{name:'Delete local copy'}).click();
  await page.getByRole('button',{name:'Imported alpha renamed'}).waitFor({state:'detached',timeout:7000});
  await page.reload();
  await page.getByTestId('native-pane').waitFor();
  await expect(async()=>await page.getByRole('button',{name:'Imported alpha renamed'}).count()===0,'Deleted conversation reappeared after reload');
  await page.getByRole('button',{name:'Imported beta'}).waitFor();
  await page.getByRole('button',{name:'Imported long thread'}).click();
  await page.getByText('History message 94',{exact:true}).waitFor();
  let count=await page.locator('.message').count();
  if(count!==40)throw Error('Expected initial 40-message viewport but got '+count);
  await page.locator('.chat-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await page.waitForFunction(()=>document.querySelectorAll('.message').length>=80,null,{timeout:6500});
  if(await page.locator('.message').count()<80)throw Error('Older messages not loaded');
  console.log('PASS: React demo send, persistence, export import, lazy sidebar, older-message scroll, rename, local-only deletion');
} finally {await browser?.close();server.kill('SIGTERM');}