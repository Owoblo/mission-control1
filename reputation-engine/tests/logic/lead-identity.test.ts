import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseCanonicalLead,
  findLeadIdentityMatches,
  mergeLeadRecords,
  normalizeLeadIdentityPhone,
} from '../../lib/server/lead-identity'
import type { CRMLead } from '../../lib/types'

function makeLead(overrides: Partial<CRMLead>): CRMLead {
  return {
    id: overrides.id || 'lead_1',
    name: overrides.name || 'Lead Name',
    stage: overrides.stage || 'new',
    createdAt: overrides.createdAt || '2026-05-01',
    inventory: overrides.inventory || [],
    mediaAssets: overrides.mediaAssets || [],
    callLogs: overrides.callLogs || [],
    ...overrides,
  }
}

test('lead identity matches North American phone variants as the same customer', () => {
  const leads: CRMLead[] = [
    makeLead({
      id: 'lead_a',
      name: 'Roland Eight',
      phone: '+1 (519) 555-0101',
      createdAt: '2026-05-01',
    }),
    makeLead({
      id: 'lead_b',
      name: 'Different Lead',
      phone: '+1 (226) 555-0101',
      createdAt: '2026-05-02',
    }),
  ]

  const matches = findLeadIdentityMatches(leads, {
    phone: '519-555-0101',
    includeClosed: false,
  })

  assert.equal(normalizeLeadIdentityPhone('5195550101'), '+15195550101')
  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.id, 'lead_a')
})

test('canonical lead selection prefers richer active records over placeholders', () => {
  const canonical = chooseCanonicalLead([
    makeLead({
      id: 'placeholder',
      name: 'Unknown Caller',
      stage: 'new',
      phone: '+15195550101',
      createdAt: '2026-05-01',
    }),
    makeLead({
      id: 'quoted',
      name: 'Roland Eight',
      stage: 'quoted',
      phone: '519-555-0101',
      email: 'roland@example.com',
      quoteId: 'quote_1',
      moveDate: '2026-06-01',
      createdAt: '2026-05-02',
      lastTouchedAt: '2026-05-05T10:00:00.000Z',
    }),
  ])

  assert.equal(canonical?.id, 'quoted')
})

test('closed customer matches are opt-in and beat new SMS placeholders', () => {
  const leads: CRMLead[] = [
    makeLead({
      id: 'sms_placeholder',
      name: '+15199990000',
      stage: 'new',
      phone: '+1 519 999 0000',
      inboundId: 'inb_new_sms',
      createdAt: '2026-06-06',
    }),
    makeLead({
      id: 'completed_customer',
      name: 'Rosemary Customer',
      stage: 'completed',
      phone: '519-999-0000',
      email: 'rosemary@example.com',
      moveDate: '2026-05-30',
      bookedAt: '2026-05-20T14:00:00.000Z',
      createdAt: '2026-05-01',
    }),
  ]

  const activeOnly = findLeadIdentityMatches(leads, {
    phone: '5199990000',
    includeClosed: false,
  })
  assert.equal(activeOnly[0]?.id, 'sms_placeholder')

  const withClosed = findLeadIdentityMatches(leads, {
    phone: '5199990000',
    includeClosed: true,
  })
  assert.equal(withClosed[0]?.id, 'completed_customer')
})

test('merging duplicate leads keeps one timeline and preserves richer details', () => {
  const primary = makeLead({
    id: 'lead_primary',
    name: 'Roland Eight',
    stage: 'quoted',
    phone: '+15195550101',
    email: 'roland@example.com',
    quoteId: 'quote_1',
    moveDate: '2026-06-01',
    callLogs: [{ id: 'call_1', type: 'call', date: '2026-05-01T10:00:00.000Z', notes: 'Initial call', callSid: 'CA123' }],
    notes: 'Quoted from web form.',
    createdAt: '2026-05-01',
  })
  const duplicate = makeLead({
    id: 'lead_duplicate',
    name: 'Unknown Caller',
    stage: 'contacted',
    phone: '519-555-0101',
    email: 'ROLAND@example.com',
    quoteIds: ['quote_2'],
    callLogs: [{ id: 'call_2', type: 'call', date: '2026-05-02T10:00:00.000Z', notes: 'Follow-up call', callSid: 'CA456' }],
    notes: 'Came back through direct mail.',
    createdAt: '2026-05-02',
  })

  const merged = mergeLeadRecords(primary, duplicate)

  assert.equal(merged.id, 'lead_primary')
  assert.equal(merged.name, 'Roland Eight')
  assert.equal(merged.identityPhone, '+15195550101')
  assert.equal(merged.identityEmail, 'roland@example.com')
  assert.deepEqual(merged.quoteIds, ['quote_1', 'quote_2'])
  assert.equal(merged.callLogs?.length, 2)
  assert.match(merged.notes || '', /Quoted from web form\./)
  assert.match(merged.notes || '', /Came back through direct mail\./)
})
