'use strict';

/**
 * Detect only a visible ChatGPT delivery-error banner with a nearby Retry
 * button. Neither a user quoting "timed out" nor a historical answer counts.
 */
const ERROR_RE=/message delivery timed out|delivery timed out|request timed out|something went wrong|network error|failed to (?:send|deliver)/i;
const TIMEOUT_RE=/message delivery timed out|delivery timed out|request timed out|timed out/i;
const RATE_RE=/too many requests|rate limit|usage limit/i;

async function inspectDeliveryError(page) {
 return page.evaluate(({errorSource,timeoutSource,rateSource})=>{
  const errorRe=new RegExp(errorSource,'i');
  const timeoutRe=new RegExp(timeoutSource,'i');
  const rateRe=new RegExp(rateSource,'i');
  const visible=el=>Boolean(el && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden');
  const candidates=[...document.querySelectorAll('button')].filter(el=>
    visible(el) && /^(retry|try again)$/i.test((el.innerText||el.getAttribute('aria-label')||'').trim()));
  for(const button of candidates){
   let ancestor=button.parentElement;
   for(let i=0;ancestor && i<7;i++,ancestor=ancestor.parentElement){
    const message=(ancestor.innerText||'').trim().replace(/\s+/g,' ');
    if(message.length>1200)break;
    if(!errorRe.test(message) && !rateRe.test(message))continue;
    const raw=message.replace(/\b(?:Retry|Try again)\s*$/i,'').trim().slice(0,350);
    return {
      kind:rateRe.test(raw)?'rate_limited':timeoutRe.test(raw)?'delivery_timeout':'delivery_error',
      message:raw||'Message delivery timed out. Please try again.',
      canRetry:true
    };
   }
  }
  return null;
 },{errorSource:ERROR_RE.source,timeoutSource:TIMEOUT_RE.source,rateSource:RATE_RE.source});
}

async function clickDeliveryRetry(page) {
 const failure=await inspectDeliveryError(page);
 if(!failure?.canRetry)throw Error('ChatGPT Retry button is not available');
 const button=page.getByRole('button',{name:/^(Retry|Try again)$/i}).filter({visible:true}).last();
 await button.click({timeout:4500});
 return failure;
}

module.exports={inspectDeliveryError,clickDeliveryRetry};
