const {chromium}=require('playwright');
(async()=>{
 const port=Number(process.argv[2]);
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+port,{timeout:9000});
 const contexts=b.contexts();
 console.log('CDP_CONNECTED',contexts.length);
 for(const c of contexts)for(const p of c.pages()){
  console.log('PAGE_HOST',new URL(p.url()).hostname);
  const result=await p.evaluate(()=>{
    const sel=[
      '#prompt-textarea',
      '[data-testid="composer"]',
      '[contenteditable="true"][data-testid*="prompt"]',
      '[contenteditable="true"]',
      '[data-testid="profile-button"]',
      '[data-testid="user-menu-button"]',
      'button[aria-label*="Profile"]',
      'button[aria-label*="Account"]',
      '[data-testid*="profile"]',
      '[data-testid*="avatar"]',
    ];
    const o={};
    for(const s of sel){
      const el=document.querySelector(s);
      o[s]={present:!!el,visible:!!(el&&el.getClientRects().length)};
    }
    const matched=[...document.querySelectorAll('button,div,[role=button]')].filter(x=>
      /profile|account|user.menu|avatar|sidebar.*user|user.*sidebar/i.test(
       [x.getAttribute('data-testid'),x.getAttribute('aria-label'),x.getAttribute('id')].filter(Boolean).join(' ')
      )).slice(0,22);
    return {selectors:o,candidates:matched.map(x=>({tag:x.tagName,role:x.getAttribute('role'),testid:x.getAttribute('data-testid'),id:x.id,aria:x.getAttribute('aria-label')?.replace(/[a-z]+@[a-z.]+/ig,'[redacted]')?.slice(0,100)}))};
  }).catch(e=>({error:e.message}));
  console.log(JSON.stringify(result,null,2));
 }
 process.exit(0);
})().catch(e=>{console.error('CHECK_ERROR',e.message);process.exit(1);});
