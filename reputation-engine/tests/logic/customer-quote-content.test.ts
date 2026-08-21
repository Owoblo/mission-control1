import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCustomerCarePlan, buildCustomerQuoteScope, getCustomerQuoteOptionLabel, sanitizeCustomerQuoteText } from '../../lib/customer-quote-content'

test('removes internal margin and manager-review language from public quote copy', () => {
  const input = 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed. Current margin is 40.9%; manager review may be required.'
  assert.equal(sanitizeCustomerQuoteText(input), 'Provisional estimate. Final pricing will be confirmed once we verify: Packing status is not confirmed.')
})

test('preserves customer-actionable provisional language', () => {
  const input = 'Final pricing will be confirmed once we verify the inventory and packing status.'
  assert.equal(sanitizeCustomerQuoteText(input), input)
})

test('does not promote provisional verification findings into the quote hero', () => {
  const moveDescription = 'Provisional estimate. Final pricing will be confirmed once we verify: No MLS, photo, video, customer-confirmed, or rep inventory evidence is on file.'
  assert.equal(getCustomerQuoteOptionLabel({ moveDescription }), undefined)
})

test('shows only explicit, concise quote-option labels', () => {
  assert.equal(
    getCustomerQuoteOptionLabel({ moveDescription: 'Quote option: One truck · two trips' }),
    'One truck · two trips',
  )
  assert.equal(getCustomerQuoteOptionLabel({ jobLabel: 'Preferred move plan' }), 'Preferred move plan')
  assert.equal(getCustomerQuoteOptionLabel({ jobLabel: 'x'.repeat(121) }), undefined)
})

test('locks internal assembly and specialty selections into the customer scope', () => {
  const scope = buildCustomerQuoteScope({
    capturedAt: '2026-08-21T12:00:00.000Z',
    inventory: [
      { room: 'Living Room', name: 'Couch', qty: 1 },
      { room: 'Living Room', name: 'Electric fireplace', qty: 1 },
      { room: 'Bedroom', name: 'Large dresser', qty: 1 },
      { room: 'Storage', name: 'Boxes', qty: 10 },
      { room: 'Fitness', name: 'Treadmill', qty: 1 },
      { room: 'Garage', name: 'Old chair', qty: 1, included: false },
    ],
    jobFactors: { disassemblyMode: 'both', estimatedBoxes: 10 },
    assemblyItems: ['Treadmill', 'Large dresser'],
    customerHandledAssemblyItems: ['Bed frame'],
    specialtyItems: ['Electric fireplace'],
  })

  assert.equal(scope.inventory.length, 5)
  assert.deepEqual(scope.assemblyItems, ['Treadmill', 'Large dresser'])
  assert.deepEqual(scope.customerHandledAssemblyItems, ['Bed frame'])
  assert.deepEqual(scope.specialtyItems, ['Electric fireplace'])
  assert.ok(scope.wrappingItems.includes('Couch'))
  assert.ok(!scope.wrappingItems.includes('Boxes'))
  assert.ok(scope.serviceNotes.includes('10 boxes included in the planned scope'))
})

test('builds item-specific customer care without duplicating selected services', () => {
  const scope = buildCustomerQuoteScope({
    inventory: [
      { room: 'Living Room', name: 'Couch' },
      { room: 'Living Room', name: 'Electric fireplace' },
      { room: 'Fitness', name: 'Treadmill' },
    ],
    assemblyItems: ['Treadmill'],
    specialtyItems: ['Electric fireplace'],
  })
  const care = buildCustomerCarePlan(scope)

  assert.deepEqual(care.find(item => item.item === 'Treadmill'), {
    item: 'Treadmill',
    service: 'Professional disassembly, transport, and reassembly',
    category: 'assembly',
  })
  assert.equal(care.find(item => item.item === 'Electric fireplace')?.category, 'specialty')
  assert.equal(care.find(item => item.item === 'Couch')?.service, 'Professionally blanket-wrapped and stretch-wrapped')
  assert.equal(care.filter(item => item.item === 'Electric fireplace').length, 1)
})
