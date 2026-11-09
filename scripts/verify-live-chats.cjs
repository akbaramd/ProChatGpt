const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2],{timeout:12000});
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).hostname==='chatgpt.com'}catch{return false}});
 if(!p)throw Error('No signed-in ChatGPT tab');
 const {sidebarRows,visibleHistory,ensureConversation}=require('./browser-sync.cjs');
 const rows=await sidebarRows(p);
 const target=rows.find(c=>c.remoteUrl && !/sign in/i.test(c.title));
 if(target)await ensureConversation(p,target.remoteUrl);
 const history=await visibleHistory(p);
 const selected=rows.find(x=>p.url().startsWith(x.remoteUrl));
 console.log(JSON.stringify({connected:true,liveSidebarVisible:rows.length,
  selectedConversation:!!selected,selectedConversationIdMatchesSidebar:Boolean(selected),
  renderedMessages:history.messages.length,
  renderedUserMessages:history.messages.filter(x=>x.role==='user').length,
  renderedAssistantMessages:history.messages.filter(x=>x.role==='assistant').length,
  canStop:history.canStop},null,2));
 process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});