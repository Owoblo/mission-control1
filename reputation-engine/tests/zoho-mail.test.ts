import test from 'node:test'
import assert from 'node:assert/strict'
import { accountContainsMailbox, checkZohoMailbox, zohoOrigin } from '../lib/server/zoho-mail'

test('Zoho credentials only go to exact regional service origins', () => {
  assert.equal(zohoOrigin('https://accounts.zohocloud.ca', 'accounts'), 'https://accounts.zohocloud.ca')
  for (const url of ['https://accounts.zoho.com.evil.test', 'http://accounts.zoho.com', 'https://user@accounts.zoho.com', 'https://accounts.zoho.com/redirect']) {
    assert.throws(() => zohoOrigin(url, 'accounts'))
  }
})

test('a different or unconfirmed mailbox does not authorize the reply inbox', () => {
  assert.equal(accountContainsMailbox({ accountId: '1', primaryEmailAddress: 'partnerships@starmovers.ca' }, 'business@starmovers.ca'), false)
  assert.equal(accountContainsMailbox({ accountId: '1', emailAddress: [{ mailId: 'business@starmovers.ca', isConfirmed: false }] }, 'business@starmovers.ca'), false)
  assert.equal(accountContainsMailbox({ accountId: '1', primaryEmailAddress: 'BUSINESS@starmovers.ca' }, 'business@starmovers.ca'), true)
})

test('connection check validates OAuth, mailbox access, and message-read scope separately', async () => {
  const values = {
    ZOHO_PARTNERSHIP_CLIENT_ID: 'test-client', ZOHO_PARTNERSHIP_CLIENT_SECRET: 'test-secret',
    ZOHO_PARTNERSHIP_REFRESH_TOKEN: 'test-refresh', PARTNERSHIP_EMAIL_REPLY_TO: 'business@starmovers.ca',
    ZOHO_PARTNERSHIP_ACCOUNTS_URL: 'https://accounts.zohocloud.ca', ZOHO_PARTNERSHIP_MAIL_URL: 'https://mail.zohocloud.ca',
  }
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  try {
    let calls = 0
    const denied = await checkZohoMailbox((async () => {
      calls++
      return Response.json({ error: 'invalid_code' })
    }) as typeof fetch)
    assert.equal(denied.reason, 'oauth_refresh_failed')
    assert.equal(calls, 1)
    const responses = [
      { access_token: 'private-token' },
      { status: { code: 200 }, data: [{ accountId: '123', primaryEmailAddress: 'business@starmovers.ca' }] },
      { status: { code: 200 }, data: [{ subject: 'Private email' }] },
    ]
    const result = await checkZohoMailbox((async () => Response.json(responses.shift())) as typeof fetch)
    assert.equal(result.ok, true)
    assert.equal(result.replySendTested, false)
    assert.equal(JSON.stringify(result).includes('private-token'), false)
    assert.equal(JSON.stringify(result).includes('Private email'), false)
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
