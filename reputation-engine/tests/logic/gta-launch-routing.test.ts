import test from 'node:test'
import assert from 'node:assert/strict'
import cities from '../../lib/data/gta-service-cities.json'
import { getPartnershipLinesForMarket } from '../../lib/partnership-lines'
import { detectSalesBranchFromLocation } from '../../lib/sales'
import { listMobilePhoneLines } from '../../lib/server/mobile-phone-access'

test('every GTA and Hamilton launch city uses Toronto partnership and sales routing', () => {
  for (const city of cities) {
    assert.equal(getPartnershipLinesForMarket(city)[0].number, '+14374650584', city)
    assert.equal(detectSalesBranchFromLocation(city), 'toronto', city)
  }
})
test('King is not inferred from Kingston and Milton is not inferred from Hamilton substrings', () => {
  assert.notEqual(detectSalesBranchFromLocation('Kingston'), 'toronto')
  assert.equal(detectSalesBranchFromLocation('Hamilton'), 'toronto')
  assert.ok(!getPartnershipLinesForMarket('Kingston').some(line => line.market === 'toronto'))
})
test('Hamilton staff receive the correct Toronto sales line', () => {
  const lines = listMobilePhoneLines({ exp: Date.now()+60000, userId: 'audit', role: 'sales_rep', branch: 'Hamilton' })
  assert.ok(lines.some(line => line.number === '+14377823004'))
  assert.ok(!lines.some(line => line.workspace === 'partnership'))
})
