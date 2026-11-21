import test from 'node:test'
import assert from 'node:assert/strict'
import { readScaledMailInventory } from '../../lib/server/scaledmail-inventory'
test('inventory request never asks for passwords and strips unexpected credential fields', async () => {
  let calls = 0
  const request = (async (url: URL, init: RequestInit) => {
    calls++
    assert.equal(url.origin, 'https://server.scaledmail.com')
    assert.equal(url.searchParams.get('password'), 'false')
    assert.equal(init.method, undefined); assert.equal(init.redirect, 'error')
    return Response.json({ total: 1, domains: [{ domain: 'Example.com', order_type: 'google', status: 'Active', total_mailboxes: 2, mailbox_password: 'secret', mailbox: [{ alias: 'john', password: 'secret' }] }] })
  }) as typeof fetch
  const result = await readScaledMailInventory('token', 'org', request)
  assert.equal(calls, 1); assert.equal(result.complete, true)
  assert.deepEqual(result.domains[0].emails, ['john@example.com'])
  assert.ok(!JSON.stringify(result).includes('secret'))
})
test('missing credentials never make a request or imply zero provisioned accounts', async () => {
  const result = await readScaledMailInventory('', '', (async () => { throw new Error('must not fetch') }) as typeof fetch)
  assert.equal(result.status, 'Not connected'); assert.equal(result.complete, false)
})
test('partial inventory cannot claim complete coverage and malformed response fails closed', async () => {
  const partial = await readScaledMailInventory('token', 'org', (async () => Response.json({ total: 2, domains: [] })) as typeof fetch)
  assert.equal(partial.complete, false)
  await assert.rejects(readScaledMailInventory('token', 'org', (async () => Response.json({})) as typeof fetch), /Unexpected/)
  await assert.rejects(readScaledMailInventory('token', 'org', (async () => new Response('secret', { status: 401 })) as typeof fetch), /inventory unavailable/)
})
