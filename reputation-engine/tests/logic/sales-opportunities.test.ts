import assert from 'node:assert/strict'
import { applyRealtorContactToOpportunityLead, buildDestinationOpportunityPitch } from '../../lib/realtor-opportunity'
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

  assert.equal(updated.name, 'Varinder Singh')
  assert.equal(updated.phone, '+15195551212')
  assert.equal(updated.email, 'varinder@example.com')
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
