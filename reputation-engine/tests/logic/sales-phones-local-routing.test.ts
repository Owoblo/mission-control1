import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getSalesBranchFromSaturnPhone,
  getSaturnBranchLabel,
  getSaturnBranchNumberForSalesBranch,
  getSaturnBranchNumberFromRawData,
  getSaturnBusinessNumberFromSmsMessage,
  inferSalesBranchFromCity,
  inferSalesBranchFromPhoneAreaCode,
  inferSaturnBranchPhoneNumberFromCity,
  inferSaturnBranchPhoneNumberFromPhone,
  pickSaturnBranchPhoneNumber,
} from '../../lib/sales-phones'

test('sales branch primary numbers map to the expected local Twilio lines', () => {
  assert.equal(getSaturnBranchNumberForSalesBranch('windsor'), '+12267732993')
  assert.equal(getSaturnBranchNumberForSalesBranch('waterloo'), '+12262423319')
  assert.equal(getSaturnBranchNumberForSalesBranch('ottawa'), '+16135193236')
  assert.equal(getSaturnBranchNumberForSalesBranch('london'), '+15484883245')
})

test('phone area code inference only claims markets with reliable local overlays', () => {
  assert.equal(inferSalesBranchFromPhoneAreaCode('+16135551234'), 'ottawa')
  assert.equal(inferSalesBranchFromPhoneAreaCode('+13435551234'), 'ottawa')
  assert.equal(inferSalesBranchFromPhoneAreaCode('+15485551234'), 'london')
  assert.equal(inferSalesBranchFromPhoneAreaCode('+12265551234'), undefined)
  assert.equal(inferSaturnBranchPhoneNumberFromPhone('+16135551234'), '+16135193236')
})

test('city inference can recover the right local market from lead geography', () => {
  assert.equal(inferSalesBranchFromCity('Kanata, ON'), 'ottawa')
  assert.equal(inferSalesBranchFromCity('Waterloo Region'), 'waterloo')
  assert.equal(inferSalesBranchFromCity('LaSalle'), 'windsor')
  assert.equal(inferSalesBranchFromCity('St. Thomas'), 'london')
  assert.equal(inferSaturnBranchPhoneNumberFromCity('Ottawa'), '+16135193236')
})

test('branch picking still falls back safely to the default line', () => {
  assert.equal(pickSaturnBranchPhoneNumber('+16135193236', '+12267732993'), '+16135193236')
  assert.equal(pickSaturnBranchPhoneNumber('not-a-branch', null), '+12267732993')
})

test('London inbound metadata stays attached to the London branch line', () => {
  const londonNumber = '+15484883245'

  assert.equal(
    getSaturnBusinessNumberFromSmsMessage({
      direction: 'inbound',
      from_number: '+15195551234',
      to_number: londonNumber,
    }),
    londonNumber
  )

  assert.equal(
    getSaturnBranchNumberFromRawData({
      to: londonNumber,
      branchNumber: londonNumber,
    }),
    londonNumber
  )

  assert.equal(getSalesBranchFromSaturnPhone(londonNumber), 'london')
  assert.equal(getSaturnBranchLabel(londonNumber), 'London')
})
