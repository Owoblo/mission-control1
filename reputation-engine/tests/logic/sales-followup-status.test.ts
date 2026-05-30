import assert from 'node:assert/strict'
import { normalizeLead } from '../../lib/sales'
import type { CRMLead } from '../../lib/types'

const baseLead: CRMLead = {
  id: 'lead_followup_status',
  name: 'Test Lead',
  stage: 'contacted',
  createdAt: '2026-05-20',
  source: 'website_form',
  inventory: [],
  mediaAssets: [],
  callLogs: [],
}

{
  const normalized = normalizeLead({
    ...baseLead,
    lastInboundAt: '2026-05-20T10:00:00.000Z',
  })

  assert.equal(normalized.followUpStatus, 'pending')
}

{
  const normalized = normalizeLead({
    ...baseLead,
    followUpDate: '2099-05-24',
    lastInboundAt: '2026-05-20T10:00:00.000Z',
    lastHumanOutboundAt: '2026-05-20T12:00:00.000Z',
  })

  assert.equal(normalized.followUpStatus, 'following_up')
}

{
  const normalized = normalizeLead({
    ...baseLead,
    followUpDate: '2026-05-01',
    lastInboundAt: '2026-05-20T10:00:00.000Z',
    lastHumanOutboundAt: '2026-05-20T12:00:00.000Z',
  })

  assert.equal(normalized.followUpStatus, 'no_response')
}

{
  const normalized = normalizeLead({
    ...baseLead,
    followUpStatus: 'followed_up',
    lastInboundAt: '2026-05-20T10:00:00.000Z',
  })

  assert.equal(normalized.followUpStatus, 'followed_up')
}
