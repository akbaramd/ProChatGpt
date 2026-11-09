'use strict';
const { chromium } = require('playwright');
const os = require('node:os');
const path = require('node:path');

const directory = process.env.CHATDESK_BROWSER_PROFILE ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ChatDeskLab', 'external-chromium-profile');
let context, complete = false;
const send = data => process.stdout.write(JSON.stringify(data) + '\n');
function isAllowedLandingUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
       u.hostname === 'chatgpt.com' &&
       !/^\/(auth|login|signup|api|share)(\/|$)/i.test(u.pathname);
  } catch { return false; }
}
async function hasAuthenticatedInterface(page) {
  if (!isAllowedLandingUrl(page.url())) return false;
  try {
    return await page.evaluate(() => {
      const visible = x => !!(x && x.getClientRects().length);
      const composer = document.querySelector('#prompt-textarea, [data-testid="composer"], div[contenteditable="true"][data-testid*="prompt"]');
      const profile = document.querySelector('[data-testid="profile-button"], [data-testid="user-menu-button"], button[aria-label*="Profile"], button[aria-label*="Account"], button[aria-label="Open profile menu"]');
      const password = document.querySelector('input[type="password"]');
      const signIn = Array.from(document.querySelectorAll('button,a')).some(el => visible(el) && /^(log in|login|sign in|sign up)$/i.test((el.textContent||'').trim()));
      return visible(composer) && visible(profile) && !visible(password) && !signIn;
    });
  } catch { return false; }
}
async function launch() {
  send({type:'opening'});
  context = await chromium.launchPersistentContext(directory, {
    channel:'msedge', headless:false, chromiumSandbox:true, viewport:null, acceptDownloads:false,
    args:['--start-maximized']
  });
  context.on('close', () => {if(!complete) send({type:'closed'}); process.exit(0);});
  const page = context.pages()[0] || await context.newPage();
  send({type:'browser-opened'});
  let scanning=false;
  const check=async()=>{
    if(scanning||complete)return;
    scanning=true;
    try{
      for(const candidate of context.pages()){
        if(!candidate.isClosed() && await hasAuthenticatedInterface(candidate)){
          complete=true;
          send({type:'authenticated',source:'browser-ui-check'});
          break;
        }
      }
    }catch(e){send({type:'warning',message:String(e)});}
    finally{scanning=false;}
  };
  const watchPage=p=>p.on('framenavigated',frame=>{
    if(frame===p.mainFrame())setTimeout(check,1200);
  });
  context.pages().forEach(watchPage);
  context.on('page',p=>{watchPage(p);setTimeout(check,1200);});
  await page.goto('https://chatgpt.com/auth/login',{waitUntil:'domcontentloaded',timeout:90000}).catch(e=>send({type:'warning',message:e.message}));
  setInterval(check,1500).unref();
  await check();
}
if (require.main === module) {
  process.on('SIGTERM',async()=>{await context?.close().catch(()=>{});process.exit(0);});
  process.stdin.on('data',data=>{if(data.toString().trim()==='quit') context?.close().catch(()=>{});});
  launch().catch(error=>{send({type:'error',message:error.message});process.exit(1);});
}
module.exports={isAllowedLandingUrl,hasAuthenticatedInterface};
