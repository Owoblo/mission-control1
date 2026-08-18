import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveBalanceAuthorizationState, isBalanceAuthorizationLive } from '../../lib/balance-authorization'
import type { CRMLead, CRMQuote } from '../../lib/types'

const lead = { id: 'lead_1', name: 'Customer', stage: 'booked', createdAt: '2026-08-18', paymentStatus: 'deposit_received', depositAmount: 750 } as CRMLead
const quote = { id: 'quote_1', number: 'Q-1', clientId: 'c1', leadId: lead.id, status: 'accepted', lineItems: [], subtotal: 2212.39, hst: 287.61, total: 2500, deposit: 750, balance: 1750, createdAt: '2026-08-18', depositPaidAmount: 750 } as CRMQuote

test('a live hold covering the outstanding balance clears dispatch', () => {
  const held = { ...quote, balanceAuthorizationStatus: 'authorized' as const, balanceAuthorizationAmount: 1750, balanceAuthorizationCaptureBefore: '2026-08-25T00:00:00.000Z' }
  const state = deriveBalanceAuthorizationState(held, lead)
  assert.equal(state.outstanding, 1750)
  assert.equal(isBalanceAuthorizationLive(held, 1750, new Date('2026-08-20').getTime()), true)
})

test('an expired or insufficient hold does not clear dispatch', () => {
  const held = { ...quote, balanceAuthorizationStatus: 'authorized' as const, balanceAuthorizationAmount: 1500, balanceAuthorizationCaptureBefore: '2026-08-19T00:00:00.000Z' }
  assert.equal(isBalanceAuthorizationLive(held, 1750, new Date('2026-08-20').getTime()), false)
})
