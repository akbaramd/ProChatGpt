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
test('unrelated form submit controls cannot be mistaken for Send',()=>{
 const doc={defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
 const button=label=>({
  type:'submit',ownerDocument:doc,isConnected:true,disabled:false,
  getClientRects:()=>[{}],offsetParent:{},textContent:label,
  getAttribute:key=>key==='aria-label'?label:null,closest:()=>null
 });
 const search=button('Search'),save=button('Save'),voice=button('Start voice mode');
 const form={querySelectorAll:selector=>
  selector.startsWith('button[type')?[search,save,voice]:[]};
 const editor={ownerDocument:doc,isConnected:true,getClientRects:()=>[{}],
  closest:selector=>selector==='form'?form:null};
 const dom={querySelectorAll:selector=>selector.includes('#prompt-textarea')?
  [editor]:[button('Send')]};
 assert.equal(core.sendButton(dom),null,
  'do not click a global Send from another form or unrelated local submits');
});
test('single anonymous submit in active composer form is supported',()=>{
 const doc={defaultView:{getComputedStyle:()=>({display:'block',visibility:'visible'})}};
 const submit={type:'submit',ownerDocument:doc,isConnected:true,disabled:false,
  textContent:'',getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null};
 const form={querySelectorAll:selector=>selector.startsWith('button[type')?[submit]:[]};
 const editor={ownerDocument:doc,isConnected:true,getClientRects:()=>[{}],
  closest:selector=>selector==='form'?form:null};
 const dom={querySelectorAll:selector=>selector.includes('#prompt-textarea')?[editor]:[]};
 assert.equal(core.sendButton(dom),submit);
});
test('primary composer wins over an earlier inline edit textbox',()=>{
 const win={getComputedStyle:()=>({display:'block',visibility:'visible'})};
 const mk=()=>({ownerDocument:{defaultView:win},isConnected:true,
  getClientRects:()=>[{}],offsetParent:{},closest:()=>null});
 const inline=mk(),main=mk();
 const dom={querySelectorAll:sel=>sel.includes('textarea[name="prompt-textarea"]')?
  [main]:[inline,main]};
 assert.equal(core.composerEditor(dom),main);
 const fallback={querySelectorAll:sel=>sel.includes('[contenteditable')?
  [inline,main]:[]};
 assert.equal(core.composerEditor(fallback),main);
});