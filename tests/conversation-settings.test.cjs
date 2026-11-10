const {test}=require('node:test');
const assert=require('node:assert/strict');
const s=require('../extension/conversation-settings.js');
function make(){const values={};return {values,async get(d){return {...d,...values}},async set(v){Object.assign(values,v)}};}
const a='/c/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const b='/c/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
test('only ChatGPT saved chat URLs are scoped',()=>{assert.equal(s.pathFrom('https://chatgpt.com'+a+'?q=1'),a);assert.equal(s.pathFrom('https://chat.openai.com'+b),b);assert.equal(s.pathFrom('https://evil.example'+a),null);assert.equal(s.pathFrom('https://chatgpt.com/'),null)});
test('conversation configurations and receipts are isolated',async()=>{
 const st=make(),one=await s.save(st,a,{enabled:true,message:'A',maxSends:2}),two=await s.save(st,b,{enabled:true,message:'B',maxSends:9});
 assert.notEqual(one.autoContinueRunId,two.autoContinueRunId);
 assert.equal((await s.read(st,a)).config.message,'A');assert.equal((await s.read(st,b)).config.message,'B');
 await st.set({[s.receiptKey(a)]:{assistantKey:'turn-A'}});
 assert.equal((await s.read(st,b)).receipt,null);
 await s.save(st,a,{enabled:false});
 assert.equal((await s.read(st,b)).config.enabled,true);
 const again=await s.save(st,a,{enabled:true});
 assert.notEqual(again.autoContinueRunId,one.autoContinueRunId);
});
test('legacy data only migrates to its originally bound conversation',async()=>{
 const st=make();
 await st.set({enabled:true,targetConversation:a,message:'legacy',autoContinueRunId:'old',autoContinueReceipt:{conversation:a,assistantKey:'old'}});
 assert.equal((await s.read(st,b)).config.enabled,false);
 const migrated=await s.read(st,a);
 assert.equal(migrated.config.message,'legacy');assert.equal(migrated.receipt.assistantKey,'old');
});
test('uc routes canonicalize to their c conversation',()=>{assert.equal(s.pathFrom('https://chatgpt.com/uc/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),a)});
