import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {
  getChat,listChats,migrateLegacy,parseExportContent,removeChat,renameChat,saveBatch,saveChat
} from './chat-history.mjs';
import './styles.css';

const uid=()=>crypto.randomUUID?.()||'local-'+Date.now()+Math.random();
const demo=new URLSearchParams(location.search).has('demo');
const cleanTitle=(t)=>String(t||'').trim().slice(0,160);
const defaultEffort=()=>localStorage.getItem('chatdesk-effort')||'medium';
const Icons={
  plus:<path d="M12 5v14M5 12h14"/>,
  chat:<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3H13a8.5 8.5 0 0 1 8 8v.5Z"/>,
  upload:<><path d="M12 16V3m0 0 4 4m-4-4L8 7M4 16v4h16v-4"/></>,
  more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  send:<path d="m5 12 7-7 7 7M12 19V5"/>,
  trash:<><path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 10v6m4-6v6"/></>,
  edit:<><path d="m16 4 4 4M4 20l4-.8L20 7a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></>,
  globe:<><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></>,
  refresh:<><path d="M20 7v5h-5M4 17v-5h5M5 9a8 8 0 0 1 13-2l2 5M4 12l2 5a8 8 0 0 0 13-2"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>
};
function Icon({name,size=17}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{Icons[name]}</svg>}
export default function App(){
  const desktop=Boolean(window.chatdesk);
  const [auth,setAuth]=useState(demo?'authenticated':'checking');
  const [authDetail,setAuthDetail]=useState('');
  const [authError,setAuthError]=useState('');
  const [index,setIndex]=useState([]);
  const [remoteIndex,setRemoteIndex]=useState([]);
  const [remoteBusy,setRemoteBusy]=useState(false);
  const [loadingChat,setLoadingChat]=useState(false);
  const [remoteDepth,setRemoteDepth]=useState(8);
  const [current,setCurrent]=useState(null);
  const [activeId,setActiveId]=useState(null);
  const [ready,setReady]=useState(false);
  const [notice,setNotice]=useState('');
  const [draft,setDraft]=useState('');
  const [effort,setEffort]=useState(defaultEffort);
  const [busy,setBusy]=useState(false);
  const [activity,setActivity]=useState('');
  const [activityLog,setActivityLog]=useState([]);
  const [search,setSearch]=useState('');
  const [visibleCount,setVisibleCount]=useState(35);
  const [visibleMessages,setVisibleMessages]=useState(40);
  const [actionsFor,setActionsFor]=useState(null);
  const [deleteTarget,setDeleteTarget]=useState(null);
  const [renameTarget,setRenameTarget]=useState(null);
  const [renameValue,setRenameValue]=useState('');
  const [importing,setImporting]=useState(false);
  const [scheduleOpen,setScheduleOpen]=useState(false);
  const [scheduleJob,setScheduleJob]=useState(null);
  const [schedulePrompt,setSchedulePrompt]=useState('');
  const [scheduleMinutes,setScheduleMinutes]=useState(1);
  const [scheduleEffort,setScheduleEffort]=useState(defaultEffort);
  const [scheduleStatus,setScheduleStatus]=useState('');
  const [scheduleError,setScheduleError]=useState('');
  const [deliveryError,setDeliveryError]=useState(null);
  const [retryPending,setRetryPending]=useState(false);
  const [scheduleTick,setScheduleTick]=useState(false);
  const [scheduleNow,setScheduleNow]=useState(Date.now());
  const [scheduleLog,setScheduleLog]=useState([]);
  const fileInput=useRef(null);
  const messagesEnd=useRef(null);
  const messageScroller=useRef(null);
  const olderHeight=useRef(null);
  const olderFetchKey=useRef('');
  const request=useRef(null);
  const syncRequests=useRef(new Map());
  const scheduledRequests=useRef(new Map());
  const currentRef=useRef(null);
  const demoTimer=useRef(null);
  useEffect(()=>{currentRef.current=current;},[current]);
  useEffect(()=>{localStorage.setItem('chatdesk-effort',effort);},[effort]);
  useEffect(()=>{
    const interval=setInterval(()=>setScheduleNow(Date.now()),1000);
    return()=>clearInterval(interval);
  },[]);
  useEffect(()=>{
    let live=true;
    (async()=>{
      try {
        await migrateLegacy();
        const rows=await listChats();
        if(!live)return;
        setIndex(rows);
        const last=localStorage.getItem('chatdesk-active-id');
        if(last&&rows.some(x=>x.id===last)){
          const chat=await getChat(last);
          if(live){setCurrent(chat);setActiveId(last);}
        }
        setReady(true);
      }catch(error){if(live){setNotice('Storage: '+error.message);setReady(true);}}
    })();
    return()=>{live=false;};
  },[]);
  useEffect(()=>{
    if(!current||!ready)return;
    const task=setTimeout(()=>saveChat(current).catch(e=>setNotice('Failed to save conversation: '+e.message)),450);
    return()=>clearTimeout(task);
  },[current,ready]);
  useEffect(()=>{
    if(current && olderHeight.current===null)
      messageScroller.current?.scrollTo({top:messageScroller.current.scrollHeight});
  },[current?.messages,current?.id]);
  useLayoutEffect(()=>{
    const scroller=messageScroller.current;
    if(scroller && olderHeight.current!==null){
      scroller.scrollTop=scroller.scrollHeight-olderHeight.current;
      olderHeight.current=null;
    }
  },[visibleMessages]);
  useEffect(()=>{
    if(demo)return;
    if(!desktop){setAuth('signed_out');return;}
    const off=window.chatdesk.onAuthEvent?.(s=>{
      if(s.state==='authenticated'){setAuth('authenticated');setAuthDetail('');setAuthError('');}
      else if(s.state==='signed_out')setAuth('signed_out');
      else if(['opening','browser_opened','checking','challenge','awaiting_login'].includes(s.state)){
        setAuth('waiting');setAuthDetail(s.message||'Waiting for the signed-in browser');
      }else if(s.state==='error'||s.state==='monitor_stopped'){
        setAuth('signed_out');setAuthError(s.message||'Chromium monitor stopped');
      }
    })||(()=>{});
    window.chatdesk.status().then(s=>{
      if(s.authState==='authenticated')setAuth('authenticated');
      else if(s.authState==='waiting')setAuth('waiting');
      else setAuth(a=>a==='authenticated'?a:'signed_out');
    }).catch(e=>setAuthError(e.message));
    return off;
  },[desktop]);
  // Every browser result is correlated to a single request and only trusted
  // if the local Chromium worker returned an explicit success event.
  function requestSync(action,payload={}){
    if(typeof window.chatdesk?.syncBrowser!=='function')return Promise.reject(Error('Chromium sync bridge not connected'));
    const requestId=uid();
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{
        syncRequests.current.delete(requestId);
        reject(Error('Chromium sync timed out: '+action));
      },55000);
      syncRequests.current.set(requestId,{resolve,reject,timeout});
      window.chatdesk.syncBrowser({requestId,action,...payload}).catch(e=>{
        clearTimeout(timeout);syncRequests.current.delete(requestId);reject(e);
      });
    });
  }
  useEffect(()=>{
    if(!desktop)return;
    const off=window.chatdesk.onSyncEvent?.(e=>{
      const pending=syncRequests.current.get(e.requestId);
      if(!pending)return;
      clearTimeout(pending.timeout);syncRequests.current.delete(e.requestId);
      if(e.ok)pending.resolve(e);
      else pending.reject(Error(e.error||'Chromium sync failed'));
    })||(()=>{});
    return()=>{off();for(const value of syncRequests.current.values()){
      clearTimeout(value.timeout);value.reject(Error('Window closed'));
    }syncRequests.current.clear();};
  },[desktop]);
  async function refreshRemote(depth=8){
    if(demo||!desktop||typeof window.chatdesk?.syncBrowser!=='function')return;
    setRemoteBusy(true);
    try{
      const result=await requestSync('list',{depth});
      const rows=(result.chats||[]).map((chat,i)=>({
        id:'remote:'+chat.id,
        remoteId:chat.id,
        title:chat.title||'Untitled chat',
        remoteUrl:chat.remoteUrl,
        source:'browser',
        updatedAt:Date.now()-i*1000,
        messageCount:0
      }));
      if(rows.length)setRemoteIndex(previous=>{
        const known=new Map(previous.map(chat=>[chat.id,chat]));
        rows.forEach(chat=>known.set(chat.id,chat));
        return [...known.values()];
      });
      setRemoteDepth(depth);
    }catch(e){setNotice('Chromium sidebar: '+e.message);}
    finally{setRemoteBusy(false);}
  }
  useEffect(()=>{
    if(auth==='authenticated'&&!demo)refreshRemote().catch(()=>{});
  },[auth,desktop]);
  useEffect(()=>{
    if(!desktop||demo||typeof window.chatdesk.onScheduleEvent!=='function')return;
    const off=window.chatdesk.onScheduleEvent(e=>{
      if(Object.prototype.hasOwnProperty.call(e,'job')){
        setScheduleJob(e.job||null);
        if(e.job){
          setSchedulePrompt(e.job.prompt||'');
          setScheduleMinutes(Math.max(1,Math.floor((e.job.intervalSeconds||60)/60)));
          setScheduleEffort(e.job.effort||'medium');
        }
      }
      if(e.event==='tick-start'){
        setScheduleTick(true);
        setScheduleError('');
        setScheduleStatus('Sending the scheduled message to ChatGPT');
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:'Sending scheduled message'}]);
        const assistantId='scheduled-assistant-'+e.requestId;
        const userId='scheduled-user-'+e.requestId;
        const selected=currentRef.current;
        scheduledRequests.current.set(e.requestId,{assistantId,userId,
          chatId:selected?.remoteUrl===e.remoteUrl?selected.id:null,
          remoteUrl:e.remoteUrl});
        setCurrent(prev=>{
          if(!prev||prev.remoteUrl!==e.remoteUrl)return prev;
          if(prev.messages.some(m=>m.id===userId))return prev;
          return {...prev,updatedAt:Date.now(),messages:[
            ...prev.messages,{id:userId,role:'user',content:e.prompt||''},
            {id:assistantId,role:'assistant',content:''}
          ]};
        });
      }else if(e.event==='delivery-timeout'){
        setScheduleError(e.message||'Message delivery timed out. Please try again.');
        setScheduleStatus('ChatGPT timed out; Retry is available');
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:'Message delivery timed out'}]);
      }else if(e.event==='retrying'){
        setScheduleError('');
        setScheduleStatus('Retrying the existing ChatGPT response');
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:'Retrying existing response'}]);
      }else if(e.event==='tick-finished'){
        setScheduleTick(false);
        setScheduleStatus(e.result==='done'?'Scheduled response completed':e.result==='cancelled'?'Previous response was stopped':'Scheduled response failed');
        if(e.message&&e.result==='error')setScheduleError(e.message);
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:'Response '+e.result}]);
        if(e.result==='done')refreshRemote(remoteDepth).catch(()=>{});
      }else if(e.event==='stopping-thinking'){
        setScheduleStatus('Stopping the previous Thinking response before sending');
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:'Stopping previous response'}]);
      }else if(e.event==='skipped'){
        setScheduleStatus(e.reason||'Tick skipped');
        setScheduleLog(prev=>[...prev.slice(-15),{at:e.at||Date.now(),text:e.reason||'Tick skipped'}]);
      }else if(e.event==='error'){
        setScheduleError(e.message||e.job?.lastError||'Recurring job failed');
        setScheduleStatus('Recurring job error');
      }else if(e.event==='paused'){
        setScheduleStatus(e.reason||'Recurring job paused');
        if(e.reason)setScheduleError(e.reason);
      }else if(e.event==='started'||e.event==='resumed'){
        setScheduleStatus('Recurring job enabled');
        setScheduleError('');
      }else if(e.event==='stopped'){
        setScheduleTick(false);
        setScheduleStatus('Recurring job stopped');
      }
    });
    if(auth==='authenticated')window.chatdesk.scheduleCommand({action:'status'})
      .catch(e=>setScheduleError(e.message));
    return off;
  },[desktop,auth]);
  async function scheduleCommand(action,payload={}){
    if(!window.chatdesk?.scheduleCommand){setScheduleError('Chromium scheduler is unavailable');return;}
    setScheduleError('');
    try{await window.chatdesk.scheduleCommand({action,...payload});}
    catch(e){setScheduleError(e.message);}
  }
  function openSchedulePanel(){
    const job=scheduleJob;
    if(job){
      setSchedulePrompt(job.prompt||'');
      setScheduleMinutes(Math.max(1,Math.floor(job.intervalSeconds/60)));
      setScheduleEffort(job.effort||effort);
    }else setScheduleEffort(effort);
    setScheduleError('');setScheduleOpen(true);
  }
  function startSchedule(){
    const minutes=Number(scheduleMinutes);
    if(!current?.remoteUrl){setScheduleError('Select a live ChatGPT conversation first');return;}
    if(!schedulePrompt.trim()){setScheduleError('Enter the fixed message to repeat');return;}
    if(!Number.isInteger(minutes)||minutes<1||minutes>1440){
      setScheduleError('Choose an interval between 1 and 1440 minutes');return;
    }
    scheduleCommand('start',{job:{
      remoteUrl:current.remoteUrl,
      prompt:schedulePrompt.trim(),
      intervalSeconds:minutes*60,
      effort:scheduleEffort
    }});
  }
  function mergeMeta(chat){
    setIndex(previous=>{
      const {messages,...meta}=chat;
      return [ {...meta,messageCount:messages?.length??meta.messageCount??0},...previous.filter(x=>x.id!==chat.id)]
        .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    });
  }
  function updateAssistant(chatId,assistantId,fn){
    setCurrent(prev=>{
      if(!prev||prev.id!==chatId)return prev;
      return {...prev,messages:prev.messages.map(m=>m.id===assistantId?{...m,content:fn(m.content)}:m)};
    });
  }
  useEffect(()=>{
    if(!desktop)return;
    const off=window.chatdesk.onChatEvent?.(e=>{
      const scheduled=scheduledRequests.current.get(e.id);
      if(scheduled){
        if(e.event==='delivery_timeout'){
          setDeliveryError({id:e.id,chatId:scheduled.chatId,remoteUrl:scheduled.remoteUrl,
            message:e.message||'Message delivery timed out. Please try again.',canRetry:Boolean(e.retryAvailable)});
          setRetryPending(false);
          setScheduleError(e.message||'Message delivery timed out');
          setScheduleLog(prev=>[...prev.slice(-15),{at:Date.now(),text:'ChatGPT delivery timed out; waiting for Retry'}]);
        }else if(e.event==='retrying'){
          setDeliveryError(prev=>prev?.id===e.id?null:prev);
          setRetryPending(false);
          setScheduleStatus(e.message||'Retrying existing response');
        }
        if(e.event==='snapshot'&&scheduled.chatId)
          updateAssistant(scheduled.chatId,scheduled.assistantId,()=>e.text||'');
        else if(e.event==='thinking'&&Array.isArray(e.steps)&&e.steps.length)
          setScheduleStatus(e.steps.at(-1));
        else if(e.event==='status'&&e.text)
          setScheduleStatus(e.text);
        else if(e.event==='done'||e.event==='error'||e.event==='cancelled'){
          if(scheduled.chatId){
            if(e.event==='done'&&e.text)
              updateAssistant(scheduled.chatId,scheduled.assistantId,()=>e.text);
            else if(e.event==='error'||e.event==='cancelled')
              updateAssistant(scheduled.chatId,scheduled.assistantId,old=>old||'['+(e.message||e.event)+']');
          }
          scheduledRequests.current.delete(e.id);
        }
        return;
      }
      const task=request.current;
      if(!task||task.id!==e.id)return;
      if(e.event==='delivery_timeout'){
        setDeliveryError({id:e.id,chatId:task.chatId,
          message:e.message||'Message delivery timed out. Please try again.',canRetry:Boolean(e.retryAvailable)});
        setRetryPending(false);setActivity('Message delivery timed out');
      }else if(e.event==='retrying'){
        setDeliveryError(null);setRetryPending(false);
        setActivity(e.message||'Retrying existing response');
      }else if(e.event==='retry_failed'){
        setRetryPending(false);
        setDeliveryError(prev=>prev?.id===e.id?{...prev,message:e.message||'Retry failed'}:prev);
      }else if(e.event==='snapshot')updateAssistant(task.chatId,task.assistantId,()=>e.text||'');
      else if(e.event==='conversation'&&e.remoteUrl?.startsWith('https://chatgpt.com/c/')){
        setCurrent(prev=>prev?.id===task.chatId?{...prev,remoteUrl:e.remoteUrl,source:'browser'}:prev);
        setIndex(prev=>prev.map(x=>x.id===task.chatId?{...x,remoteUrl:e.remoteUrl,source:'browser'}:x));
      }else if(e.event==='done'){
        if(e.text)updateAssistant(task.chatId,task.assistantId,()=>e.text);
        if(e.remoteUrl?.startsWith('https://chatgpt.com/c/')){
          setCurrent(prev=>prev?.id===task.chatId?{...prev,remoteUrl:e.remoteUrl,source:'browser'}:prev);
          setIndex(prev=>prev.map(x=>x.id===task.chatId?{...x,remoteUrl:e.remoteUrl,source:'browser'}:x));
        }
        request.current=null;setBusy(false);setActivity('');setDeliveryError(null);setRetryPending(false);
        refreshRemote(remoteDepth).catch(()=>{});
      }else if(e.event==='error'||e.event==='cancelled'){
        const msg=e.event==='cancelled'?'Response stopped':(e.message||'Browser request failed');
        updateAssistant(task.chatId,task.assistantId,old=>old||'['+msg+']');
        setNotice(msg);request.current=null;setBusy(false);setActivity('');
        setDeliveryError(null);setRetryPending(false);
      }else if(e.event==='thinking'){
        const steps=Array.isArray(e.steps)?e.steps.filter(Boolean):[];
        if(steps.length){
          setActivity(steps.at(-1));
          setActivityLog(prev=>[...prev.slice(-15),...steps.map(text=>({at:Date.now(),text}))]);
        }
      }else if(e.event==='status'||e.event==='effort'||e.event==='sent'){
        const label=e.event==='status'?e.text:e.event==='effort'?'Thinking effort: '+e.value:'Waiting for visible response';
        setActivity(label||'Generating');
        setActivityLog(prev=>[...prev.slice(-9),{at:Date.now(),text:label}]);
      }
    })||(()=>{});
    return off;
  },[desktop]);
  async function selectChat(id){
    if(busy||!ready||loadingChat)return;
    setActionsFor(null);setNotice('');setActivity('');setActivityLog([]);setDeliveryError(null);setRetryPending(false);
    if(currentRef.current)await saveChat(currentRef.current).catch(()=>{});
    const remote=remoteIndex.find(c=>c.id===id);
    olderFetchKey.current='';
    setLoadingChat(Boolean(remote));
    try{
      let record=await getChat(id);
      if((remote||record?.remoteUrl)&&!demo){
        const targetUrl=remote?.remoteUrl||record.remoteUrl;
        const fetched=await requestSync('open',{remoteUrl:targetUrl});
        record={
          ...(record||remote),id,
          remoteUrl:targetUrl,source:'browser',title:remote?.title||record?.title||'ChatGPT conversation',
          updatedAt:Date.now(),
          messages:(fetched.messages||[]).map(m=>({
            id:m.id,role:m.role,content:m.content||'',stage:m.stage||null,state:m.state||null
          }))
        };
        await saveChat(record);
      }
      if(!record&&remote)record={...remote,messages:[]};
      setVisibleMessages(40);setCurrent(record);setActiveId(record?.id||null);
      localStorage.setItem('chatdesk-active-id',record?.id||'');
    }catch(e){setNotice('Cannot load conversation: '+e.message);}
    finally{setLoadingChat(false);}
  }
  async function loadOlderRemote(){
    const chat=currentRef.current;
    if(!chat?.remoteUrl||busy||loadingChat||demo)return;
    setLoadingChat(true);
    try{
      const result=await requestSync('older',{remoteUrl:chat.remoteUrl});
      const messages=(result.messages||[]).map(m=>({
        id:m.id,role:m.role,content:m.content||'',stage:m.stage||null,state:m.state||null
      }));
      setCurrent(prev=>prev?.id===chat.id?{...prev,messages:messages.length>=prev.messages.length?messages:prev.messages}:prev);
      setVisibleMessages(v=>v+40);
    }catch(e){setNotice('Older messages: '+e.message);}
    finally{setLoadingChat(false);}
  }
  async function newChat(){
    if(busy)return;
    if(currentRef.current)await saveChat(currentRef.current).catch(()=>{});
    setDeliveryError(null);setRetryPending(false);olderFetchKey.current='';setVisibleMessages(40);setCurrent(null);setActiveId(null);setDraft('');setActivity('');setActivityLog([]);setActionsFor(null);
    localStorage.removeItem('chatdesk-active-id');
  }
  async function send(){
    const text=draft.trim();
    if(!text||busy||scheduleTick)return;
    if(current&&current.messages.length&&!current.remoteUrl&&!demo){
      setNotice('This conversation has no verified ChatGPT link. Create a new chat to avoid mixing threads.');
      return;
    }
    const id=current?.id||'local:'+uid();
    const assistantId=uid(), userId=uid();
    const original=current?.messages||[];
    const record={
      id,remoteUrl:current?.remoteUrl||null,source:current?.source||'local',
      title:current?.title||cleanTitle(text.slice(0,80)),updatedAt:Date.now(),
      messages:[...original,{id:userId,role:'user',content:text},{id:assistantId,role:'assistant',content:''}]
    };
    setCurrent(record);setActiveId(id);mergeMeta(record);setDraft('');setBusy(true);setNotice('');
    setActivity('Sending message');setActivityLog([{at:Date.now(),text:'Sending message'}]);
    localStorage.setItem('chatdesk-active-id',id);
    await saveChat(record).catch(()=>{});
    if(demo){
      const msg='Local test: message display and persistence are working.';
      let i=0;
      demoTimer.current=setInterval(()=>{
        i=Math.min(msg.length,i+4);
        updateAssistant(id,assistantId,()=>msg.slice(0,i));
        if(i===msg.length){clearInterval(demoTimer.current);setBusy(false);setActivity('');}
      },30);
      return;
    }
    if(typeof window.chatdesk?.sendBrowserMessage!=='function'){
      updateAssistant(id,assistantId,()=> '[Native bridge unavailable]');setBusy(false);return;
    }
    const requestId=uid();request.current={id:requestId,chatId:id,assistantId};
    const res=await window.chatdesk.sendBrowserMessage({
      id:requestId,chatId:id,prompt:text,effort,remoteUrl:record.remoteUrl
    }).catch(e=>({ok:false,error:e.message}));
    if(!res?.ok){updateAssistant(id,assistantId,()=> '[Unable to send: '+res.error+']');setBusy(false);request.current=null;}
  }
  async function retryTimedOutMessage(){
    if(!deliveryError?.id||!deliveryError.canRetry)return;
    if(typeof window.chatdesk?.retryBrowserMessage!=='function'){
      setDeliveryError(prev=>prev?{...prev,message:'Chromium retry bridge is unavailable'}:null);
      return;
    }
    setRetryPending(true);
    try{
      await window.chatdesk.retryBrowserMessage(deliveryError.id);
    }catch(e){
      setRetryPending(false);
      setDeliveryError(prev=>prev?{...prev,message:e.message}:null);
    }
  }
  async function stop(){
    const task=request.current;
    if(!task){if(demoTimer.current){clearInterval(demoTimer.current);setBusy(false);}return;}
    setActivity('Stopping response…');
    await window.chatdesk?.cancelBrowserMessage?.(task.id);
  }
  async function confirmDelete(){
    if(!deleteTarget||busy)return;
    setRemoteBusy(true);
    try {
      if(deleteTarget.remoteUrl&&!demo){
        await requestSync('delete',{remoteUrl:deleteTarget.remoteUrl,confirmed:true});
        setRemoteIndex(prev=>prev.filter(c=>c.remoteUrl!==deleteTarget.remoteUrl));
        setIndex(prev=>prev.filter(c=>c.remoteUrl!==deleteTarget.remoteUrl));
        setNotice('The conversation was deleted in ChatGPT and removed from ChatDesk.');
      }else{
        setNotice('Only the local copy was deleted. ChatGPT account history was not changed.');
      }
      await removeChat(deleteTarget.id);
      setIndex(prev=>prev.filter(c=>c.id!==deleteTarget.id));
      if(deleteTarget.id===activeId){
        setCurrent(null);setActiveId(null);localStorage.removeItem('chatdesk-active-id');
      }
      setDeleteTarget(null);setActionsFor(null);
    }catch(e){setNotice('Deletion was NOT confirmed in ChatGPT: '+e.message);}
    finally{setRemoteBusy(false);}
  }
  async function confirmRename(){
    if(!renameTarget||!cleanTitle(renameValue))return;
    setRemoteBusy(true);
    try{
      if(renameTarget.remoteUrl&&!demo){
        await requestSync('rename',{remoteUrl:renameTarget.remoteUrl,title:cleanTitle(renameValue)});
        setRemoteIndex(prev=>prev.map(c=>c.id===renameTarget.id?{...c,title:cleanTitle(renameValue)}:c));
      }
      const cached=await getChat(renameTarget.id);
      if(cached){
        const updated=await renameChat(renameTarget.id,renameValue);
        mergeMeta(updated);
        if(activeId===updated.id)setCurrent(updated);
      }else if(renameTarget.source!=='browser')throw Error('Local conversation was not found');
      setRenameTarget(null);setActionsFor(null);
    }catch(e){setNotice('Rename failed: '+e.message);}
    finally{setRemoteBusy(false);}
  }
  async function importHistory(event){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file)return;
    setImporting(true);setNotice('Reading ChatGPT export…');
    try{
      const raw=JSON.parse(await file.text());
      const list=parseExportContent(raw);
      await saveBatch(list);
      const latest=await listChats();
      setIndex(latest);setVisibleCount(35);
      setNotice('Imported '+list.length+' conversations from conversations.json. History is offline; no account deletion is performed.');
    }catch(e){setNotice('Import failed: '+e.message);}
    finally{setImporting(false);}
  }
  function openOriginal(chat){
    if(!chat?.remoteUrl){setNotice('This conversation has no verified ChatGPT URL.');return;}
    if(typeof window.chatdesk?.openBrowserConversation==='function')
      window.chatdesk.openBrowserConversation(chat.remoteUrl).catch(e=>setNotice(e.message));
    else window.open(chat.remoteUrl,'_blank','noopener');
    setActionsFor(null);
  }
  const filtered=[...remoteIndex,...index.filter(c=>!remoteIndex.some(r=>
      r.id===c.id||(r.remoteUrl&&c.remoteUrl&&r.remoteUrl===c.remoteUrl)
    ))].filter(c=>c.title.toLowerCase().includes(search.toLowerCase()));
  if(auth!=='authenticated'){
    const waiting=auth==='waiting'||auth==='checking';
    return <div className="login-screen" data-testid="login-screen">
      <div className="login-top"><span className="login-brand-symbol">C</span><span className="login-brand-name">ChatDesk</span><span className="login-lab">LAB</span></div>
      <div className="login-main">
        <div className="login-icon"><Icon name="chat" size={32}/></div><h1>Welcome to ChatDesk</h1>
        <p>Sign in through the official ChatGPT page in the embedded Chromium browser.</p>
        <button className="login-main-button" data-testid="login-button" onClick={()=>{
          setAuth('waiting');setAuthError('');window.chatdesk?.beginLogin?.();
        }}>{waiting?'Open Chromium sign-in':'Continue with ChatGPT'}</button>
        {waiting&&<><p data-testid="auth-waiting" className="login-hint">{authDetail||'Waiting for browser sign-in'}</p>
          <button className="confirm-login-button" data-testid="confirm-login" onClick={()=>window.chatdesk?.confirmLogin?.()}>Check sign-in status</button></>}
        {authError&&<p className="login-error">{authError}</p>}
      </div><div className="login-bottom">ChatDesk Lab · Windows prototype</div>
    </div>;
  }
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">C</div><strong>ChatDesk</strong><span className="brand-label">LAB</span></div>
      <button className="primary-new" onClick={newChat} disabled={busy} data-testid="new-chat"><Icon name="plus"/> New chat</button>
      <button className="sidebar-item" onClick={()=>refreshRemote(remoteDepth).catch(()=>{})} disabled={remoteBusy} data-testid="sync-sidebar"><Icon name="refresh"/>{remoteBusy?'Loading ChatGPT…':'Sync from Chromium'}</button>
      <input ref={fileInput} aria-label="Import conversations.json" type="file" accept=".json,application/json" hidden onChange={importHistory}/>
      <div className="sidebar-section"><span>Conversations ({filtered.length})</span><button className="small-plain" title="Refresh ChatGPT sidebar" onClick={()=>refreshRemote(remoteDepth).catch(()=>{})}><Icon name="refresh" size={14}/></button></div>
      <div className="search-wrapper"><input placeholder="Search conversations" value={search} onChange={e=>{setSearch(e.target.value);setVisibleCount(35);}}/></div>
      <div className="history" data-testid="conversation-list" onScroll={e=>{
        const n=e.currentTarget;
        if(n.scrollHeight-n.scrollTop-n.clientHeight<160){
          setVisibleCount(x=>Math.min(filtered.length,x+35));
          if(!remoteBusy&&remoteDepth<18&&!demo)refreshRemote(remoteDepth+4).catch(()=>{});
        }
      }}>
        {filtered.slice(0,visibleCount).map(chat=><div className={'history-line '+(activeId===chat.id?'selected':'')} key={chat.id}>
          <button className="history-item" onClick={()=>selectChat(chat.id)} disabled={busy} title={chat.title}><Icon name="chat" size={15}/><span>{chat.title}</span></button>
          <button className="history-more" onClick={()=>setActionsFor(actionsFor===chat.id?null:chat.id)} title="Conversation actions"><Icon name="more" size={15}/></button>
          {actionsFor===chat.id&&<div className="history-actions">
            <button onClick={()=>{setRenameTarget(chat);setRenameValue(chat.title);setActionsFor(null);}}><Icon name="edit" size={14}/> {chat.remoteUrl?'Rename in ChatGPT':'Rename locally'}</button>
            <button onClick={()=>openOriginal(chat)} disabled={!chat.remoteUrl}><Icon name="globe" size={14}/> Open in ChatGPT</button>
            <button className="destructive" onClick={()=>{setDeleteTarget(chat);setActionsFor(null);}}><Icon name="trash" size={14}/> {chat.remoteUrl?'Delete from ChatGPT':'Delete local copy'}</button>
          </div>}
        </div>)}
        {!ready?<div className="empty-history">Loading history…</div>:!filtered.length?<div className="empty-history">{remoteBusy?'Loading ChatGPT conversations…':'No conversations currently loaded from Chromium.'}</div>:null}
        {visibleCount<filtered.length&&<button className="load-more" onClick={()=>setVisibleCount(x=>x+35)}>Load older conversations</button>}
        {!demo&&remoteIndex.length>0&&remoteDepth<18&&<button className="load-more" disabled={remoteBusy} onClick={()=>refreshRemote(remoteDepth+4)}>Load more from Chromium</button>}
      </div>
      <div className="sidebar-bottom"><div className="profile"><div className="avatar">C</div><div><strong>Local workspace</strong><small>IndexedDB history · offline</small></div></div></div>
    </aside>
    <main className="main">
      <header className="topbar">
        <div className="topbar-title"><span>{current?.title||'New conversation'}</span><span className="topbar-sub">{current?.source==='export'?'Imported history':current?.remoteUrl?'Linked conversation':'Local chat'}</span></div>
        <div className="topbar-actions">
          <label htmlFor="effort-picker" className="effort-label">Thinking</label>
          <select id="effort-picker" className="effort-picker" data-testid="effort-picker" disabled={busy} value={effort} onChange={e=>setEffort(e.target.value)}>
            <option value="instant">Instant</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <button type="button" className={'schedule-toolbar-button '+(scheduleJob?.enabled?'schedule-enabled':'')}
            data-testid="schedule-open" onClick={openSchedulePanel} title="Recurring message job">
            <Icon name="clock" size={15}/>{scheduleJob?.enabled?'Recurring: On':'Recurring message'}
          </button>
          <span className="connection"><span className="indicator"/>Chromium</span>
        </div>
      </header>
      {scheduleJob?.enabled&&<div className="schedule-banner" data-testid="schedule-banner">
        <Icon name="clock" size={15}/>
        <span>Recurring message active · every {Math.round(scheduleJob.intervalSeconds/60)} min
          {scheduleJob.nextRunAt?' · next in '+Math.max(0,Math.ceil((scheduleJob.nextRunAt-scheduleNow)/1000))+'s':''}
          {scheduleTick?' · generating now':''}
        </span>
        <button onClick={openSchedulePanel}>Manage</button>
      </div>}
      {loadingChat&&<div className="notice" role="status">Loading conversation from Chromium…</div>}
      {notice&&<div className="notice" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss notice">×</button></div>}
      <div className="native-layout" data-testid="native-pane">
        <div ref={messageScroller} className={'chat-scroll '+(!current?'centered':'')} onScroll={e=>{
          const el=e.currentTarget;
          if(current && el.scrollTop<75){
            if(visibleMessages<current.messages.length && olderHeight.current===null){
              olderHeight.current=el.scrollHeight;
              setVisibleMessages(x=>Math.min(current.messages.length,x+40));
            }else if(current.remoteUrl&&!busy&&!loadingChat&&!demo){
              const key=current.id+':'+current.messages.length;
              if(olderFetchKey.current!==key){
                olderFetchKey.current=key;
                loadOlderRemote();
              }
            }
          }
        }}>
          {!current?<div className="welcome"><div className="welcome-mark">✳</div><h1>What can I help with?</h1><p>ChatDesk native conversation interface</p></div>:
            <div className="messages">
              {current.messages.length>visibleMessages&&<div className="older-marker">Scroll up for {current.messages.length-visibleMessages} older messages</div>}
              {current.messages.slice(-visibleMessages).map(m=><div key={m.id} className={'message '+m.role} data-testid={m.role+'-message'}>
              {m.role==='assistant'&&<div className="assistant-mark">✳</div>}
              <div className="message-body">
                {m.stage&&m.role==='assistant'&&<details className="message-thinking">
                  <summary>Thinking summary</summary><div>{m.stage}</div>
                </details>}
                {m.content||<span className="typing-indicator"><i/><i/><i/></span>}
              </div>
            </div>)}<div ref={messagesEnd}/></div>}
        </div>
        {deliveryError&&(!deliveryError.chatId||current?.id===deliveryError.chatId||current?.remoteUrl===deliveryError.remoteUrl)&&
          <div className="delivery-error" role="alert" data-testid="delivery-timeout">
            <span>{deliveryError.message}</span>
            {deliveryError.canRetry&&<button type="button" data-testid="delivery-retry"
              disabled={retryPending} onClick={retryTimedOutMessage}>
              {retryPending?'Retrying…':'Retry'}
            </button>}
          </div>}
        {busy&&<div className="thinking-status">
          <div className="thinking-heading"><span className="thinking-pulse"/>Visible activity: {activity||'Generating…'}</div>
          {activityLog.length>1&&<details><summary>Activity updates ({activityLog.length})</summary>
            <div className="thinking-log">{activityLog.map((entry,i)=><div key={i}>{entry.text}</div>)}</div>
          </details>}
        </div>}
        <div className="composer-outer">
          <div className="composer">
            <textarea aria-label="Message ChatDesk" data-testid="composer" value={draft} rows={1}
              disabled={scheduleTick||(current?.source==='export'&&!current?.remoteUrl)}
              placeholder={current?.source==='export'&&!current?.remoteUrl?'Imported conversation is read-only':'Message ChatDesk…'}
              onChange={e=>setDraft(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}}}/>
            <div className="composer-actions">
              <span className="input-caption" data-testid="stream-status">{busy?(activity||'Generating…'):'Chromium session • no API key'}</span>
              {busy?<button className="stop-button" title="Stop generation" data-testid="stop" onClick={stop}><span className="stop-glyph"/></button>:
                <button className="send-button" disabled={scheduleTick||!draft.trim()||Boolean(current?.source==='export'&&!current.remoteUrl)} title="Send message" data-testid="send" onClick={send}><Icon name="send"/></button>}
            </div>
          </div>
          <div className="footer-disclaimer">Chromium handles ChatGPT conversations. Only visible Thinking summaries are shown; raw internal reasoning is unavailable.</div>
        </div>
      </div>
    </main>
    {scheduleOpen&&<div className="dialog-backdrop" role="presentation">
      <div className="dialog schedule-dialog" role="dialog" aria-modal="true" aria-label="Recurring message">
        <h3>Recurring message</h3>
        <p>Send a fixed message repeatedly in one existing ChatGPT conversation using the embedded Chromium session.</p>
        <div className="schedule-target"><strong>Target conversation</strong>
          <div>{scheduleJob
            ?([current,...remoteIndex,...index].find(x=>x?.remoteUrl===scheduleJob.remoteUrl)?.title||scheduleJob.remoteUrl)
            :(current?.remoteUrl?current.title:'Select a linked ChatGPT conversation first')}</div>
        </div>
        <label className="schedule-field">Fixed message
          <textarea data-testid="schedule-prompt" rows={4} maxLength={12000} value={schedulePrompt}
            disabled={Boolean(scheduleJob)} onChange={e=>setSchedulePrompt(e.target.value)}
            placeholder="Continue the previous answer from where you stopped…"/>
        </label>
        <div className="schedule-fields">
          <label className="schedule-field">Every (minutes)
            <input data-testid="schedule-minutes" type="number" min="1" max="1440" step="1" value={scheduleMinutes}
              disabled={Boolean(scheduleJob)} onChange={e=>setScheduleMinutes(e.target.value)}/>
          </label>
          <label className="schedule-field">Thinking
            <select data-testid="schedule-effort" value={scheduleEffort} disabled={Boolean(scheduleJob)} onChange={e=>setScheduleEffort(e.target.value)}>
              <option value="instant">Instant</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
        </div>
        <p className="schedule-explanation">At each interval, ChatDesk stops an unfinished Thinking response before sending this fixed message. If the browser shows a delivery timeout, ChatDesk retries the existing response once (without sending the message again), then pauses the schedule if recovery fails. Other active conversations and missed intervals are skipped.</p>
        {scheduleJob&&<div className="schedule-status" data-testid="schedule-state">
          <strong>{scheduleJob.enabled?'Active':'Paused'}</strong>
          <span>Sent {scheduleJob.runCount} times</span>
          {scheduleJob.nextRunAt&&<span>Next run: {Math.max(0,Math.ceil((scheduleJob.nextRunAt-scheduleNow)/1000))} seconds</span>}
        </div>}
        {scheduleStatus&&<div className="schedule-update" data-testid="schedule-update">{scheduleStatus}</div>}
        {scheduleError&&<div className="schedule-error" role="alert">{scheduleError}</div>}
        {scheduleLog.length>0&&<details className="schedule-events"><summary>Recent activity ({scheduleLog.length})</summary>
          <div>{scheduleLog.slice(-8).map((entry,i)=><p key={i}><time>{new Date(entry.at).toLocaleTimeString()}</time> {entry.text}</p>)}</div>
        </details>}
        <div className="dialog-actions schedule-actions">
          {!scheduleJob?
            <button data-testid="schedule-start" className="confirm-button" onClick={startSchedule}
              disabled={!current?.remoteUrl||!schedulePrompt.trim()}>Start recurring job</button>:
            <>
              <button data-testid="schedule-run-now" disabled={!scheduleJob.enabled||scheduleTick} onClick={()=>scheduleCommand('runNow')}>Run now</button>
              <button data-testid="schedule-pause" onClick={()=>scheduleCommand(scheduleJob.enabled?'pause':'resume')}>
                {scheduleJob.enabled?'Pause':'Resume'}
              </button>
              <button data-testid="schedule-stop" className="danger-button" onClick={()=>scheduleCommand('stop')}>Stop job</button>
            </>}
          <button data-testid="schedule-close" aria-label="Close recurring panel" onClick={()=>setScheduleOpen(false)}>Close panel</button>
        </div>
      </div>
    </div>}
    {deleteTarget&&<div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label="Delete conversation">
      <h3>{deleteTarget.remoteUrl?'Delete from ChatGPT?':'Delete local conversation?'}</h3><p><strong>{deleteTarget.title}</strong></p>
      <p>{deleteTarget.remoteUrl?'This will delete the original ChatGPT conversation through the Chromium browser, then remove the ChatDesk copy. It cannot be undone.':'This deletes only the local ChatDesk copy; your ChatGPT account remains unchanged.'}</p>
      <div className="dialog-actions"><button onClick={()=>setDeleteTarget(null)}>Cancel</button><button className="danger-button" disabled={remoteBusy} onClick={confirmDelete}>{remoteBusy?'Deleting…':deleteTarget.remoteUrl?'Delete from ChatGPT':'Delete local copy'}</button></div>
    </div></div>}
    {renameTarget&&<div className="dialog-backdrop" role="presentation"><div className="dialog" role="dialog" aria-modal="true" aria-label="Rename local conversation">
      <h3>{renameTarget.remoteUrl?'Rename ChatGPT conversation':'Rename local conversation'}</h3><input className="rename-input" autoFocus value={renameValue} onChange={e=>setRenameValue(e.target.value)} onKeyDown={e=>e.key==='Enter'&&confirmRename()}/>
      <p>{renameTarget.remoteUrl?'The title will be changed in the linked Chromium ChatGPT session.':'This changes only the local title in ChatDesk.'}</p>
      <div className="dialog-actions"><button onClick={()=>setRenameTarget(null)}>Cancel</button><button className="confirm-button" onClick={confirmRename}>Save</button></div>
    </div></div>}
  </div>;
}