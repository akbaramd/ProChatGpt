// Thin persistence layer for logs + metrics over browser.storage.local, built
// on the pure helpers in watchdog-core (appendLog / bumpMetrics). Best-effort:
// writes are async and may interleave across tabs; the log is a capped ring.
// Never stores message text or tokens — only reasons, counts and a short
// conversation id, so saved scenarios are safe to review and export.
(function (global) {
  'use strict';
  const core = global.ContinueWatchdog || (typeof require !== 'undefined' ? require('./watchdog-core.js') : null);
  const LOG_CAP = 200;
  const KEYS = { logs: 'logs', metrics: 'metrics' };
  let queue=Promise.resolve();
  let lastWriteError=null;

  function store() {
    try { return global.browser && global.browser.storage && global.browser.storage.local; }
    catch (_) { return null; }
  }

  function conversationId(url) {
    try {
      const m = new URL(url).pathname.match(/\/c\/([0-9a-f-]{8,})/i);
      return m ? m[1].slice(0, 8) : null;
    } catch (_) { return null; }
  }

  function record(reason, action, extra) {
    // Serializing writes prevents rapid callbacks from losing earlier
    // read-modify-write log entries in browser.storage.local.
    const entry = {
      t: Date.now(), reason, action:action||'none',
      chat:conversationId(global.location ? global.location.href : ''),
      ...extra
    };
    queue=queue.catch(()=>{}).then(async()=>{
      const local=store();
      if(!local)throw Error('Firefox extension storage unavailable');
      const cur=await local.get({[KEYS.logs]:[],[KEYS.metrics]:{}});
      await local.set({
        [KEYS.logs]:core.appendLog(cur[KEYS.logs],entry,LOG_CAP),
        [KEYS.metrics]:core.bumpMetrics(cur[KEYS.metrics],reason,entry.t)
      });
      lastWriteError=null;
      return true;
    }).catch(error=>{
      lastWriteError=String(error?.message||error);
      return false;
    });
    return queue;
  }

  async function read() {
    const local = store();
    if (!local) return { logs: [], metrics: {} };
    try {
      await queue;
      return {...await local.get({[KEYS.logs]:[],[KEYS.metrics]:{}}),
        storageError:lastWriteError};
    } catch(error) { return { logs: [], metrics: {}, storageError:String(error) }; }
  }

  async function clear() {
    const local = store();
    if (!local) return;
    try {
      await queue;
      await local.set({ [KEYS.logs]: [], [KEYS.metrics]: {} });
    } catch(error){lastWriteError=String(error);}

  }

  const api = { record, read, clear, conversationId, LOG_CAP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WatchdogStore = api;
})(typeof window !== 'undefined' ? window : globalThis);