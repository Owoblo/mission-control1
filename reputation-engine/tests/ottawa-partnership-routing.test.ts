import { createHmac } from 'node:crypto'
import assert from 'node:assert/strict'
import test from 'node:test'
import { getPartnershipAlertRecipients } from '../lib/server/internal-notifications'
import { POST } from '../app/api/marketing/dialer/twiml/route'

test('Ottawa and Vanier notify the Dexa mailbox without affecting Windsor', () => {
  for (const city of ['Ottawa', 'Vanier', 'Nepean', 'Manotick']) {
    const recipients = getPartnershipAlertRecipients(city)
    assert.ok(recipients.includes('hello@dexamovers.ca'))
    assert.ok(!recipients.includes('ekecourage1@gmail.com'))
  }
  assert.ok(!getPartnershipAlertRecipients('Windsor').includes('hello@dexamovers.ca'))
})

test('inbound Ottawa call rings the branch manager and configured cell', async () => {
  const originalFetch = globalThis.fetch
  const old = { ...process.env }
  process.env.SUPABASE_URL = 'https://example.invalid'
  process.env.SUPABASE_KEY = 'test-only'
  process.env.TWILIO_AUTH_TOKEN = 'test-auth'
  process.env.PARTNERSHIP_FORWARD_PHONE_OTTAWA = '+13435513167'
  process.env.PARTNERSHIP_FORWARD_CLIENT_IDENTITY = 'deleted-user'
  const urls: string[] = []
  globalThis.fetch = (async (input: any) => {
    const url = String(input); urls.push(url)
    if (url.includes('/rpc/capture_crm_interaction')) return Response.json('receipt')
    assert.ok(url.includes('/app_users?role=in.(partnership_manager,manager)'))
    return new Response(JSON.stringify([{ id: 'courage-current', branch: 'ottawa' }]), { status: 200 })
  }) as typeof fetch
  try {
    const url = 'https://example.invalid/api/marketing/dialer/twiml'
    const signature = createHmac('sha1', 'test-auth').update(url + 'To+15482908695').digest('base64')
    const response = await POST(new Request(url, { method: 'POST', headers: { 'x-twilio-signature': signature }, body: new URLSearchParams({ To: '+15482908695' }) }))
    const xml = await response.text()
    assert.ok(xml.includes('<Client>partnership-rep-courage-current</Client>'))
    assert.ok(xml.includes('<Client>saturn-rep-courage-current</Client>'))
    assert.ok(xml.includes('<Number>+13435513167</Number>'))
    assert.ok(!xml.includes('deleted-user'))
    assert.ok(xml.includes('callerId="+15482908695"'))
    assert.equal(urls.length, 2)
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]
    Object.assign(process.env, old)
  }
})
