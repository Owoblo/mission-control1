import fs from 'node:fs';import path from 'node:path';
import {loadVerifiedFreshCohortBundle,highMailboxEvidence,usableMailboxReceipt,sha256} from './fresh-cohort-bundle.mjs';
export function admissionIdentities(records){const ids=new Set(),emails=new Set();for(const r of records){if(r.organisation_id)ids.add(r.organisation_id);const email=r.email||r.payload?.recipient;if(email)emails.add(email.toLowerCase());}return {ids,emails};}
export function checkedReviewRows(text,marker,known={ids:new Set(),emails:new Set()}){
 if(marker?.complete!==true||marker.sha256!==sha256(text))throw Error('Review marker hash/completion mismatch');
 const rows=text.trim()?text.trim().split('\n').map(JSON.parse):[];
 if(rows.length!==marker.count)throw Error('Review marker count mismatch');
 const ids=new Set(),emails=new Set();for(const r of rows){const e=r.email?.toLowerCase();if(!r.organisation_id||!e||ids.has(r.organisation_id)||emails.has(e))throw Error('Missing/duplicate review identity or inbox');ids.add(r.organisation_id);emails.add(e);}
 return {sha256:sha256(text),total:rows.length,rows:rows.filter(r=>!known.ids.has(r.organisation_id)&&!known.emails.has(r.email.toLowerCase()))};
}
export function discoverFreshReviewBatches(parent,known={ids:new Set(),emails:new Set()}){
 const batches=[],holds=[];if(!fs.existsSync(parent))return {batches,holds};
 for(const entry of fs.readdirSync(parent,{withFileTypes:true}).filter(e=>e.isDirectory()&&/^verification-/.test(e.name)).sort((a,b)=>a.name.localeCompare(b.name))){
  const root=path.join(parent,entry.name);const markers=fs.readdirSync(root).filter(n=>/^additional-reviewed-parallel-\d+-round\d+-source\.jsonl\.ready$/.test(n)).sort();if(!markers.length)continue;
  let bundle;try{bundle=loadVerifiedFreshCohortBundle(root)}catch(e){holds.push({root,reason:e.message});continue;}
  for(const name of markers){try{
   const source=path.join(root,name.slice(0,-6));const batch=checkedReviewRows(fs.readFileSync(source,'utf8'),JSON.parse(fs.readFileSync(path.join(root,name),'utf8')),known);
   for(const r of batch.rows){const c=bundle.candidates.find(c=>c.organisation_id===r.organisation_id);const v=bundle.mailbox.find(v=>v.organisation_id===r.organisation_id&&v.email.toLowerCase()===r.email.toLowerCase());if(!c||c.email.toLowerCase()!==r.email.toLowerCase()||!usableMailboxReceipt(v)||!highMailboxEvidence(v.validation)||r.review_method!=='automated_evidence_rules_v1'||r.identity_email_binding!=='pass'||r.role_relevance!=='pass_for_conditional_context'||r.requires_parent_account_review)throw Error('Explicit review or mailbox qualification mismatch');}
   if(batch.rows.length){batches.push({...batch,source,candidateRoot:root,manifestHash:bundle.manifestHash,key:bundle.manifestHash.slice(0,16)+'-'+batch.sha256.slice(0,20)});for(const r of batch.rows){known.ids.add(r.organisation_id);known.emails.add(r.email.toLowerCase());}}
  }catch(e){holds.push({root,source:name,reason:e.message});}}
 }
 return {batches,holds};
}
