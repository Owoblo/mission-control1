import test from 'node:test'
import assert from 'node:assert/strict'
import {
  escapeTwiml,
  makeConferenceName,
  normalizeInternalTransferTarget,
  resolveTwilioCallLegs,
} from '../../lib/twilio-call-control'

const repParent = {
  sid: 'CA11111111111111111111111111111111',
  from: 'client:saturn-rep-user1',
  to: '+15195550100',
}
const customerChild = {
  sid: 'CA22222222222222222222222222222222',
  parent_call_sid: repParent.sid,
  from: '+15195550100',
  to: '+15195550123',
  status: 'in-progress',
}

test('resolves an outbound browser parent and customer child', () => {
  assert.deepEqual(resolveTwilioCallLegs(repParent, [customerChild]), {
    repCallSid: repParent.sid,
    customerCallSid: customerChild.sid,
    rootCallSid: repParent.sid,
  })
})

test('resolves an inbound customer parent and browser child', () => {
  const customerParent = { ...repParent, from: '+15195550123', to: '+15195550100' }
  const repChild = {
    ...customerChild,
    parent_call_sid: customerParent.sid,
    from: '+15195550100',
    to: 'client:saturn-rep-user1',
  }
  assert.deepEqual(resolveTwilioCallLegs(repChild, [customerParent]), {
    repCallSid: repChild.sid,
    customerCallSid: customerParent.sid,
    rootCallSid: customerParent.sid,
  })
})

test('conference names are deterministic and safe', () => {
  assert.equal(makeConferenceName(repParent.sid), `saturn_${repParent.sid}`)
  assert.equal(escapeTwiml('<manager & "customer">'), '&lt;manager &amp; &quot;customer&quot;&gt;')
})

test('transfer targets reject TwiML injection and normalize supported destinations', () => {
  assert.deepEqual(normalizeInternalTransferTarget('client:saturn-rep-manager'), {
    kind: 'client',
    target: 'saturn-rep-manager',
  })
  assert.deepEqual(normalizeInternalTransferTarget('+15195550123'), {
    kind: 'number',
    target: '+15195550123',
  })
  assert.throws(() => normalizeInternalTransferTarget('client:x</Client><Hangup/>'))
})
