import assert from 'node:assert/strict'
import test from 'node:test'
import { canEditLead, leadMatchesSessionBranch } from '../../lib/server/sales-permissions'
import type { SessionPayload } from '../../lib/auth'
import type { CRMLead } from '../../lib/types'

const courage: SessionPayload = {
  exp: Date.now() + 60_000,
  userId: 'courage',
  name: 'Dr Courage',
  role: 'manager',
  branch: 'ottawa',
}

function lead(overrides: Partial<CRMLead>): CRMLead {
  return { id: 'lead', name: 'Customer', stage: 'new', createdAt: '2026-07-21', inventory: [], mediaAssets: [], callLogs: [], ...overrides }
}

test('Ottawa branch manager cannot read or edit another branch lead', () => {
  const windsorLead = lead({ branch: 'windsor', originCity: 'Windsor' })
  assert.equal(leadMatchesSessionBranch(windsorLead, courage), false)
  assert.equal(canEditLead(courage, windsorLead), false)
})

test('Ottawa branch manager can access explicit and legacy Ottawa records', () => {
  assert.equal(leadMatchesSessionBranch(lead({ branch: 'ottawa' }), courage), true)
  assert.equal(leadMatchesSessionBranch(lead({ originCity: 'Kanata' }), courage), true)
})

test('branch assignment wins over route geography for tenant isolation', () => {
  assert.equal(leadMatchesSessionBranch(lead({ branch: 'waterloo', destCity: 'Ottawa' }), courage), false)
})

test('owner remains company-wide', () => {
  assert.equal(leadMatchesSessionBranch(lead({ branch: 'windsor' }), { ...courage, role: 'owner', branch: undefined }), true)
})
