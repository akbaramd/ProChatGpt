// Firefox MV3 background page: privileged diagnostics export only.
(function(){
  'use strict';
  const api=globalThis.browser;
  async function exportDiagnostics(){
    const data=await globalThis.AutoContinueTrace.readAll(api.storage.local);
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    const filename='AutoContinue/diagnostics/AutoContinue-diagnostics-'+stamp+'.json';
    try{
      const id=await api.downloads.download({
        url,filename,conflictAction:'uniquify',saveAs:false
      });
      return {ok:true,id,filename};
    }finally{
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
  }
  api.runtime.onMessage.addListener((request)=>{
    if(request?.type!=='autoContinue:exportDiagnostics')return undefined;
    return exportDiagnostics();
  });
  if(typeof module!=='undefined'&&module.exports)module.exports={exportDiagnostics};
})();
