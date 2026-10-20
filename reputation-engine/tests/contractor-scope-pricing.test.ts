import test from 'node:test'
import assert from 'node:assert/strict'
import { initialScopePricing, transitionScopePricing as change, type ScopePricing } from '../lib/contractor-scope-pricing'
let id = 0
const input = (p: ScopePricing, action: string, extra = {}) => ({ revision: p.revision, action, requestId: `request-test-${String(++id).padStart(8, '0')}`, ...extra })
const price = { amount: 950, tax: 'included', notes: 'Three movers and 26-foot truck', confirm: true }
test('request price, contractor bid, staff counter and contractor acceptance preserve exact tax and amount', () => {
  let p = initialScopePricing()
  p = change(p, 'contractor', input(p, 'submit', price))
  assert.equal(p.status, 'submitted'); assert.equal(p.response?.amount, 950)
  assert.throws(() => change(p, 'contractor', input(p, 'accept', { confirm: true })))
  p = change(p, 'staff', input(p, 'offer', { ...price, amount: 900, tax: 'additional' }))
  p = change(p, 'contractor', input(p, 'accept', { confirm: true, amount: 1, tax: 'included' }))
  assert.equal(p.status, 'agreed'); assert.equal(p.agreed?.amount, 900); assert.equal(p.agreed?.tax, 'additional')
  assert.equal(p.events.length, 3)
  assert.ok(!('assigned' in p)); assert.ok(!('dispatch' in p))
})
test('contractor counter requires staff approval and can be accepted or declined', () => {
  let p = change(initialScopePricing(), 'staff', input(initialScopePricing(), 'offer', price))
  p = change(p, 'contractor', input(p, 'counter', { ...price, amount: 1000 }))
  assert.equal(p.status, 'countered'); assert.equal(p.agreed, undefined)
  const accepted = change(p, 'staff', input(p, 'accept_price'))
  assert.equal(accepted.agreed?.amount, 1000)
  const declined = change(p, 'staff', input(p, 'decline', { notes: 'Above budget' }))
  assert.equal(declined.status, 'declined')
  assert.throws(() => change(declined, 'contractor', input(declined, 'submit', price)))
  const reopened = change(accepted, 'staff', input(accepted, 'request_price'))
  assert.equal(reopened.status, 'request_price'); assert.equal(reopened.agreed, undefined)
})
test('stale offers, duplicate requests, spoofed actions and invalid prices are handled safely', () => {
  const initial = initialScopePricing(), offer = input(initial, 'offer', price)
  const p = change(initial, 'staff', offer)
  assert.equal(change(p, 'staff', offer), p)
  assert.throws(() => change(p, 'contractor', input(initial, 'accept', { confirm: true })), /changed/)
  assert.throws(() => change(p, 'contractor', input(p, 'offer', price)))
  assert.throws(() => change(p, 'contractor', input(p, 'accept', { confirm: false })), /Confirm/)
  for (const amount of [0, -5, NaN, Infinity, 100001, 1.111, '900']) assert.throws(() => change(initial, 'contractor', input(initial, 'submit', { ...price, amount })))
  assert.throws(() => change(initial, 'contractor', input(initial, 'submit', { ...price, tax: 'unknown' })))
  assert.throws(() => change(initial, 'contractor', input(initial, 'submit', { ...price, notes: 'x'.repeat(2001) })))
  const declined = change(initial, 'contractor', input(initial, 'decline'))
  assert.equal(declined.status, 'declined')
  assert.throws(() => change(declined, 'staff', input(declined, 'accept_price')))
})
