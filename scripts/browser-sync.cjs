'use strict';
const {setTimeout:delay}=require('node:timers/promises');
const {permittedConversationUrl}=require('./chat-controller.cjs');

const CHAT_LINK='a[href^="/c/"]';
const UNIT='[data-chatgpt-search-unit-key]';
function validUrl(value) {return permittedConversationUrl(value);}
function currentPage(browser) {
  return browser.contexts().flatMap(c=>c.pages()).find(p=>{
    try{return new URL(p.url()).hostname==='chatgpt.com';}catch{return false;}
  })||null;
}
async function sidebarRows(page) {
 return page.evaluate(()=>{
   const ids=new Set();
   return [...document.querySelectorAll('a[href^="/c/"]')].flatMap(link=>{
     const raw=link.getAttribute('href')||'';
     const match=raw.match(/^\/c\/([0-9a-f-]{30,})$/i);
     if(!match||ids.has(match[1]))return [];
     ids.add(match[1]);
     const title=(link.innerText||link.getAttribute('aria-label')||link.textContent||'').trim().replace(/\s+/g,' ').slice(0,170);
     return [{id:match[1],title:title||'Untitled chat',remoteUrl:'https://chatgpt.com'+raw}];
   });
 });
}
async function scrollSidebar(page, attempts=8) {
 const all=new Map();
 for(let i=0;i<attempts;i++){
   for(const chat of await sidebarRows(page))all.set(chat.id,chat);
   const moved=await page.evaluate(()=>{
      const first=document.querySelector('a[href^="/c/"]');
      if(!first)return false;
      let n=first.parentElement;
      while(n&&n!==document.body){
        if(n.scrollHeight>n.clientHeight+30&&n.clientHeight>100){
          const before=n.scrollTop;
          n.scrollTop=Math.min(n.scrollHeight,n.scrollTop+Math.max(220,n.clientHeight*.9));
          return n.scrollTop>before+2;
        }
        n=n.parentElement;
      }
      return false;
   });
   if(!moved){
      if(all.size>0)break;
      await delay(480);
      continue;
   }
   await delay(280);
 }
 for(const chat of await sidebarRows(page))all.set(chat.id,chat);
 return [...all.values()];
}
async function visibleHistory(page){
 return page.evaluate(()=>{
   const items=[...document.querySelectorAll('[data-chatgpt-search-unit-key]')];
   const messages=[];
   for(const node of items){
      const key=node.getAttribute('data-chatgpt-search-unit-key')||'';
      const role=key.endsWith(':user')?'user':key.endsWith(':assistant')?'assistant':null;
      if(!role)continue;
      const id=node.getAttribute('data-chatgpt-search-message-ids')||key;
      let content='';
      if(role==='assistant'){
        const parts=[...node.querySelectorAll('[class*="MarkdownRoot"]')].filter(el=>!el.closest('[class*="activity-header"]')).map(el=>(el.innerText||'').trim()).filter(Boolean);
        content=parts.join('\n\n');
        if(!content){
          const fallback=[...node.children].filter(el=>!el.classList.contains('sr-only'))
             .map(el=>(el.innerText||'').trim()).filter(Boolean);
          content=fallback.join('\n\n');
        }
      }else{
        const primary=node.querySelector('[class*="user-message-bubble"]');
        content=(primary?.innerText||node.innerText||'').trim();
      }
      const turn=node.closest('[data-talvt-turn-state]');
      const state=turn?.getAttribute('data-talvt-turn-state')||null;
      const stage=[...node.querySelectorAll('[class*="activity-header"]')]
        .map(el=>(el.innerText||'').trim()).filter(Boolean).slice(-1)[0]||null;
      messages.push({id,role,content:content.slice(0,120000),state,stage});
   }
   const visible = el => Boolean(el&&el.getClientRects().length);
   const button=[...document.querySelectorAll('button[aria-label="Stop"],button[aria-label="Stop generating"],button[aria-label="Stop response"]')].some(visible);
   const activity=[...document.querySelectorAll('[class*="activity-header"]')].filter(visible)
       .map(el=>(el.innerText||'').trim().slice(0,450)).filter(Boolean).slice(-2);
   return {messages,thinking:activity,canStop:button,url:location.origin+location.pathname};
 });
}
async function ensureConversation(page,url){
 const target=validUrl(url);if(!target)throw Error('Invalid ChatGPT conversation');
 if(page.url().split('?')[0]!==target)await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
 await page.locator('main').waitFor({state:'attached',timeout:35000});
 let lastFingerprint='',stable=0;
 for(let i=0;i<28;i++){
   const summary=await visibleHistory(page);
   if(summary.messages.length){
     const last=summary.messages.at(-1);
     const textReady=last.role==='user'||(last.content && last.content!=='ChatGPT said:');
     const fingerprint=summary.messages.map(m=>m.id+':'+m.content.length).join('|');
     stable=fingerprint===lastFingerprint?stable+1:0;
     lastFingerprint=fingerprint;
     if(textReady&&stable>=2)return summary;
     if(i>=12&&stable>=3)return summary;
   }
   await delay(350);
 }
 return visibleHistory(page);
}
async function loadOlder(page){
 await page.evaluate(()=>{
  const item=document.querySelector('[data-chatgpt-search-unit-key]');
  let n=item?.parentElement;
  while(n&&n!==document.body){
   if(n.scrollHeight>n.clientHeight+120&&n.clientHeight>200){
      n.scrollTop=0;return;
   }n=n.parentElement;
  }
 });
 await delay(550);
 return visibleHistory(page);
}
async function findRow(page,remoteUrl){
 const url=validUrl(remoteUrl);if(!url)throw Error('Invalid remote URL');
 const pathname=new URL(url).pathname;
 let row=page.locator('[role="group"]').filter({has:page.locator('a[href="'+pathname+'"]')}).first();
 if(await row.count())return row;
 // If an older conversation isn't mounted in the sidebar, open it first.
 await ensureConversation(page,url);
 row=page.locator('[role="group"]').filter({has:page.locator('a[href="'+pathname+'"]')}).first();
 if(!await row.count())throw Error('Conversation row is not present in the ChatGPT sidebar');
 return row;
}
async function openActions(page,url){
 const row=await findRow(page,url);
 await row.hover();
 await row.getByRole('button',{name:'Chat actions'}).click();
}
function createBrowserSync({browser,emit,signedIn,busy}){
 const event=(requestId,action,data={})=>emit({type:'sync',requestId,action,...data});
 const page=()=>currentPage(browser);
 async function run(command){
  const {action,requestId}=command;
  if(typeof requestId!=='string'||requestId.length>90||!/^[\w-]+$/.test(requestId))return;
  try{
    const p=page();
    if(!p||!await signedIn(p))throw Error('Sign in in the embedded Chromium browser first');
    if(busy() && !['list','status'].includes(action))throw Error('Wait for the current response to finish');
    if(action==='list'){
      const chats=await scrollSidebar(p,Number.isInteger(command.depth)?Math.max(1,Math.min(18,command.depth)):8);
      event(requestId,action,{ok:true,chats});
    }else if(action==='open'){
      const history=await ensureConversation(p,command.remoteUrl);
      event(requestId,action,{ok:true,...history});
    }else if(action==='older'){
      const url=validUrl(command.remoteUrl);
      if(!url)throw Error('Invalid remote URL');
      if(p.url().split('?')[0]!==url)await ensureConversation(p,url);
      const history=await loadOlder(p);
      event(requestId,action,{ok:true,...history});
    }else if(action==='delete'){
      const remoteUrl=validUrl(command.remoteUrl);
      if(!remoteUrl||command.confirmed!==true)throw Error('Remote deletion requires explicit confirmation');
      await openActions(p,remoteUrl);
      await p.getByRole('menuitem',{name:'Delete',exact:true}).click();
      const dialog=p.getByRole('dialog').filter({has:p.getByRole('button',{name:'Delete chat',exact:true})}).first();
      await dialog.waitFor({state:'visible',timeout:8000});
      await dialog.getByRole('button',{name:'Delete chat',exact:true}).click();
      // Do not report successful deletion unless the website actually navigates
      // away or removes the conversation from its sidebar.
      const path=new URL(remoteUrl).pathname;
      await p.waitForFunction(path=>location.pathname!==path || !document.querySelector('a[href="'+path+'"]'),path,{timeout:12000});
      event(requestId,action,{ok:true,remoteUrl});
    }else if(action==='rename'){
      const url=validUrl(command.remoteUrl);
      const title=typeof command.title==='string'?command.title.trim().slice(0,100):'';
      if(!url||!title)throw Error('Invalid rename request');
      await openActions(p,url);
      await p.getByRole('menuitem',{name:'Rename',exact:true}).click();
      const dialog=p.getByRole('dialog').first();
      await dialog.waitFor({state:'visible',timeout:6000});
      const field=dialog.locator('input').first();
      await field.fill(title);
      const save=dialog.getByRole('button',{name:/^(save|rename)$/i}).first();
      if(await save.count())await save.click();else await field.press('Enter');
      event(requestId,action,{ok:true,remoteUrl:url,title});
    }else if(action==='status'){
      const h=await visibleHistory(p);event(requestId,action,{ok:true,thinking:h.thinking,canStop:h.canStop});
    }else{
      throw Error('Unknown browser synchronization operation');
    }
  }catch(err){event(requestId,action,{ok:false,error:err?.message||String(err)});}
 }
 return {run};
}
module.exports={validUrl,currentPage,sidebarRows,scrollSidebar,visibleHistory,loadOlder,ensureConversation,createBrowserSync};