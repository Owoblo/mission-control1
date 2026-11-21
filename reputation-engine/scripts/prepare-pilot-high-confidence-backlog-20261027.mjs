import fs from 'node:fs';
import {mailboxAdmissionQuality} from '../lib/partnership-core/mailbox-admission-quality.mjs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const candidates=JSON.parse(fs.readFileSync(dir+'candidates.json'));
const validations=new Map(fs.readFileSync(dir+'ses-mailbox-validation.jsonl','utf8').trim().split('\n').map(JSON.parse).map(r=>[r.email.toLowerCase(),r]));
const admitted=new Set(['first-reviewed-admission.json',...fs.readdirSync(dir).filter(f=>/^additional-reviewed-.*\.json$/.test(f))].flatMap(f=>JSON.parse(fs.readFileSync(dir+f)).records||[]).filter(r=>r.jobId).map(r=>r.payload?.recipient?.toLowerCase()).filter(Boolean));
const rows=candidates.filter(c=>!admitted.has(c.email.toLowerCase())&&mailboxAdmissionQuality(validations.get(c.email.toLowerCase())?.validation).automatic).map(c=>({...c,campaign_ready:false,priority:'higher_confidence_validation_pending_remaining_reviews',validation:validations.get(c.email.toLowerCase()),requiredChecks:['fresh_official_source_identity','message_role_relevance','live_suppression','fresh_mailbox_history','parent_account_context','exact_copy','canonical_policy_reservation']}));
fs.writeFileSync(dir+'higher-confidence-admission-backlog.jsonl',rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
console.log(JSON.stringify({remainingHigherConfidenceCandidates:rows.length,alreadyAdmittedExcluded:admitted.size,queuedByThisStep:0}));
