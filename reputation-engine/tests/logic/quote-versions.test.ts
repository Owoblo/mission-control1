import test from 'node:test'
import assert from 'node:assert/strict'
import { preserveQuoteVersion, customerQuoteChanged, isCurrentQuoteVersion } from '../../lib/quote-versions'
import type { CRMQuote } from '../../lib/types'
const original = { id: 'q', number: 'Q1', clientId: 'c', status: 'viewed', createdAt: '2026-09-26', lineItems: [{ description: 'Move', amount: 1000 }, { description: 'Packing', amount: 200 }], subtotal: 1200, hst: 156, total: 1356, deposit: 406.8, balance: 949.2 } as CRMQuote
test('revision retains a detached previous price and scope snapshot', () => {
 const version = preserveQuoteVersion(original, 'Customer removed packing', 'John')
 assert.equal(version.commercialVersion, 2)
 assert.equal(version.versionHistory[0].quote.total, 1356)
 assert.equal(version.versionHistory[0].version, 1)
 const next = { ...original, ...version, lineItems: [{ description: 'Move', amount: 1000 }], total: 1130 }
 assert.equal(next.versionHistory[0].quote.lineItems.length, 2)
 assert.equal(original.versionHistory, undefined)
 assert.equal(customerQuoteChanged(original, { total: 1130 }), true)
})
test('stale customer pages cannot accept or pay a new version', () => {
 assert.equal(isCurrentQuoteVersion({}, undefined), true)
 assert.equal(isCurrentQuoteVersion({ commercialVersion: 2 }, undefined), false)
 assert.equal(isCurrentQuoteVersion({ commercialVersion: 2 }, 1), false)
 assert.equal(isCurrentQuoteVersion({ commercialVersion: 2 }, 2), true)
})
test('scope timestamp alone does not create another customer version', () => {
 const customerScope = { version: 1 as const, capturedAt: 'one', inventory: [], assemblyMode: 'both' as const, assemblyItems: [], customerHandledAssemblyItems: [], specialtyItems: [], wrappingItems: [], serviceNotes: ['Packing included'] }
 assert.equal(customerQuoteChanged({ ...original, customerScope }, { customerScope: { ...customerScope, capturedAt: 'two' } }), false)
 assert.equal(customerQuoteChanged({ ...original, customerScope }, { customerScope: { ...customerScope, serviceNotes: [] } }), true)
})
