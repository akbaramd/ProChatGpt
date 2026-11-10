const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../extension');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
test('only one incident controller is active in the runtime',()=>{
 const js=manifest.content_scripts[0].js;
 assert.ok(js.includes('incident-recovery.js'));
 assert.equal(js.includes('fault-recovery.js'),false);
 assert.equal(js.includes('stream-recovery-policy.js'),false);
 assert.equal(new Set(js).size,js.length);
 assert.ok(js.indexOf('incident-recovery.js')<js.indexOf('content.js'));
});
test('all referenced runtime files exist with narrow host permissions',()=>{
 for(const name of [...manifest.content_scripts.flatMap(x=>x.js),
  ...manifest.background.scripts,manifest.action.default_popup,
  ...Object.values(manifest.icons)])
 assert.ok(fs.existsSync(path.join(root,name)),name+' missing');
 assert.deepEqual([...manifest.host_permissions].sort(),
  ['https://chat.openai.com/*','https://chatgpt.com/*']);
 assert.equal(manifest.manifest_version,3);
});
