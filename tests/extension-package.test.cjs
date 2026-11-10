'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runtimeFiles,packageExtension}=require('../scripts/extension-package.cjs');
test('release includes every popup JS dependency',()=>{
 const files=runtimeFiles();
 for(const file of ['popup.html','popup.js','conversation-settings.js','trace.js','manifest.json'])
  assert.ok(files.includes(file),'Missing '+file);
 assert.equal(new Set(files).size,files.length);
});
test('complete release build retains local script references',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'autocontinue-release-'));
 try{
  const files=packageExtension(dir);
  for(const file of files)assert.ok(fs.existsSync(path.join(dir,file)),file);
  const html=fs.readFileSync(path.join(dir,'popup.html'),'utf8');
  const refs=[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(x=>x[1]);
  assert.ok(refs.length>=3);
  for(const file of refs)assert.ok(fs.existsSync(path.join(dir,file)),file);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
