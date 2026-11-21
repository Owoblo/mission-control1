import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/contractor-onboarding-outreach-20261019/';
const results=[];
for(const f of fs.readdirSync(dir).filter(f=>f.startsWith('receipt-'))){
 const r=JSON.parse(fs.readFileSync(dir+f));let delivery;
 if(r.plan.channel==='email'){
  const events=await db('email_provider_events',{provider_message_id:'eq.'+r.sid});delivery=events.map(e=>e.event_type);
 }else if(r.sid.startsWith('telnyx:')){
  const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
  const res=await fetch('https://api.telnyx.com/v2/messages/'+r.sid.slice(7),{headers:{Authorization:'Bearer '+key}});if(res.ok){const data=await res.json();delivery={statuses:data.data?.to?.map(t=>t.status),errors:data.data?.errors};}else{const events=await db('crm_sms_provider_events',{provider_message_id:'eq.'+r.sid.slice(7)});delivery={lookupStatus:res.status,events:events.map(e=>({type:e.event_type,status:e.payload?.to?.map(t=>t.status)}))};}
 }else{
  const account=process.env.TWILIO_ACCOUNT_SID.trim();const res=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages/${r.sid}.json`,{headers:{Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64')}});if(!res.ok)throw Error('Twilio status '+res.status);const data=await res.json();delivery={status:data.status,errorCode:data.error_code};
 }
 const result={company:r.plan.name,channel:r.plan.channel,delivery,crm:r.state};results.push(result);console.log(JSON.stringify(result));
 const [c]=await db('subcontractors',{id:'eq.'+r.plan.id});const tag='ONBOARDING DELIVERY CHECK 2026-10-19 '+r.sid;
 if(!c.notes?.includes(tag))await db('subcontractors',{id:'eq.'+c.id},'PATCH',{notes:(c.notes||'')+'\n\n'+tag+'\n'+JSON.stringify(delivery)+'\nProvider acceptance alone is not delivery confirmation. Failed or unavailable receipts require human follow-up; no automatic resend.'});
}
fs.writeFileSync(dir+'delivery-status.json',JSON.stringify({at:new Date().toISOString(),results},null,2));
const audit=JSON.parse(fs.readFileSync(dir+'audit.json'));
const callNotes={
 '48ce001d-1526-4e20-a18f-0b12fce04244':['Nicholas','Interested; requested details at hubersmoving@gmail.com'],
 '1925308a-d457-494c-8323-690b58ad0a79':['','Call after 7 pm; one person with cargo van'],
 '0d9d6f64-a9a6-4a4e-a86d-e6ccf8866884':['','Offered afternoon callback on Oct 14; reconfirm timing'],
 'ed84d5b9-0870-41e4-8f66-c5e1edf228fa':['','Interested long term; asks job scope'],
 '16c753ec-0b6f-4473-9f32-e11dbe73fa28':['','Asked about workforce, equipment, rates and payment'],
 '18bd9f02-8883-44d5-bc95-196e5c3cb60d':['','Asked hourly rate'],
 'afb9a332-247f-487c-a6c0-b6e64904c128':['','Acknowledged late reply; qualify interest'],
 '64b27da2-36e6-48b1-8b85-822fdaf97102':['','Was booked that week; recheck availability'],
 '0f9795e6-e83e-4de2-957d-ca4642700b28':['','Sent retail rates; clarify subcontractor relationship'],
 'afb6fc6d-5283-40e8-9b60-9bbd09cdd00f':['','Offers Northern Ontario coverage'],
 'c31a589c-1d2d-4150-a590-9a1023033410':['','Interested in hearing how it works'],
 'e97dcdda-9315-4505-a209-ce288069cc7c':['','Replied; clarify interest and scope']
};
const csv=[['Company','Confirmed name','Phone','Call context'],...Object.entries(callNotes).map(([id,[name,reason]])=>{const c=audit.rows.find(c=>c.id===id);if(!c)throw Error(id);return[c.company_name,name||'Collect in form/call',c.phone,reason];})];
fs.writeFileSync(dir+'call-list.csv',csv.map(row=>row.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(',')).join('\n')+'\n');
const [harry]=await db('subcontractors',{id:'eq.8b47ddb3-ae58-481a-9581-7db6ac73a275'});console.log(JSON.stringify({harryPaused:harry.status==='paused'&&harry.notes.includes('OWNER OUTREACH HOLD 2026-10-19'),callListCount:csv.length-1}));
