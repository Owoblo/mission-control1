import test from 'node:test'
import assert from 'node:assert/strict'
import { canAccessJob, canUseJobs } from '../../lib/job-access'
import type { CRMLead, Job } from '../../lib/types'
import type { SessionPayload } from '../../lib/auth'
const job = { id: 'j', crmLeadId: 'l' } as Job
const lead = { id: 'l', branch: 'toronto', assignedRepUserId: 'rep1', assignedRepName: 'Assigned Rep' } as CRMLead
const session = (role: SessionPayload['role'], extra = {}): SessionPayload => ({ role, exp: Date.now()+60000, ...extra })
test('External crew and partnership roles cannot use legacy jobs even with a valid session', () => {
  for (const role of ['crew','partner_crew','partner_admin','partner_dispatcher','partnership_manager',undefined] as SessionPayload['role'][]) {
    assert.equal(canUseJobs(session(role)), false)
    assert.equal(canAccessJob(session(role), job, lead), false)
  }
})
test('Branch managers cannot see unlinked or another branch jobs', () => {
  const manager = session('manager', { branch: 'toronto' })
  assert.equal(canAccessJob(manager, job, lead), true)
  assert.equal(canAccessJob(manager, job, { ...lead, branch: 'windsor' }), false)
  assert.equal(canAccessJob(manager, { ...job, crmLeadId: undefined }, lead), false)
  assert.equal(canAccessJob(manager, job, { ...lead, id: 'other' }), false)
})
test('Sales access follows actual assignment, including branch boundary', () => {
  assert.equal(canAccessJob(session('sales_rep', { userId:'rep1' }), job, lead), true)
  assert.equal(canAccessJob(session('sales_rep', { userId:'rep2' }), job, lead), false)
  assert.equal(canAccessJob(session('sales_rep', { userId:'rep1', branch:'windsor' }), job, lead), false)
})
test('Operations needs a verified branch; owner retains legacy jobs access', () => {
  assert.equal(canAccessJob(session('operations_lead'), job, lead), false)
  assert.equal(canAccessJob(session('operations_lead', { branch:'toronto' }), job, lead), true)
  assert.equal(canAccessJob(session('owner'), { id:'old' } as Job), true)
})
