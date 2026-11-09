const {chromium}=require('playwright');
(async()=>{
const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2],{timeout:15000});
const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).hostname==='chatgpt.com'}catch{return false}});
if(!p)throw Error('No page');
const href=await p.locator('a[href^="/c/"]').first().getAttribute('href');if(!href)throw Error('No chat links');
await p.goto('https://chatgpt.com'+href,{waitUntil:'domcontentloaded',timeout:30000});await p.waitForTimeout(2200);
const r=await p.evaluate(()=>{
const visible=e=>!!(e&&e.getClientRects().length);
const simple=e=>({tag:e.tagName,role:e.getAttribute('role'),dataTest:e.getAttribute('data-testid'),dataAuthor:e.getAttribute('data-message-author-role'),class:(typeof e.className==='string'?e.className:'').slice(0,105),textLen:(e.innerText||'').length,childCount:e.children.length});
const labels=['article','[role=article]','[data-message-author-role]','[data-testid*="message"]','[class*="DilResponseRoot"]','[class*="markdown"]','[class*="conversation-turn"]','[data-testid*="conversation-turn"]','[data-turn-id]','main','[aria-label="Thinking"]','[aria-label*="Stop"]'];
const counts={};for(const s of labels) counts[s]=[...document.querySelectorAll(s)].filter(visible).length;
const roots=[...document.querySelectorAll('[class*="DilResponseRoot"],[data-message-author-role],article,[data-testid*="conversation-turn"]')].filter(visible).slice(0,5).map(e=>simple(e));
const controls=[...document.querySelectorAll('button[aria-label]')].filter(visible).filter(e=>/copy|stop|retry|regenerate|thinking|reason|view|more|actions/i.test(e.getAttribute('aria-label')||'')).slice(-25).map(e=>({aria:e.getAttribute('aria-label'),testid:e.getAttribute('data-testid')}));
const scroll=[...document.querySelectorAll('main,article,div')].filter(e=>e.scrollHeight>e.clientHeight+300&&e.clientHeight>130&&visible(e)).slice(0,9).map(e=>({...simple(e),scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}));
return {pathname:location.pathname,counts,roots,controls,scroll};
});
console.log(JSON.stringify(r,null,2));process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});