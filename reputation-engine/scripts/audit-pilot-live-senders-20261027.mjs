import {db,fs} from './gta-email-recovery-runtime.mjs';
if(process.argv.includes('--apply-approved-name')){
 const rows=await db('email_sender_accounts',{provider:'eq.ses',from_email:'eq.john@saturnstarmovers.ca',select:'id,from_name,reply_to_email,status'});
 if(rows.length!==1||rows[0].reply_to_email!=='business@starmovers.ca')throw Error('Sender identity does not match approved profile');
 const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/email_sender_accounts?'+new URLSearchParams({id:'eq.'+rows[0].id}),{
  method:'PATCH',headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},
  body:JSON.stringify({from_name:'John Owolabi',updated_at:new Date().toISOString()}),
 });
 if(!response.ok)throw Error('Sender display-name update failed: '+response.status);
 const changed=await response.json();if(changed.length!==1||changed[0].from_name!=='John Owolabi')throw Error('Sender display-name receipt missing');
 fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/sender-display-name-update.json',JSON.stringify({at:new Date().toISOString(),before:rows[0].from_name,after:changed[0].from_name,status:changed[0].status,emailsSent:0},null,2));
}
const [senders,domains,health]=await Promise.all([
 db('email_sender_accounts',{select:'provider,domain,from_email,from_name,reply_to_email,region,status,daily_cap,pause_reason'}),
 db('crm_email_domains',{select:'domain,purpose,status,daily_cap,minimum_interval_seconds,postal_address,checked_at,health,pause_reason'}),
 db('crm_email_provider_health',{select:'region,checked_at,snapshot'}),
]);
const report={at:new Date().toISOString(),readOnly:!process.argv.includes('--apply-approved-name'),senders,domains,health};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/live-sender-readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
