import assert from 'node:assert/strict'
import { buildQuoteSendDedupeKey, normalizeQuoteSendRecipient } from '../../lib/quote-send-jobs'

const base = {
  quoteId: 'quote_1',
  leadId: 'lead_1',
  channel: 'sms' as const,
  recipient: '(226) 773-2993',
  body: 'Your quote is ready',
}

assert.equal(normalizeQuoteSendRecipient('sms', '(226) 773-2993'), '+12267732993')
assert.equal(normalizeQuoteSendRecipient('email', ' Customer@Example.COM '), 'customer@example.com')

{
  const first = buildQuoteSendDedupeKey(base)
  const second = buildQuoteSendDedupeKey({
    ...base,
    recipient: '+1 226 773 2993',
  })
  assert.equal(first, second)
}

{
  const first = buildQuoteSendDedupeKey(base)
  const changedBody = buildQuoteSendDedupeKey({
    ...base,
    body: 'Your updated quote is ready',
  })
  assert.notEqual(first, changedBody)
}

{
  const email = buildQuoteSendDedupeKey({
    ...base,
    channel: 'email',
    recipient: 'customer@example.com',
    subject: 'Quote',
    htmlBody: '<p>Your quote is ready</p>',
  })
  const sms = buildQuoteSendDedupeKey(base)
  assert.notEqual(email, sms)
}
