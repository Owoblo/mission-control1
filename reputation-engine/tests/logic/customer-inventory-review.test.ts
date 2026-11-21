import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveInboundSalesContext, extractCustomerInventoryItems } from '../../lib/sales-automation-context'
import { buildCustomerInventoryList, buildCustomerInventoryReviewMessage, inventoryMeasurementIssues, planCustomerInventoryReply } from '../../lib/customer-inventory-review'
import { normalizeAutomatedCustomerText } from '../../lib/customer-message-style'
import { deriveInventoryMetrics } from '../../lib/sales'
import type { CRMLead } from '../../lib/types'

const base = (): CRMLead => ({ id: 'test', name: 'Casey', createdAt: '2026-10-10', stage: 'contacted', originAddress: 'House', destAddress: 'Other', inventory: [] })
const firstList = "A 3-seater couch, love seat and sofa chair. A foton, an slip ti Al, a vibration machine,,, some smaller items like child's bedroom set"
const bedroomDetail = 'The bedroom set is small bed, change table. I have some small items as well'
const inventoryLead = () => resolveInboundSalesContext(resolveInboundSalesContext(base(), firstList), bedroomDetail)

test('replays Casey route without replacing the pickup with the storage address', () => {
  let lead = resolveInboundSalesContext(base(), '10 Maple Crt')
  assert.equal(lead.originAddress, '10 Maple Crt')
  lead = resolveInboundSalesContext(lead, 'Storage on Example St and Elm, just 10min away')
  lead = resolveInboundSalesContext(lead, '411 Example St. N')
  assert.equal(lead.originAddress, '10 Maple Crt')
  assert.equal(lead.destAddress, '411 Example St. N')
  assert.equal(resolveInboundSalesContext({ ...base(), originAddress: undefined }, '10 Maple Crt').originAddress, '10 Maple Crt')
})

test('preserves every Casey item and expands bedroom set without double counting', () => {
  const lead = inventoryLead()
  assert.deepEqual(lead.inventory?.map(i => i.name), [
    '3-Seater Couch', 'Loveseat', 'Armchair', 'Futon', 'Slip Ti Al', 'Vibration Machine',
    'Small Bed', 'Changing Table', 'Smaller Items (Details To Confirm)',
  ])
  const find = (name: string) => lead.inventory!.find(i => i.name === name)!
  assert.equal(find('3-Seater Couch').cubicFeet, 55)
  assert.equal(find('3-Seater Couch').weightLbs, 110)
  assert.equal(find('Loveseat').cubicFeet, 40)
  assert.equal(find('Armchair').cubicFeet, 20)
  assert.equal(find('Slip Ti Al').nameNeedsConfirmation, true)
  assert.equal(find('Slip Ti Al').customerDescription, 'an slip ti Al')
  assert.equal(find('Smaller Items (Details To Confirm)').quantityNeedsConfirmation, true)
  assert.equal(deriveInventoryMetrics(lead.inventory!).measurementsComplete, false)
  assert.equal(inventoryMeasurementIssues(lead.inventory).length, 6)
})

test('customer copy confirms names and quantities without weight, volume or em dashes', () => {
  const lead = inventoryLead()
  const text = buildCustomerInventoryReviewMessage(lead)
  assert.match(text, /1 x Loveseat/)
  assert.match(text, /please confirm: "an slip ti Al"/)
  assert.match(text, /anything missing/)
  assert.match(text, /Quantity to confirm/)
  assert.doesNotMatch(text, /weight|cubic|cu ft|lbs|approximate size|[\u2014\u2013]/i)
  assert.equal(buildCustomerInventoryList(lead.inventory).split('\n').length, 9)
})

