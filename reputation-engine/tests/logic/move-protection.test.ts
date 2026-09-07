import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MOVE_PROTECTION_NAME,
  MOVE_PROTECTION_PRICE,
  buildMoveProtectionOffer,
  splitProtectionCheckoutPayment,
} from '../../lib/move-protection'

test('builds the fixed optional service offer with a clear insurance disclosure', () => {
    const offer = buildMoveProtectionOffer()
    assert.equal(offer.name, MOVE_PROTECTION_NAME)
    assert.equal(offer.price, MOVE_PROTECTION_PRICE)
    assert.match(offer.disclosure, /not an insurance policy/i)
    assert.ok(offer.services.length >= 4)
})

test('separates the protection charge from the move deposit', () => {
    assert.deepEqual(splitProtectionCheckoutPayment({
      quoteDeposit: 250,
      capturedTotal: 349,
      protectionSelected: true,
      protectionLineAmount: 99,
    }), { depositAmount: 250, protectionAmount: 99, capturedTotal: 349 })
})

test('leaves a declined checkout as deposit-only', () => {
    assert.deepEqual(splitProtectionCheckoutPayment({
      quoteDeposit: 250,
      capturedTotal: 250,
      protectionSelected: false,
      protectionLineAmount: 0,
    }), { depositAmount: 250, protectionAmount: 0, capturedTotal: 250 })
})

test('rejects a selected checkout without the exact protection line item', () => {
    assert.throws(() => splitProtectionCheckoutPayment({
      quoteDeposit: 250,
      capturedTotal: 250,
      protectionSelected: true,
      protectionLineAmount: 0,
    }), /protection line/i)
})

test('rejects a captured total that could inflate the recorded deposit', () => {
    assert.throws(() => splitProtectionCheckoutPayment({
      quoteDeposit: 250,
      capturedTotal: 399,
      protectionSelected: true,
      protectionLineAmount: 99,
    }), /deposit/i)
})
