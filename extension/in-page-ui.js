// Always-visible in-page settings for the Firefox Auto-Continue extension.
(function (global) {
  'use strict';
  const ID='chatdesk-auto-continue-controls';
  const DEFAULTS={enabled:false,message:'ادامه بده',delaySeconds:3,maxSends:0};
  const fields=['enabled','message','delaySeconds','maxSends'];
  function clamp(v,min,max,fallback) {
    const n=Number.parseInt(v,10);
    return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
  }
  function create({storage,defaults=DEFAULTS,onSaved,readActivity,onExport}={}) {
    if(document.getElementById(ID))return null;
    const host=document.createElement('div');
    host.id=ID;
    host.style.cssText='position:fixed;z-index:2147483646;bottom:96px;right:22px;max-width:calc(100vw - 28px);direction:ltr;pointer-events:auto';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`
      <style>
        :host {all:initial;color-scheme:light dark}
        *,*:before,*:after{box-sizing:border-box}
        button,input,textarea{font:inherit}
        button{cursor:pointer}
        .launcher{display:flex;align-items:center;gap:8px;min-height:36px;padding:9px 12px;border:1px solid #505058;border-radius:12px;background:#242429;color:#fff;font:600 12px system-ui;box-shadow:0 6px 22px #0005}
        .launcher:hover{background:#39393e}
        .dot{display:inline-block;width:8px;height:8px;background:#929299;border-radius:50%}
        .dot.active{background:#2ecb9d}
        .short{font-size:11px;font-weight:400;opacity:.75}
        .panel{position:absolute;right:0;bottom:calc(100% + 10px);width:min(340px,calc(100vw - 28px));max-height:75vh;overflow-y:auto;padding:16px;border:1px solid #505058;border-radius:13px;background:#242429;color:#f3f3f4;box-shadow:0 12px 36px #0008;font:13px/1.5 system-ui,"Segoe UI",sans-serif}
        [hidden]{display:none!important}
        .head{display:flex;align-items:center;justify-content:space-between}
        h2{margin:0;font:700 16px/1.3 system-ui}
        .close{border:0;background:transparent;color:inherit;font-size:18px;padding:3px 8px}
        .intro,.hint{color:#b8b8c0;font-size:11px;margin:5px 0 14px}
        .row{display:flex;align-items:center;justify-content:space-between;margin:12px 0}
        .row input{width:18px;height:18px;accent-color:#2ecb9d}
        .field{display:block;margin:12px 0}
        .field span{display:block;font-weight:600;margin-bottom:5px}
        textarea,input[type=number]{width:100%;background:#16161a;color:#fff;border:1px solid #62626a;border-radius:8px;padding:8px}
        textarea{min-height:70px;resize:vertical;max-height:170px}
        .numbers{display:grid;grid-template-columns:1fr 1fr;gap:11px}
        .save{border:0;border-radius:8px;background:#ededf0;color:#242429;padding:8px 14px;font-weight:700}
        .feedback{margin-left:10px;font-size:11px;color:#96e7c0}
        .runtime{padding-top:10px;margin-top:14px;border-top:1px solid #555}
        .runtime p,.metrics{margin:5px 0;color:#c5c5ce;font-size:11px;overflow-wrap:anywhere}
        summary{cursor:pointer;font-size:11.5px;font-weight:600;margin-top:9px}
        .metrics{white-space:pre-wrap}
        button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #96b6ff;outline-offset:2px}
        @media(prefers-color-scheme:light){
          .launcher{background:#f7f7f9;color:#242429;border-color:#dedee2}
          .panel{background:#fff;color:#232329;border-color:#ddd}
          .intro,.hint,.runtime p,.metrics{color:#686873}
          textarea,input[type=number]{background:#fafafa;color:#222;border-color:#ccc}
          .save{background:#26262c;color:#fff}
          .runtime{border-color:#e3e3e7}
        }
      </style>
      <button type="button" class="launcher" id="launcher" aria-haspopup="dialog" aria-controls="settings" aria-expanded="false" data-testid="continue-launcher"><span class="dot" id="dot"></span>Auto-Continue <span class="short" id="short">Off</span></button>
      <section class="panel" id="settings" role="dialog" aria-label="Auto-Continue settings" hidden>
        <div class="head"><h2>Auto-Continue</h2><button type="button" class="close" id="close" aria-label="Close settings">×</button></div>
        <p class="intro">Automatic follow-up for the selected ChatGPT conversation.</p>
        <label class="row">Enabled <input type="checkbox" id="enabled" data-testid="continue-enabled"></label>
        <label class="field"><span>Message</span><textarea id="message" dir="auto" maxlength="12000" data-testid="continue-message"></textarea></label>
        <div class="numbers">
          <label class="field"><span>Delay (seconds)</span><input type="number" id="delaySeconds" min="0" max="3600" data-testid="continue-delay"></label>
          <label class="field"><span>Max follow-ups</span><input type="number" id="maxSends" min="0" max="999" data-testid="continue-max"></label>
        </div>
        <p class="hint">Max 0 = unlimited. Drafts are preserved; Firefox may throttle background timers.</p>
        <button type="button" class="save" id="save" data-testid="continue-save">Save settings</button>
        <span class="feedback" id="feedback" role="status"></span>
        <div class="runtime"><strong>Status</strong><p id="runtime" data-testid="continue-status">Disabled</p>
          <details id="activity"><summary>Activity &amp; metrics</summary><div class="metrics" id="metrics"></div><button type="button" class="save" id="exportTrace">Export diagnostics (.json)</button></details>
        </div>
      </section>`;
    (document.body||document.documentElement).appendChild(host);
    const $=id=>shadow.getElementById(id);
    let cfg={...DEFAULTS,...defaults},expanded=false;
    let hideMessage;
    const updateStatus=text=>$('runtime').textContent=text||'Idle';
    const updateConfig=next=>{
      cfg={...DEFAULTS,...next};
      const focused=shadow.activeElement;
      if(!expanded || !fields.some(k=>$(k)===focused)){
        for(const key of fields)$(key)[key==='enabled'?'checked':'value']=cfg[key];
      }
      $('dot').classList.toggle('active',!!cfg.enabled);
      $('short').textContent=cfg.enabled?'On':'Off';
      if(!cfg.enabled)updateStatus('Disabled');
    };
    const notice=(message,error=false)=>{
      $('feedback').textContent=message;$('feedback').style.color=error?'#ff9b9b':'#96e7c0';
      clearTimeout(hideMessage);
      hideMessage=setTimeout(()=>{if(host.isConnected)$('feedback').textContent='';},2200);
    };
    async function persist(){
      const next={
        enabled:$('enabled').checked,
        message:$('message').value.trim()||DEFAULTS.message,
        delaySeconds:clamp($('delaySeconds').value,0,3600,DEFAULTS.delaySeconds),
        maxSends:clamp($('maxSends').value,0,999,DEFAULTS.maxSends)
      };
      try{
        if(typeof onSaved==='function')await onSaved(next);
        else await storage.set(next);
        updateConfig(next);
        notice('Saved');
        return true;
      }catch{notice('Save failed',true);return false;}
    }
    const refreshActivity=async()=>{
      if(typeof readActivity!=='function')return;
      try{
        const {logs=[],metrics={},storageError}=await readActivity();
        $('metrics').textContent=['sends','scheduled','errors','rateLimited','skipsDraft']
          .map(k=>k+': '+(metrics[k]||0)).join(' | ')+
          (logs.length?'\nLast: '+logs.at(-1).reason:'')+(storageError?'\nStorage: '+storageError:'');
      }catch{$('metrics').textContent='Metrics unavailable';}
    };
    const setOpen=value=>{
      expanded=!!value;
      $('settings').hidden=!expanded;
      $('launcher').setAttribute('aria-expanded',String(expanded));
      if(expanded){updateConfig(cfg);refreshActivity();$('close').focus();}
      else $('launcher').focus();
    };
    $('launcher').addEventListener('click',()=>setOpen(!expanded));
    $('close').addEventListener('click',()=>setOpen(false));
    $('save').addEventListener('click',persist);
    $('enabled').addEventListener('change',persist);
    $('settings').addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);}
    });
    $('activity').addEventListener('toggle',event=>{if(event.target.open)refreshActivity();});
    $('exportTrace').addEventListener('click',async()=>{
      try{if(!onExport)throw Error('Export unavailable');await onExport();notice('Diagnostics exported');}
      catch{notice('Export failed',true);}
    });
    updateConfig(cfg);
    return {
      host,shadow,updateConfig,updateStatus,setOpen,
      ensureMounted:()=>{
        if(!host.isConnected)(document.body||document.documentElement).appendChild(host);
      },
      destroy:()=>{clearTimeout(hideMessage);host.remove();}
    };
  }
  const api={create,HOST_ID:ID};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else global.ContinueInPageUI=api;
})(typeof window!=='undefined'?window:globalThis);