import test from 'node:test'
import assert from 'node:assert/strict'
import { validateOutboundMessage } from '../../lib/server/saturn-send-gate'

test('blocks unresolved single and double brace template fields', () => {
  for (const body of ['Hi {first},', 'Serving {{city}} and surrounding areas.']) {
    assert.deepEqual(validateOutboundMessage({ body, to: '+15195551234', from: '+15485551234' }), { allowed: false, reason: 'unresolved_template_variable' })
  }
})

test('allows a rendered message with valid NANP numbers', () => {
  assert.deepEqual(validateOutboundMessage({ body: 'Hi Alan, this is John.', to: '+15195551234', from: '+15485551234' }), { allowed: true })
})

test('preserves media-only replies while rejecting messages with no content', () => {
  const numbers = { to: '+15195551234', from: '+15485551234' }
  assert.deepEqual(validateOutboundMessage({ ...numbers, body: '', mediaUrls: ['https://example.com/card.jpg'] }), { allowed: true })
  for (const mediaUrls of [undefined, [], ['  ']]) {
    assert.deepEqual(validateOutboundMessage({ ...numbers, body: ' ', mediaUrls }), { allowed: false, reason: 'empty_message' })
  }
})

test('media does not bypass addressing or unresolved-template checks', () => {
  const input = { body: '', to: '+15195551234', from: '+15485551234', mediaUrls: ['https://example.com/card.jpg'] }
  assert.deepEqual(validateOutboundMessage({ ...input, to: 'invalid' }), { allowed: false, reason: 'invalid_recipient' })
  assert.deepEqual(validateOutboundMessage({ ...input, from: 'invalid' }), { allowed: false, reason: 'invalid_sender' })
  assert.deepEqual(validateOutboundMessage({ ...input, body: 'Hi {{name}}' }), { allowed: false, reason: 'unresolved_template_variable' })
})

test('blocks invalid recipient and sender before provider contact', () => {
  const recipient = validateOutboundMessage({ body: 'Hi there', to: '5195551234', from: '+15485551234' })
  const sender = validateOutboundMessage({ body: 'Hi there', to: '+15195551234', from: '15485551234' })
  assert.equal(recipient.allowed, false)
  assert.equal(sender.allowed, false)
  if (!recipient.allowed && !sender.allowed) {
    assert.equal(recipient.reason, 'invalid_recipient')
    assert.equal(sender.reason, 'invalid_sender')
  }
})
