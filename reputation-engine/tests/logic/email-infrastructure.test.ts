import test from 'node:test'
import assert from 'node:assert/strict'
import { assessEmailInfrastructure, normalizeWarmupAccount } from '../../lib/email-infrastructure'
const sender = { from_email: 'john@example.com', domain: 'example.com', provider: 'ses', status: 'active', daily_cap: 25, pause_reason: null }
const dns = { domain: 'example.com', mx: ['10 mx.example.com'], spf: ['v=spf1 -all'], dmarc: ['v=DMARC1; p=none'], errors: [] }
const warmup = { email: sender.from_email, status: 'active', smtpHost: 'email-smtp.us-east-2.amazonaws.com', imapHost: 'imap.zohocloud.ca', sentToday: 5, spamRate14Days: 0 }
test('healthy-looking DNS and warmup never authorize a campaign or certify placement', () => {
  const result = assessEmailInfrastructure(sender, dns, warmup)
  assert.equal(result.state, 'review'); assert.equal(result.campaignAuthorized, false)
  assert.ok(result.unknowns.some(s => s.includes('Independent placement')))
})
test('CRM pauses and wrong outbound path remain holds despite active warmup', () => {
  const result = assessEmailInfrastructure({ ...sender, status: 'paused', pause_reason: 'owner_hold' }, dns, { ...warmup, smtpHost: 'smtp.google.com' })
  assert.equal(result.state, 'hold'); assert.ok(result.holds.includes('owner_hold')); assert.ok(result.holds.some(s => s.includes('SMTP path')))
})
test('duplicate SPF, failed DNS and warmup spam are visible instead of green readiness', () => {
  const result = assessEmailInfrastructure(sender, { ...dns, spf: ['v=spf1 -all', 'v=spf1 ~all'], errors: ['MX timeout'] }, { ...warmup, spamRate14Days: 42.9 })
  assert.equal(result.state, 'hold'); assert.ok(result.holds.some(s => s.includes('SPF'))); assert.ok(result.holds.some(s => s.includes('Spam'))); assert.ok(result.unknowns.some(s => s.includes('DNS')))
})
test('provider secrets are excluded and unknown counters are never converted to zero', () => {
  const result = normalizeWarmupAccount({ email: 'John@EXAMPLE.com', emails_sent_today: null, spam_rate_in_last_14_days: -1, smtp: { host: 'smtp.example.com', password: 'secret' }, password: 'secret' })
  assert.equal(result.sentToday, null); assert.equal(result.spamRate14Days, null)
  assert.equal(result.email, 'john@example.com'); assert.ok(!JSON.stringify(result).includes('secret'))
  assert.equal(normalizeWarmupAccount({ spam_rate_in_last_14_days: '0' }).spamRate14Days, 0)
})
