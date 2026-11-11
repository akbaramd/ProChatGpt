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
test('draft plans append once, replace, preserve, and reuse safely',()=>{
 const message='ادامه بده';
 assert.deepEqual(s.planDraft('',message,'append'),{text:message,action:'insert'});
 assert.deepEqual(s.planDraft('متن من',message,'append'),
   {text:'متن من\n\n'+message,action:'append'});
 assert.deepEqual(s.planDraft('متن من\n\n'+message,message,'append'),
   {text:'متن من\n\n'+message,action:'reuse'});
 assert.deepEqual(s.planDraft('متن من',message,'replace'),
   {text:message,action:'replace'});
 assert.deepEqual(s.planDraft('متن من',message,'preserve'),
   {text:null,action:'skip-draft'});
 assert.deepEqual(s.planDraft(message,message,'replace'),
   {text:message,action:'reuse'});
});
test('draft policy persists per chat; unknown values normalize to append',async()=>{
 const storage=make();
 await s.save(storage,a,{enabled:true,draftMode:'replace'});
 await s.save(storage,b,{enabled:true,draftMode:'preserve'});
 assert.equal((await s.read(storage,a)).config.draftMode,'replace');
 assert.equal((await s.read(storage,b)).config.draftMode,'preserve');
 assert.equal(s.normalize({draftMode:'unrecognized'}).draftMode,'append');
 assert.equal(s.normalize({}).draftMode,'append');
});
