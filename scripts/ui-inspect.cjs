const { chromium } = require('playwright');
(async()=>{
 const port=process.argv[2];const b=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:15000});
 try{
  const p=b.contexts().flatMap(c=>c.pages()).find(p=>{try{return new URL(p.url()).hostname==='chatgpt.com'}catch{return false}});
  if(!p)throw Error('No ChatGPT tab found');
  const x=await p.evaluate(()=>{
    const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    const sel=['#prompt-textarea','[contenteditable="true"]','[data-testid="composer"]','button[data-testid]','button[aria-label]','[role="combobox"]','[data-testid*="model"]'];
    const a={};
    for(const s of sel){
     a[s]=Array.from(document.querySelectorAll(s)).filter(visible).slice(0,18).map(e=>({
       tag:e.tagName, id:(e.id||'').slice(0,70), testid:(e.getAttribute('data-testid')||'').slice(0,70),
       aria:(e.getAttribute('aria-label')||'').slice(0,100),
       text:(e.tagName==='BUTTON'?(e.innerText||'').trim().slice(0,75):''),
       role:e.getAttribute('role')||''
     }));
    }
    return a;
  });
  console.log(JSON.stringify({page:'chatgpt',ui:x},null,2));
 }finally{process.exit(0);}
})().catch(e=>{console.error(String(e));process.exit(1);});
