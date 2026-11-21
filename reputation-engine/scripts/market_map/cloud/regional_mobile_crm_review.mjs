// Read-only CRM snapshot. No campaign/queue/message endpoints or mutations.
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {reviewMobile} from '../mobile_relationship_review.mjs';
import {mobileReviewInputs} from '../mobile_review_inputs.mjs';
import {indexedRelationshipReviewer} from '../email_relationship_review.mjs';
import {reconcileMailboxReceipts} from '../mailbox_evidence.mjs';
import {reviewAdditionalPhones} from '../additional_phone_relationship_review.mjs';
const root='/data/research/artifacts/regional-contact-enrichment-20261104';
const credentials=JSON.parse(await fs.readFile('/data/research/.private/regional-outcomes.json'));
const source=JSON.parse(await fs.readFile(root+'/source-identity-review.json'));
const age=Date.now()-Date.parse(source.checked_at);
if(!Number.isFinite(age)||age< -60000||age>900000)throw Error('Source review stale');
let reviewed={rows:[]};
try { reviewed=JSON.parse(await fs.readFile(root+'/visible-source-reviewed-routes-20261105.json')); }
catch(error) { if(error.code!=='ENOENT')throw error; }
const hash=body=>createHash('sha256').update(body).digest('hex');
function evidenceValid(record,e,number) {
 try {
  const host=new URL(record.website).hostname.replace(/^www\./,'');
  if(new URL(e.source_url).hostname.replace(/^www\./,'')!==host)return false;
  const receipt=JSON.parse(readFileSync(root+'/sources/'+hash(host).slice(0,20)+'/receipt.json'));
  if(!receipt.records.some(r=>r.source_record_id===record.source_record_id&&r.organization===record.organization&&r.address===record.address&&'+1'+r.phone_base===number))return false;
  const page=receipt.pages.find(p=>p.url===e.source_url&&p.sha256===e.page_content_sha256&&p.captured_at===e.captured_at);
  return !!page&&hash(readFileSync(page.body_path))===e.page_content_sha256&&page.phones.some(p=>p.phone===number&&p.kind!=='fax'&&!p.extension);
 } catch { return false; }
}
const prepared=mobileReviewInputs(source.rows,reviewed.rows,evidenceValid);
const headers={apikey:credentials.SUPABASE_KEY,Authorization:'Bearer '+credentials.SUPABASE_KEY};
async function get(table,select,extra={}) {
 const all=[];
 for(let offset=0;offset<100000;offset+=1000) {
  const query=new URLSearchParams({select,order:'id',...extra,limit:'1000',offset:String(offset)});
  const response=await fetch(credentials.SUPABASE_URL+'/rest/v1/'+table+'?'+query,{headers,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(table+' HTTP '+response.status);
  const rows=await response.json();all.push(...rows);if(rows.length<1000)return all;
 }
 throw Error('Incomplete pagination');
}
const contacts=await get('market_contacts','id,name,company,phone,email,website,partner_company_id,do_not_contact,cross_channel_suppressed_at,stage,decision');
const companies=await get('partner_companies','*');
const sales=await get('crm_leads','id,data',{deleted:'eq.false'});
const now=new Date();
const rows=prepared.inputs.map(r=>reviewMobile(r,contacts,companies,sales,now));
const summary={checked_at:now.toISOString(),source_checked_at:source.checked_at,contacts_scanned:contacts.length,companies_scanned:companies.length,sales_scanned:sales.length,source_matched_routes:rows.length,existing_relationship_matches:rows.filter(r=>r.crm_match_found).length,possible_suppressed_relationships:rows.filter(r=>r.release_holds.includes('possible_suppressed_relationship')).length,no_current_crm_match:rows.filter(r=>!r.crm_match_found).length,evidence_refresh_required:rows.filter(r=>r.release_holds.includes('evidence_refresh_required')).length,send_ready:0,crm_writes:0,messages_sent:0,owner_send_hold:true};
summary.reviewed_visible_routes=rows.filter(r=>r.source_review_method==='reviewed_visible_contact_excerpt').length;
summary.reviewed_visible_input_holds=prepared.holds.length;
// Reuse this CRM snapshot for research triage; do not call mailbox providers.
try {
 const inventory=JSON.parse(await fs.readFile(root+'/email-inventory.json'));
 const reviewEmail=indexedRelationshipReviewer(contacts,companies,sales);
 let receipts={};
 try {receipts=JSON.parse(await fs.readFile(root+'/email-validation-pilot-results.json'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const emailRows=reconcileMailboxReceipts(inventory.rows.map(r=>reviewEmail({...r,existing_policy_pass:false})),receipts);
 const emailSummary={checked_at:new Date().toISOString(),inventory_checked_at:inventory.checked_at,crm_snapshot_at:now.toISOString(),emails_reviewed:emailRows.length,existing_relationship_matches:emailRows.filter(r=>r.holds.includes('existing_relationship_review')).length,possible_suppressed_relationships:emailRows.filter(r=>r.holds.includes('possible_suppressed_relationship')).length,branch_review:emailRows.filter(r=>r.holds.includes('branch_association_review')).length,no_current_crm_match_or_branch_hold:emailRows.filter(r=>!r.holds.includes('existing_relationship_review')&&!r.holds.includes('branch_association_review')).length,mailbox_validation_run:false,prior_validation_receipts_reconciled:false,verified_unique_contacts:0,send_ready:0,messages_sent:0,owner_send_hold:true};
 emailSummary.prior_validation_receipts_reconciled=true;
 emailSummary.fresh_saved_mailbox_policy_passes=emailRows.filter(r=>r.mailbox_policy_pass).length;
 emailSummary.fresh_saved_passes_without_crm_or_branch_holds=emailRows.filter(r=>r.mailbox_policy_pass&&!r.holds.includes('existing_relationship_review')&&!r.holds.includes('branch_association_review')).length;
 emailSummary.mailbox_evidence_states={};for(const r of emailRows)emailSummary.mailbox_evidence_states[r.mailbox_evidence.state]=(emailSummary.mailbox_evidence_states[r.mailbox_evidence.state]||0)+1;
 const path=root+'/email-crm-review.json';await fs.writeFile(path+'.tmp',JSON.stringify({summary:emailSummary,rows:emailRows},null,2));await fs.rename(path+'.tmp',path);summary.email_review=emailSummary;
} catch(error) { summary.email_review={state:'read_error',error_type:error.name,previous_report_retained:true}; }
// Additional source-supported phones reuse the snapshot, never the mobile status.
try {
 const input=JSON.parse(await fs.readFile(root+'/additional-phone-source-review.json'));
 const result=reviewAdditionalPhones(input,contacts,companies,sales,new Date());
 const path=root+'/additional-phone-crm-review.json';await fs.writeFile(path+'.tmp',JSON.stringify(result,null,2));await fs.rename(path+'.tmp',path);
 summary.additional_phone_review=result.summary;
} catch(error) {summary.additional_phone_review={state:error.code==='ENOENT'?'not_available':'read_error',error_type:error.name};}
const target=root+'/mobile-crm-review.json';await fs.writeFile(target+'.tmp',JSON.stringify({summary,rows,input_holds:prepared.holds},null,2));await fs.rename(target+'.tmp',target);console.log(JSON.stringify(summary));
