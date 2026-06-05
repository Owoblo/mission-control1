import assert from 'node:assert/strict'
import { computeBranchCapacitySnapshot, listCapacityConflicts } from '../../lib/operations-capacity'
import type { CRMLead, CRMQuote } from '../../lib/types'

function makeJob(index: number, truckCount: number) {
  const lead: CRMLead = {
    id: `lead_${index}`,
    name: `Lead ${index}`,
    stage: 'booked',
    branch: 'windsor',
    moveDate: '2026-05-24',
    assignedCrew: ['c1', 'c2', 'c3'],
    createdAt: '2026-05-20',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
  }

  const quote: CRMQuote = {
    id: `quote_${index}`,
    number: `QT-${index}`,
    clientId: `client_${index}`,
    leadId: lead.id,
    moveDate: '2026-05-24',
    crewSize: 3,
    truckCount,
    status: 'accepted',
    lineItems: [],
    subtotal: 1000,
    hst: 130,
    total: 1130,
    deposit: 200,
    balance: 930,
    createdAt: '2026-05-20',
  }

  return { lead, quote }
}

const jobs = [
  makeJob(1, 2),
  makeJob(2, 2),
  makeJob(3, 2),
]

const snapshot = computeBranchCapacitySnapshot(jobs, 'windsor', '2026-05-24')
assert.equal(snapshot.status, 'ready')
assert.equal(snapshot.trucksUsed, 6)
assert.equal(snapshot.truckCapacity, 5)
assert.equal(snapshot.risk, 'high')

const conflicts = listCapacityConflicts(jobs)
assert.equal(conflicts.length, 1)
assert.equal(conflicts[0]?.truckOverage, 1)

const changedMoveDateJob = makeJob(4, 1)
changedMoveDateJob.lead.moveDate = '2026-05-25'
changedMoveDateJob.quote!.moveDate = '2026-05-24'

const changedDateSnapshot = computeBranchCapacitySnapshot([changedMoveDateJob], 'windsor', '2026-05-25')
assert.equal(changedDateSnapshot.jobsBooked, 1)

const staleQuoteDateSnapshot = computeBranchCapacitySnapshot([changedMoveDateJob], 'windsor', '2026-05-24')
assert.equal(staleQuoteDateSnapshot.jobsBooked, 0)
