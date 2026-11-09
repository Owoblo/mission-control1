import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { authorizationUrl, callbackUrl, GOOGLE_MAIL_SCOPES, seal, unseal, validateGrant } from '../../lib/google-mail-oauth'

test('token encryption is authenticated and bound to its mailbox', () => {
  const key = randomBytes(32).toString('base64')
  const encrypted = seal('private-refresh-token', key, 'john@moveswithsaturn.com')
  assert.ok(!encrypted.includes('private-refresh-token'))
  assert.equal(unseal(encrypted, key, 'john@moveswithsaturn.com'), 'private-refresh-token')
  assert.throws(() => unseal(encrypted, key, 'johnny@moveswithsaturn.com'))
  assert.throws(() => unseal(encrypted, randomBytes(32).toString('base64'), 'john@moveswithsaturn.com'))
})
test('reject a different Google account and missing send/read permission', () => {
  const email = 'john@moveswithsaturn.com'
  validateGrant(GOOGLE_MAIL_SCOPES.join(' '), email, email)
  assert.throws(() => validateGrant(GOOGLE_MAIL_SCOPES.join(' '), 'johnny@moveswithsaturn.com', email))
  assert.throws(() => validateGrant('openid email', email, email))
  assert.throws(() => validateGrant(GOOGLE_MAIL_SCOPES.join(' '), 'john@saturnstarmovers.ca', 'john@saturnstarmovers.ca'))
})
test('authorization uses state, PKCE and offline consent with a fixed callback', () => {
  const redirect = callbackUrl('https://crm.example.com')
  const url = new URL(authorizationUrl('client', redirect, 'john@moveswithsaturn.com', 'state', 'verifier'))
  assert.equal(url.searchParams.get('state'), 'state')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('redirect_uri'), 'https://crm.example.com/api/marketing/google-mail/callback')
  assert.throws(() => callbackUrl('http://evil.example'))
  assert.throws(() => callbackUrl('https://user:password@crm.example.com'))
  assert.throws(() => authorizationUrl('client', redirect, 'someone@gmail.com', 'state', 'verifier'))
})
