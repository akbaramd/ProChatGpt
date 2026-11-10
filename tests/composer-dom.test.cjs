const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../extension/watchdog-core.js');
test('composer text normalization handles invisible and nonbreaking characters',()=>{
 assert.equal(core.normalizeComposerText('\u200b\u2060ادامه\u00a0بده\u200d\n'),'ادامه بده');
 assert.equal(core.editorText({tagName:'TEXTAREA',value:'ادامه بده\r\n'}),'ادامه بده');
 assert.equal(core.editorText({tagName:'DIV',innerText:'ادامه بده\u200b'}),'ادامه بده');
});
test('Send belongs to the active form and hidden/stale controls are ignored',()=>{
 const win={getComputedStyle:el=>({display:el.hidden?'none':'block',visibility:'visible'})};
 const doc={defaultView:win};
 const mk=(label,{hidden=false,disabled=false,ariaDisabled=false}={})=>({
  ownerDocument:doc,isConnected:true,hidden,disabled,
  getClientRects:()=>hidden?[]:[{}],offsetParent:hidden?null:{},
  getAttribute:key=>key==='aria-label'?label:key==='aria-disabled'?
    (ariaDisabled?'true':null):null,
  closest:()=>null
 });
 const hidden=mk('Send',{hidden:true});
 const voice=mk('Start Voice');
 const disabled=mk('Send',{ariaDisabled:true});
 const active=mk('Send');
 const form={querySelectorAll:()=>[hidden,voice,disabled,active]};
 const editor=mk('');editor.closest=sel=>sel==='form'?form:null;
 const dom={
  querySelectorAll:sel=>sel.includes('#prompt-textarea')?[editor]:
    [mk('Send'),hidden,disabled,active]
 };
 assert.equal(core.sendButton(dom),active);
 assert.equal(core.composerEditor(dom),editor);
});
test('Send selection does not fall back to invisible controls',()=>{
 const win={getComputedStyle:()=>({display:'none',visibility:'visible'})};
 const hidden={
  ownerDocument:{defaultView:win},isConnected:true,
  getClientRects:()=>[],offsetParent:null,
  closest:()=>null,getAttribute:()=>null
 };
 const dom={querySelectorAll:sel=>sel.includes('#prompt-textarea')?[hidden]:[hidden]};
 assert.equal(core.sendButton(dom),null);
});
