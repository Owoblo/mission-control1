import fs from 'node:fs';
import {mailboxAdmissionQuality,classifyBounce} from '../lib/partnership-core/mailbox-admission-quality.mjs';
const dir='artifacts/partnership-pilot-3000-20261027/';
const audit=JSON.parse(fs.readFileSync(dir+'bounce-audit.json'));
const types={};for(const r of audit.rows){r.cause=classifyBounce(r);r.quality=mailboxAdmissionQuality(r.validation);types[r.cause]=(types[r.cause]||0)+1;}
const validation=fs.readFileSync(dir+'ses-mailbox-validation.jsonl','utf8').trim().split('\n').map(JSON.parse);
const pending=validation.filter(r=>!mailboxAdmissionQuality(r.validation).automatic).map(r=>({organisation_id:r.organisation_id,email:r.email,previousValidationAt:r.checked_at,reason:mailboxAdmissionQuality(r.validation).reason,status:'secondary_verification_required',note:'Discovery backlog, not a resend queue; suppressions and existing sends must be checked first.'}));
fs.writeFileSync(dir+'secondary-mailbox-verification-backlog.jsonl',pending.map(r=>JSON.stringify(r)).join('\n')+'\n');
fs.writeFileSync(dir+'bounce-audit.json',JSON.stringify(audit,null,2));
console.log(JSON.stringify({audited:audit.rows.length,types,allSuppressed:audit.rows.every(r=>r.suppressed),secondaryVerificationBacklog:pending.length},null,2));
