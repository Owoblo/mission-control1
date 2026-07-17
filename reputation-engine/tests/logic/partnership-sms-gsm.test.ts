import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureSmsOptOutLine,
  isPlainGsmSms,
  mergePartnershipSmsTemplate,
  normalizeSmsToGsm,
} from '../../lib/server/partnership-sms'

test('partnership SMS templates normalize smart punctuation to GSM-safe text', () => {
  const input = 'Hey {{first_name}}, I\u2019m Courage \u2014 Ottawa\u2019s mover\u2026'
  const normalized = normalizeSmsToGsm(input)

  assert.equal(normalized, "Hey {{first_name}}, I'm Courage - Ottawa's mover...")
  assert.equal(isPlainGsmSms(normalized), true)
})

test('partnership SMS rendering keeps merged values GSM-safe', () => {
  const rendered = mergePartnershipSmsTemplate(
    'Hey {{first_name}}, I\u2019m serving {{city}}.',
    { name: 'Jos\u00E9 Tremblay', city: 'Orl\u00E9ans' }
  )

  assert.equal(rendered, "Hey Jose, I'm serving Orleans.")
  assert.equal(isPlainGsmSms(rendered), true)
})

test('campaign template cleanup runs through ensureSmsOptOutLine', () => {
  assert.equal(
    ensureSmsOptOutLine('  Buyers \u2014 sellers\u00A0and closings\u2026  '),
    'Buyers - sellers and closings...'
  )
})
