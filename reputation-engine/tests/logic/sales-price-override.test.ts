import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionPayload } from '../../lib/auth'
import { validateQuotePricingPermissions } from '../../lib/server/sales-permissions'
import type { CRMQuote } from '../../lib/types'

const rep: SessionPayload = {
  exp: Date.now() + 60_000,
  userId: 'rep',
  name: 'Sales Rep',
  role: 'sales_rep',
  branch: 'windsor',
}

const quote: CRMQuote = {
  id: 'quote',
  number: 'QT-TEST',
  clientId: 'client',
  status: 'draft',
  lineItems: [{ description: 'Moving Services', amount: 1_000 }],
  subtotal: 1_000,
  hst: 130,
  total: 1_130,
  deposit: 226,
  balance: 904,
  createdAt: '2026-07-24',
}

test('sales rep can revise a base estimate upward without a discount approval code', () => {
  const error = validateQuotePricingPermissions(rep, quote, {
    lineItems: [{
      description: 'Moving Services — Agreed Rate',
      details: 'Scope increase after inventory review. Projected margin: unknown.',
      amount: 1_250,
    }],
  })
  assert.equal(error, null)
})

test('sales rep still needs approval for a low-margin downward override', () => {
  const error = validateQuotePricingPermissions(rep, quote, {
    lineItems: [{
      description: 'Moving Services — Agreed Rate',
      details: 'Customer requested a lower rate. Projected margin: 40%.',
      amount: 800,
    }],
  })
  assert.match(String(error), /approval code/i)
})
