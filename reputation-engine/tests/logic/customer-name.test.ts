import assert from 'node:assert/strict'
import test from 'node:test'
import { knownCustomerName, customerFirstName } from '../../lib/customer-name'
test('phone placeholders are not used as names and can be replaced by a captured name', () => {
  for (const name of ['+15199803745', '(519) 980-3745', 'New moving lead', 'Unknown', 'person@example.com', '']) {
    assert.equal(knownCustomerName(name), undefined)
    assert.equal(customerFirstName(name), 'there')
    assert.equal(knownCustomerName(name) || knownCustomerName('Jane Smith'), 'Jane Smith')
  }
  assert.equal(customerFirstName('Kiran Sallan'), 'Kiran')
  assert.equal(knownCustomerName('Omid Mostafavi'), 'Omid Mostafavi')
})
