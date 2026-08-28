import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractCustomerInventoryItems,
  extractDeterministicReplyFields,
  extractStructuredInboundLeadFields,
  resolveInboundSalesContext,
} from '../../lib/sales-automation-context'
import { getAutomationMissingFields } from '../../lib/sales-automation-qualification'
import type { CRMLead } from '../../lib/types'

test('multi-stop customer prose keeps origin and destination fields clean', () => {
  const message = 'Pickup addresses: 784 Eminence Street K2J6X6, then 10 Westchester Court K2J3P9, drop-off address: 43 St. Claire Ave K2G2A1. The majority of the items are boxes.'
  const updated = resolveInboundSalesContext(lead(), message)
  assert.equal(updated.originAddress, '784 Eminence Street K2J6X6')
  assert.equal(updated.destAddress, '43 St. Claire Ave K2G2A1')
})

function lead(overrides: Partial<CRMLead> = {}): CRMLead {
  return {
    id: 'lead_context_test',
    name: 'Siddarth Kumar',
    stage: 'pricing',
    createdAt: '2026-07-05',
    moveDate: '2026-07-11',
    moveType: 'packing',
    originCity: 'Windsor',
    destCity: 'Windsor',
    originAddress: 'Ontario Street',
    inventory: [],
    mediaAssets: [],
    callLogs: [],
    ...overrides,
  }
}

test('website form fields map directly into canonical CRM fields without AI', () => {
  const fields = extractStructuredInboundLeadFields({
    move_from: '1 Cutting Drive, Elora, Ontario N0B 1S0',
    move_to: '1349 Queen Street, New Dundee, Ontario N0B 2E0',
    move_date: '2026-08-01',
    home_size: '3 bedrooms',
    service_type: 'Local Moving',
    message: 'Stairs,',
  })

  assert.equal(fields.originAddress, '1 Cutting Drive, Elora, Ontario N0B 1S0')
  assert.equal(fields.destAddress, '1349 Queen Street, New Dundee, Ontario N0B 2E0')
  assert.equal(fields.moveDate, '2026-08-01')
  assert.equal(fields.propertyBedrooms, '3_bedrooms')
  assert.equal(fields.moveType, 'residential')
  assert.match(fields.originAccess || '', /Stairs reported/)
})

test('legacy pipe-delimited website summaries recover route, date, and home size', () => {
  const fields = extractStructuredInboundLeadFields(
    {},
    'Service: Local Moving | From: 1 Cutting Drive, Elora, Ontario N0B 1S0 | To: 1349 Queen Street, New Dundee, Ontario N0B 2E0 | Date: 2026-08-01 | Home size: 3 bedrooms | Notes: Stairs,',
  )

  assert.equal(fields.originAddress, '1 Cutting Drive, Elora, Ontario N0B 1S0')
  assert.equal(fields.destAddress, '1349 Queen Street, New Dundee, Ontario N0B 2E0')
  assert.equal(fields.moveDate, '2026-08-01')
  assert.equal(fields.propertyBedrooms, '3_bedrooms')
})

test('city-only form locations populate city fields and ignore destination placeholders', () => {
  const fields = extractStructuredInboundLeadFields({
    move_from: 'Chatham, Ontario',
    move_to: 'To be confirmed',
  })

  assert.equal(fields.originCity, 'Chatham, Ontario')
  assert.equal(fields.originAddress, undefined)
  assert.equal(fields.destCity, undefined)
  assert.equal(fields.destAddress, undefined)
})

test('flexible scheduling replies advance qualification without AI extraction', () => {
  const fields = extractDeterministicReplyFields(
    'Date is flexible, asap though, weekend is preferred. Mondays or Fridays work best.',
  )

  assert.equal(fields.moveDateFlexible, true)
  assert.match(fields.moveDateFlexibleReason || '', /weekend is preferred/i)
})

test('inbound context resolver splits two customer addresses and overwrites stale partial pickup', () => {
  const updated = resolveInboundSalesContext(
    lead(),
    '225 Wyandotte Street West, Windsor, N9A5X1 to 4755 Walker Road'
  )

  assert.equal(updated.originAddress, '225 Wyandotte Street West, Windsor, N9A5X1')
  assert.equal(updated.destAddress, '4755 Walker Road')

  const missing = getAutomationMissingFields(updated)
  assert.equal(missing.includes('origin_address'), false)
  assert.equal(missing.includes('destination_address'), false)
})

test('inbound context resolver accepts postal-code-complete address without street suffix', () => {
  const updated = resolveInboundSalesContext(
    lead({ originAddress: '29 Alderton', originCity: 'Leamington' }),
    'It is a HOUSE at 29 Alderton, Leamington, N8H 4L6'
  )

  assert.equal(updated.originAddress, '29 Alderton, Leamington, N8H 4L6')
  assert.equal(getAutomationMissingFields(updated).includes('origin_address'), false)
})

test('inbound context resolver captures packing inventory list from SMS', () => {
  const updated = resolveInboundSalesContext(
    lead({ originAddress: '225 Wyandotte Street West', destAddress: '4755 Walker Road' }),
    'Recliner sofa, recliner, chair, coffee, table, side table, tables, television, computer, study table, dishwasher, microwave, study, chair, bicycle, there are some items in the closet also'
  )

  const names = (updated.inventory || []).map(item => item.name)
  assert.ok(names.includes('Recliner Sofa'))
  assert.ok(names.includes('Coffee Table'))
  assert.ok(names.includes('Television'))
  assert.ok(names.includes('Closet Items'))
  assert.ok((updated.inventory || []).length >= 10)
  assert.ok((updated.totalItems || 0) >= 10)
  assert.match(updated.notes || '', /Customer listed packing\/moving items by SMS/)
})

