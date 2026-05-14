import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInboundQueueSummary,
  decorateInboundLead,
  isQrOrDirectMailLead,
} from '../../lib/inbound-inbox'
import type { InboundLead } from '../../lib/types'

function makeInboundLead(overrides: Partial<InboundLead>): InboundLead {
  return {
    id: overrides.id || 'inbound_1',
    source: overrides.source || 'website_form',
    created_at: overrides.created_at || new Date().toISOString(),
    claimed: overrides.claimed ?? false,
    ...overrides,
  }
}

test('buildInboundQueueSummary separates open work, recent handoffs, and closed dispositions', () => {
  const openWebLead = decorateInboundLead(makeInboundLead({
    id: 'web_1',
    source: 'website_form',
    name: 'Robert',
    message: 'Need a quote for my move',
    raw_data: {
      aiSummary: {
        moveReadiness: 'hot',
      },
    },
  }))

  const recentHandoff = decorateInboundLead(makeInboundLead({
    id: 'dm_1',
    source: 'direct_mail',
    claimed: true,
    claimed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    raw_data: {
      linkedLeadId: 'lead_123',
      inboxDisposition: 'open',
    },
  }))

  const closedLostLead = decorateInboundLead(makeInboundLead({
    id: 'call_1',
    source: 'twilio_call',
    claimed: true,
    claimed_at: new Date().toISOString(),
    raw_data: {
      inboxDisposition: 'lost',
    },
  }))

  const summary = buildInboundQueueSummary([openWebLead, recentHandoff, closedLostLead])

  assert.equal(openWebLead.inboxStatus, 'needs_action')
  assert.equal(recentHandoff.inboxStatus, 'recent_handoff')
  assert.equal(closedLostLead.inboxStatus, 'closed')

  assert.equal(summary.queue, 1)
  assert.equal(summary.priority, 1)
  assert.equal(summary.webForms, 2)
  assert.equal(summary.recentHandoffs, 1)
  assert.equal(summary.closed, 1)
  assert.equal(summary.focus.needs_action, 1)
  assert.equal(summary.focus.web_qr, 1)
  assert.equal(summary.focus.high_intent, 1)
  assert.equal(summary.closedByDisposition.lost, 1)
})

test('QR and mail attribution respects canonical source and raw tracking metadata', () => {
  const directMail = makeInboundLead({
    id: 'direct_1',
    source: 'direct_mail',
  })

  const qrTaggedWebForm = makeInboundLead({
    id: 'web_qr_1',
    source: 'website_form',
    raw_data: {
      trackingSource: 'saturn postcard qr',
    },
  })

  assert.equal(isQrOrDirectMailLead(directMail), true)
  assert.equal(isQrOrDirectMailLead(qrTaggedWebForm), true)
})
