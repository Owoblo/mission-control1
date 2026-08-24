import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
test('AI call summaries cannot mark a deposit received', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/server/call-intelligence.ts'), 'utf8')
  assert.match(source, /A transcript can describe intent to pay, but it is not payment evidence/)
  assert.doesNotMatch(source, /summary\.depositConfirmed\s*\?\s*\(lead\.paymentStatus/)
})

test('estimate workspace always preserves a sent customer price during schedule and scope saves', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/sales/leads/[id]/page.tsx'), 'utf8')
  assert.match(source, /const preserveCustomerFacingPricing = quoteIsLockedForPricing/)
  assert.doesNotMatch(source, /quoteIsLockedForPricing\s*&&\s*quotePricingInputsMatchSaved/)
})

test('automation extraction cannot convert a conversation into payment truth', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/server/sales-automation.ts'), 'utf8')
  assert.match(source, /Conversation extraction is useful context, never transaction evidence/)
  assert.doesNotMatch(source, /stage:\s*signals\.depositConfirmed/)
})
