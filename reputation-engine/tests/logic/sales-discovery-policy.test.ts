import assert from 'node:assert/strict'
import test from 'node:test'
import { customerInventoryText, interruptsNormalSalesDiscovery } from '../../lib/sales-discovery-policy'
import { requestsInventoryQuote } from '../../lib/customer-inventory-review'
import { normalizeLead } from '../../lib/sales'
import { extractCustomerInventoryItems } from '../../lib/sales-automation-context'
const submission = 'Service: Moving enquiry | From: Tilbury | To: Redford | Date: 2026-11-30 | Home size: 3 bedrooms | Notes: origin_property: House\ndestination_property: House\nCustomer notes: Normal living, kitchen and bedroom furniture along with boxes. Washer and freezer\nNo price, crew or booking was confirmed by this form.'
test('Starr website disclaimer does not request pricing or become furniture', () => {
  assert.equal(requestsInventoryQuote(submission),false)
  assert.equal(customerInventoryText(submission),'Normal living, kitchen and bedroom furniture along with boxes. Washer and freezer')
  const items=extractCustomerInventoryItems(submission)
  assert.ok(items.some(i=>/washer/i.test(i.name||'')))
  assert.ok(items.some(i=>/^freezer$/i.test(i.name||'')))
  assert.equal(items.some(i=>/no price|origin_property|destination_property/i.test(i.name||'')),false)
  const lead=normalizeLead({id:'fixture',name:'Starr',stage:'new',createdAt:'2026-10-26',inventory:items})
  for(const name of ['Washer','Freezer'])assert.equal(lead.inventory?.find(i=>i.name===name)?.included,true,`Explicit customer inventory must retain ${name}`)
})
test('actual customer requests for an estimate still reach pricing review', () => {
  assert.equal(requestsInventoryQuote('Please let me know a quote for this move. Thank you'),true)
  assert.equal(requestsInventoryQuote("I’m not ready for a quote"),false)
  assert.equal(requestsInventoryQuote('No price has been agreed yet'),false)
})
test('sales copy cannot announce coordinators or defer a customer because of arrival time', () => {
  for(const reply of ['Our coordinator will contact you.','Our office opens at 9.','We’ll respond tomorrow morning.','I’m passing this to our team.','We’ll continue during business hours.'])assert.equal(interruptsNormalSalesDiscovery(reply),true,reply)
  for(const reply of ['Thanks, Starr. What is the exact pickup address?','I have your November 30 move noted. What is the dropoff address?','We’ll use these details to prepare your estimate.'])assert.equal(interruptsNormalSalesDiscovery(reply),false,reply)
})
