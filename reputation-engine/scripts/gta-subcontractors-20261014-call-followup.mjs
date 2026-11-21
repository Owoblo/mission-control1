import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const {db}=await import('./reply-runtime-20261007.mjs');
const dir='artifacts/gta-subcontractor-recruiting-20261014/';
const review=JSON.parse(fs.readFileSync(dir+'verification.json'));
if(Date.now()-Date.parse(review.checked_at)>3600000)throw Error('Refresh review first');
const from='+14374650584';
const body='Hi, John from Saturn Star Movers again. When would be a good time for a quick call about working together? No pressure - happy to work around your schedule.';
const key=parseEnv(fs.readFileSync('.env.local','utf8')).TELNYX_API_KEY;
const candidates=review.rows.filter(r=>r.status==='delivered'&&!r.replies.length);
const results=[];
for(const c of candidates){
 const file=dir+'call-followup-'+c.row+'.json';
 if(fs.existsSync(file)){results.push(JSON.parse(fs.readFileSync(file)));continue;}
 const [sub]=await db('subcontractors',{id:'eq.'+c.contractor_id});
 const replies=await db('sms_messages',{from_number:'eq.'+c.phone,direction:'eq.inbound',created_at:'gte.2026-10-14T18:00:00Z',limit:'100'});
 if(sub.status==='blocked'||replies.length){results.push({row:c.row,name:c.name,state:'held_new_reply_or_optout'});continue;}
 const existing=await db('sms_messages',{to_number:'eq.'+c.phone,from_number:'eq.'+from,body:'eq.'+body,limit:'1'});
 if(existing.length){results.push({row:c.row,name:c.name,state:'already_sent'});continue;}
 const receipt={row:c.row,name:c.name,to:c.phone,from,body,at:new Date().toISOString(),state:'reserved_no_retry'};
 fs.writeFileSync(file,JSON.stringify(receipt,null,2),{flag:'wx'});
 const response=await fetch('https://api.telnyx.com/v2/messages',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({from,to:c.phone,text:body,webhook_url:'https://go.quote2move.com/api/sales/telnyx/messaging',use_profile_webhooks:true}),signal:AbortSignal.timeout(25000)});
 const result=await response.json();Object.assign(receipt,{result,state:response.ok?'provider_accepted':'provider_rejected'});fs.writeFileSync(file,JSON.stringify(receipt,null,2));
 if(!response.ok||!result.data?.id)throw Error('Send not confirmed; no retry');
 const sid='telnyx:'+result.data.id;
 const [sms]=await db('sms_messages',{},'POST',{id:randomUUID(),from_number:from,to_number:c.phone,body,direction:'outbound',lead_id:null,twilio_sid:sid,created_at:new Date().toISOString()});
 const verified=await db('sms_messages',{twilio_sid:'eq.'+sid,select:'id'});
 if(verified.length!==1||verified[0].id!==sms.id)throw Error('CRM receipt mismatch');
 Object.assign(receipt,{state:'accepted_crm_verified',sms_id:sms.id});fs.writeFileSync(file,JSON.stringify(receipt,null,2));results.push(receipt);
 console.log(JSON.stringify({row:c.row,name:c.name,state:receipt.state}));
}
fs.writeFileSync(dir+'call-followup-results.json',JSON.stringify({at:new Date().toISOString(),body,results},null,2));
console.log(JSON.stringify({selected:candidates.length,states:results.reduce((a,r)=>(a[r.state]=(a[r.state]||0)+1,a),{})}));
