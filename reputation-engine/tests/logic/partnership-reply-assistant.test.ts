import assert from 'node:assert/strict'
import Module from 'node:module'
import path from 'node:path'
import test from 'node:test'
import type { PartnershipAssistantContact, PartnershipAssistantTouch } from '../../lib/server/partnership-reply-assistant'

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

const { suggestPartnershipReply } = require('../../lib/server/partnership-reply-assistant') as typeof import('../../lib/server/partnership-reply-assistant')

const contact: PartnershipAssistantContact = {
  id: 'contact_1',
  name: 'Mak Cole',
  company: 'REMAX Preferred Realty',
  title: 'Realtor',
  email: null,
  phone: '+15199841037',
  city: 'Windsor',
  industry: 'real_estate',
  stage: 'replied',
  decision: null,
}

function inbound(notes: string): PartnershipAssistantTouch[] {
  return [{
    id: 'touch_1',
    channel: 'sms',
    direction: 'inbound',
    notes,
    created_by: null,
    created_at: '2026-06-18T16:48:00.000Z',
  }]
}

test('partnership assistant treats client email info requests as package-forwarding requests', async () => {
  process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/mak-cole-windsor'
  process.env.PARTNERSHIP_RATE_CARD_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf'
  process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL = 'https://starmovers.ca/quote'
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact,
    touches: inbound('Good afternoon hunter, I hope all is well. Do you have anything I can send to clients over email/ info about your business? Thank you'),
  })

  assert.equal(result.intent, 'asks_for_email')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.match(result.draft_sms, /what email/i)
  assert.match(result.draft_sms, /flyer|rate card|referral|client quote/i)
  assert.doesNotMatch(result.draft_sms, /best address and time/i)
})

test('partnership assistant treats card or picture requests as media permission', async () => {
  process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/louie-lisi-windsor'
  process.env.PARTNERSHIP_FLYER_IMAGE_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf'
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Louie Lisi', phone: '+15199714263' },
    touches: inbound('Just text me your card thank you take a picture for me and send to me thanks'),
  })

  assert.equal(result.intent, 'send_card_or_flyer_media')
  assert.equal(result.recommended_action, 'send_package')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.match(result.draft_sms, /text.*over|text.*card|card\/flyer/i)
  assert.deepEqual(result.suggested_media_urls, ['https://starmovers.ca/partner/flyers/windsor.pdf'])
})
