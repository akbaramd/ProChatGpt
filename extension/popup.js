'use strict';
const DEFAULTS = { enabled: false, message: 'ادامه بده', delaySeconds: 3, maxSends: 0 };
const $ = (id) => document.getElementById(id);
let savedTimer = null;

function flash(text) {
  $('saved').textContent = text;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => { $('saved').textContent = ''; }, 1200);
}

const settings=window.ContinueConversationSettings;
let activePath=null;
async function getActivePath(){
  if(!browser.tabs?.query)return null;
  try{
    const [tab]=await browser.tabs.query({active:true,currentWindow:true});
    return settings.pathFrom(tab?.url||'');
  }catch{return null;}
}
async function save() {
  if(!activePath){flash('Open a saved ChatGPT conversation');return;}
  const values={
    enabled:$('enabled').checked,
    message:$('message').value.trim()||DEFAULTS.message,
    delaySeconds:clamp(parseInt($('delaySeconds').value,10),0,3600,DEFAULTS.delaySeconds),
    maxSends:clamp(parseInt($('maxSends').value,10),0,999,DEFAULTS.maxSends)
  };
  try{await settings.save(browser.storage.local,activePath,values);flash('Saved for this chat');}
  catch(error){flash('Could not save: '+error.message);}
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

async function load(){
  activePath=await getActivePath();
  const enabled=!!activePath;
  for(const id of ['enabled','message','delaySeconds','maxSends'])
    $(id).disabled=!enabled;
  if($('chatScope'))$('chatScope').textContent=activePath?
    'Settings for '+activePath.slice(3,11)+'…':'Open a saved ChatGPT conversation';
  const result=activePath?await settings.read(browser.storage.local,activePath):
    {config:DEFAULTS};
  const cfg={...DEFAULTS,...result.config};
  $('enabled').checked=cfg.enabled;
  $('message').value=cfg.message;
  $('delaySeconds').value=cfg.delaySeconds;
  $('maxSends').value=cfg.maxSends;
}

for (const id of ['enabled', 'message', 'delaySeconds', 'maxSends']) {
  $(id).addEventListener('change', save);
}

// ---- Activity & metrics ----------------------------------------------------

const METRIC_ROWS = [
  ['sends', 'Continues sent'],
  ['scheduled', 'Finishes seen'],
  ['retries', 'Resend retries'],
  ['sendUnconfirmed', 'Sends unconfirmed'],
  ['errors', 'Error backoffs'],
  ['rateLimited', 'Rate-limit waits'],
  ['skipsDraft', 'Skipped (draft)'],
  ['skipsHidden', 'Skipped (hidden)'],
  ['skipsSendDisabled', 'Skipped (no Send)'],
  ['maxReached', 'Max reached']
];

const REASON_CLASS = {
  send: 'send', 'send-after-error': 'send', 'retry-send': 'warn',
  'error-backoff': 'warn', 'rate-limited': 'warn', 'send-unconfirmed': 'err', 'send-failed': 'err'
};

async function exportDiagnostics(){
  try{
    const result=await browser.runtime.sendMessage({type:'autoContinue:exportDiagnostics'});
    if(!result?.ok)throw Error('No download confirmation');
    flash('Saved to Downloads/AutoContinue/diagnostics');
  }catch(error){flash('Export failed: '+(error?.name||'error'));}
}
$('exportDiagnostics').addEventListener('click',exportDiagnostics);

function fmtTime(t) {
  const d = new Date(t);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

async function renderActivity() {
  const { logs = [], metrics = {} } = await browser.storage.local.get({ logs: [], metrics: {} });
  const m = $('metrics');
  m.innerHTML = '';
  for (const [key, label] of METRIC_ROWS) {
    const row = document.createElement('div');
    row.innerHTML = '<span>' + label + '</span> <b>' + (metrics[key] || 0) + '</b>';
    m.appendChild(row);
  }
  if (metrics.lastEventAt) {
    const row = document.createElement('div');
    row.style.gridColumn = '1 / -1';
    row.innerHTML = '<span>Last</span> <b>' + (metrics.lastReason || '-') + ' @ ' + fmtTime(metrics.lastEventAt) + '</b>';
    m.appendChild(row);
  }

  const box = $('log');
  box.textContent = '';
  for (const e of logs.slice(-60).reverse()) {
    const line = document.createElement('div');
    const cls = REASON_CLASS[e.reason];
    if (cls) line.className = cls;
    const chat = e.chat ? ' [' + e.chat + ']' : '';
    line.textContent = fmtTime(e.t) + '  ' + e.reason + (e.action === 'send' ? ' →send' : '') + chat;
    box.appendChild(line);
  }
  if (!logs.length) box.textContent = 'No events yet.';
}

$('refresh').addEventListener('click', renderActivity);
$('clear').addEventListener('click', async () => {
  await window.AutoContinueTrace.clearAll(browser.storage.local);
  renderActivity();
  flash('Cleared');
});
$('copy').addEventListener('click', async () => {
  const data = await browser.storage.local.get({ logs: [], metrics: {} });
  try { await navigator.clipboard.writeText(JSON.stringify(data, null, 2)); flash('Copied'); }
  catch (_) { flash('Copy failed'); }
});
$('activity').addEventListener('toggle', (e) => { if (e.target.open) renderActivity(); });

try {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.logs || changes.metrics) && $('activity').open) renderActivity();
  });
} catch (_) { /* ignore */ }

load();