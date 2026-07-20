import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizePartner } from '../../lib/store'

test('partner normalization tolerates historical database nulls', () => {
  const partner = normalizePartner({
    id: ' partner-1 ',
    name: null,
    type: null,
    email: null,
    phone: null,
    company: null,
    createdAt: null,
  } as never)

  assert.equal(partner.id, 'partner-1')
  assert.equal(partner.name, 'Unnamed partner')
  assert.equal(partner.type, 'other')
  assert.equal(partner.email, '')
  assert.equal(partner.phone, undefined)
  assert.equal(partner.company, undefined)
  assert.equal(partner.createdAt, '')
})
