async function streamOpenAI({key,model,messages,emit,fetchImpl=fetch}) {
  const response = await fetchImpl('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify({model,input:messages.map(m=>({role:m.role,content:m.content})),stream:true})
  });
  if (!response.ok) throw Error('API '+response.status+': '+(await response.text()).slice(0,320));
  if (!response.body) throw Error('Missing streaming response body');
  const decoder = new TextDecoder();
  let buffer='',complete=false;
  for await (const chunk of response.body) {
    buffer+=decoder.decode(chunk,{stream:true});
    const frames=buffer.split(/\r?\n\r?\n/);
    buffer=frames.pop();
    for (const frame of frames) {
      const line=frame.split(/\r?\n/).find(line=>line.startsWith('data: '));
      if(!line) continue;
      const value=line.slice(6);
      if(value==='[DONE]') continue;
      let data; try { data=JSON.parse(value); } catch { continue; }
      if(data.type==='response.output_text.delta') emit({type:'delta',text:data.delta||''});
      if(data.type==='response.completed') { complete=true;emit({type:'done'}); }
      if(data.type==='response.failed') throw Error(data.response?.error?.message||'Response failed');
    }
  }
  if (!complete) emit({type:'done'});
}
module.exports={streamOpenAI};
