const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2],{timeout:15000});
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>new URL(x.url()).hostname==='chatgpt.com');
 if(!p)throw Error('No chatgpt.com browser tab');
 await p.keyboard.press('Escape');
 const signedIn = await require('./auth-browser.cjs').signedIn(p);
 if(!signedIn)throw Error('Browser is not signed in');
 const editor=p.locator('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]').first();
 if(!await editor.count())throw Error('Editor selector unavailable');
 console.log('EDITOR_FOUND',await editor.count());
 await editor.fill('Reply with exactly this sentence: ChatDesk stream connection test succeeded.');
 console.log('FORM_CONTROLS',JSON.stringify(await p.evaluate(()=>{
  const editor=document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Ask ChatGPT"]');
  const target=editor?.closest('form')||editor?.parentElement?.parentElement?.parentElement;
  return [...target?.querySelectorAll('button')||[]].map(x=>({aria:x.getAttribute('aria-label'),title:x.getAttribute('title'),type:x.getAttribute('type'),disabled:x.disabled,txt:(x.innerText||'').slice(0,30)})).slice(-20);
 })));
 const send=p.getByRole('button',{name:/^Send message$|^Send$/i}).last();
 if(await send.count()) await send.click();
 else await editor.press('Enter');
 console.log('PROMPT_SENT');
 for(let i=0;i<55;i++){
  await p.waitForTimeout(600);
  const x=await p.evaluate(()=>{
   const selectors=['[data-message-author-role="assistant"]','[data-message-author-role="user"]','[data-testid*="assistant"]','article','[role="article"]','button[aria-label="Stop generating"]'];
   const counts={};for(const s of selectors) counts[s]=document.querySelectorAll(s).length;
   const arr=[...document.querySelectorAll('[data-message-author-role="assistant"]')];const last=arr.at(-1);
   return {counts,assistant:last?.innerText?.slice(0,500)||'', stop: !!document.querySelector('button[aria-label="Stop generating"]')};
  });
  if(i===0||i%3===0||x.assistant) console.log('TICK',i,JSON.stringify(x).slice(0,750));
  if(x.assistant.toLowerCase().includes('chatdesk stream connection test succeeded')&&!x.stop){console.log('RESULT_SUCCESS');break;}
 }
 console.log('FINAL_CHAT_URL',p.url().replace(/\?.*/, ''));
 process.exit(0);
})().catch(e=>{console.error('ERROR',e.message);process.exit(1)});
