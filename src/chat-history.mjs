const DB_NAME = 'chatdesk-conversation-store-v1';
const DB_VERSION = 1;

const createId = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const timestamp = (seconds, fallback = Date.now()) => {
  const parsed = Number(seconds);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 1000) : fallback;
};
export function formatExportMessage(message) {
  if (!message || !['user','assistant'].includes(message.author?.role)) return null;
  const content = message.content || {};
  const parts = Array.isArray(content.parts) ? content.parts : [];
  const text = parts.filter(p=>typeof p === 'string').join('\n')
    || (typeof content.text === 'string' ? content.text : '');
  if (!text.trim()) return null;
  return {id: String(message.id || createId()), role: message.author.role, content:text, at:timestamp(message.create_time)};
}
export function parseExportConversation(raw) {
  if(!raw || typeof raw !== 'object' || !raw.mapping) return null;
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;
  const nodes=raw.mapping;
  const result=[];
  const seen=new Set();
  let current=raw.current_node;
  let guard=0;
  // The exported mapping is a tree. Follow the selected branch, not every
  // node: alternative regenerated branches must not appear as one timeline.
  while(current && nodes[current] && guard++<15000 && !seen.has(current)){
    seen.add(current);
    const node=nodes[current];
    const item=formatExportMessage(node?.message);
    if(item)result.push(item);
    current=node?.parent;
  }
  if(!result.length && !raw.current_node){
    const linear=Object.values(nodes).filter(x=>x?.message).sort((a,b)=>
      (a.message.create_time||0)-(b.message.create_time||0));
    for(const x of linear){
      const item=formatExportMessage(x.message);
      if(item)result.unshift(item);
    }
    result.reverse();
  } else result.reverse();
  return {
    id: `export:${id}`,
    remoteId:id,
    remoteUrl:null, // Exported IDs are not proof that a live URL is accessible.
    source:'export',
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled conversation',
    updatedAt:timestamp(raw.update_time || raw.create_time),
    messages:result
  };
}
export function parseExportContent(json) {
  if(!Array.isArray(json))throw Error('Expected conversations.json: an array of exported chats');
  return json.map(parseExportConversation).filter(Boolean);
}
const openDb = () => new Promise((resolve,reject)=>{
  const request=indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded=()=>{
    const db=request.result;
    if(!db.objectStoreNames.contains('meta')){
      const store=db.createObjectStore('meta',{keyPath:'id'});
      store.createIndex('updatedAt','updatedAt');
    }
    if(!db.objectStoreNames.contains('messages'))db.createObjectStore('messages',{keyPath:'id'});
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
let dbPromise;
const database=()=>dbPromise||(dbPromise=openDb());
const transact = async (storeNames,action) => {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeNames,'readwrite');
    let result;
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || Error('Storage operation aborted'));
    try{result=action(tx);}catch(e){tx.abort();reject(e);}
  });
};
const toMeta = ({messages,...rest}) => ({...rest,messageCount:messages?.length ?? rest.messageCount ?? 0});
export async function listChats(){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const req=db.transaction('meta','readonly').objectStore('meta').getAll();
    req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)));
    req.onerror=()=>reject(req.error);
  });
}
export async function getChat(id){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(['meta','messages'],'readonly');
    const meta=tx.objectStore('meta').get(id);
    const body=tx.objectStore('messages').get(id);
    tx.oncomplete=()=>resolve(meta.result?{...meta.result,messages:body.result?.messages||[]}:null);
    tx.onerror=()=>reject(tx.error);
  });
}
export async function saveChat(chat){
  if(!chat?.id || !Array.isArray(chat.messages))throw Error('Invalid conversation record');
  return transact(['meta','messages'],tx=>{
    tx.objectStore('meta').put(toMeta(chat));
    tx.objectStore('messages').put({id:chat.id,messages:chat.messages});
  });
}
export async function saveBatch(chats){
  for(let offset=0;offset<chats.length;offset+=75){
    const chunk=chats.slice(offset,offset+75);
    await transact(['meta','messages'],tx=>{
      for(const chat of chunk){
        tx.objectStore('meta').put(toMeta(chat));
        tx.objectStore('messages').put({id:chat.id,messages:chat.messages});
      }
    });
  }
}
export async function removeChat(id){
  return transact(['meta','messages'],tx=>{
    tx.objectStore('meta').delete(id);
    tx.objectStore('messages').delete(id);
  });
}
export async function renameChat(id,title){
  const chat=await getChat(id);
  if(!chat)throw Error('Conversation not found');
  chat.title=String(title||'').trim().slice(0,160)||chat.title;
  chat.updatedAt=Date.now();
  await saveChat(chat);
  return chat;
}
export async function migrateLegacy(){
  if(localStorage.getItem('chatdesk-idb-migrated-v1')==='1')return;
  let existing=[];
  try{existing=JSON.parse(localStorage.getItem('chatdesk-native-chats-v1')||'[]');}catch{}
  if(Array.isArray(existing)&&existing.length){
    const normalized=existing.filter(x=>typeof x?.id==='string'&&Array.isArray(x.messages)).map(x=>({
      ...x,updatedAt:x.updatedAt||Date.now(),source:x.source||'local'
    }));
    await saveBatch(normalized);
  }
  localStorage.setItem('chatdesk-idb-migrated-v1','1');
}
