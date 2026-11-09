const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateChatRequest}=require('../scripts/chat-controller.cjs');
test('accept local and remote ChatDesk conversation IDs',()=>{
 for(const chatId of ['local:12345678-1111-2222-3333-444444444444','remote:12345678-1111-2222-3333-444444444444']){
  assert.doesNotThrow(()=>validateChatRequest({type:'chat_send',id:'request-1',chatId,prompt:'Hello',effort:'medium'}));
 }
});
test('reject invalid commands and newline injection',()=>{
 assert.throws(()=>validateChatRequest({type:'chat_send',id:'request-1',chatId:'local:abc\nquit',prompt:'Hello',effort:'medium'}),/Invalid chat/);
 assert.throws(()=>validateChatRequest({type:'chat_send',id:'request-1',chatId:'local:abc',prompt:'Hello',effort:'magic'}),/Invalid chat/);
});