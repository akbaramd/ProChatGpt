import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
const base='http://127.0.0.1:5194/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5194','--strictPort'],{cwd:process.cwd(),stdio:'ignore'});
async function ready(){for(let i=0;i<80;i++){try{if((await fetch(base)).ok)return;}catch{}await new Promise(r=>setTimeout(r,170));}throw Error('Vite startup failed');}
let browser;
try{
  await ready();
  browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  const context=await browser.newContext();
  const page=await context.newPage();
  await page.addInitScript(()=>{
    const chatListeners=new Set(),authListeners=new Set();
    window.__submitted=[];
    window.chatdesk={
      status:async()=>({authState:'authenticated',authEnabled:true}),
      onAuthEvent:cb=>{authListeners.add(cb);return()=>authListeners.delete(cb);},
      onChatEvent:cb=>{chatListeners.add(cb);return()=>chatListeners.delete(cb);},
      onStream:()=>()=>{},
      sendBrowserMessage:async data=>{
        window.__submitted.push(data);
        setTimeout(()=>{for(const cb of chatListeners)cb({event:'sent',id:data.id});},40);
        setTimeout(()=>{for(const cb of chatListeners)cb({event:'status',id:data.id,text:'Thinking about the question'});},90);
        setTimeout(()=>{for(const cb of chatListeners)cb({event:'snapshot',id:data.id,text:'Streamed answer'});},160);
        return {ok:true};
      },
      cancelBrowserMessage:async id=>{
        window.__cancelled=id;
        for(const cb of chatListeners)cb({event:'cancelled',id});
        return true;
      }
    };
  });
  await page.goto(base);
  await page.getByTestId('native-pane').waitFor();
  await page.getByTestId('effort-picker').selectOption('high');
  await page.getByTestId('composer').fill('A question for stream');
  await page.getByTestId('send').click();
  await page.getByText('Thinking about the question').first().waitFor({timeout:7000});
  await page.getByText('Streamed answer').waitFor({timeout:7000});
  const requests=await page.evaluate(()=>window.__submitted);
  if(requests.length!==1||requests[0].effort!=='high'||requests[0].prompt!=='A question for stream')throw Error('Prompt or High effort was not routed to browser');
  await page.getByTestId('stop').click();
  await page.waitForFunction(()=>!!window.__cancelled,null,{timeout:6000});
  await page.getByTestId('send').waitFor();
  console.log('PASS: Browser events to React, High effort, visible status, snapshot, Stop event');
}finally{await browser?.close();server.kill('SIGTERM');}
