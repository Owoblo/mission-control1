import test from 'node:test'
import assert from 'node:assert/strict'
import { getReceiptBrand } from '../../lib/receipt-brand'

test('receipt branding uses Dexa for Ottawa branch records', () => {
  const brand = getReceiptBrand({ branch: 'ottawa' })
  assert.equal(brand.name, 'Dexa Movers')
  assert.equal(brand.phone, '613-519-3236')
  assert.equal(brand.logoPath, undefined)
})

test('receipt branding recovers Ottawa from route when branch is missing', () => {
  const brand = getReceiptBrand(null, { originCity: 'Ottawa', destCity: 'Kanata' })
  assert.equal(brand.name, 'Dexa Movers')
})

test('receipt branding defaults to the Saturn Star master brand', () => {
  const brand = getReceiptBrand({ branch: 'windsor' })
  assert.equal(brand.name, 'Saturn Star')
  assert.equal(brand.logoPath, '/brand/saturn-star-horizontal-full-color.png')
})
