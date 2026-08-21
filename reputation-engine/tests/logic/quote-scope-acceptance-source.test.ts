import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

test('customer acceptance confirms scope and both acceptance paths preserve a snapshot', () => {
  const page = fs.readFileSync(path.join(root, 'app/quote-accept/page.tsx'), 'utf8')
  const publicRoute = fs.readFileSync(path.join(root, 'app/api/public/quotes/[id]/route.ts'), 'utf8')
  const checkoutRoute = fs.readFileSync(path.join(root, 'app/api/sales/stripe/checkout/route.ts'), 'utf8')

  assert.match(page, /scopeConfirmed: true/)
  assert.match(page, /I confirm my move details are accurate/)
  assert.match(publicRoute, /body\.scopeConfirmed !== true/)
  assert.match(publicRoute, /preserveAcceptedScopeSnapshot\(savedLead, nextQuote/)
  assert.match(checkoutRoute, /scopeConfirmed !== true/)
  assert.match(checkoutRoute, /preserveAcceptedScopeSnapshot\(lead, quote/)
})

test('public quote connects inventory, blind spots, arrival verification, and transparent payment math', () => {
  const page = fs.readFileSync(path.join(root, 'app/quote-accept/page.tsx'), 'utf8')
  assert.match(page, /Update my inventory/)
  assert.match(page, /The three inventory blind spots/)
  assert.match(page, /Before anything is loaded/)
  assert.match(page, /Total including HST:/)
})

test('provisional quote delivery bypasses only the final-scope readiness gate', () => {
  const quoteRoute = fs.readFileSync(path.join(root, 'app/api/sales/quotes/[id]/route.ts'), 'utf8')
  const messageRoute = fs.readFileSync(path.join(root, 'app/api/sales/send/route.ts'), 'utf8')
  const worker = fs.readFileSync(path.join(root, 'lib/server/quote-send-worker.ts'), 'utf8')
  const leadPage = fs.readFileSync(path.join(root, 'app/sales/leads/[id]/page.tsx'), 'utf8')
  assert.match(quoteRoute, /!isProvisionalQuoteScope\(proposedQuote\)/)
  assert.match(messageRoute, /!isProvisionalQuoteScope\(quote\)/)
  assert.match(worker, /!isProvisionalQuoteScope\(pendingQuote\)/)
  assert.match(leadPage, /Provisional quote sent — scope follow-up required before final confirmation/)
})
