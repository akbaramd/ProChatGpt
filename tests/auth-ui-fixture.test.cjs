const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {signedIn}=require('../scripts/auth-browser.cjs');

test('Playwright recognises current ChatGPT-style editor and profile menu',async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,chromiumSandbox:true});
  try {
    const page=await browser.newPage();
    await page.route('https://chatgpt.com/**',route=>route.fulfill({
      status:200,contentType:'text/html',
      body:`<!doctype html><html><body>
      <aside><button style="display:none" aria-label="Open profile menu">Hidden mobile account</button><button aria-label="Open profile menu">Account</button></aside>
      <main><div contenteditable="true" role="textbox">Ask ChatGPT</div></main>
      </body></html>`
    }));
    await page.goto('https://chatgpt.com/');
    assert.equal(await signedIn(page),true,'Current editor markup should count as signed in');
    await page.evaluate(()=>document.querySelectorAll('[aria-label="Open profile menu"]').forEach(el=>el.remove()));
    assert.equal(await signedIn(page),false,'Do not treat a guest composer as a login');
    await page.evaluate(()=>{
      const b=document.createElement('button');
      b.setAttribute('aria-label','Open profile menu');b.textContent='Account';document.body.appendChild(b);
      const p=document.createElement('input');p.type='password';document.body.appendChild(p);
    });
    assert.equal(await signedIn(page),false,'Do not treat password screen as logged in');
  } finally {await browser.close();}
});