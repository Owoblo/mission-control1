/** Role addresses are allowed. Mailbox existence confidence is a separate check. */
export function mailboxAdmissionQuality(validation){
 const e=validation?.Evaluations||{};
 if(e.HasValidSyntax?.ConfidenceVerdict!=='HIGH'||e.HasValidDnsRecords?.ConfidenceVerdict!=='HIGH')return {automatic:false,reason:'syntax_or_dns_uncertain'};
 if(e.IsDisposable?.ConfidenceVerdict==='HIGH'||e.IsRandomInput?.ConfidenceVerdict==='HIGH')return {automatic:false,reason:'disposable_or_random_input'};
 if(e.MailboxExists?.ConfidenceVerdict==='LOW')return {automatic:false,reason:'low_mailbox_existence_confidence'};
 if(e.MailboxExists?.ConfidenceVerdict==='MEDIUM'&&validation?.IsValid?.ConfidenceVerdict==='HIGH')return {automatic:true,reason:'aws_high_overall_likelihood_mailbox_not_confirmed'};
 if(e.MailboxExists?.ConfidenceVerdict!=='HIGH')return {automatic:false,reason:'mailbox_existence_requires_secondary_verification'};
 return {automatic:true,reason:'high_confidence_mailbox_not_delivery_guarantee'};
}
export function classifyBounce(row){
 const text=(row.diagnostics||[]).map(d=>d.diagnostic||'').join(' ').toLowerCase();
 if(row.bounceSubType==='MailboxFull'||/mailbox.*full|quota exceeded/.test(text))return 'mailbox_full';
 if(/no such user|user unknown|recipient not found/.test(text))return 'recipient_missing';
 if(/relay access denied/.test(text))return 'relay_access_denied';
 if(/spam classification|spam detected/.test(text))return 'spam_policy_rejection';
 if(!text)return 'diagnostic_missing';
 return 'other_requires_review';
}
