import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
const base='http://127.0.0.1:5196/';
const UUID='12345678-1234-1234-1234-123456789abc';
const remoteUrl='https://chatgpt.com/c/'+UUID;
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5196','--strictPort'],{cwd:process.cwd(),stdio:'ignore'});
let browser;
async function ready(){for(let i=0;i<90;i++){try{if((await fetch(base)).ok)return;}catch{}await new Promise(r=>setTimeout(r,160));}throw Error('Vite startup failure');}
try{
 await ready();
 browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const page=await browser.newPage();
 page.on('pageerror',e=>console.error('REACT_ERROR',e.message));
 await page.addInitScript((remote)=>{
  const authCallbacks=new Set(),syncCallbacks=new Set(),chatCallbacks=new Set(),scheduleCallbacks=new Set();
  let job=null;
  window.__commands=[];
  const publish=(set,message)=>{for(const cb of set)cb(message);};
  window.chatdesk={
    status:async()=>({authState:'authenticated',authEnabled:true}),
    onAuthEvent:cb=>{authCallbacks.add(cb);return()=>authCallbacks.delete(cb);},
    onSyncEvent:cb=>{syncCallbacks.add(cb);return()=>syncCallbacks.delete(cb);},
    onChatEvent:cb=>{chatCallbacks.add(cb);return()=>chatCallbacks.delete(cb);},
    onScheduleEvent:cb=>{scheduleCallbacks.add(cb);return()=>scheduleCallbacks.delete(cb);},
    onStream:()=>()=>{},
    syncBrowser:async args=>{
      setTimeout(()=>publish(syncCallbacks,{
        type:'sync',requestId:args.requestId,action:args.action,ok:true,
        ...(args.action==='list'?{chats:[{id:'12345678-1234-1234-1234-123456789abc',title:'Recurring test chat',remoteUrl:remote}]}:
          {messages:[{id:'u0',role:'user',content:'Existing message',state:'complete'}],url:remote})
      }),20);
      return true;
    },
    scheduleCommand:async cmd=>{
      window.__commands.push(cmd);
      const publishSchedule=(event,extra={})=>publish(scheduleCallbacks,{type:'schedule',event,job:job?{...job}:null,at:Date.now(),...extra});
      if(cmd.action==='status')publishSchedule('state');
      else if(cmd.action==='start'){
        job={id:'scheduled-1',...cmd.job,enabled:true,createdAt:Date.now(),runCount:0,nextRunAt:Date.now()+cmd.job.intervalSeconds*1000};
        publishSchedule('started');
      }else if(cmd.action==='pause'){
        job.enabled=false;job.nextRunAt=null;publishSchedule('paused');
      }else if(cmd.action==='resume'){
        job.enabled=true;job.nextRunAt=Date.now()+job.intervalSeconds*1000;publishSchedule('resumed');
      }else if(cmd.action==='stop'){job=null;publishSchedule('stopped');}
      else if(cmd.action==='runNow'){
        const id='scheduled-msg-1';
        job.runCount++;
        publishSchedule('tick-start',{requestId:id,chatId:'remote:12345678-1234-1234-1234-123456789abc',remoteUrl:remote,prompt:job.prompt});
        setTimeout(()=>publish(chatCallbacks,{type:'chat',event:'snapshot',id,text:'Recurring test answer'}),30);
        setTimeout(()=>{
          publish(chatCallbacks,{type:'chat',event:'done',id,text:'Recurring test answer'});
          publishSchedule('tick-finished',{requestId:id,chatId:'remote:12345678-1234-1234-1234-123456789abc',result:'done'});
        },65);
      }
      return true;
    },
    sendBrowserMessage:async()=>({ok:false}),
  };
 },remoteUrl);
 await page.goto(base);
 await page.getByTestId('native-pane').waitFor({timeout:12000});
 await page.getByRole('button',{name:'Recurring test chat'}).waitFor({timeout:12000});
 if((await page.evaluate(()=>window.__commands)).some(x=>x.action==='start'))throw Error('Job auto-started without opt-in');
 await page.getByRole('button',{name:'Recurring test chat'}).click();
 await page.getByText('Existing message').waitFor();
 await page.getByTestId('schedule-open').click();
 await page.getByRole('dialog',{name:'Recurring message'}).waitFor();
 await page.getByTestId('schedule-prompt').fill('Continue this ChatGPT conversation.');
 await page.getByTestId('schedule-minutes').fill('1');
 await page.getByTestId('schedule-effort').selectOption('high');
 await page.getByTestId('schedule-start').click();
 await page.getByTestId('schedule-state').getByText('Active').waitFor();
 const start=await page.evaluate(()=>window.__commands.find(x=>x.action==='start'));
 if(start.job.intervalSeconds!==60||start.job.effort!=='high'||start.job.remoteUrl!==remoteUrl)
   throw Error('Incorrect recurring job setup');
 await page.getByTestId('schedule-run-now').click();
 await page.getByText('Recurring test answer').waitFor({timeout:8000});
 await page.getByTestId('schedule-state').getByText('Sent 1 times').waitFor();
 await page.getByTestId('schedule-pause').click();
 await page.getByTestId('schedule-state').getByText('Paused').waitFor();
 await page.getByTestId('schedule-pause').click();
 await page.getByTestId('schedule-state').getByText('Active').waitFor();
 await page.getByTestId('schedule-stop').click();
 await page.getByTestId('schedule-start').waitFor();
 console.log('PASS: live-chat selection, recurring configuration, 60s cadence, High mode, Run now, visible answer, pause/resume/stop');
}finally{await browser?.close();server.kill('SIGTERM');}
