import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
const root='http://127.0.0.1:5196/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5196','--strictPort'],{cwd:process.cwd(),stdio:'ignore'});
async function ready(){for(let i=0;i<90;i++){try{if((await fetch(root)).ok)return;}catch{}await new Promise(r=>setTimeout(r,160));}throw Error('Vite not ready');}
let browser;
try{
 await ready();
 browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const page=await browser.newPage();
 page.on('pageerror',e=>console.error('PAGE_ERROR',e.message));
 await page.addInitScript(()=>{
  const sync=new Set(),schedule=new Set(),chat=new Set(),auth=new Set();
  const url='https://chatgpt.com/c/12345678-1234-1234-1234-123456789abc';
  const notify=(listeners,x)=>{for(const cb of listeners)cb(x);};
  window.__cmds=[];window.__retryId=null;let job=null;
  window.chatdesk={
   status:async()=>({authEnabled:true,authState:'authenticated'}),
   onAuthEvent:cb=>{auth.add(cb);return()=>auth.delete(cb);},
   onSyncEvent:cb=>{sync.add(cb);return()=>sync.delete(cb);},
   onScheduleEvent:cb=>{schedule.add(cb);return()=>schedule.delete(cb);},
   onChatEvent:cb=>{chat.add(cb);return()=>chat.delete(cb);},
   syncBrowser:async ({requestId,action})=>{
    window.__cmds.push({type:'sync',action});
    setTimeout(()=>{
     if(action==='list')notify(sync,{requestId,action,ok:true,chats:[{id:'12345678-1234-1234-1234-123456789abc',title:'Scheduled chat test',remoteUrl:url}]});
     else if(action==='open')notify(sync,{requestId,action,ok:true,messages:[{id:'u1',role:'user',content:'Old prompt'},{id:'a1',role:'assistant',content:'Old reply'}]});
     else notify(sync,{requestId,action,ok:true,messages:[]});
    },40);
    return true;
   },
   scheduleCommand:async payload=>{
    window.__cmds.push({type:'schedule',...payload});
    if(payload.action==='start'){
      job={...payload.job,id:'job-1',enabled:true,runCount:0,nextRunAt:Date.now()+60000};
      notify(schedule,{type:'schedule',event:'started',job});
    }else if(payload.action==='pause'){
      job={...job,enabled:false,nextRunAt:null};notify(schedule,{type:'schedule',event:'paused',job});
    }else if(payload.action==='resume'){
      job={...job,enabled:true,nextRunAt:Date.now()+60000};notify(schedule,{type:'schedule',event:'resumed',job});
    }else if(payload.action==='stop'){
      job=null;notify(schedule,{type:'schedule',event:'stopped',job:null});
    }else if(payload.action==='status')notify(schedule,{type:'schedule',event:'state',job});
    return true;
   },
   sendBrowserMessage:async data=>{
    window.__cmds.push({type:'chat_send',...data});
    setTimeout(()=>notify(chat,{type:'chat',event:'delivery_timeout',id:data.id,chatId:data.chatId,
      message:'Message delivery timed out. Please try again.',retryAvailable:true}),100);
    return {ok:true};
   },
   retryBrowserMessage:async id=>{
    window.__retryId=id;window.__cmds.push({type:'chat_retry',id});
    notify(chat,{type:'chat',event:'retrying',id,message:'Retrying existing response'});
    setTimeout(()=>{
      notify(chat,{type:'chat',event:'snapshot',id,text:'Recovered ChatGPT response'});
      notify(chat,{type:'chat',event:'done',id,text:'Recovered ChatGPT response',remoteUrl:url});
    },100);
    return true;
   },
   cancelBrowserMessage:async()=>true
  };
 });
 await page.goto(root);
 await page.getByRole('button',{name:'Scheduled chat test'}).waitFor({timeout:9000});
 await page.getByRole('button',{name:'Scheduled chat test'}).click();
 await page.getByText('Old reply',{exact:true}).waitFor();
 await page.getByTestId('schedule-open').click();
 await page.getByRole('dialog',{name:'Recurring message'}).waitFor();
 await page.getByTestId('schedule-prompt').fill('Continue the previous answer');
 await page.getByTestId('schedule-minutes').fill('1');
 await page.getByTestId('schedule-effort').selectOption('high');
 await page.getByTestId('schedule-start').click();
 await page.getByTestId('schedule-state').getByText('Active').waitFor();
 const start=await page.evaluate(()=>window.__cmds.find(c=>c.type==='schedule'&&c.action==='start'));
 if(start.job.prompt!=='Continue the previous answer'||start.job.intervalSeconds!==60||start.job.effort!=='high'||!start.job.remoteUrl.endsWith('123456789abc'))throw Error('Invalid scheduler payload '+JSON.stringify(start));
 await page.getByTestId('schedule-pause').click();
 await page.getByTestId('schedule-state').getByText('Paused').waitFor();
 await page.getByTestId('schedule-pause').click();
 await page.getByTestId('schedule-state').getByText('Active').waitFor();
 await page.getByTestId('schedule-stop').click();
 await page.getByTestId('schedule-start').waitFor();
 await page.getByTestId('schedule-close').click();
 await page.getByTestId('composer').fill('Test the timeout banner');
 await page.getByTestId('send').click();
 await page.getByTestId('delivery-timeout').getByText('Message delivery timed out. Please try again.').waitFor({timeout:7000});
 await page.getByTestId('delivery-retry').click();
 await page.getByTestId('assistant-message').getByText('Recovered ChatGPT response').waitFor({timeout:6500});
 await page.waitForFunction(()=>window.__retryId);
 const items=await page.evaluate(()=>window.__cmds.filter(c=>c.type==='chat_send'||c.type==='chat_retry'));
 if(items.length!==2)throw Error('Retry incorrectly submitted a duplicate prompt '+JSON.stringify(items));
 console.log('PASS: load real-like browser conversation, schedule 1m/high, pause/resume/stop, timeout banner, Retry without duplicate prompt');
}finally{await browser?.close();server.kill('SIGTERM');}
