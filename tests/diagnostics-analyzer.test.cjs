const test=require('node:test'),assert=require('node:assert/strict');
const {analyze}=require('../scripts/analyze-auto-continue-diagnostics.cjs');
test('analyzer identifies rapid duplicate risk and blocked states without reading messages',()=>{
 const report=analyze({schema:1,exportedAt:10000,sessions:[{id:'one'}],events:[
  {t:10,event:'send-clicked',chat:'abcd1234'},
  {t:11,event:'send-clicked',chat:'abcd1234'},
  {t:12,event:'send-not-clicked',chat:'abcd1234',reason:'send-button-missing'},
  {t:13,event:'state',chat:'abcd1234',reason:'paused-unconfirmed'},
  {t:14,event:'watchdog-exception',chat:'abcd1234',errorCode:'TypeError'}
 ]});
 assert.equal(report.eventCount,5);assert.equal(report.chats[0].sends,2);
 assert.ok(report.issues.some(x=>x.type==='rapid-consecutive-sends'));
 assert.ok(report.issues.some(x=>x.type==='watchdog-exception'));
 assert.ok(report.issues.some(x=>x.type==='paused-unconfirmed'));
});
