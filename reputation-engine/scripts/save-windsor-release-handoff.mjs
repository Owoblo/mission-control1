// Save exact personalized drafts and remaining release checks to existing CRM tasks.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment';
const release=JSON.parse(await fs.readFile(`${dir}/personalized-release.json`));
const simulator=JSON.parse(await fs.readFile(`${dir}/simulator-event-results.json`));
const marker='Personalized Windsor release v1 — 2026-09-15';
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status+' '+await r.text());return r.status===204?[]:r.json()}
let updated=0,created=0;
for(const d of release.initial){const [task]=await db('crm_tasks',{source_key:'eq.windsor-priority-20260915:'+d.account_key});if(!task)throw Error('Missing account task '+d.account_key);
 if(task.description.includes(marker))continue;
 const details={...d,secondary:release.secondary.filter(s=>s.account_key===d.account_key),provider_delivery_and_bounce_ingestion:simulator.deliveryObserved&&simulator.bounceObserved?'tested_with_AWS_simulator':'not_proven',remaining_release_checks:['mailbox_verification','current_role_and_sending_basis','confirmed_sender_mailing_footer','fresh_suppression_account_history_and_reply_stop_check'],supersedes:'Earlier generic draft in this task. This exact personalized draft is the current review version; it is unsent.'};
 await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{description:task.description+'\n\n'+marker+'\n'+JSON.stringify(details),updated_at:new Date().toISOString()});updated++;
}
for(const [key,title,description] of [
 ['mailbox-verifier','Windsor launch: connect and run individual mailbox verification','ZeroBounce integration exists but no usable key was found in inspected local configuration. Owner has been asked whether a service exists. Select an existing configured provider or prepare a bounded provider setup; record valid/invalid/catch-all/unknown separately. DNS is not mailbox verification. Validate first personalized batch, then process all 794 unique directory addresses without auto-sending.'],
 ['sender-footer','Windsor launch: confirm sender mailing footer','Current business phone and website are confirmed. No current sender mailing address has yet been established from first-party evidence for this cold batch. Confirm the appropriate business mailing address for the footer; do not use an unverified directory or private address.'],
 ['reply-stop','Windsor launch: verify reply and account stop behavior','AWS simulator delivery and bounce events reached CRM on September 15. This does not establish reply matching or contact suppression behavior because simulator messages used no real contact IDs. Verify inbound reply association and sequence stop, and ensure account-wide cold touches pause for review. Do not test bounces on prospects.']]){
 const sourceKey='windsor-personalized-release-20260915:'+key;
 if((await db('crm_tasks',{select:'id',source_key:'eq.'+sourceKey})).length)continue;
 const id='we-release-'+createHash('sha256').update(sourceKey).digest('hex').slice(0,24);
 await db('crm_tasks',{},'POST',{id,title,description,status:'open',priority:'high',category:'partnerships',owner_name:'John',due_at:'2026-09-16T14:00:00Z',source:'manual',source_key:sourceKey});created++;
}
const result={at:new Date().toISOString(),personalized_account_tasks_updated:updated,launch_tasks_created:created,initial_drafts:release.initial.length,held_follow_on_drafts:release.secondary.length,prospects_sent:0};
await fs.writeFile(`${dir}/release-handoff-receipt.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
