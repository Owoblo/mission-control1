import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDraftLeadSignature,
  buildLeadDraftPayload,
  buildSavedLeadSignature,
  createLeadDraftState,
} from '../../app/components/sales/lead-detail/lead-draft'
import type { CRMLead } from '../../lib/types'

function makeLead(inventory: CRMLead['inventory']): CRMLead {
  return {
    id: 'lead_autosave_1',
    name: 'Sam',
    phone: '226-000-0000',
    email: 'sam@example.com',
    stage: 'quoted',
    createdAt: '2026-06-06T10:00:00.000Z',
    moveDate: '2026-06-30',
    moveType: 'residential',
    originAddress: '203 Catherine Street #601, Ottawa, ON, Canada',
    destAddress: '2A Caroline Avenue, Ottawa, ON, Canada',
    inventory,
    mediaAssets: [],
    callLogs: [],
  }
}

test('lead draft autosave ignores inventory changes handled by dedicated inventory persistence', () => {
  const leadWithSamInventory = makeLead([
    { id: 'item_1', name: 'Sectional Sofa', room: 'Living Room', qty: 1, cubicFeet: 90, included: true, owner: 'person_a' },
  ])
  const leadAfterConjointEdit = makeLead([
    { id: 'item_2', name: 'Dining Table', room: 'Dining Room', qty: 1, cubicFeet: 40, included: true, owner: 'person_b' },
  ])

  assert.equal(buildSavedLeadSignature(leadWithSamInventory), buildSavedLeadSignature(leadAfterConjointEdit))

  const draft = createLeadDraftState(leadWithSamInventory)
  const draftAfterInventoryEdit = {
    ...draft,
    inventory: leadAfterConjointEdit.inventory,
  }
  assert.equal(buildDraftLeadSignature(draft), buildDraftLeadSignature(draftAfterInventoryEdit))

  const payload = buildLeadDraftPayload(leadWithSamInventory, draftAfterInventoryEdit)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'inventory'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'roomBreakdown'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'totalCubicFeet'), false)
})

test('lead draft persists structured partnership attribution and clears it when source changes', () => {
  const lead = makeLead([])
  const draft = {
    ...createLeadDraftState(lead),
    leadSource: 'partner_referral',
    partnerReferral: {
      id: 'contact_realtor_1',
      name: 'Alex Realtor',
      company: 'North Star Realty',
      category: 'realtor',
      email: 'alex@example.com',
      city: 'London',
    },
  }

  const linked = buildLeadDraftPayload(lead, draft)
  assert.equal(linked.source, 'partner_referral')
  assert.equal(linked.partnerReferralContactId, 'contact_realtor_1')
  assert.equal(linked.partnerReferralName, 'Alex Realtor')
  assert.equal(linked.partnerReferralCompany, 'North Star Realty')

  const cleared = buildLeadDraftPayload(
    { ...lead, ...linked } as CRMLead,
    { ...draft, leadSource: 'google_online_search', partnerReferral: null }
  )
  assert.equal(cleared.partnerReferralContactId, '')
  assert.equal(cleared.partnerReferralName, '')
})

test('lead draft does not persist an incomplete partnership source while selection is in progress', () => {
  const lead = makeLead([])
  const draft = {
    ...createLeadDraftState(lead),
    leadSource: 'partner_referral',
    partnerReferral: null,
  }
  const payload = buildLeadDraftPayload(lead, draft)
  assert.equal(payload.source, lead.source)
  assert.equal(payload.partnerReferralContactId, '')
})
