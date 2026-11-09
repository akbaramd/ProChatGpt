const {chromium}=require('playwright');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).hostname==='chatgpt.com'}catch{return false}});const r=await p.evaluate(()=>{
const simple=e=>({tag:e.tagName,role:e.getAttribute('role'),attrs:e.getAttributeNames().filter(k=>k.startsWith('data-')).slice(0,12).map(k=>[k,e.getAttribute(k)?.slice(0,40)]),cls:(typeof e.className==='string'?e.className:'').slice(0,120),len:e.innerText?.length||0,buttons:[...e.querySelectorAll('button[aria-label]')].slice(-5).map(b=>b.getAttribute('aria-label'))});
const candidates=[...document.querySelectorAll('button[aria-label="Copy message"]')].slice(0,2);const chains=candidates.map(b=>{let el=b;const res=[];for(let i=0;i<11&&el;i++,el=el.parentElement)res.push(simple(el));return res});
const activity=[...document.querySelectorAll('[class*="activity-header"]')].slice(-1).map(el=>{let n=el,r=[];for(let i=0;i<5&&n;i++,n=n.parentElement)r.push(simple(n));return r;});
const stop=[...document.querySelectorAll('button[aria-label="Stop"]')].map(simple);
return {copyCount:document.querySelectorAll('button[aria-label="Copy message"]').length,chains,activity,stop};
});console.log(JSON.stringify(r,null,2));process.exit(0)})().catch(e=>{console.error(e.message);process.exit(1)});