test('inventory extractor ignores address-only messages', () => {
  const items = extractCustomerInventoryItems('225 Wyandotte Street West, Windsor to 4755 Walker Road')
  assert.equal(items.length, 0)
})

test('customer inventory uses known moving dimensions instead of zero-value placeholders', () => {
  const items = extractCustomerInventoryItems('couch, dining table, four night tables, TV console')
  const knownItems = items.filter(item => ['Couch', 'Dining Table', 'Night Tables', 'Television Console'].includes(item.name || ''))

  assert.equal(knownItems.length, 4)
  assert.ok(knownItems.every(item => Number(item.cubicFeet) > 0))
  assert.ok(knownItems.every(item => Number(item.weightLbs) > 0))
  assert.equal(knownItems.find(item => item.name === 'Night Tables')?.qty, 4)
})

test('customer inventory separates adjacent counted items from conversational prose', () => {
  const items = extractCustomerInventoryItems(
    "I can't count boxes yet because nothing is packed. I have three beds two couches, dining table, patio furniture, four night tables, storage furniture midsize. One TV console."
  )
  const byName = new Map(items.map(item => [item.name, item]))

  assert.equal(byName.get('Beds')?.qty, 3)
  assert.equal(byName.get('Couches')?.qty, 2)
  assert.equal(byName.get('Night Tables')?.qty, 4)
  assert.equal(byName.get('Television Console')?.qty, 1)
  assert.ok(items.every(item => Number(item.cubicFeet) > 0))
  assert.ok(items.every(item => Number(item.weightLbs) > 0))
})

test('customer inventory separates SMS corrections across rooms and preserves quantities', () => {
  const items = extractCustomerInventoryItems(
    'In the living room, there are 2 end tables, and the lazy boy recliner couch was missed. The bedroom also has an armoire/chest of drawers.',
  )
  const byName = new Map(items.map(item => [item.name, item]))

  assert.equal(byName.get('End Tables')?.qty, 2)
  assert.equal(byName.get('Lazy Boy Recliner Couch')?.qty, 1)
  assert.equal(byName.get('Armoire/Chest Of Drawers')?.qty, 1)
  assert.equal(items.length, 3)
  assert.ok(items.every(item => !/\bmissed\b.*\bbedroom\b/i.test(item.name || '')))
})

test('inbound inventory recomputes totals after a customer correction', () => {
  const updated = resolveInboundSalesContext(
    lead({
      inventory: [{ id: 'existing', name: 'Coffee Table', qty: 1, cubicFeet: 10, weightLbs: 35, room: 'Living Room', included: true }],
      totalCubicFeet: 999,
      totalWeightLbs: 9999,
    }),
    'The bedroom has an armoire.',
  )

  assert.equal(updated.totalCubicFeet, 50)
  assert.equal(updated.totalWeightLbs, 195)
  assert.equal(updated.inventory?.find(item => item.name === 'Armoire')?.status, 'needs_confirmation')
  assert.match(
    updated.inventory?.find(item => item.name === 'Armoire')?.confirmReason || '',
    /automatically parsed from customer text/i,
  )
})

test('customer inventory does not interpret TV dimensions as quantities', () => {
  const items = extractCustomerInventoryItems(
    `Oak furniture - queen bed+ headboard, dresser, chest of drawers, end table.
56 inch plasma tv + stand
Lazy boy couch and chair, coffee table, end tables
Kitchen table and chairs
Single bed, dresser
Wooden desk (fairly heavy, will be disassembled somewhat)
2 pinball machines (which I might move myself)
Nearly all of the small stuff has already been moved`
  )

  const television = items.find(item => /television/i.test(item.name || ''))
  const pinball = items.find(item => /pinball/i.test(item.name || ''))
  assert.equal(television?.qty, 1)
  assert.match(television?.name || '', /56 Inch Plasma Television/i)
  assert.equal(pinball?.qty, 2)
  assert.equal(pinball?.name, 'Pinball Machines')
  assert.equal(pinball?.cubicFeet, 25)
  assert.equal(pinball?.weightLbs, 250)
  assert.equal(pinball?.status, 'needs_confirmation')
  assert.match(pinball?.confirmReason || '', /confirm whether/i)
  assert.match(pinball?.notes || '', /might move myself/i)
  assert.ok(items.every(item => !/Nearly All|Will Be Disassembled/i.test(item.name || '')))
})

test('customer inventory keeps quoted email bullets separate and ignores prose and measurements', () => {
  const items = extractCustomerInventoryItems(
    `Please see list for added, amended! Many thanks, Mario
> Living Room
> • 1 x 3-seat tufted sofa — Approx. 7 ft length — Fabric upholstery
> • 1 x floor lamp with rectangular shade — Approx. 5 ft tall
> • 1 x round dining table with wood legs — Approx. 4 ft diameter
> • 4 x upholstered dining chairs — Standard dining chair size`
  )

  assert.deepEqual(items.map(item => item.qty), [1, 1, 1, 4])
  assert.ok(items.some(item => /3[- ]Seat Tufted Sofa/i.test(item.name || '')))
  assert.ok(items.some(item => /Floor Lamp/i.test(item.name || '')))
  assert.ok(items.some(item => /Round Dining Table/i.test(item.name || '')))
  assert.ok(items.some(item => /Upholstered Dining Chairs/i.test(item.name || '')))
  assert.ok(items.every(item => !/Mario|Many Thanks|Ft Length|Ft Tall/i.test(item.name || '')))
})
