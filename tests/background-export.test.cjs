const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Firefox background export routes to downloads API in dedicated folder',async()=>{
 let handler=null,download=null,revoked=false;
 const fake={
  browser:{
   runtime:{onMessage:{addListener(fn){handler=fn}}},
   storage:{local:{}},
   downloads:{async download(opts){download=opts;return 42}}
  },
  AutoContinueTrace:{async readAll(){return {schema:1,events:[{event:'state',reason:'scheduled'}],sessions:[]}}},
  URL:{createObjectURL(){return 'blob:diagnostics'},revokeObjectURL(){revoked=true}},
  Blob,setTimeout(){},module:{exports:{}}
 };
 fake.globalThis=fake;
 const source=fs.readFileSync(path.join(__dirname,'../extension/background.js'),'utf8');
 vm.runInNewContext(source,fake);
 assert.equal(typeof handler,'function');
 const result=await handler({type:'autoContinue:exportDiagnostics'});
 assert.equal(result.ok,true);assert.equal(result.id,42);
 assert.equal(download.url,'blob:diagnostics');
 assert.match(download.filename,/^AutoContinue\/diagnostics\/AutoContinue-diagnostics-/);
 assert.equal(handler({type:'unknown'}),undefined);
});
