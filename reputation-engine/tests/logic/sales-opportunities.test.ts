import assert from 'node:assert/strict'
import { normalizeLead } from '../../lib/sales'
import {
  applyRealtorContactToOpportunityLead,
  buildDestinationOpportunityPitch,
  canAutoApplyRealtorContact,
  getListingSideContactDisplayName,
  getListingSideContactRoleLabel,
} from '../../lib/realtor-opportunity'
import type { CRMLead } from '../../lib/types'

const baseLead: CRMLead = {
  id: 'lead_opportunity',
  name: 'Realtor lead — 631 Doon South Drive',
  stage: 'new',
  createdAt: '2026-05-15',
  leadKind: 'realtor_opportunity',
  primaryContactRole: 'realtor',
  source: 'destination_opportunity',
  moveType: 'residential',
  opportunityAddress: '631 Doon South Drive, Kitchener, ON, Canada',
  sourceLeadMoveDate: '2026-06-26',
  inventory: [],
  mediaAssets: [],
  callLogs: [],
}

{
  const updated = applyRealtorContactToOpportunityLead(baseLead, {
    realtorName: 'Varinder Singh',
    realtorPhone: '+15195551212',
    realtorEmail: 'varinder@example.com',
  })

  assert.equal(updated.name, baseLead.name)
  assert.equal(updated.phone, undefined)
  assert.equal(updated.email, undefined)
  assert.equal(updated.realtorName, 'Varinder Singh')
  assert.equal(updated.realtorPhone, '+15195551212')
  assert.equal(updated.realtorEmail, 'varinder@example.com')
}

{
  const normalized = normalizeLead({
    ...baseLead,
    realtorName: 'Varinder Kaur Singh',
    realtorPhone: '4167405100',
  })

  assert.equal(normalized.name, baseLead.name)
  assert.equal(normalized.phone, undefined)
  assert.equal(normalized.realtorName, 'Varinder Kaur Singh')
  assert.equal(normalized.realtorPhone, '4167405100')
}

{
  const safe = canAutoApplyRealtorContact({
    rawText: 'Listing agent Sean Turner, Sutton Group Select Realty Inc., email shawn@shawnturner.ca, call 519-777-9961.',
    expectedBrokerage: 'Sutton Group Select Realty Inc.',
    realtorName: 'Sean Turner',
    realtorPhone: '519-777-9961',
    realtorEmail: 'shawn@shawnturner.ca',
    realtorBrokerage: 'Sutton Group Select Realty Inc.',
    contactKind: 'listing_agent',
    confidence: 'high',
  })

  assert.equal(safe, true)
}

{
  const unsafePersonalEmail = canAutoApplyRealtorContact({
    rawText: 'Angela Cope can be reached at angelamcope@icloud.com or 519-566-5701 for the listing.',
    expectedBrokerage: 'Remax Preferred Realty Ltd. - 588 Brokerage',
    realtorName: 'Angela Cope',
    realtorPhone: '519-566-5701',
    realtorEmail: 'angelamcope@icloud.com',
    realtorBrokerage: 'Remax Preferred Realty Ltd. - 588 Brokerage',
    contactKind: 'sales_representative',
    confidence: 'high',
  })

  assert.equal(unsafePersonalEmail, false)
}

{
  const displayName = getListingSideContactDisplayName(baseLead)
  assert.equal(displayName, 'Listing-side contact pending')
  assert.equal(getListingSideContactRoleLabel('sales_representative'), 'Sales representative')
}

{
  const sms = buildDestinationOpportunityPitch({
    ...baseLead,
    realtorName: 'Varinder Singh',
  }, 'sms')

  assert.match(sms, /Varinder/i)
  assert.match(sms, /631 Doon South Drive/i)
  assert.match(sms, /paired-move rate/i)
  assert.match(sms, /Jun/i)
}

{
  const email = buildDestinationOpportunityPitch({
    ...baseLead,
    realtorName: 'Varinder Singh',
  }, 'email')

  assert.match(email.subject, /631 Doon South Drive/i)
  assert.match(email.body, /Saturn Star Moving/i)
  assert.match(email.body, /preferred paired-move rate/i)
}
