const {chromium}=require('playwright');
(async()=>{const browser=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2],{timeout:15000});const page=browser.contexts().flatMap(c=>c.pages()).find(p=>{try{return new URL(p.url()).host==='chatgpt.com'}catch{return false}});if(!page)throw Error('No chat tab');
const r=await page.evaluate(()=>{
const a=[...document.querySelectorAll('a[href^="/c/"]')];
const count={};
for(const s of ['nav','aside','[role="group"]','[data-testid]','[data-testid*="conversation"]','[data-testid*="message"]','[data-message-author-role]','[class*="DilResponseRoot"]','[aria-label="Chat actions"]','[aria-label="Stop"]','[aria-label="Open profile menu"]'])count[s]=document.querySelectorAll(s).length;
const example=a.slice(0,3).map(x=>{
let p=x;const rows=[];for(let i=0;i<4&&p;i++,p=p.parentElement)rows.push({tag:p.tagName,role:p.getAttribute('role'),testid:p.getAttribute('data-testid'),class:(typeof p.className==='string'?p.className:'').slice(0,100),childButtons:[...p.querySelectorAll('button')].slice(0,3).map(b=>b.getAttribute('aria-label')),href:p.getAttribute('href')});return rows});
return {path:location.pathname,sidebarCount:a.length,selectedLinks:a.slice(0,4).map(x=>({href:x.getAttribute('href'),titleLength:(x.innerText||x.textContent||'').length})),example,count};
});console.log(JSON.stringify(r,null,2));process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});