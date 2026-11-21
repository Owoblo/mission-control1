import test from 'node:test';
import assert from 'node:assert/strict';
import { compareBranchRecipients, selectBranchAwareResearchCohort } from '../../lib/partnership-core/branch-identity.mjs';
const now = Date.parse('2026-10-28T04:00:00Z');
const branch = (id, operator, recipient) => ({ company: 'Shared brand', website: 'https://brand.example', email: recipient, branchEvidence: { branchId: id, operatorId: operator, recipient, contactScope: 'branch', status: 'verified', sourceUrl: 'https://brand.example/locations/' + id, sourceSha256: 'a'.repeat(64), verifiedAt: '2026-10-28T03:00:00Z', validUntil: '2026-10-29T03:00:00Z' } });
test('independent verified franchises sharing brand/domain remain distinct', () => {
  const r = compareBranchRecipients(branch('windsor', 'owner-a', 'windsor@brand.example'), branch('toronto', 'owner-b', 'toronto@brand.example'), now);
  assert.equal(r.relation, 'distinct_branch'); assert.equal(r.authorizesSend, false);
});
test('same operator can have distinct branches, with coordination indicated', () => {
  assert.equal(compareBranchRecipients(branch('a', 'owner', 'a@brand.example'), branch('b', 'owner', 'b@brand.example'), now).reason, 'distinct_branches_same_operator_coordinate_outreach');
});
test('shared inbox never receives parallel branch sequences', () => {
  assert.equal(compareBranchRecipients(branch('a', 'x', 'INFO@brand.example'), branch('b', 'y', 'info@brand.example'), now).relation, 'same_recipient');
});
test('different city or mailbox alone does not prove separate ownership', () => {
  assert.equal(compareBranchRecipients({ email: 'a@brand.example', city: 'Windsor' }, { email: 'b@brand.example', city: 'Toronto' }, now).relation, 'review');
});
test('same branch multiple recipients requires coordination review', () => {
  assert.equal(compareBranchRecipients(branch('a', 'x', 'a@brand.example'), branch('a', 'x', 'b@brand.example'), now).reason, 'same_branch_multiple_contacts');
});
test('recipient suppressions survive dedup and related unclear suppressions remain held', () => {
  const a = branch('a', 'x', 'a@brand.example'), b = branch('b', 'y', 'b@brand.example');
  assert.equal(compareBranchRecipients({ ...a, do_not_contact: true }, b, now).relation, 'suppressed');
  assert.equal(compareBranchRecipients(a, { ...b, do_not_contact: true }, now).relation, 'review');
  assert.equal(compareBranchRecipients(a, { ...b, email: a.email, do_not_contact: true }, now).relation, 'suppressed');
});
test('stale evidence and evidence bound to another recipient cannot separate branches', () => {
  const a = branch('a', 'x', 'a@brand.example'), b = branch('b', 'y', 'b@brand.example');
  assert.equal(compareBranchRecipients(a, b, now + 86400000).relation, 'review');
  b.branchEvidence.recipient = 'other@brand.example';
  assert.equal(compareBranchRecipients(a, b, now).relation, 'review');
});
test('cohort keeps two verified branches on one domain and excludes shared inbox/holds', () => {
  const row = (id, recipient) => ({ ...branch(id, id, recipient), organisation_id: id, domain: 'brand.example' });
  const result = selectBranchAwareResearchCohort([row('a', 'a@brand.example'), row('b', 'b@brand.example'), row('c', 'a@brand.example'), { ...row('d', 'd@brand.example'), holds: ['identity_review'] }, row('e', 'e@brand.example')], { now, excludedEmails: ['e@brand.example'] });
  assert.equal(result.selected.length, 2); assert.equal(result.held.length, 3); assert.equal(result.campaignReady, 0);
});
test('cohort does not upgrade domain-only observations or duplicate entity mailboxes', () => {
  const a = { ...branch('a', 'a', 'a@brand.example'), organisation_id: 'a', domain: 'brand.example' };
  const r = selectBranchAwareResearchCohort([{ email: 'hq@brand.example', domain: 'brand.example', organisation_id: 'hq' }, a, { ...a, email: 'second@brand.example', branchEvidence: { ...a.branchEvidence, recipient: 'second@brand.example' } }], { now });
  assert.equal(r.selected.length, 1); assert.equal(r.selected[0].email, a.email);
  assert.ok(r.held.some(x => x.reason === 'shared_domain_branch_binding_requires_review'));
  assert.ok(r.held.some(x => x.reason === 'duplicate_entity'));
});
