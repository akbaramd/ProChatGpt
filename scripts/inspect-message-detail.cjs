const {chromium}=require('playwright');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).hostname==='chatgpt.com'}catch{return false}});await p.waitForTimeout(3500);
const result=await p.evaluate(()=>{
const o={path:location.pathname,title:document.title};
const main=document.querySelector('main');o.main=main?{textLength:main.innerText.length,htmlLength:main.innerHTML.length,children:main.children.length,buttons:[...main.querySelectorAll('button[aria-label]')].map(e=>e.getAttribute('aria-label')).slice(-18)}:null;
o.tags={};for(const s of ['[data-testid]','[role="group"]','[class*="Dil"]','[class*="response"]','[class*="prose"]','[class*="message"]','[contenteditable]','[role="textbox"]'])o.tags[s]=document.querySelectorAll(s).length;
o.mainChildren=main?[...main.querySelectorAll('div')].filter(x=>x.children.length>0&&x.innerText&&x.innerText.length>40&&x.innerText.length<750).slice(-12).map(x=>({class:(typeof x.className==='string'?x.className:'').slice(0,110),len:x.innerText.length,child:x.children.length})):null;
return o});console.log(JSON.stringify(result,null,2));process.exit(0)
})().catch(e=>{console.error(e.message);process.exit(1)});