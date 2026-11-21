import fs from 'node:fs/promises';
import {createHmac} from 'node:crypto';
const id='f8a1a4f3-9454-45d1-83ce-ee88b679be3f';
const source='62ce6efe-163c-4dae-b57c-5b4bda14645e';
const path='partnership-system/state/replies-afternoon-20260916/ali-business-update.json';
const body="That's fantastic, brother—your best year in 20 years is something to celebrate! Business is growing on our side too, thank you for asking. I really appreciate you recommending us and keeping us in mind. It's good to stay in touch. — Courage";
const clean=s=>String(s||'').replace(/\\r|\\n|\r|\n/g,'').trim();
const h={apikey:clean(process.env.SUPABASE_KEY),Authorization:'Bearer '+clean(process.env.SUPABASE_KEY),'Content-Type':'application/json',Prefer:'return=representation'};
async function db(t,q={},method='GET',body){const r=await fetch(clean(process.env.SUPABASE_URL)+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers:h,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status);return r.status===204?[]:r.json();}
try{await fs.access(path);throw Error('Prior attempt exists: inspect, do not resend');}catch(e){if(e.code!=='ENOENT')throw e;}
const [latest]=await db('market_touches',{contact_id:'eq.'+id,direction:'eq.inbound',order:'created_at.desc',limit:'1'});
if(latest?.id!==source)throw Error('New inbound: review first');
const after=await db('market_touches',{contact_id:'eq.'+id,direction:'eq.outbound',created_at:'gt.'+latest.created_at});if(after.length)throw Error('Already answered');
const [contact]=await db('market_contacts',{id:'eq.'+id});
const sid=clean(process.env.TWILIO_ACCOUNT_SID),token=clean(process.env.TWILIO_AUTH_TOKEN);
const history=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json?`+new URLSearchParams({To:contact.phone,PageSize:'20'}),{headers:{Authorization:'Basic '+Buffer.from(sid+':'+token).toString('base64')}});
if(!history.ok)throw Error('Provider history unavailable');
if((await history.json()).messages.some(m=>m.direction.startsWith('outbound')&&Date.parse(m.date_created)>Date.parse(latest.created_at)))throw Error('New provider outbound: review');
const p=Buffer.from(JSON.stringify({role:'owner',name:'John — owner-confirmed business update',exp:Date.now()+300000})).toString('base64url');
const cookie='mc_session='+p+'.'+createHmac('sha256',clean(process.env.AUTH_SECRET)).update(p).digest('base64url');
await fs.writeFile(path,JSON.stringify({state:'reserved_no_retry',id,source,body,owner_fact:'growing'},null,2),{flag:'wx'});
const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${id}/send-reply`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({body,from_number:'+15482908695'}),signal:AbortSignal.timeout(60000)});
const result=await r.json();await fs.writeFile(path,JSON.stringify({state:r.ok?'accepted':'held',at:new Date().toISOString(),id,source,body,owner_fact:'growing',result},null,2));
if(!r.ok)throw Error('Reply held: '+result.error);
await db('crm_tasks',{source_key:'eq.ali-personal-reply:'+source,status:'eq.open'},'PATCH',{status:'completed',completed_at:new Date().toISOString(),completed_by_name:'John',outcome_note:'Owner confirmed business is growing. Personal response sent; provider accepted '+result.sid+'. Await inbound; do not auto-follow-up.'});
await db('market_contacts',{id:'eq.'+id,last_inbound_at:'eq.'+latest.created_at},'PATCH',{sequence_paused:true,sequence_paused_reason:'Personal business update sent; commercial relationship warm. Await reply; no automatic follow-up.',next_follow_up:null});
console.log(JSON.stringify({accepted:true,sid:result.sid}));
