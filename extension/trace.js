// Durable per-tab structured diagnostics. No message bodies, cookies or URLs.
// Each tab has a unique storage key, so concurrent tabs never overwrite traces.
(function(global){
  'use strict';
  const PREFIX='autoContinue:trace:';
  const VERSION=1, CAP=1200;
  const ALLOWED=new Set([
    'reason','action','chat','phase','status','receiptPhase','lastTurnRole',
    'enabled','leader','visible','online','generating','completed','errorBanner',
    'retryAvailable','rateLimited','interrupted','conversationMaxed','hasStopButton',
    'hasEditor','sendReady','composerEmpty','blocked','awaitingResponse','sentPending',
    'sends','faultPhase','faultType','reloads','stopAttempts','retryAttempts','dueInMs','responseWaitMs','tickMs','attempt','elapsedMs','errorCode','source'
  ]);
  function clean(fields){
    const safe={};
    for(const [key,value] of Object.entries(fields||{})){
      if(!ALLOWED.has(key))continue;
      if(typeof value==='boolean')safe[key]=value;
      else if(typeof value==='number'&&Number.isFinite(value))safe[key]=Math.max(-1e10,Math.min(1e10,Math.round(value)));
      else if(typeof value==='string'){
        if(key==='chat')safe.chat=value.slice(0,8).replace(/[^0-9a-f]/gi,'');
        else if(key==='errorCode')safe.errorCode=value.slice(0,40).replace(/[^a-z0-9_-]/gi,'');
        else safe[key]=value.slice(0,64).replace(/[^\w.-]/g,'_');
      }
    }
    return safe;
  }
  function create(storage,{id,clock=()=>Date.now(),capacity=CAP}={}){
    const session=id||clock().toString(36)+'-'+Math.random().toString(36).slice(2,12);
    const key=PREFIX+session;
    let queue=Promise.resolve(),sequence=0,lastError=null;
    const append=(event,fields={})=>{
      const entry={t:clock(),seq:++sequence,event:String(event).slice(0,45).replace(/[^a-z0-9_-]/gi,''),...clean(fields)};
      queue=queue.catch(()=>{}).then(async()=>{
        const saved=await storage.get({[key]:null});
        const prev=saved[key];
        const previousLength=Array.isArray(prev?.events)?prev.events.length:0;
        const events=Array.isArray(prev?.events)?[...prev.events]:[];
        events.push(entry);
        if(events.length>capacity)events.splice(0,events.length-capacity);
        await storage.set({[key]:{
          schema:VERSION,session,createdAt:prev?.createdAt||entry.t,
          updatedAt:entry.t,dropped:(prev?.dropped||0)+Math.max(0,previousLength+1-capacity),
          events
        }});
        lastError=null;
      }).catch(e=>{lastError=e?.name||'storage_write_failed';});
      return queue;
    };
    return {session,key,append,flush:()=>queue,getError:()=>lastError};
  }
  async function readAll(storage,{maxSessions=80,maxEvents=15000}={}){
    const all=await storage.get(null);
    const sessions=Object.entries(all||{})
      .filter(([key,value])=>key.startsWith(PREFIX)&&Array.isArray(value?.events))
      .map(([,value])=>value)
      .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))
      .slice(0,maxSessions);
    const events=sessions.flatMap(s=>s.events.map(e=>({...e,session:s.session})))
      .sort((a,b)=>a.t-b.t||a.seq-b.seq).slice(-maxEvents);
    return {schema:VERSION,exportedAt:Date.now(),
      sessions:sessions.map(s=>({id:s.session,createdAt:s.createdAt,
        updatedAt:s.updatedAt,dropped:s.dropped||0,count:s.events.length})),
      metrics:all?.metrics||{},events};
  }
  async function prune(storage,{now=Date.now(),maxSessions=100,
    maxAgeMs=14*86400000}={}){
    const marker=PREFIX+'lastPrune';
    const check=await storage.get({[marker]:0});
    if(now-(check[marker]||0)<86400000)return {skipped:true,removed:0};
    const all=await storage.get(null);
    const sessions=Object.entries(all||{})
      .filter(([key,v])=>key.startsWith(PREFIX)&&Array.isArray(v?.events))
      .sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0));
    const toRemove=sessions.filter(([key,v],i)=>
      now-(v.updatedAt||0)>maxAgeMs ||
      (i>=maxSessions && now-(v.updatedAt||0)>86400000))
      .map(([key])=>key);
    if(toRemove.length&&typeof storage.remove==='function')
      await storage.remove(toRemove);
    await storage.set({[marker]:now});
    return {skipped:false,removed:toRemove.length};
  }
  async function clearAll(storage){
    const all=await storage.get(null);
    const keys=Object.keys(all||{}).filter(k=>k.startsWith(PREFIX));
    if(keys.length&&typeof storage.remove==='function')await storage.remove(keys);
    await storage.set({logs:[],metrics:{}});
  }
  const api={PREFIX,VERSION,CAP,clean,create,readAll,clearAll,prune};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else global.AutoContinueTrace=api;
})(typeof window!=='undefined'?window:globalThis);