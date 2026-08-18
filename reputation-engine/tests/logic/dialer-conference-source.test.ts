import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const source = fs.readFileSync(
  path.join(process.cwd(), 'app/api/sales/dialer/conference/route.ts'),
  'utf8',
)

test('hold migration moves the customer leg before the representative leg', () => {
  const start = source.indexOf('async function handleStartConference')
  const end = source.indexOf('async function handleUpdateConference')
  assert.ok(start >= 0 && end > start, 'expected conference start handler')

  const handler = source.slice(start, end)
  const customerMove = handler.indexOf('updateCall(accountSid, authToken, legs.customerCallSid')
  const representativeMove = handler.indexOf('updateCall(accountSid, authToken, legs.repCallSid')

  assert.ok(customerMove >= 0, 'expected customer call migration')
  assert.ok(representativeMove >= 0, 'expected representative call migration')
  assert.ok(
    customerMove < representativeMove,
    'moving the rep first completes the outbound customer child leg',
  )
})
