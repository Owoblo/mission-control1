import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { resolveQuoteDraftPricing } from '../../lib/quote-draft-pricing'
import type { CRMQuote } from '../../lib/types'
test('AI call summaries cannot mark a deposit received', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/server/call-intelligence.ts'), 'utf8')
  assert.match(source, /A transcript can describe intent to pay, but it is not payment evidence/)
  assert.doesNotMatch(source, /summary\.depositConfirmed\s*\?\s*\(lead\.paymentStatus/)
})

test('estimate workspace always preserves a sent customer price during schedule and scope saves', () => {
  const quote = { status: 'sent', lineItems: [{ description: 'Moving Services', amount: 1000 }], subtotal: 1000, hst: 130, total: 1130, deposit: 339, balance: 791 } as CRMQuote
  const result = resolveQuoteDraftPricing(quote, [{ description: 'Moving Services', amount: 2000 }], 0, 0.3, true)
  assert.equal(result.preserveCustomerFacingPricing, true)
  assert.equal(result.totals.total, 1130)
  assert.deepEqual(result.sourceLineItems, quote.lineItems)
})

test('automation extraction cannot convert a conversation into payment truth', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/server/sales-automation.ts'), 'utf8')
  assert.match(source, /Conversation extraction is useful context, never transaction evidence/)
  assert.doesNotMatch(source, /stage:\s*signals\.depositConfirmed/)
})
