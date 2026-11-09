const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isAllowedLandingUrl,hasAuthenticatedInterface}=require('../scripts/experimental-playwright-auth.cjs');
test('Login routes and other origins must never signal authentication',()=>{
  for(const url of ['https://chatgpt.com/auth/login','https://chatgpt.com/login','https://evil.com/c/abc','http://chatgpt.com/','https://chatgpt.com.evil.org/'])
    assert.equal(isAllowedLandingUrl(url),false,url);
  assert.equal(isAllowedLandingUrl('https://chatgpt.com/'),true);
  assert.equal(isAllowedLandingUrl('https://chatgpt.com/c/123'),true);
});
test('Authentication requires signed-in UI evidence in addition to landing URL',async()=>{
  const fake={url:()=> 'https://chatgpt.com/',evaluate:async()=>false};
  assert.equal(await hasAuthenticatedInterface(fake),false);
  fake.evaluate=async()=>true;
  assert.equal(await hasAuthenticatedInterface(fake),true);
  fake.url=()=> 'https://chatgpt.com/auth/login';
  assert.equal(await hasAuthenticatedInterface(fake),false);
});