test('confirmation uses a persisted inventory fingerprint, not lastIntent', () => {
  const lead = resolveInboundSalesContext(base(), 'A couch, loveseat and armchair')
  const reply = planCustomerInventoryReply(lead, 'A couch, loveseat and armchair', '2026-10-10T17:00:00Z')!
  assert.equal(reply.handoff, false)
  const waiting = { ...lead, smsInventoryReview: reply.review }
  assert.equal(planCustomerInventoryReply(waiting, 'Thanks', '2026-10-10T17:01:00Z'), null)
  const confirmation = planCustomerInventoryReply(waiting, 'Yes', '2026-10-10T17:02:00Z')!
  assert.equal(confirmation.handoff, true)
  assert.ok(confirmation.review.confirmedFingerprint)
  assert.doesNotMatch(confirmation.body, /does that|reply yes/i)
})

test('quote request hands unresolved list to coordinator without falsely confirming it', () => {
  const lead = inventoryLead()
  const reply = planCustomerInventoryReply(lead, 'Please let me know a quote for this move. Thank you', '2026-10-10T17:20:00Z')!
  assert.equal(reply.handoff, true)
  assert.equal(reply.review.confirmedFingerprint, undefined)
  assert.match(reply.body, /unclear items/)
})

test('specific clarification replaces the uncertain item and retains original wording', () => {
  const lead = resolveInboundSalesContext(inventoryLead(), 'Slip ti Al is an elliptical')
  assert.equal(lead.inventory?.filter(i => i.name === 'Elliptical').length, 1)
  assert.equal(lead.inventory?.some(i => i.name === 'Slip Ti Al'), false)
  assert.match(lead.inventory?.find(i => i.name === 'Elliptical')?.customerDescription || '', /an slip ti Al; corrected by customer: elliptical/)
  assert.equal(lead.inventory?.find(i => i.name === 'Elliptical')?.weightLbs, 180)
})

test('standalone items and counts work outside a couch-led list', () => {
  assert.equal(extractCustomerInventoryItems('2 loveseats')[0].qty, 2)
  assert.equal(extractCustomerInventoryItems('a futon')[0].name, 'Futon')
  assert.equal(extractCustomerInventoryItems('a vibration machine')[0].name, 'Vibration Machine')
  assert.equal(extractCustomerInventoryItems('Please quote the sofa and chairs').length, 2)
  assert.equal(extractCustomerInventoryItems('Thanks, please send a quote').length, 0)
})

test('automated punctuation removes em dashes and keeps line breaks', () => {
  assert.equal(normalizeAutomatedCustomerText('Thanks, Casey — got it.\nCouch–three seats'), 'Thanks, Casey, got it.\nCouch, three seats')
})

test('customer exclusions and quantity corrections update the list without duplicates', () => {
  let lead = resolveInboundSalesContext(base(), 'a loveseat, sofa chair')
  lead = resolveInboundSalesContext(lead, 'Actually 2 loveseats')
  assert.equal(lead.inventory?.filter(i => /loveseat/i.test(i.name || '')).length, 1)
  assert.equal(lead.inventory?.find(i => /loveseat/i.test(i.name || ''))?.qty, 2)
  lead = resolveInboundSalesContext(lead, 'Remove the armchair')
  assert.equal(lead.inventory?.find(i => i.name === 'Armchair')?.included, false)
  assert.doesNotMatch(buildCustomerInventoryList(lead.inventory), /Armchair/)
  assert.equal(lead.totalItems, 2)
  assert.equal(lead.totalCubicFeet, 80)
})

test('plural items without a count request clarification instead of inventing quantity', () => {
  assert.equal(extractCustomerInventoryItems('chairs')[0].quantityNeedsConfirmation, true)
  assert.equal(extractCustomerInventoryItems('4 chairs')[0].quantityNeedsConfirmation, false)
  assert.equal(extractCustomerInventoryItems('4 chairs')[0].qty, 4)
})


test('a plain corrected item name resolves a tentative spelling without adding another item', () => {
  const lead = resolveInboundSalesContext(inventoryLead(), 'A futon')
  const futons = lead.inventory!.filter(i => i.name === 'Futon')
  assert.equal(futons.length, 1)
  assert.equal(futons[0].nameNeedsConfirmation, false)
  assert.match(futons[0].customerDescription || '', /A foton; clarified by customer: A futon/)
})
