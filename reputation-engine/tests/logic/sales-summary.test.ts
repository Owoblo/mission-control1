import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesSummary } from '../../lib/sales'
import type { CRMLead, CRMQuote } from '../../lib/types'

test('buildSalesSummary separates active leads from total lead records', () => {
  const leads: CRMLead[] = [
    {
      id: 'lead_active',
      name: 'Active Lead',
      stage: 'new',
      commercialDisposition: 'qualified_lead',
      createdAt: '2026-05-15',
      inventory: [],
      mediaAssets: [],
      callLogs: [],
    },
    {
      id: 'lead_booked',
      name: 'Booked Lead',
      stage: 'booked',
      commercialDisposition: 'customer',
      createdAt: '2026-05-15',
      inventory: [],
      mediaAssets: [],
      callLogs: [],
    },
    {
      id: 'lead_lost',
      name: 'Lost Lead',
      stage: 'lost',
      commercialDisposition: 'qualified_lead',
      createdAt: '2026-05-15',
      inventory: [],
      mediaAssets: [],
      callLogs: [],
    },
  ]

  const quotes: CRMQuote[] = []
  leads.push({ id: 'noise', name: 'Internal call', stage: 'new', createdAt: '2026-05-15', commercialDisposition: 'not_a_lead' })
  leads.push({ id: 'unknown', name: 'Unknown', stage: 'new', createdAt: '2026-05-15' })
  const summary = buildSalesSummary(leads, quotes)

  assert.equal(summary.totalLeads, 3)
  assert.equal(summary.activeLeads, 1)
  assert.equal(summary.bookedLeads, 1)
})
