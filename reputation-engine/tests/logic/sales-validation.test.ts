import assert from 'node:assert/strict'
import { validateLeadPatchPayload } from '../../lib/server/sales-validation'

{
  const updates = validateLeadPatchPayload({
    followUpDate: '2026-05-15',
  })

  assert.equal(updates.followUpDate, '2026-05-15')
}

{
  const updates = validateLeadPatchPayload({
    opportunityContext: {
      position: 'collecting_inventory',
      bookingConfidence: 60,
      nextAction: 'Call after photos arrive',
      nextActionDueAt: '2026-07-29T14:00:00.000Z',
      updatedAt: '2026-07-28T14:00:00.000Z',
    },
    attributionSignals: [{
      id: 'attr_1',
      channel: 'Direct mail',
      influence: 'first_touch',
      confidence: 'confirmed',
      observedAt: '2026-07-28T14:00:00.000Z',
    }],
    moveRelationships: [{
      id: 'rel_1',
      contactId: 'contact_1',
      name: 'Jane Smith',
      role: 'listing_realtor',
      confidence: 'confirmed',
      createdAt: '2026-07-28T14:00:00.000Z',
    }],
  })

  assert.equal(updates.opportunityContext?.position, 'collecting_inventory')
  assert.equal(updates.attributionSignals?.length, 1)
  assert.equal(updates.moveRelationships?.[0]?.role, 'listing_realtor')
}
