// Firefox content script. Interacts only with the visible ChatGPT composer.
// A successful send is counted only after clicking the enabled Send button.
// Never re-send a request when its delivery is uncertain.
(function(){
  'use strict';
  const core=window.ContinueWatchdog;
  const log=window.WatchdogStore;
  const trace=window.AutoContinueTrace?.create(browser.storage.local);
  const settings=window.ContinueConversationSettings;
  const recovery=window.AutoContinueRecovery;
  const incidentPolicy=window.AutoContinueIncident;
  if(!core || !settings)return;
  const DEFAULTS=settings.DEFAULTS;
  let cfg={...DEFAULTS};
  let state=core.initialState();
  let lastLoggedReason=null;
  const shortChat=()=>currentConversation()?.split('/').at(-1)?.slice(0,8)||'';
  const traceEvent=(event,fields)=>trace?.append(event,{chat:shortChat(),...fields});
  let busy=false;
  let activeSubmission=null;
  let lastUrl=location.href;
  let lastReceipt=null;
  let lastHeartbeat=0;
  let networkLostAt=navigator.onLine===false?Date.now():null;
  let networkReturnedAt=null;
  let networkRecoveryReloaded=false;
  addEventListener('offline',()=>{
    networkLostAt ||= Date.now();
    networkReturnedAt=null;
  });
  addEventListener('online',()=>{
    if(networkLostAt!=null && Date.now()-networkLostAt>=45000)
      networkReturnedAt=Date.now();
    else networkLostAt=null;
  });
  function considerNetworkRecovery(){
    if(incidentPolicy && incidentState && !['resolved','hold'].includes(incidentState.phase))return false;
    if(core.detectErrorBanner(document))return false;
    if(navigator.onLine===false){
      networkLostAt ||= Date.now();
      return false;
    }
    if(incidentPolicy && (incidentState || core.detectInterrupted(document,true) ||
       core.detectErrorBanner(document)))return false;
    if(!networkReturnedAt || networkRecoveryReloaded ||
       Date.now()-networkReturnedAt<15000)return false;
    if(!cfg.enabled || !isLeader || !currentConversation() ||
       configuredPath!==currentConversation() || busy ||
       core.detectRateLimited(document) || core.detectGenerating(document) ||
       core.detectInterrupted(document,true) ||
       !core.composerEmpty(document))return false;
    // Reload only after a sustained browser-reported outage, not just a slow
    // ChatGPT response. Durable receipts prevent replaying an uncertain send.
    networkRecoveryReloaded=true;
    record('network-recovery-reload','reload');
    location.reload();
    return true;
  }
  let lastObservedReason='boot';
  let lastBadgeReason=null;
  let stallProbeAt=0,stallProbePending=false;
  let candidateAnswer={key:null,text:null,changedAt:0};
  let configuredPath=null;
  let loadSerial=0;
  let incidentState=null,incidentReady=false,incidentPending=false;
  let incidentLastStatus=null;
  // Web Locks provide atomic ownership across tabs in the same origin.
  let isLeader=false;
  let leaderRequestPending=false;
  let leaderRelease=null;
  let leaderToken=null;
  let lastLeaderAttempt=0;
  function relinquishLeader(){
    // A released lock's finally may run after a different chat acquired a lock.
    const release=leaderRelease;
    leaderRelease=null;
    leaderToken=null;
    isLeader=false;
    if(release)release();
  }
  function maintainLeadership(){
    if(!cfg.enabled || !configuredPath ||
       configuredPath!==currentConversation()){
      relinquishLeader();
      return;
    }
    if(isLeader || leaderRequestPending ||
       Date.now()-lastLeaderAttempt<6000)return;
    lastLeaderAttempt=Date.now();
    if(!navigator.locks?.request){
      record('web-lock-unavailable','none');
      return;
    }
    leaderRequestPending=true;
    const lockPath=configuredPath;
    traceEvent('leader-attempt',{reason:'web-lock',enabled:cfg.enabled});
    navigator.locks.request('prochatgpt-auto-continue:'+lockPath,
      {ifAvailable:true},async lock=>{
        leaderRequestPending=false;
        if(!lock)return;
        if(!cfg.enabled || configuredPath!==lockPath ||
           lockPath!==currentConversation())return;
        const token={path:lockPath};
        leaderToken=token;
        isLeader=true;
        traceEvent('leader-acquired',{leader:true,enabled:cfg.enabled});
        record('leader-acquired','none');
        try{await new Promise(resolve=>{leaderRelease=resolve;});}
        finally{
          if(leaderToken===token){
            isLeader=false;
            leaderRelease=null;
            leaderToken=null;
          }
          traceEvent('leader-released',{leader:false,
            chat:lockPath.split('/').at(-1)?.slice(0,8)});
          record('leader-released','none');
        }
      }).catch(error=>{
        leaderRequestPending=false;
        record('leader-error','none');
        ui?.updateStatus('Exclusive browser lock unavailable: '+error.message);
      });
  }
  addEventListener('pagehide',relinquishLeader);

  async function saveConfig(values,path=currentConversation()){
    if(!path || path!==currentConversation() || configuredPath!==path)
      throw Error('Conversation changed before saving');
    const next=await settings.save(browser.storage.local,path,values);
    applyConfig(next);
    return next;
  }
  async function exportTrace(){
    const result=await browser.runtime.sendMessage({type:'autoContinue:exportDiagnostics'});
    if(!result?.ok)throw Error('Unable to create diagnostics download');
    return result;
  }
  const ui=window.ContinueInPageUI?.create({
    storage:browser.storage.local,defaults:DEFAULTS,
    onSaved:saveConfig,getScope:currentConversation,
    readActivity:log?.read,onExport:exportTrace
  })||null;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const runtimeCfg=()=>({
    ...core.DEFAULT_CFG,
    enabled:cfg.enabled,
    delayMs:Math.max(0,Number(cfg.delaySeconds)||0)*1000,
    maxSends:Number(cfg.maxSends)||0,
    draftMode:cfg.draftMode,
    // Allow React to acknowledge a sent turn before declaring it unconfirmed.
    verifyWindowMs:12000,
    errorBackoffMs:1800
  });
  function applyConfig(values){
    const previous=cfg;
    cfg=settings.normalize(values);
    if(!cfg.enabled){
      relinquishLeader();
      state=core.initialState();
      activeSubmission=null;
    }else if(!previous.enabled || previous.autoContinueRunId!==cfg.autoContinueRunId){
      if((previous.autoContinueRunId||'legacy')!==
         (cfg.autoContinueRunId||'legacy'))incidentState=null;
      state=core.initialState();
      if(lastReceipt?.conversation===currentConversation() &&
         lastReceipt.runId===(cfg.autoContinueRunId||'legacy'))
        state.sends=lastReceipt.sends||0;
      if(core.lastCompletedAssistant(document) &&
         !core.detectGenerating(document)&&!core.detectErrorBanner(document))
        state.dueAt=Date.now()+runtimeCfg().delayMs;
      record('armed-on','none');
    }
    ui?.updateConfig(cfg);
    renderBadge();
  }
  async function loadConfig(){
    const path=currentConversation(),serial=++loadSerial;
    if(path!==configuredPath){
      ui?.resetForNavigation?.();
      relinquishLeader();
      // Lock-attempt cooldown belongs to the previous conversation.
      // A new chat must be able to acquire its own lock immediately.
      lastLeaderAttempt=0;
      configuredPath=path;
      traceEvent('navigation',{phase:'chat-switch'});
      cfg={...DEFAULTS};
      state=core.initialState();
      activeSubmission=null;
      lastReceipt=null;
      incidentState=null;incidentReady=false;incidentLastStatus=null;
      candidateAnswer={key:null,text:null,changedAt:0};
      lastLoggedReason=null;
      ui?.updateConfig(cfg);
    }
    if(!path){
      ui?.updateStatus('Open a saved ChatGPT conversation to configure Auto-Continue');
      return;
    }
    try{
      const key=settings.incidentKey(path);
      const [result,savedIncident]=await Promise.all([
        settings.read(browser.storage.local,path),
        browser.storage.local.get({[key]:null})
      ]);
      if(serial!==loadSerial||path!==currentConversation())return;
      lastReceipt=result.receipt;
      incidentState=(savedIncident[key]?.runId === (result.config.autoContinueRunId||'legacy'))?
        savedIncident[key]:null;
      if(incidentState?.phase==='reloaded'){
        // A tab may take seconds or minutes to render after location.reload().
        // Re-start the post-refresh observation window on actual page hydration,
        // not at the time the previous page requested navigation.
        const mountedAt=Date.now();
        incidentState={...incidentState,phaseAt:mountedAt,
          lastProgressAt:Math.max(incidentState.lastProgressAt||0,mountedAt)};
        await browser.storage.local.set({[key]:incidentState});
        if(serial!==loadSerial||path!==currentConversation())return;
      }
      incidentReady=true;
      traceEvent('config-loaded',{enabled:result.config.enabled,receiptPhase:result.receipt?.phase||'legacy'});
      applyConfig(result.config);
    }catch(e){
      if(serial===loadSerial){
        incidentReady=false;
        traceEvent('config-load-error',{errorCode:e?.name||'storage'});
        ui?.updateStatus('Configuration load failed: '+e.message);
      }
    }
  }
  browser.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    const path=currentConversation();
    if(!path)return;
    if(Object.hasOwn(changes,settings.configKey(path)))loadConfig();
    else if(Object.hasOwn(changes,settings.receiptKey(path)))
      lastReceipt=changes[settings.receiptKey(path)].newValue||null;
  });
  function currentConversation(){return settings.pathFrom(location.href);}

  function turnCounts(){
    const nodes=core.turnNodes(document);
    const users=nodes.filter(el=>core.roleOf(el)==='user');
    const assistants=nodes.filter(el=>core.roleOf(el)==='assistant');
    return {
      user:users.length,assistant:assistants.length,
      lastUserKey:users.length?core.messageKey(users.at(-1),nodes):null,
      lastAssistantKey:assistants.length?core.messageKey(assistants.at(-1),nodes):null
    };
  }
  function submissionObservation(){
    if(!activeSubmission || activeSubmission.path!==currentConversation())
      return {sentConfirmed:false,responseCompleted:false};
    const now=turnCounts();
    const sentConfirmed=now.user>activeSubmission.before.user ||
      (Boolean(now.lastUserKey)&&now.lastUserKey!==activeSubmission.before.lastUserKey);
    const responseStarted=now.assistant>activeSubmission.before.assistant ||
      (Boolean(now.lastAssistantKey)&&
       now.lastAssistantKey!==activeSubmission.before.lastAssistantKey);
    const latest=core.lastVisibleTurn(document);
    const responseCompleted=responseStarted && latest?.role==='assistant' &&
      latest.complete && !core.detectGenerating(document,latest);
    return {sentConfirmed,responseCompleted};
  }

  function editableText(editor){return core.editorText(editor);}
  function setComposerText(editor,text,prior=''){
    if(!editor || editableText(editor)!==prior)return false;
    const expected=core.normalizeComposerText(text);
    if(prior===expected)return true;
    const append=Boolean(prior && expected.startsWith(prior+'\n'));
    editor.focus();
    if(editor.isContentEditable){
      const range=document.createRange();
      range.selectNodeContents(editor);
      if(append)range.collapse(false);
      const selection=window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      // In contenteditable, inserting a single newline at the end creates
      // a new paragraph break. Two input newlines become three visual lines.
      const insert=append?text.slice(prior.length).replace(/^\n\n/,'\n'):text;
      let inserted=false;
      try{inserted=document.execCommand('insertText',false,insert);}
      catch{inserted=false;}
      // React/Lexical can remount the editor synchronously on beforeinput.
      // Direct fallback is permitted only if the controlled editor and its
      // contents still match the snapshot taken before insertion.
      if(!inserted && editableText(editor)===prior &&
         core.composerEditor(document)===editor){
        editor.textContent=text;
        editor.dispatchEvent(new InputEvent('input',{
          bubbles:true,inputType:'insertText',data:insert
        }));
      }
    }else{
      const proto=editor.tagName==='TEXTAREA'?
        HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(editor,text);
      else editor.value=text;
      editor.dispatchEvent(new InputEvent('input',{
        bubbles:true,inputType:'insertText',data:text
      }));
    }
    return editableText(core.composerEditor(document))===expected ||
      editableText(editor)===expected;
  }
  async function releaseCompletedStop(){
    const completedKey=core.lastCompletedAssistant(document);
    if(!completedKey || !core.stopButton(document))return true;
    const initialPath=location.pathname;
    // Do not stop genuine generation. This runs only with a completed
    // final-assistant turn and after the configured follow-up delay.
    const grace=Date.now()+1700;
    while(core.stopButton(document)&&Date.now()<grace)await sleep(100);
    const stale=core.stopButton(document);
    if(!stale)return true;
    if(!cfg.enabled ||
       location.pathname!==initialPath ||
       core.lastCompletedAssistant(document)!==completedKey)return false;
    stale.click(); // Close a lingering first-party Stop state, once only.
    const deadline=Date.now()+4500;
    while(core.stopButton(document)&&Date.now()<deadline){
      if(!cfg.enabled || location.pathname!==initialPath)return false;
      await sleep(100);
    }
    return !core.stopButton(document) &&
      core.lastCompletedAssistant(document)===completedKey &&
      !core.detectErrorBanner(document);
  }
  async function clickSendWhenReady(text,submission){
    const fail=code=>{if(submission)submission.abortReason=code;return false;};
    if(!submission || currentConversation()!==submission.path ||
       activeSubmission!==submission)return fail('submission-changed');
    let editor=core.composerEditor(document);
    if(!editor)return fail('composer-missing');
    if(!await releaseCompletedStop())return fail('stop-not-settled');
    if(!cfg.enabled || !isLeader ||
       currentConversation()!==submission.path)return fail('ownership-changed');
    editor=core.composerEditor(document);
    if(!editor)return fail('composer-missing');
    const original=editableText(editor);
    const plan=settings.planDraft(original,text,submission.draftMode);
    if(plan.text==null)return fail(plan.action);
    const expected=core.normalizeComposerText(plan.text);
    submission.draftPlan=plan.action;
    traceEvent('composer-prepared',{action:plan.action,
      originalLength:original.length,expectedLength:expected.length});
    if(original!==expected)setComposerText(editor,plan.text,original);
    // React/Lexical may replace the composer during insertion. Never send
    // text that differs from the one prepared for this submission.
    const deadline=Date.now()+8000;
    let repairs=0,noticeAt=Date.now()+1200,reason='send-ui-timeout';
    while(Date.now()<deadline){
      const legacyRecovered=!incidentPolicy && state.interruptionDismissed;
      const incidentRecovered=Boolean(incidentPolicy &&
        incidentState?.phase==='resolved' && incidentState?.partial &&
        candidateAnswer.key===incidentState.resolvedKey &&
        candidateAnswer.text);
      const safeReleasedInterruption=Boolean(
        (legacyRecovered||incidentRecovered) &&
        !core.stopButton(document) && core.detectInterrupted(document,true) &&
        candidateAnswer.changedAt>0 &&
        Date.now()-candidateAnswer.changedAt>=core.DEFAULT_CFG.interruptStableMs);
      if(!cfg.enabled || !isLeader ||
         currentConversation()!==submission.path ||
         activeSubmission!==submission)return fail('ownership-changed');
      if(cfg.draftMode!==submission.draftMode ||
         (cfg.message||'ادامه بده').trim()!==text)
        return fail('settings-changed');
      if(core.detectGenerating(document)&&!safeReleasedInterruption)
        return fail('generation-resumed');
      editor=core.composerEditor(document);
      if(!editor){reason='composer-missing';await sleep(100);continue;}
      const actual=editableText(editor);
      if(actual!==expected){
        // Repair an empty replacement editor or one that still has exactly
        // the original draft. Another mutation may be new user input.
        if(actual && actual!==original)return fail('composer-text-mismatch');
        if(repairs<2){
          repairs++;
          setComposerText(editor,plan.text,actual);
        }
        reason='composer-not-synchronized';
        await sleep(120);
        continue;
      }
      const btn=core.sendButton(document);
      if(btn && !btn.disabled &&
         btn.getAttribute('aria-disabled')!=='true' &&
         btn.isConnected!==false && btn.getClientRects().length){
        // Revalidate the active editor immediately before the one permitted click.
        if(editableText(core.composerEditor(document))!==expected){
          reason='composer-remounted-before-click';await sleep(100);continue;
        }
        // Mark possible delivery before calling an event handler that can throw.
        submission.clickAttempted=true;
        btn.click();
        submission.clickSucceeded=true;
        return true;
      }
      reason=!btn?'send-button-missing':
        btn.disabled?'send-button-disabled':
        btn.getAttribute('aria-disabled')==='true'?'send-aria-disabled':
        'send-button-not-visible';
      // Some controlled editors need another input event after mounting.
      // This does not modify the text and is bounded to one notification.
      if(Date.now()>=noticeAt){
        noticeAt=Infinity;
        editor.dispatchEvent(new InputEvent('input',{
          bubbles:true,inputType:'insertText',data:null
        }));
      }
      await sleep(100);
    }
    return fail(reason);
  }
  function record(reason,action,extra){
    const meaningful=action==='send'||reason==='send-failed'||reason==='retry-error'||
      (reason!==lastLoggedReason && !core.QUIET_REASONS.has(reason));
    if(meaningful)log?.record(reason,action,extra);
    lastLoggedReason=reason;
  }
  async function pauseWithError(message,reason){
    // Stay enabled so late confirmation of the failed turn can safely resume.
    // A blocked state never submits another prompt while delivery is unknown.
    state={...state,blocked:true,sentPending:false,awaitingResponse:false,
      dueAt:null,verifyAt:null};
    ui?.updateStatus('Waiting for safe recovery: '+message);
    record(reason||'send-failed','none');
  }
  async function executeSend(reason){
    busy=true;
    const message=(cfg.message||'ادامه بده').trim();
    const latest=core.lastVisibleTurn(document);
    const sourceKey=latest?.role==='assistant'?latest.key:state.lastScheduledCompletedKey;
    activeSubmission={path:currentConversation(),before:turnCounts(),
      sourceKey,at:Date.now(),draftMode:cfg.draftMode};
    const submission=activeSubmission;
    const stillHere=()=>currentConversation()===submission.path &&
      configuredPath===submission.path && activeSubmission===submission;
    let clicked=false;
    try{
      // Persist before sending so a crash after the click does not repeat it.
      if(!submission.sourceKey)throw Error('No assistant turn to continue');
      const previousReceipt=lastReceipt;
      const receipt={
        conversation:submission.path,
        assistantKey:submission.sourceKey,
        runId:cfg.autoContinueRunId||'legacy',
        sends:state.sends,at:Date.now()
      };
      traceEvent('send-prepare',{phase:'pre-commit',sends:state.sends,leader:isLeader});
      await browser.storage.local.set({[settings.receiptKey(submission.path)]:receipt});
      if(stillHere())lastReceipt=receipt;
      clicked=stillHere()?await clickSendWhenReady(message,submission):false;
      if(!clicked){
        // No click happened: restore the previous durable receipt.
        // Do not overwrite a receipt written by a newly elected tab.
        // When navigation released our lock, leave the prepared receipt
        // (fail closed) rather than racing another sender.
        if(stillHere() && isLeader){
          const key=settings.receiptKey(submission.path);
          const saved=(await browser.storage.local.get({[key]:null}))[key];
          if(saved?.assistantKey===receipt.assistantKey &&
             saved?.at===receipt.at && saved?.runId===receipt.runId){
            await browser.storage.local.set({[key]:previousReceipt});
            lastReceipt=previousReceipt;
          }
        }else traceEvent('submission-abandoned',{phase:'navigation'});
        // No click happened, so we can retry the prepared message later.
        // Never re-submit once the first-party Send button was clicked.
        if(stillHere())state={...state,sentPending:false,verifyAt:null,
          sends:Math.max(0,state.sends-1),blocked:false,
          dueAt:Date.now()+15000};
        const editor=core.composerEditor(document),sendButton=core.sendButton(document);
        const why=submission.abortReason||(!stillHere()?'navigation':!isLeader?'leader-lost':
          !editor?'composer-missing':!sendButton?'send-button-missing':
          (sendButton.disabled||sendButton.getAttribute('aria-disabled')==='true')?
            'send-button-disabled':'send-action-not-ready');
        traceEvent('send-not-clicked',{
          phase:'before-click',reason:why,leader:isLeader,
          hasEditor:!!editor,sendReady:!!sendButton&&!sendButton.disabled,
          composerEmpty:core.composerEmpty(document)
        });
        record('send-not-clicked','none');
        ui?.updateStatus('Send unavailable — trying again in 15 seconds');
        return;
      }
      traceEvent('send-clicked',{phase:'clicked',sends:state.sends});
      record(reason,'send',{msgLen:message.length});
      ui?.updateStatus('Sent «'+message.slice(0,40)+'»; waiting for ChatGPT');
    }catch(e){
      // A click can be accepted before dispatch throws. A durable receipt
      // already exists; never interpret a thrown click handler as no send.
      if(clicked || submission.clickAttempted){
        if(stillHere())state={...state,blocked:true,sentPending:false,
          awaitingResponse:false,verifyAt:null,dueAt:null};
        traceEvent('send-exception',{phase:'after-click',errorCode:e?.name||'exception'});
        ui?.updateStatus('Send clicked but follow-up confirmation is uncertain');
      }else{
        if(stillHere())state={...state,sentPending:false,verifyAt:null,
          sends:Math.max(0,state.sends-1),blocked:false,dueAt:Date.now()+15000};
        traceEvent('send-exception',{phase:'before-click',errorCode:e?.name||'exception'});
        record('send-not-clicked','none');
        ui?.updateStatus('Send failed before clicking: '+e.message);
      }
    }finally{busy=false;}
  }
  async function executeInterruptedStop(){
    busy=true;
    try{
      const target=currentConversation();
      const editor=core.composerEditor(document);
      const text=editableText(editor);
      const expected=(cfg.message||'ادامه بده').trim();
      if(!cfg.enabled || !isLeader || !target ||
         configuredPath!==target ||
         !core.detectInterrupted(document,true) || core.detectRateLimited(document) ||
         (text && text!==expected)){
        state.interruptionStopAttempted=false;
        state.interruptedSince=Date.now();
        record('interruption-stop-skipped','none');
        return;
      }
      const stop=core.stopButton(document);
      if(!stop){
        state.interruptionStopAttempted=false;
        return;
      }
      stop.click();
      record('interruption-stop-clicked','stop');
      ui?.updateStatus('Connection interrupted — requested first-party Stop once');
    }catch(error){
      state.interruptionStopAttempted=false;
      state.interruptedSince=Date.now();
      record('interruption-stop-failed','none');
      ui?.updateStatus('Connection recovery failed: '+error.message);
    }finally{busy=false;}
  }
  async function executeRetry(){
    busy=true;
    try{
      const btn=core.retryButton(document);
      if(!btn)throw Error('ChatGPT Retry button unavailable');
      btn.click();
      traceEvent('retry-clicked',{reason:'retry-error'});
      record('retry-error','retry');
      ui?.updateStatus('Retrying the failed ChatGPT response');
    }catch(e){
      await pauseWithError(e.message,'error-recovery-unconfirmed');
    }finally{busy=false;}
  }
  function considerStallRecovery(obs){
    if(incidentPolicy && incidentState && !['resolved','hold'].includes(incidentState.phase))return;
    const now=Date.now(),path=currentConversation();
    if(!recovery?.eligible({now,enabled:cfg.enabled,leader:isLeader,busy,
         online:navigator.onLine!==false,state,obs,receipt:lastReceipt}) ||
       stallProbePending || now-stallProbeAt<60000)return;
    stallProbeAt=now;stallProbePending=true;
    (async()=>{
      const key=settings.recoveryKey(path);
      const saved=(await browser.storage.local.get({[key]:null}))[key];
      const decision=recovery.next(saved,Date.now());
      if(!decision.allowed){
        traceEvent('stall-reload-suppressed',{reason:decision.reason});
        return;
      }
      const latest=core.observe(document,window);
      if(path!==currentConversation()||!isLeader||
         !recovery.eligible({now:Date.now(),enabled:cfg.enabled,leader:isLeader,
           busy,online:navigator.onLine!==false,state,obs:latest,receipt:lastReceipt}))
        return;
      await browser.storage.local.set({[key]:decision.record});
      await traceEvent('stall-reload',{reason:'unanswered-user-turn',phase:'bounded'});
      location.reload();
    })().catch(error=>traceEvent('stall-reload-error',{
      errorCode:error?.name||'recovery'
    })).finally(()=>{stallProbePending=false;});
  }

  function incidentSnapshot(obs){
    return {
      online:navigator.onLine!==false,
      composerEmpty:core.composerEmpty(document),
      generating:!!obs.generating,hasStopButton:!!obs.hasStopButton,
      errorBanner:!!obs.errorBanner,connectionInterrupted:!!obs.connectionInterrupted,
      retryAvailable:!!obs.retryAvailable,rateLimited:!!obs.rateLimited,
      conversationMaxed:!!obs.conversationMaxed,latestTurnRole:obs.latestTurnRole,
      latestAssistantKey:obs.latestAssistantKey,
      latestAssistantLength:obs.latestAssistantLength||0,
      latestAssistantHash:incidentPolicy.hashText(
        incidentPolicy.cleanAssistantText(obs.latestAssistantText||'')),
      completedAssistantKey:obs.completedAssistantKey
    };
  }
  function incidentStatus(reason){
    if(reason===incidentLastStatus)return;
    incidentLastStatus=reason;
    traceEvent('incident-status',{reason,phase:incidentState?.phase||'none'});
  }
  function handleIncident(obs){
    if(!incidentPolicy)return false;
    if(!incidentReady||incidentPending){
      renderBadge('incident-loading');
      return true;
    }
    const snap=incidentSnapshot(obs);
    // First-party Retry does not submit or clear a draft; allow it in
    // append/replace mode without permitting a destructive reload.
    if(cfg.draftMode!=='preserve'&&core.composerEditor(document))
      snap.composerEmpty=true;
    const isIncident=incidentState || incidentPolicy.issueOf(snap);
    if(!isIncident)return false;
    const decision=incidentPolicy.transition(incidentState,snap,Date.now());
    incidentStatus(decision.reason);
    if(Date.now()-lastHeartbeat>=30000){
      lastHeartbeat=Date.now();
      traceEvent('incident-heartbeat',{
        reason:decision.reason,phase:decision.incident?.phase||'none',
        leader:isLeader,enabled:cfg.enabled,online:snap.online,
        generating:snap.generating,hasStopButton:snap.hasStopButton,
        retryAvailable:snap.retryAvailable,rateLimited:snap.rateLimited,
        errorBanner:snap.errorBanner,interrupted:snap.connectionInterrupted,
        responseWaitMs:decision.incident?
          Date.now()-(decision.incident.lastProgressAt||Date.now()):0
      });
    }
    if(decision.action==='pass'){
      if(incidentState?.partial && snap.latestAssistantKey===incidentState.resolvedKey &&
         snap.latestTurnRole==='assistant'&&snap.composerEmpty&&!snap.hasStopButton &&
         !snap.rateLimited&&!snap.conversationMaxed &&
         (snap.latestAssistantLength||0)<=(incidentState.progressLength||0) &&
         Date.now()-(incidentState.lastProgressAt||Date.now())>=incidentPolicy.QUIET_MS){
        obs.generating=false;obs.connectionInterrupted=false;
        obs.errorBanner=false;obs.retryAvailable=false;
        obs.completedAssistantKey=obs.latestAssistantKey;
      }
      return false;
    }
    if(decision.action==='wait' || (decision.action==='hold' &&
        (decision.reason==='service-limit'||incidentState?.phase==='hold'))){
      // Save progress checkpoints. Without this, source text growth is
      // re-detected on every tick and the quiet-time threshold never expires.
      if(decision.incident && (
         decision.incident.progressKey!==incidentState?.progressKey ||
         decision.incident.progressLength!==incidentState?.progressLength ||
         decision.incident.progressHash!==incidentState?.progressHash)){
        incidentPending=true;
        const path=currentConversation(),value={
          ...decision.incident,runId:cfg.autoContinueRunId||'legacy'
        };
        browser.storage.local.set({[settings.incidentKey(path)]:value})
          .then(()=>{if(currentConversation()===path)incidentState=value;})
          .catch(error=>traceEvent('incident-checkpoint-error',{
            errorCode:error?.name||'storage'
          }))
          .finally(()=>{incidentPending=false;requestTick();});
      }
      renderBadge('incident-'+decision.reason);
      return true;
    }
    incidentPending=true;
    const path=currentConversation(),runId=cfg.autoContinueRunId||'legacy';
    const beforeAction=incidentState;
    const incident={...decision.incident,runId};
    if(decision.action==='hold')incident.phase='hold';
    (async()=>{
      // The checkpoint is durable BEFORE reloading, stopping or retrying.
      const key=settings.incidentKey(path);
      await browser.storage.local.set({[key]:incident});
      if(path!==currentConversation()||!isLeader||
         !cfg.enabled || (cfg.autoContinueRunId||'legacy')!==runId)return;
      incidentState=incident;
      traceEvent('incident-transition',{phase:incident.phase,
        action:decision.action,reason:decision.reason});
      const canAct=()=>path===currentConversation()&&configuredPath===path &&
        cfg.enabled&&isLeader&&!busy&&navigator.onLine!==false&&
        !core.detectRateLimited(document)&&
        !core.detectConversationMaxed(document)&&
        (core.composerEmpty(document)||
          (decision.action==='retry'&&cfg.draftMode!=='preserve'));
      // Persisted intent is not proof the UI action was performed.
      const defer=async reason=>{
        if(path!==currentConversation()||!cfg.enabled||!isLeader||
           (cfg.autoContinueRunId||'legacy')!==runId)return;
        const previous=beforeAction?{...beforeAction,runId}:null;
        await browser.storage.local.set({[key]:previous});
        incidentState=previous;
        traceEvent('incident-action-deferred',{reason,phase:decision.action});
      };
      if(decision.action==='reload'){
        if(!canAct())return await defer('ui-not-ready');
        await traceEvent('incident-reload',{reason:decision.reason});
        if(!canAct())return await defer('changed-before-reload');
        location.reload();
      }else if(decision.action==='stop'){
        if(!canAct())return await defer('ui-not-ready');
        const current=core.observe(document,window);
        const checked=incidentSnapshot(current);
        if(checked.latestAssistantKey!==incident.progressKey ||
           checked.latestAssistantLength!==incident.progressLength ||
           checked.latestAssistantHash!==incident.progressHash){
          const updated={...incident,phase:'reloaded',
            stops:Math.max(0,incident.stops-1),lastProgressAt:Date.now(),
            progressKey:checked.latestAssistantKey,
            progressLength:checked.latestAssistantLength,
            progressHash:checked.latestAssistantHash};
          await browser.storage.local.set({[key]:updated});
          incidentState=updated;
          traceEvent('incident-stop-aborted',{reason:'response-progressed'});
          return;
        }
        if(!current.hasStopButton || !core.stopButton(document))
          return await defer('stop-disappeared');
        const btn=core.stopButton(document);
        btn.click();
        traceEvent('incident-stop-clicked',{reason:decision.reason});
      }else if(decision.action==='retry'){
        if(!canAct())return await defer('ui-not-ready');
        const btn=core.retryButton(document);
        if(!btn)return await defer('retry-disappeared');
        btn.click();
        traceEvent('incident-retry-clicked',{reason:decision.reason});
      }else if(decision.action==='release'||decision.action==='release-partial'){
        state=core.initialState();
        if(lastReceipt?.runId===runId)state.sends=lastReceipt.sends||0;
        traceEvent('incident-released',{reason:decision.reason});
      }
    })().catch(error=>{
      traceEvent('incident-action-error',{errorCode:error?.name||'exception'});
      ui?.updateStatus('Recovery storage/action failed; sending paused');
    }).finally(()=>{incidentPending=false;requestTick();});
    renderBadge('incident-'+decision.reason);
    return true;
  }
  function tick(){
    ui?.ensureMounted();
    if(location.href!==lastUrl || configuredPath!==currentConversation()){
      lastUrl=location.href;
      if(configuredPath!==currentConversation())loadConfig();
    }
    if(!currentConversation()){renderBadge('no-conversation');return;}
    if(configuredPath!==currentConversation()){renderBadge('loading-chat');return;}
    maintainLeadership();
    if(cfg.enabled && !isLeader){
      renderBadge(navigator.locks?.request?'another-tab':'web-lock-unavailable');
      return;
    }
    if(!cfg.enabled){renderBadge('disabled');return;}
    if(incidentPolicy && !incidentReady){renderBadge('incident-loading');return;}
    if(considerNetworkRecovery())return;
    if(busy){renderBadge('preparing-message');return;}
    const obs={...core.observe(document,window),...submissionObservation()};
    // A persisted receipt suppresses replay until a NEW assistant appears.
    if(lastReceipt?.conversation===currentConversation() &&
       lastReceipt.assistantKey && obs.latestAssistantKey===lastReceipt.assistantKey){
      state.lastScheduledCompletedKey=lastReceipt.assistantKey;
      state.dueAt=null;
      if(lastReceipt.runId===(cfg.autoContinueRunId||'legacy'))
        state.sends=Math.max(state.sends,lastReceipt.sends||0);
    }
    // Some ChatGPT builds omit the terminal turn-state attribute. A new
    // assistant answer that remains unchanged without any Stop control for
    // eight seconds is a conservative completion fallback.
    if(obs.latestAssistantKey && obs.latestAssistantText){
      if(candidateAnswer.key!==obs.latestAssistantKey ||
         candidateAnswer.text!==obs.latestAssistantText){
        candidateAnswer={key:obs.latestAssistantKey,
          text:obs.latestAssistantText,changedAt:Date.now()};
      }else if(!obs.generating && !obs.errorBanner &&
               !core.stopButton(document) &&
               // Historical in_progress turns are irrelevant. Only the latest
               // assistant decides whether its answer has settled.
               Date.now()-candidateAnswer.changedAt>=8000){
        obs.completedAssistantKey ||=obs.latestAssistantKey;
      }
    }
    obs.answerStableMs=candidateAnswer.changedAt>0?
      Math.max(0,Date.now()-candidateAnswer.changedAt):0;
    // A failed attempt can leave the exact configured message as a draft.
    // Reuse only that exact match, without changing any other user draft.
    const editor=core.composerEditor(document);
    if(editor && editableText(editor)===(cfg.message||'ادامه بده').trim())
      obs.composerEmpty=true;
    if(handleIncident(obs))return;
    const result=core.decide(state,obs,runtimeCfg(),Date.now());
    state=result.state;
    if(activeSubmission && !state.sentPending && !state.awaitingResponse)
      activeSubmission=null;
    const previousReason=lastObservedReason;
    lastObservedReason=result.reason;
    if(result.reason!==previousReason)traceEvent('state',{
      reason:result.reason,enabled:cfg.enabled,leader:isLeader,
      generating:!!obs.generating,completed:!!obs.completedAssistantKey,
      errorBanner:!!obs.errorBanner,retryAvailable:!!obs.retryAvailable,
      interrupted:!!obs.connectionInterrupted,rateLimited:!!obs.rateLimited,
      hasStopButton:!!obs.hasStopButton,hasEditor:!!obs.canSend,
      composerEmpty:!!obs.composerEmpty,blocked:!!state.blocked,
      awaitingResponse:!!state.awaitingResponse,sentPending:!!state.sentPending,
      sends:state.sends,lastTurnRole:obs.latestTurnRole||'none',
      dueInMs:state.dueAt==null?-1:state.dueAt-Date.now()
    });
    if(cfg.enabled && Date.now()-lastHeartbeat>=30000){
      lastHeartbeat=Date.now();
      traceEvent('heartbeat',{
        reason:result.reason,enabled:cfg.enabled,leader:isLeader,
        visible:document.visibilityState==='visible',generating:!!obs.generating,
        sentPending:!!state.sentPending,awaitingResponse:!!state.awaitingResponse,
        blocked:!!state.blocked,sends:state.sends,
        responseWaitMs:state.awaitingResponseSince==null?0:Date.now()-state.awaitingResponseSince
      });
      log?.record('heartbeat','none',{
        state:result.reason,
        responseWaitSeconds:state.awaitingResponseSince==null?0:
          Math.floor((Date.now()-state.awaitingResponseSince)/1000),
        visible:document.visibilityState==='visible',
        generating:!!obs.generating,
        completed:!!obs.completedAssistantKey,
        boundChat:configuredPath===currentConversation()
      });
    }
    if(result.action==='send'){
      if(!currentConversation()){
        pauseWithError('Open an existing ChatGPT conversation first.','send-failed');
      }else executeSend(result.reason);
    }else if(result.action==='retry-error'){
      executeRetry();
    }else if(result.action==='stop-interrupted'){
      executeInterruptedStop();
    }else if(result.reason==='send-unconfirmed' ||
             result.reason==='error-recovery-unconfirmed'){
      // The state machine has blocked new sends; remain enabled for recovery
      // if a matching completed assistant response arrives late.
      ui?.updateStatus('Delivery uncertain — waiting for confirmed response');
      record(result.reason,'none');
    }else record(result.reason,'none');
    considerStallRecovery(obs);
    renderBadge(result.reason);
  }
  function renderBadge(reason){
    if(reason!==lastBadgeReason &&
       ['another-tab','web-lock-unavailable','loading-chat','no-conversation',
         'max-reached','conversation-maxed'].includes(reason))
      traceEvent('guard',{reason,leader:isLeader,enabled:cfg.enabled});
    lastBadgeReason=reason;
    if(!ui)return;
    if(!cfg.enabled){
      // Preserve a useful error message from pauseWithError.
      if(reason==='disabled' || !reason)ui.updateStatus('Disabled');
      return;
    }
    const sec=state.dueAt==null?null:Math.max(0,Math.ceil((state.dueAt-Date.now())/1000));
    let message='Armed — waiting for a response';
    if(reason?.startsWith('incident-')){
      // UI copy is user-facing; internal state names belong only in diagnostics.
      const step=reason.slice(9);
      if(/(?:hold|expired|unconfirmed|manual|service-limit)/.test(step))
        message='Paused — recovery could not be confirmed';
      else if(/retry/.test(step))
        message='Retrying the failed response';
      else if(/(?:refresh|reload)/.test(step))
        message='Reconnecting to ChatGPT';
      else if(/stop/.test(step))
        message='Finishing an interrupted response';
      else message='Waiting for ChatGPT to recover';
    }
    else if(reason==='rate-limited')message='Rate limited — waiting';
    else if(reason==='retry-error'||reason==='awaiting-error-recovery')message='Recovering ChatGPT error using Retry';
    else if(reason==='generating'||state.sentPending||state.awaitingResponse)message='Waiting for ChatGPT response';
    else if(reason==='preparing-message')message='Preparing message and waiting for Send';
    else if(reason==='skip-draft')message='Waiting — your draft is not empty';
    else if(reason==='skip-hidden')message='Waiting for background tab to wake';
    else if(reason==='skip-send-disabled')message='Waiting for the ChatGPT composer';
    else if(reason==='send-not-clicked')message='Send button unavailable; retrying in 15s';
    else if(reason==='paused-unconfirmed')message='Delivery uncertain — waiting for verification';
    else if(reason==='conversation-maxed')
      message='Conversation reached maximum length — start a new chat';
    else if(reason==='error-awaiting-retry')message='Waiting for ChatGPT Retry control';
    else if(reason==='connection-interrupted')message='Connection interrupted — waiting for reconnection or safe recovery';
    else if(reason==='stop-interrupted')message='Recovering persistently interrupted response';
    else if(reason==='interruption-recovered')message='Interrupted response released — scheduling continuation';
    else if(reason==='no-conversation')message='Open a saved ChatGPT conversation';
    else if(reason==='loading-chat')message='Loading this conversation settings';
    else if(reason==='another-tab')message='Another ChatGPT tab owns Auto-Continue';
    else if(reason==='web-lock-unavailable')message='Web Locks unavailable: automatic sending paused';
    else if(reason==='max-reached')message='Completed configured follow-ups';
    else if(sec!=null)message='Next follow-up in '+sec+'s';
    else if(reason==='error-backoff')message='Waiting before ChatGPT Retry';
    ui.updateStatus(message);
  }
  function safeTick(){
    try{tick();}
    catch(error){
      traceEvent('watchdog-exception',{errorCode:error?.name||'exception'});
      log?.record('watchdog-exception','none');
      ui?.updateStatus('Watchdog error — will inspect again');
    }
  }
  // DOM changes wake the watchdog without depending only on throttled timers.
  // Burst coalescing avoids repeatedly scanning long chat transcripts.
  let observer=null,observedRoot=null,wakeTimer=null,lastTickAt=0;
  function requestTick(){
    if(wakeTimer!=null)return;
    const minDelay=lastObservedReason==='generating'?1700:550;
    const delay=Math.max(250,minDelay-(Date.now()-lastTickAt));
    wakeTimer=setTimeout(()=>{wakeTimer=null;lastTickAt=Date.now();safeTick();},delay);
  }
  function observeChat(){
    const root=document.querySelector('main,[role="main"]')||document.body;
    if(!root || root===observedRoot)return;
    observer?.disconnect();
    observedRoot=root;
    observer=new MutationObserver(records=>{
      if(records.every(item=>item.target?.closest?.('#chatdesk-auto-continue-controls')))return;
      requestTick();
    });
    observer.observe(root,{
      subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['data-talvt-turn-state','disabled','aria-disabled']
    });
  }
    // bind once at startup; polling also reconnects if React replaces <main>.
  try{observeChat();}catch(error){traceEvent('observe-error',{errorCode:error?.name||'observer'});}
  for(const event of ['pageshow','online','focus','popstate'])
    addEventListener(event,requestTick);
  document.addEventListener('visibilitychange',requestTick);
  addEventListener('pagehide',()=>{
    observer?.disconnect();
    if(wakeTimer!=null)clearTimeout(wakeTimer);
  });
  loadConfig();
  if(window.AutoContinueTrace)setTimeout(()=>
    window.AutoContinueTrace.prune(browser.storage.local).catch(()=>{}),12000);
  setInterval(()=>{
    try{observeChat();}catch(error){traceEvent('observe-error',{errorCode:error?.name||'observer'});}
    lastTickAt=Date.now();safeTick();
  },2500);
  requestTick();
})();