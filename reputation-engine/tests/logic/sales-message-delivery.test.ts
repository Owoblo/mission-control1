import assert from 'node:assert/strict'
import test from 'node:test'
import { wasSalesMessageDelivered } from '../../lib/sales-message-delivery'

test('automation delivery reports semantic duplicates as not sent', () => {
  assert.equal(wasSalesMessageDelivered({
    deduped: true,
    result: { ok: true, deduped: true },
  }), false)
})

test('automation delivery reports policy-blocked messages as not sent', () => {
  assert.equal(wasSalesMessageDelivered({
    deduped: false,
    result: { ok: true, blocked: true },
  }), false)
})

test('automation delivery reports provider-accepted messages as sent', () => {
  assert.equal(wasSalesMessageDelivered({
    deduped: false,
    result: { ok: true, sid: 'SM123' },
  }), true)
})
