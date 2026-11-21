import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headerMessageIds, mailboxAddress, matchPartnershipReply, recordedInternetMessageIds, providerEventInternetMessageIds } from '../../lib/partnership-email-thread-match'
const contacts = [{ id: 'a', email: 'info@example.com', email_last_sent_at: '2026-10-27T10:00:00Z' }, { id: 'b', email: 'other@elsewhere.ca', email_last_sent_at: '2026-10-27T10:00:00Z' }]
const outbound = [{ contactId: 'a', sentAt: '2026-10-27T10:00:00Z', messageIds: ['A@mail.amazonses.com'] }, { contactId: 'b', sentAt: '2026-10-27T10:00:00Z', messageIds: ['B@example.net'] }]
const input = { contacts, outbound, from: 'owner@example.com', receivedAt: Date.parse('2026-10-27T11:00:00Z'), headers: '' }
test('different-address response matches recorded In-Reply-To exactly', () => {
 assert.deepEqual(matchPartnershipReply({ ...input, headers: 'In-Reply-To: <A@mail.amazonses.com>' }), { status: 'matched', contactId: 'a', method: 'thread_headers', evidenceIds: ['A@mail.amazonses.com'] })
})
test('folded References work and repeated references do not create ambiguity', () => {
 assert.equal(matchPartnershipReply({ ...input, headers: 'References: <unknown@remote.net>\r\n\t<A@mail.amazonses.com>\r\nIn-Reply-To: <A@mail.amazonses.com>' }).status, 'matched')
 assert.deepEqual(headerMessageIds('REFERENCES: <A@EXAMPLE.COM>\r\n\t<B@example.com>', 'references'), ['A@example.com', 'B@example.com'])
})
test('conflicting thread contacts remain unresolved even with exact sender', () => {
 const result = matchPartnershipReply({ ...input, from: 'info@example.com', headers: 'In-Reply-To: <A@mail.amazonses.com>\r\nReferences: <B@example.net>' })
 assert.equal(result.status, 'unresolved'); if (result.status === 'unresolved') assert.equal(result.reason, 'ambiguous_thread')
})
test('same domain never autoattributes and unrelated headers do not persist', () => {
 assert.equal(matchPartnershipReply(input).status, 'ignore')
 assert.equal(matchPartnershipReply({ ...input, headers: 'In-Reply-To: <A@forged.example>' }).status, 'ignore')
})
test('exact sender fallback requires prior outreach and supports display-name addresses', () => {
 const result = matchPartnershipReply({ ...input, from: 'Owner <INFO@example.com>' })
 assert.equal(result.status, 'matched'); if (result.status === 'matched') assert.equal(result.method, 'exact_sender')
 assert.equal(matchPartnershipReply({ ...input, contacts: [{ id: 'a', email: 'info@example.com' }], outbound: [], from: 'info@example.com' }).status, 'ignore')
 assert.equal(mailboxAddress('one@example.com, two@example.com'), null)
})
test('future outbound records cannot anchor a historical reply', () => {
 assert.equal(matchPartnershipReply({ ...input, receivedAt: Date.parse('2026-10-27T09:00:00Z'), from: 'info@example.com', headers: 'In-Reply-To: <A@mail.amazonses.com>' }).status, 'ignore')
})
test('duplicate exact addresses require review; multiple messages for one contact do not', () => {
 assert.equal(matchPartnershipReply({ ...input, from: 'info@example.com', contacts: [...contacts, { ...contacts[0], id: 'c' }] }).status, 'unresolved')
 assert.equal(matchPartnershipReply({ ...input, outbound: [...outbound, outbound[0]], headers: 'In-Reply-To: <A@mail.amazonses.com>' }).status, 'matched')
})
test('bare API receipts never become invented MIME message IDs', () => {
 assert.deepEqual(recordedInternetMessageIds({ provider_message_id: '010001abc', sesMessageId: '010001abc' }), [])
 assert.deepEqual(recordedInternetMessageIds({ internet_message_id: '<actual@EXAMPLE.COM>', provider_message_id: '010001abc' }), ['actual@example.com'])
 assert.deepEqual(providerEventInternetMessageIds({ mail: { messageId: '010001abc' } }), [])
})
test('provider event extracts exact recorded MIME headers, including SNS envelope', () => {
 const payload = { mail: { commonHeaders: { messageId: '<actual@example.com>' }, headers: [{ name: 'Message-ID', value: '<actual@example.com>' }] } }
 assert.deepEqual(providerEventInternetMessageIds(payload), ['actual@example.com'])
 assert.deepEqual(providerEventInternetMessageIds({ Message: JSON.stringify(payload) }), ['actual@example.com'])
 assert.deepEqual(providerEventInternetMessageIds({ Message: 'invalid' }), [])
})
test('thread evidence outside scoped contacts is ignored', () => {
 assert.equal(matchPartnershipReply({ ...input, contacts: [], headers: 'References: <A@mail.amazonses.com>' }).status, 'ignore')
})
