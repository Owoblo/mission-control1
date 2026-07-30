import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionPayload } from '../../lib/auth'
import {
  canUseAllMobilePhoneLines,
  canUseMobilePhoneLine,
  listMobilePhoneLines,
} from '../../lib/server/mobile-phone-access'

const expires = Date.now() + 60_000

function session(role: SessionPayload['role'], branch?: string): SessionPayload {
  return { exp: expires, userId: `${role}-${branch || 'central'}`, role, branch }
}

test('owner can switch among all configured mobile phone lines', () => {
  const owner = session('owner')
  const lines = listMobilePhoneLines(owner)
  assert.equal(canUseAllMobilePhoneLines(owner), true)
  assert.ok(lines.length > 1)
  assert.ok(lines.some(line => line.workspace === 'sales'))
  assert.ok(lines.some(line => line.workspace === 'partnership'))
})

test('branch staff receive only the phone lines assigned to their branch', () => {
  const windsor = session('sales_rep', 'Windsor')
  const lines = listMobilePhoneLines(windsor)
  assert.ok(lines.length > 0)
  assert.ok(lines.every(line => line.branch === 'windsor'))
  assert.ok(lines.every(line => line.workspace === 'sales'))
  assert.ok(lines.every(line => canUseMobilePhoneLine(windsor, line.number)))
})

test('partnership managers receive only partnership lines for their market', () => {
  const manager = session('partnership_manager', 'Windsor')
  const lines = listMobilePhoneLines(manager)
  assert.ok(lines.length > 0)
  assert.ok(lines.every(line => line.branch === 'windsor'))
  assert.ok(lines.every(line => line.workspace === 'partnership'))
})

test('a branch rep cannot select a different market caller ID', () => {
  const windsor = session('sales_rep', 'Windsor')
  const ottawaLine = listMobilePhoneLines(session('owner'))
    .find(line => line.branch === 'ottawa')
  assert.ok(ottawaLine)
  assert.equal(canUseMobilePhoneLine(windsor, ottawaLine!.number), false)
})

test('an unauthenticated device has no line access', () => {
  assert.deepEqual(listMobilePhoneLines(null), [])
  assert.equal(canUseMobilePhoneLine(null, '+15195550123'), false)
})
