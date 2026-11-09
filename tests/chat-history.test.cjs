const {test}=require('node:test');
const assert=require('node:assert/strict');

test('ChatGPT export follows selected conversation branch and keeps message roles',async()=>{
 const {parseExportConversation,parseExportContent}=await import('../src/chat-history.mjs');
 const raw={
   id:'00000000-0000-0000-0000-000000000001', title:'Test from ChatGPT',
   create_time:1700000000,update_time:1700000300,
   current_node:'last',
   mapping:{
     root:{parent:null,message:null},
     user:{parent:'root',message:{id:'u',author:{role:'user'},content:{parts:['Hello']},create_time:1700000100}},
     bad:{parent:'user',message:{id:'wrong',author:{role:'assistant'},content:{parts:['Wrong branch']},create_time:1700000150}},
     last:{parent:'user',message:{id:'a',author:{role:'assistant'},content:{parts:['Final answer']},create_time:1700000200}}
   }
 };
 const a=parseExportConversation(raw);
 assert.equal(a.id,'export:'+raw.id);
 assert.equal(a.remoteUrl,null);
 assert.deepEqual(a.messages.map(m=>m.content),['Hello','Final answer']);
 assert.deepEqual(a.messages.map(m=>m.role),['user','assistant']);
 assert.equal(parseExportContent([raw]).length,1);
 assert.throws(()=>parseExportContent({mapping:{}}),/array/);
});
