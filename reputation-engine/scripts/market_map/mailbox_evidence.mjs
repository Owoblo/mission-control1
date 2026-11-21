// Shared evidence policy; provider confidence is not identity or send permission.
export function usableMailboxReceipt(record,now=Date.now()){
 const at=Date.parse(record?.checked_at);return !!record?.validation&&Number.isFinite(at)&&at<=now+60000&&now-at<=86400000;
}
export function highMailboxEvidence(validation){
 const e=validation?.Evaluations||{};return validation?.IsValid?.ConfidenceVerdict==='HIGH'&&e.HasValidSyntax?.ConfidenceVerdict==='HIGH'&&e.HasValidDnsRecords?.ConfidenceVerdict==='HIGH'&&['HIGH','MEDIUM'].includes(e.MailboxExists?.ConfidenceVerdict)&&['IsDisposable','IsRandomInput'].every(k=>e[k]?.ConfidenceVerdict==='LOW');
}
export function reconcileMailboxReceipts(rows,receipts,now=Date.now()){
 return rows.map(row=>{
  const receipt=receipts[row.email];let state='no_saved_receipt';
  if(receipt){
   if(String(receipt.email||'').trim().toLowerCase()!==row.email)state='receipt_address_mismatch';
   else if(!['mailbox_review_required','mailbox_checks_passed_identity_review_pending'].includes(receipt.state)||!receipt.request_id||!receipt.validation)state='incomplete_or_error_receipt';
   else if(!usableMailboxReceipt(receipt,now))state='receipt_stale_or_invalid_time';
   else state=highMailboxEvidence(receipt.validation)?'fresh_existing_policy_pass':'confidence_review_required';
  }
  const pass=state==='fresh_existing_policy_pass';
  const holds=row.holds.filter(h=>h!=='mailbox_confidence_review');if(!pass)holds.push('mailbox_confidence_review');
  return {...row,mailbox_policy_pass:pass,holds,mailbox_evidence:{state,checked_at:receipt?.checked_at||null,request_id:receipt?.request_id||null,mailbox_existence_confidence:receipt?.validation?.Evaluations?.MailboxExists?.ConfidenceVerdict||null,policy:'high_overall_syntax_dns_low_disposable_random_medium_or_high_existence_24h'},send_ready:false,owner_send_hold:true};
 });
}
