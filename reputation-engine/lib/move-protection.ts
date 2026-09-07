import type { CRMQuote } from './types'

export const MOVE_PROTECTION_PRODUCT_CODE = 'move_protection_plus'
export const MOVE_PROTECTION_VERSION = '2026-08-08-service-v1'
export const MOVE_PROTECTION_NAME = 'Move Protection Plus'
export const MOVE_PROTECTION_PRICE = 99

export type MoveProtectionChoice = 'selected' | 'declined'

export function buildMoveProtectionOffer() {
  return {
    productCode: MOVE_PROTECTION_PRODUCT_CODE as 'move_protection_plus',
    version: MOVE_PROTECTION_VERSION,
    name: MOVE_PROTECTION_NAME,
    price: MOVE_PROTECTION_PRICE,
    currency: 'cad' as const,
    disclosure: 'Optional enhanced moving service. Not an insurance policy. Terms and exclusions apply.',
    services: [
      'Pre-move condition photo record for selected high-risk items',
      'Enhanced wrapping for selected TVs, mirrors, artwork, glass, and mattresses',
      'Item-specific handling notes shared with the moving crew',
      'Priority post-move damage-intake support',
    ],
  }
}

export function protectionPurchased(quote?: CRMQuote | null) {
  return quote?.protectionPurchase?.status === 'captured'
}

export function splitProtectionCheckoutPayment(input: {
  quoteDeposit: number
  capturedTotal: number
  protectionSelected: boolean
  protectionLineAmount?: number
}) {
  const capturedTotal = Math.round(Math.max(0, input.capturedTotal) * 100) / 100
  const protectionAmount = Math.round(Math.max(0, input.protectionLineAmount ?? 0) * 100) / 100
  const depositAmount = Math.round((capturedTotal - protectionAmount) * 100) / 100
  const expectedDeposit = Math.round(Math.max(0, input.quoteDeposit) * 100) / 100

  if (input.protectionSelected && protectionAmount !== MOVE_PROTECTION_PRICE) {
    throw new Error('Protection line item amount does not match the configured offer')
  }
  if (!input.protectionSelected && protectionAmount !== 0) {
    throw new Error('Unexpected protection amount on checkout')
  }
  if (depositAmount !== expectedDeposit) {
    throw new Error('Captured deposit does not match the quote deposit')
  }
  return { depositAmount, protectionAmount, capturedTotal }
}
