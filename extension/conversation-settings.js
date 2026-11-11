// Per-conversation persistence. No global active-chat pointer.
(function (global) {
  'use strict';
  const DEFAULTS=Object.freeze({enabled:false,message:'ادامه بده',delaySeconds:3,maxSends:0,draftMode:'append'});
  const PREFIX='autoContinue:conversation:';
  function pathFrom(value) {
    if(typeof value!=='string')return null;
    try{
      const url=new URL(value,'https://chatgpt.com');
      if(!['chatgpt.com','chat.openai.com'].includes(url.hostname) ||
         url.protocol!=='https:')return null;
      const path=url.pathname.replace(/\/$/,'');
      if(/^\/uc\/[0-9a-f-]{8,}$/i.test(path))
        return '/c/'+path.split('/').at(-1).toLowerCase();
      return /^\/(?:g\/[^/]+\/)?c\/[0-9a-f-]{8,}$/i.test(path)?path.toLowerCase():null;
    }catch{return null;}
  }
  const configKey=path=>PREFIX+path;
  const receiptKey=path=>PREFIX+path+':receipt';
  const recoveryKey=path=>PREFIX+path+':recovery';
  const faultKey=path=>PREFIX+path+':fault';
  const incidentKey=path=>PREFIX+path+':incident';
  const streamRecoveryKey=path=>PREFIX+path+':stream-recovery';
  const DRAFT_MODES=Object.freeze(['append','replace','preserve']);
  // A draft is sent only after a completed assistant turn, never on typing alone.
  function planDraft(existing,continuation,mode='append'){
    const draft=String(existing||'').trim();
    const message=String(continuation||'').trim();
    if(!message)return {text:null,action:'empty-continuation'};
    if(!draft)return {text:message,action:'insert'};
    if(draft===message)return {text:message,action:'reuse'};
    if(mode==='preserve')return {text:null,action:'skip-draft'};
    if(mode==='replace')return {text:message,action:'replace'};
    // Idempotence across failed pre-click attempts and browser remounts:
    // a prepared draft is never suffixed twice with the same continuation.
    if(draft.endsWith('\n'+message))return {text:draft,action:'reuse'};
    return {text:draft+'\n\n'+message,action:'append'};
  }
  const freshRun=()=>String(Date.now())+'-'+Math.random().toString(36).slice(2);
  const normalize=values=>({
    ...DEFAULTS,
    enabled:values?.enabled===true,
    message:typeof values?.message==='string'&&values.message.trim()?values.message.trim():DEFAULTS.message,
    delaySeconds:Number.isFinite(Number(values?.delaySeconds))?
      Math.min(3600,Math.max(0,Math.floor(Number(values.delaySeconds)))):DEFAULTS.delaySeconds,
    maxSends:Number.isFinite(Number(values?.maxSends))?
      Math.min(999,Math.max(0,Math.floor(Number(values.maxSends)))):DEFAULTS.maxSends,
    draftMode:DRAFT_MODES.includes(values?.draftMode)?values.draftMode:DEFAULTS.draftMode,
    autoContinueRunId:values?.autoContinueRunId||null
  });
  async function read(storage,path){
    if(!path) return {config:{...DEFAULTS},receipt:null};
    const key=configKey(path),receipt=receiptKey(path);
    const saved=await storage.get({[key]:null,[receipt]:null});
    if(saved[key])return {config:normalize(saved[key]),receipt:saved[receipt]};
    // One-time migration for the chat explicitly selected in older builds.
    // An unbound legacy global setting is NOT duplicated into every chat.
    const legacy=await storage.get({
      enabled:false,message:DEFAULTS.message,delaySeconds:3,maxSends:0,
      targetConversation:null,autoContinueRunId:null,autoContinueReceipt:null
    });
    if(legacy.targetConversation===path){
      const config=normalize(legacy);
      config.autoContinueRunId ||= 'legacy';
      const oldReceipt=legacy.autoContinueReceipt?.conversation===path?
        legacy.autoContinueReceipt:null;
      await storage.set({[key]:config,[receipt]:oldReceipt});
      return {config,receipt:oldReceipt};
    }
    return {config:{...DEFAULTS},receipt:saved[receipt]};
  }
  async function save(storage,path,values){
    if(!path)throw Error('Open an existing ChatGPT conversation to configure it');
    const key=configKey(path);
    const stored=await storage.get({[key]:null});
    const previous=normalize(stored[key]);
    const next=normalize({...previous,...values});
    if(next.enabled&&!previous.enabled)next.autoContinueRunId=freshRun();
    else next.autoContinueRunId=previous.autoContinueRunId;
    await storage.set({[key]:next});
    return next;
  }
  const api={DEFAULTS,DRAFT_MODES,planDraft,pathFrom,configKey,receiptKey,recoveryKey,faultKey,incidentKey,streamRecoveryKey,read,save,normalize};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else global.ContinueConversationSettings=api;
})(typeof window!=='undefined'?window:globalThis);