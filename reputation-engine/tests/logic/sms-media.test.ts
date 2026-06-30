import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractMmsUrlsFromBody,
  isTwilioApiMediaUrl,
  normalizeSmsMediaUrls,
  stripMmsMarkersFromBody,
} from '../../lib/sms-media'

test('SMS media helpers strip Twilio MMS markers from customer text', () => {
  const body = 'Everytime I upload it get this\n[MMS: https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123]'

  assert.equal(stripMmsMarkersFromBody(body), 'Everytime I upload it get this')
  assert.deepEqual(extractMmsUrlsFromBody(body), [
    'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123',
  ])
})

test('SMS media helpers normalize explicit media and body marker URLs without duplicates', () => {
  const url = 'https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM123/Media/ME123'

  assert.deepEqual(normalizeSmsMediaUrls({
    body: `Photo attached\n[MMS: ${url}]`,
    media: [{ url }],
    metadata: { mediaUrls: [url] },
  }), [url])
  assert.equal(isTwilioApiMediaUrl(url), true)
  assert.equal(isTwilioApiMediaUrl('https://example.com/photo.jpg'), false)
})
