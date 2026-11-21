import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const {campaign,from,body}=await import('./gta-subcontractors-20261014-data.mjs');
const dir='artifacts/'+campaign+'/';
const review=JSON.parse(fs.readFileSync(dir+'reviewed.json'));
const candidates=review.review.filter(c=>!c.holds.length);
if(review.from!==from||review.body!==body||Date.now()-Date.parse(review.at)>3600000)throw Error('Stale/changed review');
if(new Set(candidates.map(c=>c.phone)).size!==candidates.length)throw Error('Duplicate destinations');
if(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date())!=='2026-10-14')throw Error('Job-date copy expired');
const key=process.env.TELNYX_API_KEY||parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10);
const receipts=[];
for(const c of candidates){
 const file=dir+'receipt-'+c.row+'.json';
 if(fs.existsSync(file)){receipts.push(JSON.parse(fs.readFileSync(file)));continue;}
 // Recheck exact normalized destinations and history before every one-off send.
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:'1000'});
 if(peers.length===1000||peers.some(x=>[c.phone,...c.aliases].map(norm).includes(norm(x.phone))))throw Error('New partnership identity: '+c.name);
 const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',limit:'1000'});
 if(sms.length)throw Error('New SMS history: '+c.name);
 const existing=await db('subcontractors',{phone:'eq.'+c.phone});
 if(existing.length)throw Error('Existing subcontractor requires review: '+c.name);
 const reservation={state:'reserved_no_retry',campaign,row:c.row,name:c.name,phone:c.phone,from,body,at:new Date().toISOString()};
 fs.writeFileSync(file,JSON.stringify(reservation,null,2),{flag:'wx'});
 const [contractor]=await db('subcontractors',{},'POST',{company_name:c.name,contact_name:'Owner / crew manager (not yet confirmed)',phone:c.phone,status:'paused',branches:['toronto'],service_cities:[c.city],service_tags:['subcontractor_recruiting'],insured:false,availability_notes:'Recruiting candidate; availability, truck, crew, insurance and rates unverified. Not eligible for job dispatch.',notes:JSON.stringify({campaign,source:c.source,source_row:c.row,aliases:c.aliases,stage:'recruiting',sender:from,owner:'John',job_date:'2026-10-15',job_scope:'Awaiting owner details; no award or payout committed',followup:'Human review only; no automatic messages',phone_carrier_type:c.carrier_type})});
 reservation.contractor_id=contractor.id;fs.writeFileSync(file,JSON.stringify(reservation,null,2));
 const response=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers,body:JSON.stringify({from,to:c.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});
 const result=await response.json();
 const receipt={...reservation,state:response.ok&&result.data?.id?'provider_accepted':'provider_rejected',http:response.status,result,at:new Date().toISOString()};
 fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 if(!response.ok){console.log(JSON.stringify({row:c.row,name:c.name,state:receipt.state,errors:result.errors}));receipts.push(receipt);continue;}
 if(!result.data?.id)throw Error('Ambiguous response; no retry');
 const sid='telnyx:'+result.data.id;
 const [saved]=await db('sms_messages',{},'POST',{id:randomUUID(),from_number:from,to_number:c.phone,body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:new Date().toISOString()});
 const verified=await db('sms_messages',{twilio_sid:'eq.'+sid,select:'id'});
 if(verified.length!==1||verified[0].id!==saved.id)throw Error('SMS log receipt mismatch');
 receipt.sms_message_id=saved.id;receipt.state='accepted_crm_verified';fs.writeFileSync(file,JSON.stringify(receipt,null,2));receipts.push(receipt);
 console.log(JSON.stringify({row:c.row,name:c.name,state:receipt.state}));
}
fs.writeFileSync(dir+'send-results.json',JSON.stringify(receipts,null,2));
console.log(JSON.stringify({processed:receipts.length,states:receipts.reduce((s,x)=>(s[x.state]=(s[x.state]||0)+1,s),{})}));
