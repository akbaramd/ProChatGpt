import { chromium } from 'playwright';
import {spawn} from 'node:child_process';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173'],{cwd:process.cwd(),stdio:'ignore'});
let browser;
async function ready(){for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5173/')).ok)return;}catch{}await new Promise(r=>setTimeout(r,150));}throw Error('Vite startup timeout');}
try{
 await ready();
 browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
 const page=await browser.newPage();
 page.on('pageerror',e=>console.log('PAGE_ERROR',e.message));
 page.on('console',e=>{if(e.type()==='error')console.log('BROWSER_CONSOLE_ERROR',e.text());});
 page.on('requestfailed',r=>console.log('REQUEST_FAILED',r.url(),r.failure()?.errorText));
 await page.addInitScript(()=>{
   window.__authCallbacks=new Set();
   window.chatdesk={
     status:async()=>({apiEnabled:false,authEnabled:true,authState:'signed_out'}),
     beginLogin:async()=>{window.__started=true;for(const cb of window.__authCallbacks)cb({state:'browser_opened'});return true;},
     onAuthEvent:callback=>{window.__authCallbacks.add(callback);return()=>window.__authCallbacks.delete(callback);},
     onStream:()=>()=>{},
     sendApi:async()=>({ok:false,error:'demo'})
   };
 });
 await page.goto('http://127.0.0.1:5173/');
 console.log('AUTH_SMOKE_DEBUG',await page.title(), (await page.locator('body').innerText()).slice(0,400));
 await page.getByTestId('login-screen').waitFor({timeout:3500});
 if(await page.getByTestId('native-pane').count())throw Error('Dashboard visible before auth');
 await page.getByTestId('login-button').click();
 await page.getByTestId('auth-waiting').waitFor();
 const launched=await page.evaluate(()=>window.__started);
 if(!launched)throw Error('Open browser command missing');
 await page.evaluate(()=>{for(const cb of window.__authCallbacks)cb({state:'authenticated'});});
 await page.getByTestId('native-pane').waitFor({timeout:5000});
 if(await page.getByTestId('login-screen').count())throw Error('Login overlay remained visible');
 console.log('PASS: first screen is login only, button triggers external browser, authenticated event transitions to React chat');
}finally{await browser?.close();server.kill('SIGTERM');}
