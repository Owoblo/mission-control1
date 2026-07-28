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
    propertyBedrooms: '3_bedrooms',
    propertyType: 'detached_house',
  })

  assert.equal(updates.propertyBedrooms, '3_bedrooms')
  assert.equal(updates.propertyType, 'detached_house')
}

{
  assert.throws(
    () => validateLeadPatchPayload({
      propertyBedrooms: '12_bedrooms',
    } as never),
    /Invalid property bedrooms/,
  )

  assert.throws(
    () => validateLeadPatchPayload({
      propertyType: 'castle',
    } as never),
    /Invalid property type/,
  )
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
