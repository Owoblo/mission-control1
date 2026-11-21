// Conservative account matching only: never merge people or authorize outreach.
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const phone = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return /^1?\d{10}$/.test(digits) ? digits.slice(-10) : '';
};
const host = value => {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
};
export function reviewMobile(candidate, contacts, companies, sales, now = new Date()) {
  const number = phone(candidate.phone);
  const names = new Set(candidate.matches.map(m => norm(m.organization)).filter(n => n.length >= 5));
  const domains = new Set(candidate.matches.map(m => host(m.source_url)).filter(Boolean));
  const reasons = row => {
    const found = [];
    if (number && phone(row.phone) === number) found.push('exact_phone');
    if (names.has(norm(row.company || row.company_name || row.name))) found.push('organization_name');
    if (domains.has(host(row.website))) found.push('account_domain');
    const emailDomain = String(row.email || '').trim().toLowerCase().split('@')[1];
    if (emailDomain && domains.has(emailDomain)) found.push('account_email_domain');
    return found;
  };
  const firms = companies.map(r => ({id:r.id, reasons:reasons(r)})).filter(r => r.reasons.length);
  const ids = new Set(firms.map(r => r.id));
  const peers = contacts.map(r => ({id:r.id, reasons:[...reasons(r), ...(ids.has(r.partner_company_id) ? ['linked_company'] : [])],
    suppressed:!!(r.do_not_contact || r.cross_channel_suppressed_at || r.stage === 'dnc' || r.decision === 'opted_out')
  })).filter(r => r.reasons.length);
  const leads = sales.map(r => ({id:r.id, reasons:reasons(r.data || {})})).filter(r => r.reasons.length);
  const holds = [...(candidate.release_holds||[]),'category_message_approval_required', 'owner_send_hold', 'fresh_pre_release_history_check_required'];
  const occurrenceEvidence=candidate.occurrence_evidence||candidate.evidence||candidate.matches;
  if(!occurrenceEvidence.length||occurrenceEvidence.some(e=>!e.source_dom_locator||!(e.page_content_sha256||e.source_sha256)))holds.push('attribution_evidence_incomplete');
  const fresh = value => { const age = now - new Date(value); return Number.isFinite(age) && age >= -60000 && age <= 86400000; };
  if (!number || candidate.state !== 'source_identity_and_mobile_checks_passed_needs_crm_review' || !candidate.matches.length) holds.push('source_identity_review');
  if (!fresh(candidate.carrier_checked_at) || !candidate.matches.every(m => fresh(m.captured_at))) holds.push('evidence_refresh_required');
  if (firms.length || peers.length || leads.length) holds.push('existing_relationship_review');
  if (peers.some(r => r.suppressed)) holds.push('possible_suppressed_relationship');
  return {...candidate, crm_checked_at:now.toISOString(), contacts:peers, companies:firms, sales:leads,
    crm_match_found:!!(firms.length || peers.length || leads.length), release_holds:[...new Set(holds)],occurrence_evidence:occurrenceEvidence,relationship_status:'candidate_only_not_verified', send_ready:false, owner_send_hold:true};
}
