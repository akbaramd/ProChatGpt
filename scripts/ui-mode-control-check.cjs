const {chromium}=require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:'+process.argv[2]);
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>new URL(x.url()).hostname==='chatgpt.com');
 await p.keyboard.press('Escape');
 const btn=p.getByRole('button',{name:'Select ChatGPT model'}).first();await btn.click();
 const ctrl=p.getByRole('menuitem',{name:'Power'});const val=()=>p.locator('[role="slider"][aria-valuenow]').first().getAttribute('aria-valuenow');
 console.log('START',await val());
 await ctrl.focus();await ctrl.press('ArrowLeft');await p.waitForTimeout(200);console.log('AFTER_LEFT',await val());
 await ctrl.press('ArrowRight');await p.waitForTimeout(200);console.log('RESTORED',await val());
 await ctrl.press('ArrowRight');await p.waitForTimeout(200);console.log('AFTER_RIGHT',await val());
 await ctrl.press('ArrowLeft');await p.waitForTimeout(200);console.log('RESTORED2',await val());
 await p.keyboard.press('Escape');process.exit(0);
})().catch(e=>{console.error('ERROR',e.message);process.exit(1)});
