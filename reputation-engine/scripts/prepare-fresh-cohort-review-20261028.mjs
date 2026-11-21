// Converts bounded mailbox receipts into technical REVIEW eligibility only.
import fs from 'node:fs';import path from 'node:path';
import {loadFreshCohortBundle,usableMailboxReceipt,highMailboxEvidence,sha256} from '../lib/partnership-core/fresh-cohort-bundle.mjs';
const root=process.argv[2];if(!root)throw Error('Batch root required');
const {candidates,manifestHash}=loadFreshCohortBundle(root);
if(fs.existsSync(path.join(root,'validation.lock')))throw Error('Validation still in flight');
const receiptFile=path.join(root,'ses-mailbox-validation.jsonl');
const receipts=fs.readFileSync(receiptFile,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const technical=candidates.map(c=>{const v=receipts.filter(r=>r.email.toLowerCase()===c.email.toLowerCase()&&r.organisation_id===c.organisation_id).at(-1);const pass=usableMailboxReceipt(v)&&highMailboxEvidence(v.validation);return {...c,campaign_ready:false,technical_screen_status:pass?'advance_to_identity_and_eligibility_review':'hold_for_mailbox_review',role_address_alone_is_hold:false,identity_email_binding:'unverified',outreach_eligibility:'not_assessed',mailbox_assessment:pass?'stronger_mailbox_evidence':'secondary_review_required',receipt_request_id:v?.request_id||null,receipt_sha256:v?sha256(JSON.stringify(v)):null};});
fs.writeFileSync(path.join(root,'role-inclusive-review.jsonl'),technical.map(r=>JSON.stringify(r)+'\n').join(''),{flag:'wx'});
const report={batch_manifest_sha256:manifestHash,completed_at:new Date().toISOString(),selected:candidates.length,receipts:receipts.length,provider_receipts:receipts.filter(r=>r.request_id&&r.validation).length,validation_errors:receipts.filter(r=>r.error).length,eligible_for_individual_review:technical.filter(r=>r.technical_screen_status==='advance_to_identity_and_eligibility_review').length,secondary_mailbox_review:technical.filter(r=>r.technical_screen_status!=='advance_to_identity_and_eligibility_review').length,campaign_ready:0,sent:0,files:Object.fromEntries(['ses-mailbox-validation.jsonl','role-inclusive-review.jsonl'].map(name=>[name,sha256(fs.readFileSync(path.join(root,name)))])),remaining_checks:['individual identity/role/geography review','live CRM/history/suppression checks','canonical admission only']};
fs.writeFileSync(path.join(root,'verification-manifest.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
