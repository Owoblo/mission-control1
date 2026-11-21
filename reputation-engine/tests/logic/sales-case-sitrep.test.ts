import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSalesCaseSitrep } from '../../lib/sales-case-sitrep'
import type { CRMLead, CRMQuote } from '../../lib/types'

const lead = (overrides: Partial<CRMLead> = {}): CRMLead => ({
  id: 'lead-test',
  name: 'Test Customer',
  stage: 'lost',
  createdAt: '2026-10-01',
  source: 'twilio_sms',
  lostReason: 'availability',
  ...overrides,
})

test('builds a sourced chronology and measures the first outbound from first inbound', () => {
  const report = buildSalesCaseSitrep({
    lead: lead({ originCity: 'Windsor', destCity: 'London', moveDate: '2026-10-10' }),
    messages: [
      { id: 'in-1', direction: 'inbound', body: 'Can you move a small bed?', createdAt: '2026-10-01T14:00:00.000Z', channel: 'sms' },
      { id: 'out-1', direction: 'outbound', body: 'Yes, what date works?', createdAt: '2026-10-01T14:10:00.000Z', channel: 'sms' },
    ],
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })

  assert.match(report, /First recorded inbound touch: Oct 01, 2026, 10:00 a\.m\. EDT \(sms\)\. First recorded outbound: Oct 01, 2026, 10:10 a\.m\. EDT \(sms\), about 10 minutes later\./)
  assert.match(report, /CRM-recorded two-minute response-attempt target: missed/)
  assert.ok(report.indexOf('Customer sms: Can you move a small bed?') < report.indexOf('Sales sms: Yes, what date works?'))
  assert.match(report, /Source labels describe the CRM intake\/routing channel/)
  assert.doesNotMatch(report, /partner\/referral name .*Partnerships/)
})

test('flags conflicting event order instead of reporting a negative response delay', () => {
  const report = buildSalesCaseSitrep({
    lead: lead(),
    messages: [
      { direction: 'outbound', body: 'Hello', createdAt: '2026-10-01T13:00:00.000Z', channel: 'sms' },
      { direction: 'inbound', body: 'Hi', createdAt: '2026-10-01T14:00:00.000Z', channel: 'sms' },
    ],
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })
  assert.match(report, /predates it; no outbound event after that first inbound is linked/)
})

test('does not grade an inbound phone call by the time of a later email when pickup evidence is missing', () => {
  const report = buildSalesCaseSitrep({
    lead: lead(),
    partnershipTouches: [
      { id: 'partner-call', direction: 'inbound', channel: 'phone', notes: 'Inbound call received.', createdAt: '2026-10-01T14:00:00.000Z' },
      { id: 'partner-email', direction: 'outbound', channel: 'email', notes: 'Good speaking with you today.', createdAt: '2026-10-01T15:42:00.000Z' },
    ],
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })
  assert.match(report, /live-pickup SLA: unmeasurable/)
  assert.match(report, /First later outbound follow-up: Oct 01, 2026, 11:42 a\.m\. EDT \(Partnership email\), about 1h 42m later/)
  assert.doesNotMatch(report, /two-minute response-attempt target: missed/)
})

test('uses a provider-stamped answer even before the call duration is available', () => {
  const report = buildSalesCaseSitrep({
    lead: lead({ callLogs: [{
      id: 'call-1', type: 'inbound', direction: 'inbound', date: '2026-10-01T14:00:00.000Z',
      callOutcome: 'answered', answeredAt: '2026-10-01T14:00:07.000Z', answerLatencySeconds: 7,
      answeredBy: 'browser', audioConnected: true,
    }] }),
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })

  assert.match(report, /TwiML-routing-start-to-answer 7s/)
  assert.match(report, /The call was answered live/)
})

test('uses partnership inbound context when measuring Sales response and keeps referral attribution distinct', () => {
  const report = buildSalesCaseSitrep({
    lead: lead({ source: 'relationship_contact', relationshipContactName: 'Lynn Faris', relationshipContactCompany: 'Royal Heritage Realty Ltd.' }),
    partnershipTouches: [
      { id: 'partner-in', direction: 'inbound', channel: 'sms', notes: 'Asked if we were available for a move.', createdAt: '2026-10-08T18:30:00.000Z' },
    ],
    messages: [
      { id: 'sales-out', direction: 'outbound', body: 'We can help. Please send the addresses.', createdAt: '2026-10-08T18:46:00.000Z', channel: 'sms' },
    ],
    quotes: [{
      id: 'quote-date-only', number: 'QT-DATE', clientId: 'client-test', status: 'draft', lineItems: [], subtotal: 1, hst: 0.13, total: 1.13, deposit: 0, balance: 1.13, createdAt: '2026-10-08',
    }],
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })

  assert.match(report, /First recorded inbound touch: Oct 08, 2026, 2:30 p\.m\. EDT \(Partnership sms\)\. First recorded outbound: Oct 08, 2026, 2:46 p\.m\. EDT \(sms\), about 16 minutes later\./)
  assert.match(report, /CRM-recorded two-minute response-attempt target: missed/)
  assert.match(report, /Linked partner referral: none recorded\. Linked relationship contact: Lynn Faris \(Royal Heritage Realty Ltd\)\./)
  assert.match(report, /Oct 08, 2026 \(date only; time not recorded\)/)
})

test('reports booked jobs with passed dates and missing move-day/payment/review evidence', () => {
  const quote: CRMQuote = {
    id: 'quote-test', number: 'QT-TEST', clientId: 'client-test', status: 'accepted',
    lineItems: [], subtotal: 500, hst: 65, total: 565, deposit: 169.5, balance: 395.5,
    createdAt: '2026-10-01', moveDate: '2026-10-10', billingModel: 'binding',
  }
  const report = buildSalesCaseSitrep({
    lead: lead({ stage: 'booked', bookedAt: '2026-10-02T14:00:00.000Z', moveDate: '2026-10-10' }),
    quotes: [quote],
    asOf: new Date('2026-10-21T15:00:00.000Z'),
  })
  assert.match(report, /Scheduled move date has passed Current CRM stage: booked/)
  assert.match(report, /Move execution log: 0 milestone\(s\)/)
  assert.match(report, /Customer payment status: not recorded/)
  assert.match(report, /No review request timestamp recorded/)
  assert.match(report, /Move date is past while CRM stage remains booked/)
})
