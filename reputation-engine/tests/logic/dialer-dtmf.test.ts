import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sendCallKeypadDigit } from '../../lib/dialer-dtmf'

test('sends the requested screening digit through the connected call, including * and #', () => {
  const sent: string[] = []
  const call = { status: () => 'open', sendDigits: (digit: string) => { sent.push(digit) } }
  for (const digit of ['7', '*', '#']) sendCallKeypadDigit(call, digit)
  assert.deepEqual(sent, ['7', '*', '#'])
})

test('does not send tones on closed calls, hold/transfer, or invalid input', () => {
  let sent = 0
  const call = { status: () => 'open', sendDigits: () => { sent++ } }
  assert.throws(() => sendCallKeypadDigit(null, '1'), /connect/)
  for (const state of ['pending', 'connecting', 'ringing', 'closed']) {
    assert.throws(() => sendCallKeypadDigit({ ...call, status: () => state }, '1'), /connect/)
  }
  assert.throws(() => sendCallKeypadDigit(call, '1', true), /hold or transfer/)
  for (const digit of ['', '12', 'w', '+', 'A']) assert.throws(() => sendCallKeypadDigit(call, digit), /one keypad digit/)
  assert.equal(sent, 0)
})

test('surfaces SDK send failures without retrying a digit', () => {
  let attempts = 0
  assert.throws(() => sendCallKeypadDigit({ status: () => 'open', sendDigits: () => { attempts++; throw new Error('Disconnected') } }, '4'), /Disconnected/)
  assert.equal(attempts, 1)
})
