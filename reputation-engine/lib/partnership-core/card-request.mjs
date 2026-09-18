export function requestsDigitalCard(text,previousOutbound=''){
 const s=String(text||'').replace(/^Inbound SMS:\s*/i,'').trim();
 if(/\b(no|not|don't|stop|unsubscribe|email|e-mail|rates?|pricing|prices?|discount|call)\b/i.test(s))return false;
 if(/\b(send|text|share|forward)\b.{0,45}\b(?:digital |business |e[- ]?)?card\b/i.test(s))return true;
 const acceptance=/^(?:(?:hey|hi)[,! ]+)?(?:yes(?: please)?|sure(?: please)?|please do|absolutely|that would be great|sounds good|ok(?:ay)?|✅|👍)[!.\s]*$/i.test(s);
 return acceptance&&/\b(?:digital|business) card\b/i.test(previousOutbound)&&/[?]/.test(previousOutbound)&&!/\[MMS:/i.test(previousOutbound);
}
