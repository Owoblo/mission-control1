import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {usableMailboxReceipt,highMailboxEvidence} from '../../scripts/market_map/mailbox_evidence.mjs';
export {usableMailboxReceipt,highMailboxEvidence};
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function loadFreshCohortBundle(root){
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'batch-manifest.json'),'utf8'));
 if(manifest.schema!=='fresh-cohort-bounded-v1'||!Number.isInteger(manifest.count)||manifest.count<1||manifest.count>100||manifest.maximum_new_paid_requests>100||manifest.send_authorized!==false)throw Error('Invalid bounded fresh manifest');
 const data={};for(const name of ['candidates.json','source-refresh.jsonl']){
  const bytes=fs.readFileSync(path.join(root,name));if(sha256(bytes)!==manifest.files[name])throw Error('Manifest content mismatch '+name);
  data[name]=name.endsWith('.jsonl')?bytes.toString().split('\n').filter(Boolean).map(JSON.parse):JSON.parse(bytes);
 }
 const candidates=data['candidates.json'],sources=data['source-refresh.jsonl'];
 if(candidates.length!==manifest.count||sources.length!==manifest.count||new Set(candidates.map(c=>c.email.toLowerCase())).size!==manifest.count||new Set(candidates.map(c=>c.organisation_id)).size!==manifest.count)throw Error('Candidate bounds/duplicate violation');
 for(const c of candidates){const s=sources.find(s=>s.organisation_id===c.organisation_id);if(!s||s.email.toLowerCase()!==c.email.toLowerCase()||!s.target_email_observed||s.restriction_signals?.length||/ottawa/i.test(c.catchment||''))throw Error('Source/market binding violation'); const at=Date.parse(s.checked_at);if(!Number.isFinite(at)||at>Date.now()+60000||Date.now()-at>86400000)throw Error('Source evidence stale');const host=x=>new URL(x).hostname.toLowerCase().replace(/^www\./,'');if(!s.pages?.some(p=>p.http_status===200&&p.sha256&&p.target_email_observed&&host(p.final_url)===c.domain.toLowerCase().replace(/^www\./,'')))throw Error('Official source evidence missing');}
 return {manifest,candidates,sources,manifestHash:sha256(fs.readFileSync(path.join(root,'batch-manifest.json')))};
}
export function loadVerifiedFreshCohortBundle(root){
 const bundle=loadFreshCohortBundle(root);const verification=JSON.parse(fs.readFileSync(path.join(root,'verification-manifest.json'),'utf8'));
 if(verification.batch_manifest_sha256!==bundle.manifestHash||verification.selected!==bundle.candidates.length||verification.campaign_ready!==0)throw Error('Verification manifest binding mismatch');
 const result={...bundle,verification};
 for(const [name,key] of [['ses-mailbox-validation.jsonl','mailbox'],['role-inclusive-review.jsonl','technical']]){
  const bytes=fs.readFileSync(path.join(root,name));if(sha256(bytes)!==verification.files[name])throw Error('Verification evidence mismatch '+name);result[key]=bytes.toString().split('\n').filter(Boolean).map(JSON.parse);
 }
 return result;
}
