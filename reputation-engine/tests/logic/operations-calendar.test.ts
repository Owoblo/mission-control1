import assert from 'node:assert/strict'
import {
  getOperationsCalendarOccurrences,
  hasOperationsOccurrenceOnDate,
} from '../../lib/operations-calendar'
import type { CRMQuote } from '../../lib/types'

const lead = { id: 'lead_staged', moveDate: '2026-08-04' }
const stagedQuote = {
  id: 'quote_staged',
  moveDate: '2026-08-04',
  legs: [
    {
      id: 'pickup',
      label: 'Pickup → storage',
      type: 'storage',
      scheduledDate: '2026-08-04',
      originAddress: '10 First St',
      destAddress: 'Saturn Star Storage',
    },
    {
      id: 'delivery',
      label: 'Storage → new home',
      type: 'storage_delivery',
      scheduledDate: '2026-08-22',
      originAddress: 'Saturn Star Storage',
      destAddress: '20 Second St',
    },
  ],
} as CRMQuote

const stagedOccurrences = getOperationsCalendarOccurrences(lead, stagedQuote)
assert.deepEqual(stagedOccurrences.map(item => item.date), ['2026-08-04', '2026-08-22'])
assert.deepEqual(stagedOccurrences.map(item => item.legLabel), ['Pickup → storage', 'Storage → new home'])
assert.equal(stagedOccurrences[1]?.destinationAddress, '20 Second St')
assert.equal(hasOperationsOccurrenceOnDate(lead, stagedQuote, '2026-08-22'), true)

const sameDayLegs = getOperationsCalendarOccurrences(lead, {
  ...stagedQuote,
  legs: stagedQuote.legs?.map(leg => ({ ...leg, scheduledDate: '2026-08-04' })),
})
assert.equal(sameDayLegs.length, 2, 'two same-day legs remain two operational commitments')

const ordinaryOccurrences = getOperationsCalendarOccurrences(
  { id: 'lead_ordinary', moveDate: '2026-08-09' },
  { id: 'quote_ordinary', moveDate: '2026-08-10' } as CRMQuote,
)
assert.deepEqual(ordinaryOccurrences, [{
  key: 'quote_ordinary:move:2026-08-09',
  date: '2026-08-09',
}])

const partiallyDated = getOperationsCalendarOccurrences(lead, {
  ...stagedQuote,
  legs: [
    { ...stagedQuote.legs![0], scheduledDate: undefined },
    { ...stagedQuote.legs![1], scheduledDate: '2026-08-22' },
  ],
})
assert.deepEqual(partiallyDated.map(item => item.date), ['2026-08-04', '2026-08-22'])

assert.deepEqual(
  getOperationsCalendarOccurrences({ id: 'undated' }, { id: 'undated_quote' } as CRMQuote),
  [],
)
