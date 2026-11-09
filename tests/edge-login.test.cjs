const {test}=require('node:test');
const assert=require('node:assert/strict');
const {allowedUrl,signedIn}=require('../scripts/auth-browser.cjs');
test('Only ChatGPT chat origins qualify for UI-based login detection',()=>{
 for(const url of [
   'https://auth.openai.com/authorize',
   'https://chatgpt.com/auth/login',
   'https://chatgpt.com/login',
   'https://chatgpt.com.evil.example/',
   'http://chatgpt.com/',
 ]) assert.equal(allowedUrl(url),false,url);
 assert.equal(allowedUrl('https://chatgpt.com/'),true);
 assert.equal(allowedUrl('https://chatgpt.com/c/123'),true);
});
test('An authenticated state requires visible account UI on the signed-in page',async()=>{
 const page={isClosed:()=>false,url:()=> 'https://chatgpt.com/',evaluate:async()=>false};
 assert.equal(await signedIn(page),false);
 page.evaluate=async()=>true;
 assert.equal(await signedIn(page),true);
 page.url=()=> 'https://chatgpt.com/auth/login';
 assert.equal(await signedIn(page),false);
});
