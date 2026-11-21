/** Identity comparison only. A separate branch still needs the normal send review. */
const text = value => typeof value === 'string' ? value.trim() : '';
const email = value => text(value).toLowerCase();
const validEmail = value => /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email(value));
const suppressed = row => Boolean(row.do_not_contact || row.cross_channel_suppressed_at || row.email_unsubscribed_at || ['dnc', 'do_not_contact', 'closed_lost'].includes(row.stage));
function verifiedBranch(row, now) {
  const b = row.branchEvidence;
  const at = Date.parse(b?.verifiedAt), until = Date.parse(b?.validUntil);
  return Boolean(b && text(b.branchId) && text(b.operatorId) && b.contactScope === 'branch'
    && email(b.recipient) === email(row.email) && b.status === 'verified'
    && /^https?:\/\//.test(text(b.sourceUrl)) && /^[a-f0-9]{64}$/.test(text(b.sourceSha256))
    && Number.isFinite(at) && Number.isFinite(until) && at <= now && now < until);
}

/**
 * Compare related records without collapsing every branch sharing a brand/domain.
 * branchEvidence must come from persisted, reviewed identity evidence, not inferred
 * from different cities, store URLs, email prefixes or a claim of franchise status.
 * This result NEVER authorizes sending or cancels a suppression/history hold.
 */
export function compareBranchRecipients(candidate, existing, now = Date.now()) {
  const result = (relation, reason) => ({ relation, reason, authorizesSend: false });
  if (!Number.isFinite(now)) return result('review', 'invalid_clock');
  if (suppressed(candidate)) return result('suppressed', 'candidate_suppressed');
  if (!validEmail(candidate.email) || !validEmail(existing.email)) return result('review', 'recipient_missing_or_invalid');
  if (email(candidate.email) === email(existing.email)) {
    return result(suppressed(existing) ? 'suppressed' : 'same_recipient', suppressed(existing) ? 'shared_recipient_suppressed' : 'shared_inbox_one_sequence');
  }
  if (!verifiedBranch(candidate, now) || !verifiedBranch(existing, now)) return result('review', 'branch_contact_binding_not_verified');
  const a = candidate.branchEvidence, b = existing.branchEvidence;
  if (a.branchId === b.branchId) return result('review', 'same_branch_multiple_contacts');
  // Existing account-level flags do not encode their scope. Retain review until
  // the scope is reconciled; a new branch must never become an opt-out bypass.
  if (suppressed(existing)) return result('review', 'related_suppression_scope_requires_review');
  return result('distinct_branch', a.operatorId === b.operatorId ? 'distinct_branches_same_operator_coordinate_outreach' : 'distinct_branches_distinct_operators');
}

/** Research-cohort selection, not admission. Preserves independent branches while
 * retaining one recipient per inbox. Existing source/eligibility holds survive.
 * Prefer reviewed branches over a generic head-office/domain association.
 */
export function selectBranchAwareResearchCohort(rows, { limit = 20000, now = Date.now(), excludedEmails = [] } = {}) {
  if (!Number.isInteger(limit) || limit < 0 || !Number.isFinite(now)) throw Error('Invalid cohort limits');
  const selected = [], held = [], byDomain = new Map(), seenEmails = new Set(excludedEmails.map(email)), seenEntities = new Set();
  const ordered = rows.map((row, i) => ({ row, i })).sort((a, b) => Number(verifiedBranch(b.row, now)) - Number(verifiedBranch(a.row, now)) || a.i - b.i);
  for (const { row } of ordered) {
    const reject = reason => held.push({ organisationId: row.organisation_id || null, email: row.email, reason });
    if (!validEmail(row.email) || !text(row.domain) || !text(row.organisation_id)) { reject('missing_research_identity'); continue; }
    if (suppressed(row) || row.sequence_paused || (Array.isArray(row.holds) && row.holds.length)) { reject('existing_hold'); continue; }
    const recipient = email(row.email), domain = text(row.domain).toLowerCase().replace(/^www\./, '');
    const entity = verifiedBranch(row, now) ? 'branch:' + row.branchEvidence.branchId : 'organisation:' + row.organisation_id;
    if (seenEmails.has(recipient)) { reject('shared_or_excluded_inbox'); continue; }
    if (seenEntities.has(entity)) { reject('duplicate_entity'); continue; }
    const peers = byDomain.get(domain) || [];
    if (peers.some(peer => compareBranchRecipients(row, peer, now).relation !== 'distinct_branch')) { reject('shared_domain_branch_binding_requires_review'); continue; }
    if (selected.length >= limit) { reject('cohort_limit'); continue; }
    selected.push(row); seenEmails.add(recipient); seenEntities.add(entity); byDomain.set(domain, [...peers, row]);
  }
  return { selected, held, campaignReady: 0, scope: 'research_only_requires_normal_admission' };
}
