import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLiveCrewBriefing } from '../../lib/crew-briefing-view'
import type { CRMLead, CRMQuote } from '../../lib/types'

test('live crew briefing carries multi-leg scope, excludes, images, handling, and approved changes', () => {
  const lead = {
    id: 'lead', name: 'Customer', stage: 'booked', createdAt: '2026-08-01', originAddress: '1 Home St', destAddress: '9 Final St',
    inventory: [
      { id: 'sofa', name: 'Sleeper sofa', qty: 1, room: 'Basement', included: true, weightLbs: 260, originFloor: -1, destinationFloor: 2, source: 'customer_verification', status: 'confirmed' },
      { id: 'lamp', name: 'Broken lamp', qty: 1, room: 'Garage', included: false, exclusionReason: 'Customer keeping it' },
    ],
    mediaAssets: [{ id: 'photo', url: 'https://example.com/sofa.jpg', kind: 'image', source: 'survey', room: 'Basement', uploadedAt: '2026-08-01' }],
    jobFactors: { originFloors: 2, destFloors: 2, originHasElevator: false, destHasElevator: false, originParkingOk: true, destParkingOk: true },
  } as CRMLead
  const quote = {
    id: 'quote', number: 'Q-1', clientId: 'client', leadId: 'lead', status: 'accepted', billingModel: 'binding', lineItems: [{ description: 'Storage handling', details: 'Two service days', amount: 100 }], subtotal: 100, hst: 13, total: 113, deposit: 30, balance: 83, createdAt: '2026-08-01',
    legs: [
      { id: 'in', label: 'Storage in', type: 'storage', originAddress: '1 Home St', destAddress: '4 Storage Rd' },
      { id: 'out', label: 'Storage out', type: 'storage_delivery', originAddress: '4 Storage Rd', destAddress: '9 Final St' },
    ],
    changeLog: [{ id: 'change', changedAt: '2026-08-02', changedBy: 'Ops', reason: 'Added dresser', changeType: 'scope_change', previousTotal: 100, newTotal: 100, customerNotified: true, approvalRequired: true, approvalStatus: 'approved' }],
  } as CRMQuote
  const briefing = buildLiveCrewBriefing(lead, quote, 'Authorized instructions')
  assert.equal(briefing.routeLegs.length, 2)
  assert.equal(briefing.inventory.find(item => item.id === 'lamp')?.included, false)
  assert.equal(briefing.inventory.find(item => item.id === 'sofa')?.handling, 'specialty')
  assert.equal(briefing.photos[0].label, 'Basement')
  assert.equal(briefing.changes[0].status, 'approved')
  assert.ok(briefing.intelligence.risks.some(risk => risk.includes('storage handling cycle')))
})
