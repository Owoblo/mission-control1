import test from 'node:test'
import assert from 'node:assert/strict'
import { relationshipIdentity, fulfilmentSummary, canonicalChannel } from '../../lib/relationship-record'
test('industry and individual role stay separate', () => {
  const broker = relationshipIdentity({ industry: 'Real Estate', title: 'Broker Of Record', city: 'kitchener', preferred_channel: 'call' })
  assert.equal(broker.category.id, 'real_estate'); assert.equal(broker.role, 'Broker of record')
  assert.equal(broker.city, 'Kitchener'); assert.equal(broker.preferredChannel, 'phone')
  const cfo = relationshipIdentity({ industry: 'OEMs, factories and large organizations', title: 'CFO', city: 'Sarnia' })
  assert.equal(cfo.category.id, 'industrial'); assert.equal(cfo.role, 'CFO')
  assert.equal(cfo.city, 'Sarnia'); assert.equal(cfo.phoneHub, 'london')
})
test('generic mortgage contacts are not invented people or licensed brokers', () => {
  const contact = relationshipIdentity({ industry: 'Mortgage brokers and agents', title: 'Mortgage contact — individual or office as listed', city: 'Unmapped Place' })
  assert.equal(contact.roleRecorded, false); assert.equal(contact.city, 'Unmapped Place'); assert.equal(contact.phoneHub, null)
  assert.notEqual(relationshipIdentity({ industry: 'Bank mortgage specialists' }).category.id, contact.category.id)
  assert.equal(relationshipIdentity({}).category.label, 'Not recorded')
})
test('fulfilment statuses preserve handoff versus delivery and exclude attachments and private file paths', () => {
  const result = fulfilmentSummary({ id: 'x', title: 'Cards', status: 'completed', description: JSON.stringify({ status: 'sent_to_printer', dispatch_status: 'awaiting_printer_confirmation', receipt_status: 'unconfirmed', attachments: [{ content: 'private bytes' }], envelope_pdf: '/private/address.pdf', image_evidence: [{}] }) })
  assert.equal(result.status, 'sent_to_printer'); assert.equal(result.receiptStatus, 'unconfirmed'); assert.equal(result.hasPhoto, true)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(fulfilmentSummary({ id: 'y', title: 'Legacy', status: 'open', description: 'Call John' }).status, 'open')
  assert.equal(canonicalChannel('mms'), 'sms'); assert.equal(canonicalChannel('call'), 'phone'); assert.equal(canonicalChannel('direct_mail'), 'direct_mail')
})
