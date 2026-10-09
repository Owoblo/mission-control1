import {createHash} from 'node:crypto';
import {SESv2Client,GetAccountCommand} from '@aws-sdk/client-sesv2';
import {serviceLocations,activeLocations} from './markets.mjs';
import {isOttawa,ottawaActionAllowed} from './ottawa.mjs';
import {openZohoMailbox} from './zoho.mjs';
import {validSignalReview} from './signal-review.mjs';
const normalize=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const cities=new Set(serviceLocations.map(normalize));
/** Server-only adapter. Never accept evidence flags from an HTTP request body. */
export async function reserveAction({url,headers,contactId,channel,kind='cold_introduction',key,content,sender,emailProvider=''}){
 const response=await fetch(`${url}/rest/v1/market_contacts?${new URLSearchParams({id:'eq.'+contactId,select:'*'})}`,{headers,cache:'no-store'});
 if(!response.ok)throw Error('Policy contact lookup failed');
 const [contact]=await response.json();if(!contact)throw Error('Policy contact missing');
 const serviceAvailable=cities.has(normalize(contact.city))||isOttawa(contact.city);
 let reviewedSignal=false;
 if(kind==='cold_introduction'&&channel==='email'){
  const reviewResponse=await fetch(`${url}/rest/v1/partnership_policy_events?${new URLSearchParams({event_key:'eq.signal-review:'+key,select:'*'})}`,{headers,cache:'no-store'});
  if(!reviewResponse.ok)throw Error('Signal review lookup failed');
  const [review]=await reviewResponse.json();
  reviewedSignal=validSignalReview(review,{key,accountId:contact.partner_company_id,contactId,channel,recipient:contact.email,sender,content});
 }
 const ottawaAllowed=ottawaActionAllowed({city:contact.city,kind,channel,sender,reviewedSignal});
 // Explicit workflow provider takes precedence; legacy sender-specific routes remain unchanged.
 const provider=emailProvider||(isOttawa(contact.city)?'zoho':'ses');
 if(channel==='email'&&!['ses','zoho'].includes(provider))throw Error('Unknown email provider');
 let senderHealthy=false;
 if(channel==='email'&&provider==='zoho'){
  if(ottawaAllowed){await openZohoMailbox('ottawa');senderHealthy=true;}
 }else if(channel==='email'&&provider==='ses'){
  const health=await new SESv2Client({region:process.env.AWS_REGION||process.env.AWS_DEFAULT_REGION||'ca-central-1',maxAttempts:1}).send(new GetAccountCommand({}));
  senderHealthy=health.SendingEnabled===true&&health.ProductionAccessEnabled===true&&health.EnforcementStatus==='HEALTHY';
 }else if((channel==='sms'||channel==='phone')&&['+14377823004','+14374650584'].includes(sender)){
  const key=process.env.TELNYX_API_KEY;
  if(key){const health=await fetch('https://api.telnyx.com/v2/phone_numbers?'+new URLSearchParams({'filter[phone_number]':sender}),{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(10000)});if(health.ok)senderHealthy=((await health.json()).data||[]).some(n=>n.phone_number===sender&&n.status==='active'&&(channel==='sms'?!!n.messaging_profile_id:!!n.connection_id));}
 }else if(channel==='sms'||channel==='phone'){
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  if(sid&&token){const health=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')},signal:AbortSignal.timeout(10000)});if(health.ok)senderHealthy=(await health.json()).status==='active';}
 }else if(channel==='direct_mail')senderHealthy=true;
 const channelEligible=channel==='email'?!!contact.email&&!contact.email_unsubscribed_at&&!['bounced','complained','unsubscribed'].includes(contact.email_status):channel==='sms'||channel==='phone'?!!contact.phone&&!contact.do_not_contact:channel==='direct_mail'&&!!(contact.address||contact.mailing_address);
 const evidence={observedAt:new Date().toISOString(),marketActive:isOttawa(contact.city)?ottawaAllowed:activeLocations.some(city=>normalize(city)===normalize(contact.city)),serviceAvailable,channelEligible,senderHealthy,sender,contentHash:createHash('sha256').update(content||'').digest('hex')};
 const r=await fetch(`${url}/rest/v1/rpc/reserve_partnership_action`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p_contact_id:contactId,p_channel:channel,p_kind:kind,p_action_key:key,p_evidence:evidence}),cache:'no-store'});
 if(!r.ok)throw Error('Policy reservation unavailable ('+r.status+')');
 const result=await r.json();if(!result.allowed)throw Error('Partnership policy hold: '+result.reasons.join(', '));return result;
}
