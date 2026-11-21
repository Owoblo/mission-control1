// Attach provider evidence without changing eligibility, suppression or sequence state.
import fs from 'node:fs/promises';
const root='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';
const results=(await fs.readFile(`${root}/email-verification/aws-validation-results.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);
const byEmail=new Map(results.map(r=>[r.email,r]));
const release=JSON.parse(await fs.readFile(`${root}/priority-enrichment/personalized-release.json`));
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status);return r.status===204?[]:r.json()}
let updated=0;
for(const d of [...release.initial,...release.secondary]){
 const r=byEmail.get(d.to);if(!r)throw Error('Missing validation '+d.to);
 const [c]=await db('market_contacts',{id:'eq.'+d.contact_id,select:'id,email,notes,email_verification_provider,email_verification_checked_at'});
 if(c.email?.toLowerCase()!==r.email)throw Error('Email changed '+d.contact_id);
 const marker=`AWS recipient assessment ${r.checked_at}`;
 if(!c.notes?.includes(marker)){
  const status=r.status==='high_confidence_mailbox'?'valid':r.status==='review_uncertain'?'risky':'unknown';
  await db('market_contacts',{id:'eq.'+c.id},'PATCH',{email_verification_provider:'aws_ses',email_verification_checked_at:r.checked_at,email_verification_status:status,email_verification_reason:`overall_${r.overall};mailbox_${r.mailbox};policy_${r.status};does_not_establish_role_or_sending_basis`,notes:(c.notes||'')+'\n\n'+marker+'\n'+JSON.stringify({overall:r.overall,mailbox:r.mailbox,roleAddress:r.roleAddress,raw:r.raw,source:'SES GetEmailAddressInsights',send_ready:false})});updated++;
 }
 d.mailbox_status=`aws_overall_${r.overall.toLowerCase()}_mailbox_${r.mailbox.toLowerCase()}`;d.validation=r;
 if(d.release_holds)d.release_holds=d.release_holds.map(x=>x==='mailbox_verification'?'mailbox_confidence_and_recipient_review':x);
}
release.sender_mailing_address_status='deferred_by_owner_2026-09-15';
await fs.writeFile(`${root}/priority-enrichment/personalized-release.json`,JSON.stringify(release,null,2));
const [task]=await db('crm_tasks',{source_key:'eq.windsor-personalized-release-20260915:mailbox-verifier'});
if(task?.status!=='completed')await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{status:'completed',description:task.description+'\n\nResolved with existing AWS SES Email Validation. Thirteen prepared addresses assessed; full 794-address directory assessed separately. Raw mailbox confidence remains visible. No third-party subscription required for this first pass; no campaign enabled.',updated_at:new Date().toISOString()});
const [footer]=await db('crm_tasks',{source_key:'eq.windsor-personalized-release-20260915:sender-footer'});
if(footer&&!footer.description.includes('Owner deferred'))await db('crm_tasks',{id:'eq.'+footer.id},'PATCH',{title:'Deferred: Windsor sender mailing footer',priority:'normal',due_at:null,description:footer.description+'\n\nOwner deferred this item on September 15. Continue recipient validation independently; no address confirmation requested in this run.'});
for(const d of release.initial){const [t]=await db('crm_tasks',{source_key:'eq.windsor-priority-20260915:'+d.account_key});if(t&&!t.description.includes('AWS validation completed — personalized v1'))await db('crm_tasks',{id:'eq.'+t.id},'PATCH',{description:t.description+'\n\nAWS validation completed — personalized v1\n'+JSON.stringify({to:d.to,validation:d.validation,mailbox_status:d.mailbox_status,status:'prepared_not_sent',sender_address:'deferred_by_owner',note:'Provider assessment completed; medium mailbox confidence is not confirmed existence. No blanket send eligibility or sequence change.'})});}
const report={at:new Date().toISOString(),contacts_updated:updated,prepared_addresses_assessed:13,prospect_emails_sent:0};await fs.writeFile(`${root}/email-verification/aws-crm-receipt.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
