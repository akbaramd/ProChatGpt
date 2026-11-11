// Low-profile, non-blocking in-page settings for Firefox Auto-Continue.
(function (global) {
  'use strict';
  const ID='chatdesk-auto-continue-controls';
  const DEFAULTS={enabled:false,message:'ادامه بده',delaySeconds:3,maxSends:0,draftMode:'append'};
  const fields=['enabled','message','delaySeconds','maxSends','draftMode'];
  function clamp(v,min,max,fallback) {
    const n=Number.parseInt(v,10);
    return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
  }
  function create({storage,defaults=DEFAULTS,onSaved,getScope,readActivity,onExport}={}) {
    if(document.getElementById(ID))return null;
    const host=document.createElement('div');
    host.id=ID;
    host.style.cssText='position:fixed;z-index:2147480000;bottom:max(12px,env(safe-area-inset-bottom));right:max(12px,env(safe-area-inset-right));max-width:calc(100vw - 24px);direction:ltr;pointer-events:auto';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`
      <style>
        :host {all:initial;color-scheme:light dark}
        *,*:before,*:after{box-sizing:border-box}
        button,input,textarea,select{font:inherit}
        button{cursor:pointer}
        .launcher{position:relative;display:grid;place-items:center;width:34px;height:34px;padding:0;border:1px solid #7777;border-radius:50%;background:#242429e8;color:#f4f4f5;font:600 18px/1 system-ui;box-shadow:0 2px 8px #0003;opacity:.80}
        .launcher:hover,.launcher:focus-visible,.launcher[aria-expanded="true"]{opacity:1;background:#39393e}
        .launcher:focus-visible{outline:2px solid #96b6ff;outline-offset:2px}
        .symbol{display:block;line-height:1;transform:translateY(-1px)}
        .dot{position:absolute;right:0;bottom:0;display:inline-block;width:8px;height:8px;background:#929299;border:1px solid #242429;border-radius:50%}
        .dot.active{background:#2ecb9d}
        .launcher[data-tone="working"] .dot{background:#80aaff}
        .launcher[data-tone="attention"] .dot{background:#efba63}
        .short{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
        .panel{position:absolute;right:0;bottom:calc(100% + 9px);width:min(320px,calc(100vw - 24px));max-height:min(74vh,calc(100dvh - 75px));overflow-y:auto;overscroll-behavior:contain;padding:16px;border:1px solid #505058;border-radius:13px;background:#242429;color:#f3f3f4;box-shadow:0 8px 25px #0006;font:13px/1.5 system-ui,"Segoe UI",sans-serif}
        [hidden]{display:none!important}
        .head{display:flex;align-items:center;justify-content:space-between}
        h2{margin:0;font:700 16px/1.3 system-ui}
        .close{border:0;background:transparent;color:inherit;font-size:18px;padding:3px 8px}
        .intro,.hint{color:#b8b8c0;font-size:11px;margin:5px 0 14px}
        .row{display:flex;align-items:center;justify-content:space-between;margin:12px 0}
        .row input{width:18px;height:18px;accent-color:#2ecb9d}
        .field{display:block;margin:12px 0}
        .field span{display:block;font-weight:600;margin-bottom:5px}
        textarea,input[type=number],select{width:100%;background:#16161a;color:#fff;border:1px solid #62626a;border-radius:8px;padding:8px}
        textarea{min-height:70px;resize:vertical;max-height:170px}
        .numbers{display:grid;grid-template-columns:1fr 1fr;gap:11px}
        .save{border:0;border-radius:8px;background:#ededf0;color:#242429;padding:8px 14px;font-weight:700}
        .save:disabled{opacity:.65;cursor:wait}
        .launcher:active{transform:scale(.97)}
        @media(prefers-reduced-motion:reduce){.launcher:active{transform:none}}
        .feedback{margin-left:10px;font-size:11px;color:#96e7c0}
        .runtime{padding-top:10px;margin-top:14px;border-top:1px solid #555}
        .runtime p,.metrics{margin:5px 0;color:#c5c5ce;font-size:11px;overflow-wrap:anywhere}
        .runtime p{min-height:16px}
        summary{cursor:pointer;font-size:11.5px;font-weight:600;margin-top:9px}
        .metrics{white-space:pre-wrap}
        button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid #96b6ff;outline-offset:2px}
        @media(prefers-color-scheme:light){
          .launcher{background:#f7f7f9e8;color:#242429;border-color:#dedee2}
          .launcher:hover,.launcher:focus-visible,.launcher[aria-expanded="true"]{background:#ececf0}
          .dot{border-color:#f7f7f9}
          .panel{background:#fff;color:#232329;border-color:#ddd}
          .intro,.hint,.runtime p,.metrics{color:#686873}
          textarea,input[type=number],select{background:#fafafa;color:#222;border-color:#ccc}
          .save{background:#26262c;color:#fff}
          .runtime{border-color:#e3e3e7}
        }
      </style>
      <button type="button" class="launcher" id="launcher" aria-label="Auto-Continue settings" title="Auto-Continue settings" aria-haspopup="dialog" aria-controls="settings" aria-expanded="false" data-testid="continue-launcher"><span class="symbol" aria-hidden="true">↻</span><span class="dot" id="dot" aria-hidden="true"></span><span class="short" id="short">Off</span></button>
      <section class="panel" id="settings" role="dialog" aria-modal="false" aria-label="Auto-Continue settings" hidden>
        <div class="head"><h2>Auto-Continue</h2><button type="button" class="close" id="close" aria-label="Close settings">×</button></div>
        <p class="intro">Automatic follow-up for the selected ChatGPT conversation.</p>
        <label class="row">Enabled <input type="checkbox" id="enabled" data-testid="continue-enabled"></label>
        <label class="field"><span>Message</span><textarea id="message" dir="auto" maxlength="12000" data-testid="continue-message"></textarea></label>
        <label class="field"><span>If the composer contains a draft</span><select id="draftMode" data-testid="continue-draft-mode"><option value="append">Append follow-up and send (default)</option><option value="replace">Clear draft, send only follow-up</option><option value="preserve">Keep draft, pause sending</option></select></label>
        <div class="numbers">
          <label class="field"><span>Delay (seconds)</span><input type="number" id="delaySeconds" min="0" max="3600" data-testid="continue-delay"></label>
          <label class="field"><span>Max follow-ups</span><input type="number" id="maxSends" min="0" max="999" data-testid="continue-max"></label>
        </div>
        <p class="hint">Max 0 = unlimited. Append sends existing draft text as part of the message. Replace discards it. Firefox may throttle background timers.</p>
        <button type="button" class="save" id="save" data-testid="continue-save">Save settings</button>
        <span class="feedback" id="feedback" role="status"></span>
        <div class="runtime"><strong>Status</strong><p id="runtime" aria-live="off" data-testid="continue-status">Disabled</p>
          <details id="activity"><summary>Activity &amp; metrics</summary><div class="metrics" id="metrics"></div><button type="button" class="save" id="exportTrace">Export diagnostics (.json)</button></details>
        </div>
      </section>`;
    (document.body||document.documentElement).appendChild(host);
    const $=id=>shadow.getElementById(id);
    let cfg={...DEFAULTS,...defaults},expanded=false,dirty=false,revision=0;
    let hideMessage,saveQueue=Promise.resolve(),pendingSaves=0;
    const updateStatus=value=>{
      const next=String(value||'Idle');
      const runtime=$('runtime');
      if(runtime.textContent!==next)runtime.textContent=next;
      const tone=!cfg.enabled?'off':
        /(?:recover|retry|preparing|waiting for chatgpt response|next follow-up)/i.test(next)?'working':
        /(?:uncertain|unavailable|paused|failed|limit|maximum|another tab|draft|error)/i.test(next)?'attention':'normal';
      const button=$('launcher');
      if(button.dataset.tone!==tone)button.dataset.tone=tone;
      const aria='Auto-Continue '+(cfg.enabled?'on':'off')+'. '+next+'. Open settings';
      if(button.getAttribute('aria-label')!==aria)button.setAttribute('aria-label',aria);
      if(button.title!==aria)button.title=aria;
    };
    const updateConfig=(next,{force=false}={})=>{
      cfg={...DEFAULTS,...next};
      // A storage update must not erase an unsaved text edit while the panel
      // is open. On navigation, the panel is closed and the new chat wins.
      if(force || !expanded || !dirty){
        for(const key of fields)$(key)[key==='enabled'?'checked':'value']=cfg[key];
        dirty=false;
      }
      $('dot').classList.toggle('active',!!cfg.enabled);
      $('short').textContent=cfg.enabled?'On':'Off';
      updateStatus(cfg.enabled?$('runtime').textContent:'Disabled');
    };
    const notice=(message,error=false)=>{
      $('feedback').textContent=message;
      $('feedback').style.color=error?'#ff9b9b':'#96e7c0';
      clearTimeout(hideMessage);
      hideMessage=setTimeout(()=>{if(host.isConnected)$('feedback').textContent='';},2200);
    };
    function persist(){
      const next={
        enabled:$('enabled').checked,
        message:$('message').value.trim()||DEFAULTS.message,
        delaySeconds:clamp($('delaySeconds').value,0,3600,DEFAULTS.delaySeconds),
        maxSends:clamp($('maxSends').value,0,999,DEFAULTS.maxSends),
        draftMode:['append','replace','preserve'].includes($('draftMode').value)?$('draftMode').value:DEFAULTS.draftMode
      };
      const submittedRevision=revision;
      const submittedScope=typeof getScope==='function'?getScope():null;
      pendingSaves++;
      $('save').disabled=true;
      saveQueue=saveQueue.catch(()=>{}).then(async()=>{
        try{
          if(typeof getScope==='function' && getScope()!==submittedScope)
            return false;
          if(typeof onSaved==='function')await onSaved(next,submittedScope);
          else await storage.set(next);
          if(typeof getScope==='function' && getScope()!==submittedScope)
            return false;
          if(revision===submittedRevision)updateConfig(next,{force:true});
          else {cfg={...DEFAULTS,...next};updateStatus($('runtime').textContent);}
          notice('Saved');
          return true;
        }catch{
          notice('Save failed',true);
          return false;
        }finally{
          pendingSaves--;
          if(!pendingSaves)$('save').disabled=false;
        }
      });
      return saveQueue;
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
    const setOpen=(value,{restoreFocus=true}={})=>{
      const next=!!value;
      if(next===expanded)return;
      expanded=next;
      $('settings').hidden=!expanded;
      $('launcher').setAttribute('aria-expanded',String(expanded));
      if(expanded){updateConfig(cfg);refreshActivity();$('close').focus();}
      else {if(restoreFocus)$('launcher').focus();dirty=false;}
    };
    $('launcher').addEventListener('click',()=>setOpen(!expanded));
    $('close').addEventListener('click',()=>setOpen(false));
    $('save').addEventListener('click',persist);
    $('enabled').addEventListener('change',()=>{revision++;persist();});
    for(const key of ['message','delaySeconds','maxSends','draftMode'])
      $(key).addEventListener('input',()=>{dirty=true;revision++;});
    // The panel is modeless. Clicking in ChatGPT closes it, without stealing
    // keyboard focus or covering native ChatGPT interactions.
    const outsideClick=event=>{
      if(expanded && !event.composedPath().includes(host))
        setOpen(false,{restoreFocus:false});
    };
    document.addEventListener('pointerdown',outsideClick,true);
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
      resetForNavigation:()=>{
        expanded=false;dirty=false;revision++;
        $('settings').hidden=true;
        $('launcher').setAttribute('aria-expanded','false');
      },
      destroy:()=>{clearTimeout(hideMessage);document.removeEventListener('pointerdown',outsideClick,true);host.remove();}
    };
  }
  const api={create,HOST_ID:ID};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else global.ContinueInPageUI=api;
})(typeof window!=='undefined'?window:globalThis);