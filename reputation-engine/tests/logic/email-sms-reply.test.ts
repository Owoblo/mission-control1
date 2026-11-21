import test from 'node:test'
import assert from 'node:assert/strict'
import { extractSmsReply, parseReplyAddress, replyTokenHash, validateReplyEnvelope } from '../../lib/server/email-sms-reply-policy'

test('reply routing requires an exact domain and opaque token', () => {
  const token = 'ab'.repeat(20)
  assert.equal(parseReplyAddress(`sms+${token}@reply.example.com`, 'reply.example.com'), token)
  assert.equal(parseReplyAddress(`sms+${token}@reply.example.com.evil.test`, 'reply.example.com'), null)
  assert.equal(parseReplyAddress('sms+123@reply.example.com', 'reply.example.com'), null)
  assert.equal(replyTokenHash(token).length, 64)
})
test('plain reply preserves paragraph spacing and removes quoted history and common signatures', () => {
  assert.equal(extractSmsReply('Hi Ryan,\r\n\r\nThat works.\r\n\r\nOn Tue, John wrote:\r\nOld message'), 'Hi Ryan,\n\nThat works.')
  assert.equal(extractSmsReply('Confirmed.\n\nBest regards,\nJohn'), 'Confirmed.')
  assert.equal(extractSmsReply('Yes\n> Original message'), 'Yes')
  assert.equal(extractSmsReply('Yes\nSent from my iPhone'), 'Yes')
})
test('automatic, empty, oversized, attachment and unstripped notification replies fail closed', () => {
  for (const run of [() => extractSmsReply('Away', 'auto-replied'), () => extractSmsReply('> old'), () => extractSmsReply('x'.repeat(1201)), () => extractSmsReply('See attached', '', 1), () => extractSmsReply('Yes\nOpen Partner Thread')]) assert.throws(run)
})
test('sender identity, expiry and one-use state are required', () => {
  const input = { from: 'john@example.com', authenticatedSender: 'john@example.com', tokenRecipient: 'john@example.com', authenticationPassed: true, to: 'sms+'+'ab'.repeat(20)+'@reply.example.com', domain: 'reply.example.com', expiresAt: '2030-01-01', status: 'pending' }
  assert.doesNotThrow(() => validateReplyEnvelope(input, Date.parse('2026-01-01')))
  for (const change of [{from:'attacker@example.com'}, {authenticatedSender:'attacker@example.com'}, {authenticationPassed:false}, {expiresAt:'invalid'}, {expiresAt:'2020-01-01'}, {status:'processing'}, {status:'accepted'}]) assert.throws(() => validateReplyEnvelope({...input,...change}))
})
