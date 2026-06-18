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

function conversation(notes: Array<{ direction: 'inbound' | 'outbound'; text: string }>): PartnershipAssistantTouch[] {
  return notes.map((item, index) => ({
    id: `touch_${index + 1}`,
    channel: 'sms',
    direction: item.direction,
    notes: item.text,
    created_by: item.direction === 'outbound' ? 'Hunter' : null,
    created_at: new Date(Date.UTC(2026, 5, 18, 16, 48 + index)).toISOString(),
  }))
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
  assert.match(result.draft_sms, /Mak/i)
  assert.match(result.draft_sms, /what email/i)
  assert.match(result.draft_sms, /flyer|rate card|referral|client quote/i)
  assert.doesNotMatch(result.draft_sms, /best address and time/i)
})

test('partnership assistant treats card or picture requests as media permission', async () => {
  process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/louie-lisi-windsor'
  process.env.PARTNERSHIP_FLYER_IMAGE_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf'
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Louie Lisi', phone: '+15199714263' },
    touches: inbound('Just text me your card thank you take a picture for me and send to me thanks'),
  })

  assert.equal(result.intent, 'send_card_or_flyer_media')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.equal(result.goal_state.digital_package, 'suggested')
  assert.match(result.draft_sms, /text.*card|card\/flyer/i)
  assert.match(result.draft_sms, /Is it okay if I send that here too\?/i)
  assert.deepEqual(result.suggested_media_urls, ['https://starmovers.ca/partner/flyers/windsor.pdf'])
})

test('partnership assistant handles digital card only replies without pushing office drop off', async () => {
  process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL = 'https://starmovers.ca/partner/simon-tan-windsor'
  process.env.PARTNERSHIP_FLYER_IMAGE_URL = 'https://starmovers.ca/partner/flyers/windsor.pdf'
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Simon Tan', phone: '+15199715971' },
    touches: inbound("Thank you for the information, I don't go to the office very often, you can just send me your business card through this number. I will contact you when I need."),
  })

  assert.equal(result.intent, 'send_card_or_flyer_media')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.match(result.draft_sms, /card|flyer/i)
  assert.match(result.draft_sms, /Is it okay if I send that here too\?/i)
  assert.doesNotMatch(result.draft_sms, /best address|drop.*postcard|office/i)
})

test('partnership assistant auto-generates package links when env links are absent', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: {
      ...contact,
      name: 'Simon Tan',
      city: 'Windsor',
      tracking_code: null,
      affiliate_partner_id: null,
    },
    touches: inbound('Thank you, you can just send me your business card through this number.'),
  })

  assert.equal(result.package_configured, true)
  assert.doesNotMatch(result.risk_flags.join(' '), /package_links_not_configured/)
  assert.deepEqual(result.suggested_media_urls, ['https://starmovers.ca/partner/flyers/windsor.pdf'])
})

test('partnership assistant treats go ahead after package permission ask as approval to send package', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
    touches: conversation([
      { direction: 'inbound', text: 'Hi Hunter, you can just text me your card here.' },
      { direction: 'outbound', text: 'For sure Moe, I can text the card/flyer here. I also have a short digital package with rates, referral info, and your client quote link in one place. Is it okay if I send that here too?' },
      { direction: 'inbound', text: 'Hey Hunter ya go ahead' },
    ]),
  })

  assert.equal(result.intent, 'positive_vague')
  assert.equal(result.recommended_action, 'send_package')
  assert.equal(result.goal_state.digital_package, 'ready_to_send')
  assert.match(result.draft_sms, /digital package: https:\/\/starmovers\.ca\/partner\/moe-fakih-windsor\?city=windsor/i)
  assert.doesNotMatch(result.draft_sms, /if that is okay|Is it okay|Is it cool/i)
})

test('partnership assistant treats go ahead after card drop ask as postcard approval only', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
    touches: conversation([
      { direction: 'outbound', text: 'Would it be okay if I stopped by your office next week to drop off a few cards?' },
      { direction: 'inbound', text: 'Loved “Would it be okay if I stopped by your office next week to drop off a few cards?”' },
      { direction: 'inbound', text: 'Hey Hunter ya go ahead' },
    ]),
  })

  assert.equal(result.intent, 'postcard_yes')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.goal_state.digital_package, 'suggested')
  assert.match(result.draft_sms, /What address and time work best/i)
  assert.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i)
  assert.match(result.draft_sms, /client quote link you can forward anytime/i)
  assert.doesNotMatch(result.draft_sms, /digital package: https:\/\//i)
  assert.doesNotMatch(result.risk_flags.join(' '), /needs_context_review/)
})

test('partnership assistant treats sms love reactions as soft acknowledgement', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Moe Fakih', city: 'Windsor' },
    touches: conversation([
      { direction: 'outbound', text: 'Would it be okay if I stopped by your office next week to drop off a few cards?' },
      { direction: 'inbound', text: 'Loved “Would it be okay if I stopped by your office next week to drop off a few cards?”' },
    ]),
  })

  assert.equal(result.intent, 'warm_acknowledgement')
  assert.match(result.risk_flags.join(' '), /sms_reaction_only/)
  assert.equal(result.recommended_action, 'draft_reply')
  assert.doesNotMatch(result.draft_sms, /digital package: https:\/\//i)
})

test('partnership assistant routes meeting requests through local relationship reps', async () => {
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact,
    touches: inbound('Can you come by Tuesday afternoon to meet?'),
  })

  assert.equal(result.intent, 'wants_meeting')
  assert.equal(result.quick_action, 'meeting_requested')
  assert.match(result.draft_sms, /Mak/i)
  assert.match(result.draft_sms, /local relationship rep|local team|someone from our/i)
  assert.doesNotMatch(result.draft_sms, /address should I come to|I can come|I'll come|I will come/i)
})

test('partnership assistant uses local team language for postcard drop offs', async () => {
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact,
    touches: inbound('Sure, you can drop postcards off anytime.'),
  })

  assert.equal(result.quick_action, 'drop_cards')
  assert.match(result.draft_sms, /local team|local relationship reps|someone from our/i)
  assert.doesNotMatch(result.draft_sms, /I can drop|I'll drop|I will drop/i)
})
