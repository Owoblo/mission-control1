import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const {campaign,from,body}=await import('./london-sarnia-subcontractors-20261015-data.mjs');
const dir='artifacts/'+campaign+'/';
const review=JSON.parse(fs.readFileSync(dir+'reviewed.json'));
const candidates=review.review.filter(c=>!c.holds.length);
if(review.from!==from||review.body!==body||Date.now()-Date.parse(review.at)>3600000)throw Error('Stale/changed review');
if(new Set(candidates.map(c=>c.phone)).size!==candidates.length)throw Error('Duplicate destinations');
if(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date())!=='2026-10-15')throw Error('Job-date copy expired');
const account=process.env.TWILIO_ACCOUNT_SID.trim();
const headers={Authorization:'Basic '+Buffer.from(account+':'+process.env.TWILIO_AUTH_TOKEN.trim()).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'};
if(from!=='+15486391428'||/reply stop|opt.out|tomorrow/i.test(body))throw Error('Wrong sender or campaign copy');
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10);
const line=JSON.parse(fs.readFileSync(dir+'line-check.json'));if(line.number!==from||!line.sms_capable||Date.now()-Date.parse(line.at)>3600000)throw Error('Recheck sender');
const balanceResponse=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Balance.json`,{headers});if(!balanceResponse.ok)throw Error('Balance unavailable');const balance=Number((await balanceResponse.json()).balance);const allowance=candidates.length*Math.ceil(body.length/153)*0.04+2;if(balance<allowance)throw Error('Funding hold');console.log(JSON.stringify({candidates:candidates.length,balance,allowance}));
const receipts=[];
for(const c of candidates){
 const file=dir+'receipt-'+c.row+'.json';
 if(fs.existsSync(file)){receipts.push(JSON.parse(fs.readFileSync(file)));continue;}
 // Recheck exact normalized destinations and history before every one-off send.
 const peers=await db('market_contacts',{phone:'ilike.*'+c.phone.slice(-4)+'*',limit:'1000'});
 if(peers.length===1000||peers.some(x=>[c.phone,...c.aliases].map(norm).includes(norm(x.phone))&&(x.id!==c.approved_existing_contact_id||x.do_not_contact||x.cross_channel_suppressed_at||x.last_inbound_at||x.last_touch_at||['dnc','closed_lost'].includes(x.stage)||['opted_out','rejected'].includes(x.decision)||!x.sequence_paused)))throw Error('New/suppressed partnership identity: '+c.name);
 if(c.approved_existing_contact_id){for(const table of ['market_touches','sequence_jobs','partnership_action_reservations'])if((await db(table,{contact_id:'eq.'+c.approved_existing_contact_id,limit:'1'})).length)throw Error('New legacy history: '+c.name);const peer=peers.find(x=>x.id===c.approved_existing_contact_id);const policies=await db('partnership_account_policy',{account_id:'eq.'+peer.partner_company_id});if(policies.some(x=>x.suppressed||x.unresolved_promise||x.pending_introduction))throw Error('Account hold: '+c.name)}
 const sms=await db('sms_messages',{or:'(from_number.eq.'+c.phone+',to_number.eq.'+c.phone+')',limit:'1000'});
 if(sms.length)throw Error('New SMS history: '+c.name);
 const existing=await db('subcontractors',{phone:'eq.'+c.phone});
 if(existing.length)throw Error('Existing subcontractor requires review: '+c.name);
 const reservation={state:'reserved_no_retry',campaign,row:c.row,name:c.name,phone:c.phone,from,body,at:new Date().toISOString()};
 fs.writeFileSync(file,JSON.stringify(reservation,null,2),{flag:'wx'});
 const [contractor]=await db('subcontractors',{},'POST',{company_name:c.name,contact_name:'Owner / crew manager (not yet confirmed)',phone:c.phone,status:'paused',branches:['london'],service_cities:[c.city],service_tags:['subcontractor_recruiting'],insured:false,availability_notes:'Recruiting candidate; availability, truck, crew, insurance and rates unverified. Not eligible for job dispatch.',notes:JSON.stringify({campaign,source:c.source,source_row:c.row,aliases:c.aliases,legacy_partnership_contact_id:c.approved_existing_contact_id||null,stage:'recruiting',sender:from,owner:'John',job_scope:'Long-term London/Middlesex and Sarnia/Lambton subcontractor recruiting; no specific job, date or payout offered',followup:'Human review only; no automatic messages',phone_carrier_type:c.carrier_type})});
 reservation.contractor_id=contractor.id;fs.writeFileSync(file,JSON.stringify(reservation,null,2));
 const response=await fetch(`https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`,{method:'POST',headers,body:new URLSearchParams({From:from,To:c.phone,Body:body}).toString(),signal:AbortSignal.timeout(25000)});
 const result=await response.json();
 const receipt={...reservation,state:response.ok&&result.sid?'provider_accepted':'provider_rejected',http:response.status,result,at:new Date().toISOString()};
 fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 if(!response.ok){console.log(JSON.stringify({row:c.row,name:c.name,state:receipt.state,errors:result.errors}));receipts.push(receipt);continue;}
 if(!result.sid)throw Error('Ambiguous response; no retry');
 const sid=result.sid;
 const [saved]=await db('sms_messages',{},'POST',{id:randomUUID(),from_number:from,to_number:c.phone,body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:new Date().toISOString()});
 const verified=await db('sms_messages',{twilio_sid:'eq.'+sid,select:'id'});
 if(verified.length!==1||verified[0].id!==saved.id)throw Error('SMS log receipt mismatch');
 receipt.sms_message_id=saved.id;receipt.state='accepted_crm_verified';fs.writeFileSync(file,JSON.stringify(receipt,null,2));receipts.push(receipt);
 console.log(JSON.stringify({row:c.row,name:c.name,state:receipt.state}));
}
fs.writeFileSync(dir+'send-results.json',JSON.stringify(receipts,null,2));
console.log(JSON.stringify({processed:receipts.length,states:receipts.reduce((s,x)=>(s[x.state]=(s[x.state]||0)+1,s),{})}));
