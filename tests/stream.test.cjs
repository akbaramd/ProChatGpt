const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ReadableStream}=require('node:stream/web');
const {streamOpenAI}=require('../electron/stream.cjs');
test('Responses API SSE chunks are assembled and surfaced in order',async()=>{
  const frames=['data: {"type":"response.output_text.delta","delta":"Hel"}\n\n','data: {"type":"response.output_text.delta","delta":"lo"}\n\n','data: {"type":"response.completed"}\n\n'];
  const bytes=new TextEncoder().encode(frames.join(''));
  const parts=[bytes.slice(0,21),bytes.slice(21,73),bytes.slice(73)];
  const stream=new ReadableStream({start(controller){for(const p of parts)controller.enqueue(p);controller.close();}});
  const events=[];
  await streamOpenAI({key:'test',model:'mock',messages:[{role:'user',content:'hi'}],emit:e=>events.push(e),fetchImpl:async()=>({ok:true,body:stream})});
  assert.deepEqual(events,[{type:'delta',text:'Hel'},{type:'delta',text:'lo'},{type:'done'}]);
});
test('HTTP failure is returned without treating it as a successful response',async()=>{
  await assert.rejects(()=>streamOpenAI({key:'test',model:'mock',messages:[],emit:()=>{},fetchImpl:async()=>({ok:false,status:401,text:async()=>'invalid key'})}),/401/);
});
