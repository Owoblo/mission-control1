// Requeue only failed reservations proven not to have reached a provider send.
import {fs,db} from './gta-email-recovery-runtime.mjs';
const dir='artifacts/gta-email-recovery-20261009';
const plans=JSON.parse(fs.readFileSync(dir+'/send-plan.json'));
const receipts=fs.readdirSync(dir+'/receipts').map(f=>JSON.parse(fs.readFileSync(dir+'/receipts/'+f)));
const retry=[];
fs.mkdirSync(dir+'/reconciled-holds',{recursive:true});
// This one reservation was created by our readback diagnostic. That diagnostic
// never called SES; retain the reservation event and record the release explicitly.
const diagnostic=JSON.parse(fs.readFileSync(dir+'/reservation-diagnostic.json'));
if(diagnostic.providerSendAttempted===false&&diagnostic.status===200&&JSON.parse(diagnostic.result).allowed){
 const p=plans.find(p=>p.id===diagnostic.id);
 const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
 const query=`begin;
 do $recovery$ begin
 perform 1 from market_contacts where id=${quote(p.id)} for update;
 perform 1 from partnership_action_reservations where action_key=${quote(p.key)} for update;
 if exists(select 1 from market_touches where contact_id=${quote(p.id)} and channel='email')
 or exists(select 1 from email_provider_events where lower(recipient_email)=lower(${quote(p.email)}))
 or exists(select 1 from market_contacts where id=${quote(p.id)} and email_last_sent_at is not null)
 then raise exception 'Diagnostic reservation now has send evidence; leave untouched'; end if;
 insert into partnership_policy_events(event_key,account_id,action_key,event_type,evidence)
 values(${quote('diagnostic-reconciled:'+p.key)},${quote(p.account_id)},${quote(p.key)},'action.reconciled_no_provider_record',
 jsonb_build_object('owner_authorized_retry',true,'contact_id',${quote(p.id)},'provider_send_attempted',false,'reason','Reservation-only diagnostic; no SES call, email touch, or provider event')) on conflict(event_key) do nothing;
 delete from partnership_action_reservations where action_key=${quote(p.key)} and contact_id=${quote(p.id)} and channel='email';
 end $recovery$; commit;`;
 const response=await fetch('https://api.supabase.com/v1/projects/idbyrtwdeeruiutoukct/database/query',{method:'POST',headers:{Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({query})});
 if(!response.ok)throw Error('Diagnostic reservation reconciliation failed: '+await response.text());
 fs.writeFileSync(dir+'/diagnostic-reservation-reconciled.json',JSON.stringify({at:new Date().toISOString(),id:p.id,providerSendAttempted:false,auditEvent:'diagnostic-reconciled:'+p.key},null,2));
}
for(const receipt of receipts.filter(r=>r.state==='held'&&r.reason==='Policy reservation unavailable (500)')){
 const p=plans.find(p=>p.id===receipt.id);
 const [reservations,touches,events,contacts]=await Promise.all([
  db('partnership_action_reservations',{contact_id:'eq.'+p.id,channel:'eq.email'}),
  db('market_touches',{contact_id:'eq.'+p.id,channel:'eq.email'}),
  db('email_provider_events',{recipient_email:'ilike.'+p.email,limit:'1'}),
  db('market_contacts',{id:'eq.'+p.id})
 ]);
 if(reservations.length||touches.length||events.length||contacts[0]?.email_last_sent_at)continue;
 const record={at:new Date().toISOString(),previous:receipt,reservations:0,emailTouches:0,providerEvents:0,decision:'recheck_live_context_and_reserve_again_before_any_send'};
 fs.writeFileSync(dir+'/reconciled-holds/'+p.id+'.json',JSON.stringify(record,null,2),{flag:'wx'});
 fs.renameSync(dir+'/receipts/'+p.id+'.json',dir+'/reconciled-holds/'+p.id+'-original.json');
 retry.push(p.id);
}
fs.writeFileSync(dir+'/reconciled-retry-ids.json',JSON.stringify(retry,null,2));
console.log(JSON.stringify({safeToRecheck:retry.length,ids:retry}));
