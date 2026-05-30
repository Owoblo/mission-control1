import assert from 'node:assert/strict'
import { buildCRMAnalyticsSnapshot } from '../../lib/server/crm-analytics'
import type { CRMLead, CRMQuote } from '../../lib/types'

const leads: CRMLead[] = [
  {
    id: 'lead_a',
    name: 'Booked Lead',
    stage: 'booked',
    source: 'google_online_search',
    branch: 'windsor',
    assignedRepName: 'John',
    assignedRepUserId: 'rep_1',
    createdAt: '2026-05-01',
    bookedAt: '2026-05-04',
    firstResponseAt: '2026-05-01T12:00:00.000Z',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
  },
  {
    id: 'lead_b',
    name: 'Tentative Lead',
    stage: 'tentative',
    source: 'customer_referral',
    branch: 'windsor',
    assignedRepName: 'John',
    assignedRepUserId: 'rep_1',
    createdAt: '2026-05-03',
    firstResponseAt: '2026-05-05T12:00:00.000Z',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
  },
  {
    id: 'lead_c',
    name: 'Lost Lead',
    stage: 'lost',
    source: 'customer_referral',
    branch: 'windsor',
    assignedRepName: 'Mary',
    assignedRepUserId: 'rep_2',
    createdAt: '2026-05-02',
    lostAt: '2026-05-06',
    lostReason: 'price',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
  },
]

const quotes: CRMQuote[] = [
  {
    id: 'quote_a',
    number: 'QT-A',
    clientId: 'client_a',
    leadId: 'lead_a',
    moveDate: '2026-05-24',
    crewSize: 3,
    truckCount: 1,
    status: 'accepted',
    lineItems: [],
    subtotal: 2000,
    hst: 260,
    total: 2260,
    deposit: 400,
    balance: 1860,
    createdAt: '2026-05-02',
    acceptedAt: '2026-05-04T15:00:00.000Z',
  },
]

const snapshot = buildCRMAnalyticsSnapshot(leads, quotes, [], {
  range: 'month',
  dateFrom: '2026-05-01',
  dateTo: '2026-05-31',
})

assert.equal(snapshot.totals.leadsReceived, 3)
assert.equal(snapshot.totals.confirmedBookings, 1)
assert.equal(snapshot.totals.tentativeReservations, 1)
assert.equal(snapshot.totals.lostLeads, 1)
assert.equal(snapshot.totals.confirmedRevenue, 2260)
assert.equal(snapshot.totals.averageQuoteValue, 2260)
assert.equal(snapshot.totals.followUpComplianceRate, 50)
assert.equal(snapshot.lostReasons[0]?.reason, 'price')
assert.equal(snapshot.filters.repOptions.length, 2)
