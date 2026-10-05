import assert from 'node:assert/strict'
import test from 'node:test'
import { callMatchesDashboardBranch, scopeDashboard } from '../../lib/server/dashboard-scope'
import type { SessionPayload } from '../../lib/auth'
import type { CRMLead, CRMQuote, FollowUpLog } from '../../lib/types'

const session = { role: 'manager', branch: 'ottawa', userId: 'courage' } as SessionPayload
const overview = {
  leads: [{ id: 'ottawa', branch: 'ottawa' }, { id: 'windsor', branch: 'windsor' }] as CRMLead[],
  quotes: [{ id: 'oq', leadId: 'ottawa' }, { id: 'wq', leadId: 'windsor' }, { id: 'unlinked' }] as CRMQuote[],
  followUps: [{ id: 'of', leadId: 'ottawa' }, { id: 'wf', leadId: 'windsor' }, { id: 'quote-only', quoteId: 'oq' }, { id: 'conflicting', leadId: 'windsor', quoteId: 'oq' }] as FollowUpLog[],
}

test('Ottawa dashboard excludes other branches and unlinked quotes, including drilldowns', () => {
  const result = scopeDashboard(overview, session)
  assert.deepEqual(result.leads.map(row => row.id), ['ottawa'])
  assert.deepEqual(result.quotes.map(row => row.id), ['oq'])
  assert.deepEqual(result.followUps.map(row => row.id), ['of', 'quote-only'])
  assert.equal(overview.leads.length, 2)
})

test('central owner retains full dashboard', () => {
  assert.equal(scopeDashboard(overview, { role: 'owner' } as SessionPayload), overview)
})

test('Ottawa calls include both sales and partnership lines, with linked-lead fallback', () => {
  const ids = new Set(['ottawa'])
  assert.equal(callMatchesDashboardBranch({ branchNumber: '+16135193236' }, 'ottawa', ids), true)
  assert.equal(callMatchesDashboardBranch({ sourceNumber: '+15482908695' }, 'ottawa', ids), true)
  assert.equal(callMatchesDashboardBranch({ leadId: 'ottawa' }, 'ottawa', ids), true)
  assert.equal(callMatchesDashboardBranch({ leadId: 'windsor' }, 'ottawa', ids), false)
  assert.equal(callMatchesDashboardBranch({}, 'ottawa', ids), false)
})
