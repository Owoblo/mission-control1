import assert from 'node:assert/strict'
import Module from 'node:module'
import path from 'node:path'
import test from 'node:test'

const originalResolveFilename = (Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string
})._resolveFilename

;(Module as unknown as {
  _resolveFilename: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string
})._resolveFilename = function resolveAlias(request: string, parent: unknown, isMain: boolean, options?: unknown) {
  if (request.startsWith('@/')) {
    return originalResolveFilename(path.join(__dirname, '../..', request.slice(2)), parent, isMain, options)
  }
  return originalResolveFilename(request, parent, isMain, options)
}

const {
  partnershipInboundNotificationEmail,
  sendPartnershipInboundAlert,
} = require('../../lib/server/internal-notifications') as typeof import('../../lib/server/internal-notifications')

test('partnership inbound email renders downloaded MMS media as inline CID images', () => {
  const html = partnershipInboundNotificationEmail({
    contactId: 'contact-1',
    contactName: 'Steve Hatton',
    channel: 'sms',
    mediaUrls: ['https://api.twilio.com/private-image'],
    embeddedMedia: [{ contentId: 'partner-mms-1', filename: 'Attachment 1' }],
  })

  assert.match(html, /src="cid:partner-mms-1"/)
  assert.match(html, /Media attached \(1\)/)
  assert.doesNotMatch(html, /href="https:\/\/api\.twilio\.com\/private-image"/)
})

test('partnership inbound alert downloads Twilio MMS and sends it as an inline attachment', async () => {
  const originalFetch = global.fetch
  const originalEnv = {
    resend: process.env.RESEND_API_KEY,
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  }
  process.env.RESEND_API_KEY = 'resend-test'
  process.env.TWILIO_ACCOUNT_SID = 'ACtest'
  process.env.TWILIO_AUTH_TOKEN = 'twilio-test'

  let resendPayload: Record<string, unknown> | null = null
  global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.startsWith('https://api.twilio.com/')) {
      return new Response(Buffer.from('jpeg-bytes'), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': '10' },
      })
    }
    if (url === 'https://api.resend.com/emails') {
      resendPayload = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
      return Response.json({ id: 'email-1' })
    }
    throw new Error(`Unexpected URL: ${url}`)
  }) as typeof fetch

  try {
    await sendPartnershipInboundAlert(
      'Partner inbound SMS — Steve Hatton',
      {
        contactId: 'contact-1',
        contactName: 'Steve Hatton',
        channel: 'sms',
        mediaUrls: [
          'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1',
        ],
      },
      ['business@starmovers.ca'],
    )

    assert.ok(resendPayload)
    const capturedPayload = resendPayload as unknown as Record<string, unknown>
    const attachments = capturedPayload.attachments as Array<Record<string, unknown>>
    assert.equal(attachments.length, 1)
    assert.equal(attachments[0].filename, 'partner-mms-1.jpg')
    assert.equal(attachments[0].content_id, 'partner-mms-1')
    assert.equal(attachments[0].content, Buffer.from('jpeg-bytes').toString('base64'))
    assert.match(String(capturedPayload.html), /src="cid:partner-mms-1"/)
  } finally {
    global.fetch = originalFetch
    if (originalEnv.resend === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = originalEnv.resend
    if (originalEnv.accountSid === undefined) delete process.env.TWILIO_ACCOUNT_SID
    else process.env.TWILIO_ACCOUNT_SID = originalEnv.accountSid
    if (originalEnv.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN
    else process.env.TWILIO_AUTH_TOKEN = originalEnv.authToken
  }
})
