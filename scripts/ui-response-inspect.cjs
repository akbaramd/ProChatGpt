const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>new URL(x.url()).hostname==='chatgpt.com');
 if(!p)throw Error('No page');
 const res=await p.evaluate(()=>{
  const target='ChatDesk stream connection test succeeded';
  const all=[...document.querySelectorAll('div,p,span')];
  const candidates=all.filter(x=>x.childElementCount===0&&x.textContent?.includes(target)).slice(0,5);
  const structures=candidates.map(x=>{
   const list=[];let node=x;
   for(let i=0;node&&i<9;node=node.parentElement,i++){
    list.push({tag:node.tagName,role:node.getAttribute('role'),id:node.id,testid:node.getAttribute('data-testid'),author:node.getAttribute('data-message-author-role'),class:(typeof node.className==='string'?node.className:'').slice(0,100),text:(node.innerText||'').slice(0,160)});
   }
   return list;
  });
  const visible=x=>!!(x&&x.getClientRects().length);
  const controls=[...document.querySelectorAll('button')].filter(visible).filter(x=>/send|stop|retry|regenerate|edit|copy|read aloud/i.test(x.getAttribute('aria-label')||'')).map(x=>({aria:x.getAttribute('aria-label'),disabled:x.disabled})).slice(-20);
  const editor=document.querySelector('[contenteditable="true"][role="textbox"]');
  return {matched:candidates.length,structures,controls,editor:!!editor,headingCount:document.querySelectorAll('main').length};
 });
 console.log(JSON.stringify(res,null,2));
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});
