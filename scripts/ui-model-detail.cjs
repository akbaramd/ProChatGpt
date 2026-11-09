const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>new URL(x.url()).hostname==='chatgpt.com');
 await p.keyboard.press('Escape');
 await p.getByRole('button',{name:'Select ChatGPT model'}).first().click();
 const res=await p.evaluate(()=>{
  const vis=e=>!!(e&&e.getClientRects().length);
  const items=[...document.querySelectorAll('[role=slider],input[type=range],[aria-valuenow],[role=menuitem],[role=menu]')].filter(vis);
  return items.slice(0,16).map(e=>({tag:e.tagName,role:e.getAttribute('role'),aria:e.getAttribute('aria-label'),value:e.getAttribute('aria-valuenow'),min:e.getAttribute('aria-valuemin'),max:e.getAttribute('aria-valuemax'),title:e.getAttribute('title'),state:e.getAttribute('data-state'),text:(e.innerText||'').trim().slice(0,280),outer:e.outerHTML.slice(0,430)}));
 });
 console.log(JSON.stringify(res,null,2));
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
