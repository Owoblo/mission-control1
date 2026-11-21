// Live preflight only. Creates a reviewable manifest; contains no SendEmail call.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {SESv2Client,ListSuppressedDestinationsCommand,GetAccountCommand} from '@aws-sdk/client-sesv2';
const root='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';
const out=`${root}/send-release`;
await fs.mkdir(out,{recursive:true});
const csv=f=>JSON.parse(execFileSync('python3',['-c','import csv,json,sys;print(json.dumps(list(csv.DictReader(open(sys.argv[1])))))',`${root}/${f}`],{encoding:'utf8'}));
const accounts=csv('accounts-and-locations.csv');
const queue=csv('volume-experiment/account-review-queue.csv');
const drafts=JSON.parse(await fs.readFile(`${root}/volume-experiment/email-drafts.json`));
const personalized=JSON.parse(await fs.readFile(`${root}/priority-enrichment/personalized-release.json`));
const validations=(await fs.readFile(`${root}/email-verification/aws-validation-results.jsonl`,'utf8')).trim().split('\n').map(JSON.parse);
const byEmail=new Map(validations.map(r=>[r.email,r]));
const dbHeaders={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`};
let contacts=[];
for(let offset=0;offset<30000;offset+=1000){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/market_contacts?select=id,name,email,company,partner_company_id,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at,stage,last_touch_at,last_inbound_at,notes&order=id&limit=1000&offset=${offset}`,{headers:dbHeaders});if(!r.ok)throw Error('CRM '+r.status);const page=await r.json();contacts.push(...page);if(page.length<1000)break;if(offset===29000)throw Error('CRM pagination cap');}
const ses=new SESv2Client({region:'us-east-2'});const health=await ses.send(new GetAccountCommand({}));if(!health.SendingEnabled||health.EnforcementStatus!=='HEALTHY')throw Error('Sender health not ready');
const suppressed=new Set();let token;do{const r=await ses.send(new ListSuppressedDestinationsCommand({NextToken:token,PageSize:1000}));for(const d of r.SuppressedDestinationSummaries||[])suppressed.add(d.EmailAddress.toLowerCase());token=r.NextToken;}while(token);
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const suppressedContact=c=>c.do_not_contact||c.cross_channel_suppressed_at||c.email_unsubscribed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||['dnc','closed_lost'].includes(c.stage);
const manifest=[];
for(const d of drafts){
 const a=accounts.find(a=>a.account_id===d.account_id);const q=queue.find(q=>q.account_id===d.account_id);const v=byEmail.get(d.to.toLowerCase());
 const related=contacts.filter(c=>c.email?.toLowerCase()===d.to.toLowerCase()||norm(c.company)===norm(d.account_name));
 const holds=[];
 if(suppressed.has(d.to.toLowerCase())||related.some(suppressedContact))holds.push('suppression');
 if(!v||v.overall==='LOW'||v.mailbox==='LOW'||v.status==='hold_risk')holds.push('delivery_research');
 if(related.some(c=>c.last_touch_at||c.last_inbound_at))holds.push('existing_conversation_review');
 if(personalized.initial.some(p=>p.supersedes_bulk_ids.includes(d.draft_id)))holds.push('replaced_by_personalized_account_draft');
 holds.push('official_publication_and_role_review','personalized_context_review');
 manifest.push({id:d.draft_id,account_id:d.account_id,account_name:d.account_name,to:d.to,variant:d.variant,source_url:q.source_url,website:a.website,source_categories:a.source_categories,city:a.city,related_crm_contacts:related.map(c=>c.id),validation:v,holds,body:d.body,status:'not_sent'});
}
for(const d of personalized.initial){const v=byEmail.get(d.to.toLowerCase());const related=contacts.filter(c=>c.id===d.contact_id||c.partner_company_id===d.company_id);const holds=['fresh_mailbox_history','sender_mailing_address_confirmation'];if(suppressed.has(d.to.toLowerCase())||related.some(suppressedContact))holds.push('suppression');if(!v||v.overall==='LOW'||v.mailbox==='LOW'||v.status==='hold_risk')holds.push('delivery_research');if(related.some(c=>c.last_touch_at||c.last_inbound_at))holds.push('existing_conversation_review');manifest.push({...d,validation:v,holds,status:'not_sent'});}
const holdCounts={};for(const r of manifest)for(const h of r.holds)holdCounts[h]=(holdCounts[h]||0)+1;
const result={checked_at:new Date().toISOString(),directory_unique_addresses:794,bulk_draft_accounts:drafts.length,personalized_initial_accounts:personalized.initial.length,manifest_rows:manifest.length,holdCounts,providerSuppressionCount:suppressed.size,prospectsSent:0,rows:manifest};
await fs.writeFile(`${out}/live-send-preflight.json`,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,rows:undefined}));
