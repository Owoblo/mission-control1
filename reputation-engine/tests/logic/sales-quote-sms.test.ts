import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildAutomationQuoteSmsSummary,
  buildManualQuoteSmsDraft,
} from '../../lib/sales-quote-sms'

test('manual quote SMS sends customer to estimate link without price or deposit', () => {
  const body = buildManualQuoteSmsDraft({
    firstName: 'Lisa',
    quoteNumber: 'QT-2026-0706-LM',
    acceptUrl: 'https://go.quote2move.com/quote-accept?id=qt_123',
  })

  assert.match(body, /estimate is ready/)
  assert.doesNotMatch(body, /QT-2026-0706-LM/)
  assert.match(body, /Please review the full estimate here/)
  assert.doesNotMatch(body, /\$\d/)
  assert.doesNotMatch(body, /deposit/i)
  assert.doesNotMatch(body, /starting at/i)
})

test('automation quote SMS omits price and reply-yes booking language', () => {
  const body = buildAutomationQuoteSmsSummary({
    firstName: 'Siddarth',
    routeLine: 'Windsor to Windsor - Sat, Jul 11',
    crewLine: '3 movers - 1 truck - ~4-6hrs',
    acceptUrl: 'https://go.quote2move.com/quote-accept?id=qt_123',
  })

  assert.match(body, /Please review the full estimate here/)
  assert.doesNotMatch(body, /\$\d/)
  assert.doesNotMatch(body, /deposit/i)
  assert.doesNotMatch(body, /reply yes/i)
})
