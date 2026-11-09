const {chromium}=require('playwright');
(async()=>{const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);const p=b.contexts().flatMap(c=>c.pages()).find(x=>{try{return new URL(x.url()).host==='chatdesk-app.example'}catch{return false}});
if(!p)throw Error('no app shell page');
const r=await p.evaluate(async()=>{
return new Promise((resolve,reject)=>{
 const req=indexedDB.open('chatdesk-conversation-store-v1');
 req.onerror=()=>reject(req.error);
 req.onsuccess=()=>{
 const d=req.result;const tx=d.transaction('meta','readonly');const q=tx.objectStore('meta').getAll();q.onsuccess=()=>resolve(q.result.filter(x=>(x.title||'').includes('Chromium integration')).map(x=>({id:x.id,title:x.title,source:x.source,remoteUrl:x.remoteUrl||null,messageCount:x.messageCount})));q.onerror=()=>reject(q.error);
 };
});
});
console.log(JSON.stringify(r,null,2));process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1)});