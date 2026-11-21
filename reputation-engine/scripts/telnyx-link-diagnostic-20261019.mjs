import {fs,db} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
async function get(path){const r=await fetch('https://api.telnyx.com/v2/'+path,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(20000)});const j=await r.json();return {status:r.status,data:j.data,errors:j.errors};}
const out={at:new Date().toISOString()};
const [p,n]=await Promise.all([get('messaging_profiles/4001a0df-3221-42e3-a516-6eff54aa435c'),get('messaging_phone_numbers/+14374650584')]);
out.profile={http:p.status,...Object.fromEntries(['id','name','enabled','whitelisted_destinations','url_shortener_settings','daily_spend_limit_enabled','daily_spend_limit','webhook_url','smart_encoding'].map(k=>[k,p.data?.[k]]))};
out.number={http:n.status,...Object.fromEntries(['phone_number','messaging_profile_id','type','country_code','health','features','eligible_messaging_products','traffic_type'].map(k=>[k,n.data?.[k]]))};
const dir='artifacts/contractor-onboarding-outreach-20261019/';out.messages=[];
for(const file of fs.readdirSync(dir).filter(f=>f.startsWith('receipt-'))){const r=JSON.parse(fs.readFileSync(dir+file));if(!r.sid?.startsWith('telnyx:'))continue;const id=r.sid.slice(7);const m=await get('messages/'+id);const ev=await db('crm_sms_provider_events',{provider_message_id:'eq.'+id});out.messages.push({name:r.plan.name,id,hasUrl:/https?:/.test(r.plan.body),http:m.status,to:m.data?.to,errors:m.data?.errors,events:ev.map(e=>({type:e.event_type,to:e.payload?.to,errors:e.payload?.errors}))});}
fs.writeFileSync(dir+'telnyx-diagnostic.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
