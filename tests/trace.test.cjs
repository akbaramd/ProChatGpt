const test=require('node:test');
const assert=require('node:assert/strict');
const trace=require('../extension/trace.js');
function storage(){const values={};return {values,async get(d){return {...d,...values}},async set(v){Object.assign(values,v)},async remove(keys){for(const k of keys)delete values[k]}}}
test('diagnostics never store prompts or credentials',async()=>{
 const st=storage(),t=trace.create(st,{id:'tab-1'});
 await t.append('send-clicked',{chat:'12345678abcdef',phase:'clicked',message:'secret prompt',cookie:'secret cookie',token:'secret token',enabled:true,responseWaitMs:1234});
 const report=await trace.readAll(st);
 assert.equal(report.events.length,1);assert.equal(report.events[0].chat,'12345678');
 for(const val of ['secret prompt','secret cookie','secret token'])assert.equal(JSON.stringify(report).includes(val),false);
});
test('ten concurrent tabs retain every diagnostic event',async()=>{
 const st=storage(),tabs=Array.from({length:10},(_,i)=>trace.create(st,{id:'tab'+i,capacity:500}));
 await Promise.all(tabs.flatMap((t,i)=>Array.from({length:200},(_,j)=>t.append('state',{reason:j%2?'waiting':'scheduled',sends:i*200+j}))));
 await Promise.all(tabs.map(t=>t.flush()));
 const report=await trace.readAll(st);
 assert.equal(report.sessions.length,10);assert.equal(report.events.length,2000);
});
test('stress: per-tab buffer stays bounded after 10000 events',async()=>{
 const st=storage(),tab=trace.create(st,{id:'long',capacity:350});
 for(let i=0;i<10000;i++)tab.append('heartbeat',{sends:i,leader:true});
 await tab.flush();
 const report=await trace.readAll(st);
 assert.equal(report.events.length,350);assert.equal(report.events[0].sends,9650);
 assert.equal(report.sessions[0].dropped,9650);
});
test('persist across sessions and clear safely',async()=>{
 const st=storage();
 await trace.create(st,{id:'old'}).append('state',{reason:'paused-unconfirmed'});
 await trace.create(st,{id:'new'}).append('state',{reason:'scheduled'});
 assert.equal((await trace.readAll(st)).sessions.length,2);
 await trace.clearAll(st);assert.equal((await trace.readAll(st)).sessions.length,0);
});
test('diagnostic retention prunes old sessions without touching recent ones',async()=>{
 const st=storage(),now=50*86400000;
 await st.set({
  'autoContinue:trace:old':{schema:1,session:'old',updatedAt:now-16*86400000,events:[{t:1,event:'state'}]},
  'autoContinue:trace:new':{schema:1,session:'new',updatedAt:now-1000,events:[{t:now,event:'state'}]}
 });
 assert.equal((await trace.prune(st,{now,maxSessions:100})).removed,1);
 const report=await trace.readAll(st);
 assert.equal(report.sessions.length,1);assert.equal(report.sessions[0].id,'new');
});
