// Pure logic + DOM detectors for the Auto-Continue watchdog.
// decide() is a pure state machine: content.js reads the page into `obs`, calls
// decide(), performs the returned action through the normal chat UI, and records
// the returned `reason` for logging/metrics. No network calls, no API, no
// rate-limit bypass — when ChatGPT is limited the machine waits and logs it.
(function (global) {
  'use strict';

  // ---- DOM detectors (the only ChatGPT-markup-specific part) -----------------

  function visibleEl(el) {
    if(!el || el.isConnected===false || el.closest?.('[hidden],[inert],[aria-hidden="true"]'))
      return false;
    const style=el.ownerDocument?.defaultView?.getComputedStyle?.(el);
    if(style && (style.display==='none' || style.visibility==='hidden' ||
       style.visibility==='collapse'))return false;
    return Boolean(el.getClientRects?.().length || el.offsetParent !== null);
  }
  const interruptedCache=new WeakMap();
  const maxLengthCache=new WeakMap();

  // Support search-unit, legacy message and section[data-turn] DOM families.
  function turnNodes(doc) {
    const selectors=[
      '[data-chatgpt-search-unit-key$=":user"],[data-chatgpt-search-unit-key$=":assistant"]',
      '[data-message-author-role="user"],[data-message-author-role="assistant"]',
      'section[data-turn="user"],section[data-turn="assistant"]'
    ];
    let chosen=[],latest=null;
    for(const selector of selectors){
      const matches=[...doc.querySelectorAll(selector)];
      const candidate=matches.at(-1);
      if(!candidate)continue;
      // A page can contain old and new turn families during rollout.
      // Follow whichever family has the latest message in document order.
      if(!latest || (latest.compareDocumentPosition?.(candidate)&4)){
        chosen=matches;latest=candidate;
      }
    }
    return chosen;
  }
  function roleOf(el) {
    const key=el.getAttribute('data-chatgpt-search-unit-key')||'';
    if(key.endsWith(':assistant'))return 'assistant';
    if(key.endsWith(':user'))return 'user';
    return el.getAttribute('data-message-author-role')||el.getAttribute('data-turn')||null;
  }
  function messageKey(el,nodes) {
    const key=el.getAttribute('data-chatgpt-search-unit-key');
    if(key)return key;
    const id=el.getAttribute('data-message-id')||el.getAttribute('data-turn-key')||
      el.closest('[data-turn-key]')?.getAttribute('data-turn-key')||el.getAttribute('id');
    if(id)return roleOf(el)+':'+id;
    const body=el.querySelector('.markdown,.prose,[data-markdown-text-style]');
    const text=((body||el).textContent||'').trim().slice(-500);
    let hash=2166136261;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    return roleOf(el)+':fallback:'+nodes.length+':'+(hash>>>0).toString(16);
  }
  function lastVisibleTurn(doc) {
    const nodes=turnNodes(doc),last=nodes.at(-1);
    if(!last)return null;
    const wrapper=last.closest('[data-talvt-turn-state]');
    return {
      role:roleOf(last),key:messageKey(last,nodes),
      text:(last.textContent||'').trim().slice(-6000),
      length:(last.textContent||'').replace(
        /Connection interrupted\.\s*Waiting for the complete answer\.?/gi,''
      ).trim().length,
      complete:wrapper?.getAttribute('data-talvt-turn-state')==='complete',
      turnState:wrapper?.getAttribute('data-talvt-turn-state')||null
    };
  }
  function lastCompletedAssistant(doc,knownLast) {
    const last=knownLast||lastVisibleTurn(doc);
    return last?.role==='assistant' && last.complete && last.text?last.key:null;
  }

  function stopButton(doc) {
    return [...doc.querySelectorAll(
      'button[data-testid="stop-button"],button[aria-label="Stop generating"],' +
      'button[aria-label="Stop streaming"],button[aria-label="Stop"]'
    )].find(el=>visibleEl(el)&&!el.disabled)||null;
  }
  function detectGenerating(doc,knownLast) {
    // Only the latest assistant and current Stop control indicate generation.
    const last=knownLast||lastVisibleTurn(doc);
    if(last?.role==='assistant' && last.complete)return false;
    return Boolean(stopButton(doc)) ||
      (last?.role==='assistant' && last.turnState==='in_progress');
  }

  const EDITORS='#prompt-textarea,textarea[name="prompt-textarea"],' +
    'textarea#mobile-composer-prompt,textarea[data-testid="prompt-textarea"],' +
    '[contenteditable="true"][role="textbox"],[contenteditable="true"][data-lexical-editor="true"]';
  const SEND_BUTTONS='button[data-testid="send-button"],button[data-testid="composer-send-button"],' +
    'button#composer-submit-button,button[aria-label="Send prompt"],' +
    'button[aria-label="Send message"],button[aria-label="Send Message"],' +
    'button[aria-label="Send"]';
  function composerEditor(doc) {
    const editors=[...doc.querySelectorAll(EDITORS)];
    // Prefer the active editor, not a hidden or detached previous instance.
    return editors.find(visibleEl)||editors.find(e=>e.isConnected!==false)||null;
  }
  function normalizeComposerText(value) {
    return String(value||'').replace(/[\u200b-\u200d\u2060\ufeff]/g,'')
      .replace(/\u00a0/g,' ').replace(/\r\n?/g,'\n').trim();
  }
  function editorText(editor) {
    if(!editor)return '';
    const raw=/^(TEXTAREA|INPUT)$/.test(editor.tagName||'')?editor.value:
      (editor.innerText||editor.textContent||'');
    return normalizeComposerText(raw);
  }
  function composerEmpty(doc) {
    const editor=composerEditor(doc);
    return Boolean(editor && !editorText(editor));
  }
  function sendButton(doc) {
    const editor=composerEditor(doc),form=editor?.closest('form');
    const selector=SEND_BUTTONS+',button[type="submit"]';
    const eligible=button=>visibleEl(button) &&
      !/^(?:start voice|voice|stop|attach|record)$/i.test(
        (button.getAttribute('aria-label')||'').trim());
    // A stale Send elsewhere on the page must not win over the active form.
    const local=form?[...form.querySelectorAll(selector)].filter(eligible):[];
    const candidates=local.length?local:
      [...doc.querySelectorAll(SEND_BUTTONS)].filter(eligible);
    return candidates.find(b=>!b.disabled && b.getAttribute('aria-disabled')!=='true')||
      candidates[0]||null;
  }

  function canSend(doc) {
    // ChatGPT intentionally disables/hides Send while the composer is empty.
    // An empty composer is ready for *preparing* a message; the Send button
    // must be checked only AFTER inserting that message.
    return Boolean(composerEditor(doc));
  }

  function historicalStatus(el,doc) {
    const last=turnNodes(doc).at(-1);
    if(!last)return false;
    const lastWrapper=last.closest('[data-talvt-turn-state]');
    const statusWrapper=el.closest?.('[data-talvt-turn-state]');
    if(statusWrapper && lastWrapper && statusWrapper!==lastWrapper)return true;
    // Ignore a stale error banner before the latest message; current
    // floating dialogs and alerts after the message still count.
    if(!statusWrapper && !el.closest?.('[role="dialog"]') &&
       !el.contains?.(last) &&
       (el.compareDocumentPosition?.(last)&4))return true;
    return false;
  }
  function textOf(doc, selector, currentOnly=false) {
    return [...doc.querySelectorAll(selector)].slice(-40)
      .filter(el=>visibleEl(el) && (!currentOnly || !historicalStatus(el,doc)))
      .map(el=>(el.textContent||el.innerText||'').trim().slice(-1500))
      .join(' \n ');
  }

  // Usage/rate-limit notices -> back off, never send into a wall.
  function detectRateLimited(doc) {
    const text = textOf(doc,
      '[role="alert"],[data-testid*="limit"],.text-token-text-error',true);
    return /(rate limit|too many requests|usage limit|reached your limit|please wait|try again later|محدودیت|بیش از حد)/i.test(text);
  }

  // Generation errors ("something went wrong", network error, Regenerate prompt).
  function detectErrorBanner(doc) {
    const text = textOf(doc,
      '[role="alert"],.text-token-text-error,[data-testid*="error"]',true);
    if (/(rate limit|usage limit|محدودیت)/i.test(text)) return false; // that's rate-limit, handled apart
    return Boolean(retryButton(doc)) ||
      /(something went wrong|error in input stream|message delivery timed out|delivery timed out|error generating|network error|an error occurred|regenerate|خطا|مشکلی پیش آمد)/i.test(text);
  }

  function retryButton(doc) {
    const buttons=[...doc.querySelectorAll('button')].slice(-80)
      .filter(el=>visibleEl(el) && !historicalStatus(el,doc));
    return buttons.find(btn=>{
      const name=(btn.getAttribute('aria-label')||btn.textContent||'').trim();
      if(!/^(retry|try again)$/i.test(name))return false;
      let ancestor=btn.parentElement;
      for(let i=0;i<6&&ancestor;i++,ancestor=ancestor.parentElement) {
        const content=(ancestor.textContent||ancestor.innerText||'').trim();
        if(content.length>1100)break;
        if(/error in input stream|message delivery timed out|delivery timed out|something went wrong|network error|an error occurred/i.test(content))return true;
      }
      return false;
    })||null;
  }

  function detectInterrupted(doc,force=false) {
    const now=Date.now();
    const cached=interruptedCache.get(doc);
    if(!force && cached && now-cached.at<6000)return cached.value;
    const latest=turnNodes(doc).filter(el=>roleOf(el)==='assistant').at(-1);
    const container=latest?.closest('[data-talvt-turn-state]')||latest;
    const matches=el=>{
      if(el.children.length>1)return false;
      const v=(el.textContent||'').trim().replace(/\s+/g,' ');
      return /^Connection interrupted\. Waiting for the complete answer\.?$/i.test(v) &&
        Boolean(el.getClientRects?.().length);
    };
    if(container && [...container.querySelectorAll('div,p,span,[role="alert"]')].some(matches)){
      interruptedCache.set(doc,{at:now,value:true});
      return true;
    }
    const root=doc.querySelector?.('main,[role="main"]')||doc;
    const value=[...root.querySelectorAll('div,p,span,[role="alert"]')].slice(-160)
      .some(el=>matches(el) && !historicalStatus(el,doc));
    interruptedCache.set(doc,{at:now,value});
    return value;
  }

  function detectConversationMaxed(doc) {
    const now=Date.now();
    const cached=maxLengthCache.get(doc);
    if(cached && now-cached.at<5000)return cached.value;
    const root=doc.querySelector?.('main,[role="main"]')||doc;
    const tail=[...root.querySelectorAll('div,p,span,[role="alert"]')].slice(-240);
    const value=tail.some(el=>{
      if(!visibleEl(el))return false;
      const msg=(el.textContent||'').trim().replace(/\s+/g,' ');
      return msg.length<450 &&
        /maximum length for this conversation/i.test(msg);
    });
    maxLengthCache.set(doc,{at:now,value});
    return value;
  }

  function observe(doc, win) {
    const last=lastVisibleTurn(doc);
    return {
      generating: detectGenerating(doc,last),
      completedAssistantKey: lastCompletedAssistant(doc,last),
      latestTurnKey:last?.key||null,
      latestTurnRole:last?.role||null,
      latestAssistantKey:last?.role==='assistant'?last.key:null,
      latestAssistantText:last?.role==='assistant'?last.text:'',
      latestAssistantLength:last?.role==='assistant'?last.length:0,
      latestTurnComplete:!!last?.complete,
      visible: (doc.visibilityState || (win && win.document && win.document.visibilityState)) === 'visible',
      composerEmpty: composerEmpty(doc),
      canSend: canSend(doc),
      errorBanner: detectErrorBanner(doc),
      retryAvailable: Boolean(retryButton(doc)),
      rateLimited: detectRateLimited(doc),
      connectionInterrupted:detectInterrupted(doc),
      conversationMaxed:detectConversationMaxed(doc),
      hasStopButton:Boolean(stopButton(doc))
    };
  }

  // ---- Pure state machine ----------------------------------------------------

  const DEFAULT_CFG = {
    enabled: false,
    delayMs: 3000,
    maxSends: 0,          // 0 = unlimited
    maxRetries: 2,        // re-send attempts when a send didn't start generating
    errorBackoffMs: 8000, // wait after an error banner before retrying
    rateCooldownMs: 60000,// wait after a rate-limit notice before re-checking
    verifyWindowMs: 6000,
    interruptWaitMs: 45000,
    interruptStableMs: 30000
  };

  function initialState() {
    return { wasGenerating: false, dueAt: null, verifyAt: null, sentPending: false, retries: 0,
      sends: 0, blocked: false, awaitingResponse: false,
      errorRetryAttempted: false, errorRecoveryAt: null,
      lastScheduledCompletedKey: null, awaitingResponseSince: null, lastProgressAt:null,
      interruptedSince:null, interruptionStopAttempted:false,
      interruptionDismissed:false };
  }

  // Reasons that repeat every idle tick; content.js keeps them out of the log.
  const QUIET_REASONS = new Set(['armed', 'waiting', 'generating', 'awaiting-generation',
    'awaiting-response', 'awaiting-error-recovery', 'paused-unconfirmed',
    'error-awaiting-retry', 'connection-interrupted', 'interruption-recovered',
    'conversation-maxed','disabled']);

  function decide(prev, obs, cfg, now) {
    const c = { ...DEFAULT_CFG, ...cfg };
    const s = { ...prev };
    const done = (action, reason) => ({ state: s, action, reason });

    const justFinished = s.wasGenerating && !obs.generating;
    s.wasGenerating = obs.generating;

    if (!c.enabled) {
      return { state: { ...initialState(), wasGenerating: obs.generating }, action: 'none', reason: 'disabled' };
    }

    // A hard ChatGPT conversation limit is terminal for this conversation.
    if(obs.conversationMaxed){
      s.blocked=true;s.sentPending=false;s.verifyAt=null;
      s.awaitingResponse=false;s.dueAt=null;
      return done('none','conversation-maxed');
    }

    if(obs.connectionInterrupted && !obs.retryAvailable){
      if(s.interruptedSince==null)s.interruptedSince=now;
      // Stop may disappear by itself while the warning remains.
      if(!s.interruptionStopAttempted && !obs.hasStopButton &&
         !s.interruptionDismissed && !obs.rateLimited &&
         obs.latestAssistantKey && obs.latestAssistantText &&
         (obs.answerStableMs||0)>=c.interruptStableMs){
        s.interruptionDismissed=true;s.interruptedSince=null;
        s.sentPending=false;s.verifyAt=null;s.awaitingResponse=false;
        s.awaitingResponseSince=null;s.dueAt=now+c.delayMs;
        return done('none','interruption-recovered');
      }
      // Reschedule only once, after the first-party Stop control disappears.
      if(s.interruptionStopAttempted && !obs.hasStopButton &&
         (obs.answerStableMs||0)>=c.interruptStableMs &&
         !s.interruptionDismissed){
        s.interruptedSince=null; s.interruptionDismissed=true;
        s.sentPending=false;s.verifyAt=null;s.awaitingResponse=false;
        s.awaitingResponseSince=null;s.dueAt=now+c.delayMs;
        return done('none','interruption-recovered');
      }
      // Only release Stop after sustained explicit interruption AND no
      // answer progress. Do not interrupt normal long thinking.
      if(!s.interruptionStopAttempted && !s.interruptionDismissed &&
         now-s.interruptedSince>=c.interruptWaitMs &&
         (obs.answerStableMs||0)>=c.interruptStableMs &&
         obs.hasStopButton && !obs.rateLimited &&
         obs.latestAssistantKey && obs.latestAssistantText){
        s.interruptionStopAttempted=true;
        return done('stop-interrupted','stop-interrupted');
      }
      if(!s.interruptionDismissed)return done('none','connection-interrupted');
    }else if(!obs.connectionInterrupted){
      s.interruptedSince=null;s.interruptionDismissed=false;
      s.interruptionStopAttempted=false;
    }

    // A send we issued has begun generating -> confirmed.
    if (s.sentPending && (obs.generating || obs.sentConfirmed)) {
      s.sentPending=false; s.verifyAt=null; s.retries=0;
      s.awaitingResponse=true;
      if(s.awaitingResponseSince==null)s.awaitingResponseSince=now;
      if (!obs.generating && obs.responseCompleted) {
        s.awaitingResponse=false; s.awaitingResponseSince=null; s.dueAt=now+c.delayMs;
        if(obs.completedAssistantKey)s.lastScheduledCompletedKey=obs.completedAssistantKey;
        return done('none','scheduled');
      }
    }

    if (obs.generating && !s.interruptionDismissed) {
      s.dueAt = null;
      return done('none','generating');
    }

    // Idle from here on.
    if (s.blocked && obs.errorBanner && obs.retryAvailable) {
      // A failed response can now be retried through the first-party control;
      // this never submits the user prompt again.
      s.blocked=false;
      s.sentPending=false;
      s.dueAt=now+c.errorBackoffMs;
    }
    if (s.blocked) {
      // The ambiguous send may have succeeded after a delayed network ack.
      // Only a NEW completed assistant turn safely resumes the scheduler.
      if(obs.completedAssistantKey && obs.completedAssistantKey!==s.lastScheduledCompletedKey &&
         !obs.errorBanner && !obs.generating){
        s.blocked=false; s.awaitingResponse=false; s.awaitingResponseSince=null;
        s.lastScheduledCompletedKey=obs.completedAssistantKey;
        s.dueAt=now+c.delayMs;
        return done('none','recovered-confirmed-response');
      }
      return done('none','paused-unconfirmed');
    }
    if (obs.rateLimited) {
      s.sentPending = false; s.verifyAt = null; s.awaitingResponse=false;
      s.dueAt = now + c.rateCooldownMs;
      return done('none', 'rate-limited');
    }

    if (!obs.errorBanner && s.errorRetryAttempted) {
      s.errorRetryAttempted=false; s.errorRecoveryAt=null;
      if(obs.completedAssistantKey &&
         obs.completedAssistantKey!==s.lastScheduledCompletedKey){
        s.lastScheduledCompletedKey=obs.completedAssistantKey;
        s.awaitingResponse=false; s.awaitingResponseSince=null;
        s.dueAt=now+c.delayMs;
        return done('none','scheduled');
      }
      // Removal of a delivery-error banner is NOT proof that the retried
      // assistant finished. Wait for the terminal response first.
      s.awaitingResponse=true;
      if(s.awaitingResponseSince==null)s.awaitingResponseSince=now;
      return done('none','awaiting-response');
    }
    if (obs.errorBanner && !obs.retryAvailable && !s.interruptionDismissed) {
      // A visible delivery failure is not permission to submit another
      // user prompt. Reinspect while waiting for ChatGPT's Retry control.
      s.dueAt=now+c.errorBackoffMs;
      return done('none','error-awaiting-retry');
    }
    if (obs.errorBanner && obs.retryAvailable) {
      // Recover the currently failed response via the first-party Retry UI,
      // not by submitting a second "continue" prompt.
      if (!s.errorRetryAttempted) {
        if (s.dueAt==null) {
          s.dueAt=now+c.errorBackoffMs;
          return done('none','error-backoff');
        }
        if (now<s.dueAt)return done('none','waiting');
        s.errorRetryAttempted=true;
        s.errorRecoveryAt=now+c.verifyWindowMs*2;
        s.dueAt=null; s.sentPending=false; s.verifyAt=null;
        return done('retry-error','retry-error');
      }
      if (now>=(s.errorRecoveryAt||0)) {
        s.blocked=true;
        return done('none','error-recovery-unconfirmed');
      }
      return done('none','awaiting-error-recovery');
    }

    // A previous send that never started generating.
    if (s.sentPending) {
      if (now >= (s.verifyAt || 0)) {
        // Never resend a prompt whose delivery was not confirmed: the
        // original user turn might have been accepted despite a fast reply.
        s.sentPending = false; s.verifyAt = null; s.retries = 0; s.blocked=true;
        return done('none', 'send-unconfirmed');
      }
      return done('none', 'awaiting-generation');
    }

    // For fast replies we may miss the intermediate Stop button entirely.
    // A confirmed user turn is not permission to send again until a new
    // assistant response is known to have finished.
    if(s.awaitingResponse && (obs.responseCompleted ||
      (obs.completedAssistantKey &&
       obs.completedAssistantKey!==s.lastScheduledCompletedKey))) {
      s.awaitingResponse=false;
      s.awaitingResponseSince=null;
      s.dueAt=now+c.delayMs;
      if(obs.completedAssistantKey)s.lastScheduledCompletedKey=obs.completedAssistantKey;
      return done('none','scheduled');
    }
    if(s.awaitingResponse && !justFinished){
      // Unlike the original implementation, this state is observable and
      // can recover when a new terminal assistant is detected later.
      return done('none','awaiting-response');
    }
    // A completed turn is authoritative, including when the extension was
    // enabled after the answer had already finished.
    if(obs.completedAssistantKey && !obs.errorBanner &&
        s.lastScheduledCompletedKey!==obs.completedAssistantKey) {
      s.lastScheduledCompletedKey=obs.completedAssistantKey;
      if(s.dueAt==null)s.dueAt=now+c.delayMs;
      return done('none','scheduled');
    }
    // Schedule: on a finished answer, or on a lingering error banner.
    if (justFinished && s.dueAt == null) {
      s.awaitingResponse=false; s.awaitingResponseSince=null; s.dueAt = now + c.delayMs;
      if(obs.completedAssistantKey)s.lastScheduledCompletedKey=obs.completedAssistantKey;
      return done('none', 'scheduled');
    }
    if (obs.errorBanner && s.dueAt == null) { s.dueAt = now + c.errorBackoffMs; return done('none', 'error-backoff'); }

    if (s.dueAt == null) return done('none', 'armed');
    if (now < s.dueAt) return done('none', 'waiting');

    // Due now.
    if (c.maxSends > 0 && s.sends >= c.maxSends) { s.dueAt = null; return done('none', 'max-reached'); }
    // Firefox may throttle the polling interval while this tab is hidden.
    // Continue when it wakes; explicit user enablement permits background use.
    // Never bypass rate limits, a pending response or an unsent user draft.
    if (!obs.composerEmpty) return done('none', 'skip-draft');
    if (!obs.canSend) return done('none', 'skip-send-disabled');

    if(obs.completedAssistantKey && !s.lastScheduledCompletedKey)
      s.lastScheduledCompletedKey=obs.completedAssistantKey;
    s.sends += 1; s.dueAt = null; s.sentPending = true; s.verifyAt = now + c.verifyWindowMs; s.retries = 0;
    return done('send', obs.errorBanner ? 'send-after-error' : 'send');
  }

  // ---- Metrics (pure) --------------------------------------------------------

  const REASON_METRIC = {
    scheduled: 'scheduled',
    send: 'sends',
    'send-after-error': 'sends',
    'retry-error': 'retries',
    'retry-send': 'retries',
    'send-unconfirmed': 'sendUnconfirmed',
    'error-recovery-unconfirmed': 'errors',
    'error-awaiting-retry':'errors',
    'recovered-confirmed-response':'scheduled',
    'rate-limited': 'rateLimited',
    'error-backoff': 'errors',
    'skip-draft': 'skipsDraft',
    'skip-hidden': 'skipsHidden',
    'skip-send-disabled': 'skipsSendDisabled',
    'max-reached': 'maxReached'
  };

  function metricKeyForReason(reason) {
    return REASON_METRIC[reason] || null;
  }

  function bumpMetrics(metrics, reason, now) {
    const next = { ...(metrics || {}) };
    const key = metricKeyForReason(reason);
    if (key) next[key] = (next[key] || 0) + 1;
    next.lastReason = reason;
    if (now != null) next.lastEventAt = now;
    return next;
  }

  function appendLog(logs, entry, cap) {
    const out = Array.isArray(logs) ? [...logs, entry] : [entry];
    const limit = cap || 200;
    return out.length > limit ? out.slice(out.length - limit) : out;
  }

  const api = {
    turnNodes,roleOf,messageKey,detectGenerating, composerEmpty, editorText, normalizeComposerText, sendButton, canSend, composerEditor,
    detectRateLimited, detectErrorBanner, detectInterrupted,detectConversationMaxed,
    retryButton, stopButton,
    lastVisibleTurn, lastCompletedAssistant, observe,
    decide, initialState, DEFAULT_CFG, QUIET_REASONS,
    metricKeyForReason, bumpMetrics, appendLog
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.ContinueWatchdog = api;
})(typeof window !== 'undefined' ? window : globalThis);