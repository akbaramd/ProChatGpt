const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2],{timeout:15000});
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).hostname==='chatgpt.com'}catch{return false}});
 if(!p)throw Error('No ChatGPT tab');
 await p.keyboard.press('Escape');
 const button=p.getByRole('button',{name:'Select ChatGPT model'}).first();
 if(!await button.count())throw Error('Model selector unavailable');
 await button.click();
 const output=await p.evaluate(()=>{
  const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  return {
   menus:[...document.querySelectorAll('[role=menu],[role=dialog],[role=listbox],[data-state=open]')].filter(visible).slice(0,7).map(x=>({role:x.getAttribute('role'),text:(x.innerText||'').slice(0,700)})),
   choices:[...document.querySelectorAll('[role=menuitem],[role=menuitemradio],[role=option],[role=radio],[role=button]')].filter(visible).filter(x=>/instant|medium|high|thinking|effort|auto|pro|extra|fast/i.test(x.innerText||'')).slice(0,25).map(x=>({role:x.getAttribute('role'),text:(x.innerText||'').trim().slice(0,160),state:x.getAttribute('data-state'),checked:x.getAttribute('aria-checked')}))
  };
 });
 console.log(JSON.stringify(output,null,2));process.exit(0);
})().catch(e=>{console.error('ERROR',e.message);process.exit(1)});
