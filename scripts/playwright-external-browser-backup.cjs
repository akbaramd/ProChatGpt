'use strict';

/** Local Playwright-controlled Chromium-based Edge session.
 *  Used only to detect the user landing on the signed-in chat UI.
 *  Credentials, tokens, cookies and private network APIs are never read or copied.
 *  Challenge screens are left for the user to complete manually.
 */
const { chromium } = require('playwright');
const os = require('node:os');
const path = require('node:path');

const directory = process.env.CHATDESK_BROWSER_PROFILE ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData','Local'),
            'ChatDeskLab','external-chromium-profile');

const emit = data => process.stdout.write(JSON.stringify(data) + '\n');
let context;
let authenticated = false;
let stopping = false;
let scanning = false;
let lastStatus = '';
let timer;
const allowedUrl = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && u.hostname === 'chatgpt.com'
       && !/^\/(auth|login|signup|api|share)(\/|$)/i.test(u.pathname);
  } catch { return false; }
};

async function hasAuthenticatedInterface(page) {
  if (page.isClosed() || !allowedUrl(page.url())) return false;
  try {
    return await page.evaluate(() => {
      const visible = el => Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const prompt = document.querySelector('#prompt-textarea, [data-testid="composer"], [contenteditable="true"][data-testid*="prompt"]');
      const account = document.querySelector(
        '[data-testid="profile-button"],[data-testid="user-menu-button"],' +
        'button[aria-label="Open profile menu"],button[aria-label*="Account menu"],' +
        'button[aria-label*="Profile menu"]'
      );
      const password = document.querySelector('input[type="password"]');
      const login = Array.from(document.querySelectorAll('a,button'))
        .some(el => visible(el) && /^(log in|login|sign in|sign up)$/i.test((el.textContent||'').trim()));
      return visible(prompt) && visible(account) && !visible(password) && !login;
    });
  } catch { return false; }
}

async function checkState() {
  if (scanning || stopping || !context) return;
  scanning = true;
  try {
    for (const page of context.pages()) {
      if (page.isClosed()) continue;
      if (await hasAuthenticatedInterface(page)) {
        if (!authenticated) {
          authenticated = true;
          emit({type:'authenticated',source:'playwright-visible-account-ui'});
        } else emit({type:'verified'});
        return;
      }
    }
    // Do not interpret an arbitrary redirect to ChatGPT as proof of authentication.
    if (authenticated) {
      authenticated = false;
      emit({type:'signed_out'});
    }
    const titles = await Promise.all(context.pages().filter(p=>!p.isClosed()).map(p=>p.title().catch(()=>'')));
    const challenge = titles.some(t => /just a moment|attention required|checking your browser/i.test(t));
    const status = challenge ? 'challenge' : 'awaiting_login';
    if (lastStatus !== status) {
      lastStatus = status;
      emit({type:status, message:challenge ? 'Complete the Cloudflare challenge manually in the Chromium window.' : 'Sign in through the Chromium window.'});
    }
  } catch(error) {
    emit({type:'warning',message:error.message});
  } finally {
    scanning=false;
  }
}

async function openBrowser() {
  emit({type:'opening'});
  context = await chromium.launchPersistentContext(directory, {
    channel:'msedge',
    headless:false,
    chromiumSandbox:true,
    viewport:null,
    acceptDownloads:false,
    args:['--start-maximized']
  });
  const pages = context.pages();
  const page = pages[0] || await context.newPage();
  const attach = p => p.on('framenavigated', frame => {
    if (frame === p.mainFrame()) setTimeout(checkState, 1250);
  });
  pages.forEach(attach);
  context.on('page', p => {attach(p);setTimeout(checkState, 1200);});
  context.on('close', () => {
    if (timer) clearInterval(timer);
    if (!stopping) emit({type:'closed'});
    process.exit(0);
  });
  emit({type:'browser_opened',engine:'playwright-chromium-msedge'});
  await page.goto('https://chatgpt.com/', {waitUntil:'domcontentloaded',timeout:80000})
    .catch(err => emit({type:'warning',message:'Navigation: '+err.message}));
  timer = setInterval(checkState, 1600);
  await checkState();
}

async function shutdown() {
  if (stopping) return;
  stopping=true;
  if(timer)clearInterval(timer);
  await context?.close().catch(()=>{});
  process.exit(0);
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  for(const cmd of chunk.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)) {
    if(cmd==='quit')shutdown().catch(()=>process.exit(1));
    else if(cmd==='check')checkState().catch(()=>{});
    else if(cmd==='show') {
      context?.pages().find(p=>!p.isClosed())?.bringToFront().catch(()=>{});
      checkState().catch(()=>{});
    }
  }
});
process.on('SIGTERM',()=>shutdown().catch(()=>process.exit(1)));
if(require.main === module)openBrowser().catch(error=>{emit({type:'error',message:error.message});process.exit(1);});
module.exports={allowedUrl,hasAuthenticatedInterface};
