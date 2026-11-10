const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../extension/incident-recovery.js');
const base={online:true,composerEmpty:true,errorBanner:false,connectionInterrupted:true,generating:true,hasStopButton:true,retryAvailable:false,rateLimited:false,conversationMaxed:false,latestAssistantKey:'old',latestAssistantLength:100,latestTurnRole:'assistant',completedAssistantKey:null};
const step=(e,o,time)=>p.transition(e,{...base,...o},time);
test('same-length text changes after refresh postpone Stop',()=>{
 const a=p.hashText('AAAA'),b=p.hashText('BBBB');
 let r=step(null,{latestAssistantHash:a},1000);
 r=step(r.incident,{latestAssistantHash:a},47000);assert.equal(r.action,'reload');
 r=step(r.incident,{latestAssistantHash:b},62000);assert.equal(r.action,'wait');
 assert.equal(r.incident.lastProgressAt,62000);
 r=step(r.incident,{latestAssistantHash:b},85000);assert.notEqual(r.action,'stop');
 r=step(r.incident,{latestAssistantHash:b},94000);assert.equal(r.action,'stop');
});
test('shrinking text restarts quiet clock',()=>{
 let r=step(null,{},1000);r=step(r.incident,{},47000);
 r=step(r.incident,{latestAssistantLength:20},65000);
 assert.equal(r.incident.lastProgressAt,65000);assert.notEqual(r.action,'stop');
});
test('persistent Stop eventually becomes hold, not infinite loop',()=>{
 let r=step(null,{},1000);r=step(r.incident,{},47000);
 r=step(r.incident,{},79000);assert.equal(r.action,'stop');
 r=step(r.incident,{},201000);
 assert.equal(r.action,'hold');assert.equal(r.reason,'stop-unresponsive');
});
test('vanished banner with pre-existing completed answer cannot repeat a prompt',()=>{
 let r=step(null,{connectionInterrupted:false,errorBanner:true,retryAvailable:true,generating:false,hasStopButton:false,completedAssistantKey:'old'},1000);
 r=step(r.incident,{connectionInterrupted:false,errorBanner:false,retryAvailable:false,generating:false,hasStopButton:false,completedAssistantKey:'old'},36000);
 assert.equal(r.action,'wait');
});
test('completion newly confirmed after banner clears safely resumes',()=>{
 let r=step(null,{connectionInterrupted:false,errorBanner:true,retryAvailable:true,generating:false,hasStopButton:false,completedAssistantKey:null},1000);
 r=step(r.incident,{connectionInterrupted:false,errorBanner:false,retryAvailable:false,generating:false,hasStopButton:false,completedAssistantKey:'old'},36000);
 assert.equal(r.action,'release');
});
test('Retry with Stop reloads first, stops once, releases stable assistant',()=>{
 let r=step(null,{connectionInterrupted:false,errorBanner:true,retryAvailable:true},1000);
 r=step(r.incident,{connectionInterrupted:false,errorBanner:true,retryAvailable:true},35000);assert.equal(r.action,'reload');
 r=step(r.incident,{connectionInterrupted:false,errorBanner:true,retryAvailable:true},69000);assert.equal(r.action,'stop');
 r=step(r.incident,{connectionInterrupted:false,errorBanner:false,retryAvailable:false,generating:false,hasStopButton:false},103000);
 assert.equal(r.action,'release-partial');
});
test('UI interruption banner does not count as assistant content growth',()=>{
 const body='Output from assistant',warning=body+'Connection interrupted. Waiting for the complete answer.';
 assert.equal(p.cleanAssistantText(warning),body);
 assert.equal(p.hashText(p.cleanAssistantText(warning)),p.hashText(body));
});