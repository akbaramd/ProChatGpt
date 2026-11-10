// Build a minimal Firefox extension ZIP with every referenced local asset.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../extension');
function runtimeFiles(){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 const files=new Set([...manifest.content_scripts.flatMap(s=>s.js||[]),
  ...(manifest.background?.scripts||[]),manifest.action?.default_popup,
  ...Object.values(manifest.icons||{}),'manifest.json','README.md'].filter(Boolean));
 const queue=[manifest.action?.default_popup].filter(Boolean);
 while(queue.length){
  const file=queue.shift(),html=fs.readFileSync(path.join(root,file),'utf8');
  const pattern=/<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for(const match of html.matchAll(pattern)){
   const ref=match[1];if(/^(?:https?:|data:|#|\/\/)/i.test(ref))continue;
   const name=path.posix.normalize(path.posix.join(path.posix.dirname(file),ref));
   if(!files.has(name)){files.add(name);if(/\.html?$/i.test(name))queue.push(name);}
  }
 }
 for(const file of files){
  if(!/^[A-Za-z0-9._/-]+$/.test(file)||file.startsWith('/')||file.split('/').includes('..'))
   throw Error('Unsafe extension path: '+file);
  if(!fs.statSync(path.join(root,file)).isFile())throw Error('Missing asset: '+file);
 }
 return [...files].sort();
}
function packageExtension(destination){
 if(!destination)throw Error('Missing output directory');
 const target=path.resolve(destination);fs.mkdirSync(target,{recursive:true});
 const files=runtimeFiles();
 for(const file of files){
  const out=path.join(target,file);fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.copyFileSync(path.join(root,file),out);
 }
 return files;
}
if(require.main===module)console.log(JSON.stringify(packageExtension(process.argv[2]),null,2));
module.exports={runtimeFiles,packageExtension};
