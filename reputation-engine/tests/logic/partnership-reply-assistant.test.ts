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
  assert.match(result.draft_sms, /relationship managers/i)
  assert.doesNotMatch(result.draft_sms, /address should I come to|I can come|I'll come|I will come/i)
})

test('partnership assistant uses local team language for postcard drop offs', async () => {
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact,
    touches: inbound('Sure, you can drop postcards off anytime.'),
  })

  assert.equal(result.quick_action, 'drop_cards')
  assert.match(result.draft_sms, /make arrangements to drop it off/i)
  assert.doesNotMatch(result.draft_sms, /I can drop|I'll drop|I will drop/i)
})

test('partnership assistant keeps low-referral-capacity drop offs low pressure', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: {
      ...contact,
      name: 'Kevin Diluca',
      company: 'REMO VALENTE REAL ESTATE (1990) LIMITED',
    },
    touches: inbound('You can drop off cards to reception at Valente Real Estate on Dougall. I have a different position at the company an not selling very much'),
  })

  assert.equal(result.intent, 'drop_by_anytime')
  assert.equal(result.quick_action, 'drop_cards')
  assert.equal(result.extracted.low_referral_activity, true)
  assert.match(result.draft_sms, /Totally understand, Kevin/i)
  assert.match(result.draft_sms, /no pressure/i)
  assert.match(result.draft_sms, /leave a few cards at reception/i)
  assert.match(result.draft_sms, /even one client is helpful/i)
  assert.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i)
  assert.doesNotMatch(result.draft_sms, /What is the best address to use|What address and time work best|relationship managers/i)
  assert.doesNotMatch(result.draft_sms, /digital package: https:\/\//i)
})

test('partnership assistant answers social media requests and uses brokerage location hints', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: {
      ...contact,
      name: 'Natalie Lazzarin-Gignac',
      company: 'ROYAL LEPAGE BINDER REAL ESTATE',
    },
    touches: inbound("Hey! Always open to new business and we always need movers! You certainly can. It's the Royal LePage on Provincial. Do you have a social media page"),
  })

  assert.equal(result.intent, 'asks_social_media')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.quick_action, 'drop_cards')
  assert.equal(result.extracted.asks_social_media, true)
  assert.match(result.extracted.brokerage_location || '', /Royal LePage on Provincial/i)
  assert.match(result.draft_sms, /Absolutely Natalie/i)
  assert.match(result.draft_sms, /yes we do/i)
  assert.match(result.draft_sms, /Royal LePage on Provincial works/i)
  assert.match(result.draft_sms, /make arrangements to drop it off/i)
  assert.match(result.draft_sms, /social links/i)
  assert.match(result.draft_sms, /referral details/i)
  assert.doesNotMatch(result.draft_sms, /What is the best address to use/i)
  assert.doesNotMatch(result.draft_sms, /digital package: https:\/\//i)
})

test('partnership assistant answers share-number email and website requests before package CTA', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.PARTNERSHIP_PUBLIC_EMAIL
  delete process.env.PARTNERSHIP_PUBLIC_WEBSITE
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Rami Abraham', city: 'Windsor' },
    touches: inbound("Hi Hunter, thanks for reaching out. I'm not usually in the office. But I'll keep your number handy on my phone. Is this the number I can share with clients? And do you also have an email or website? Thanks"),
  })

  assert.equal(result.intent, 'asks_contact_info')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.equal(result.extracted.asks_share_number, true)
  assert.equal(result.extracted.asks_website, true)
  assert.match(result.draft_sms, /Rami/i)
  assert.match(result.draft_sms, /this number works for clients too/i)
  assert.match(result.draft_sms, /info@starmovers\.ca/i)
  assert.match(result.draft_sms, /starmovers\.ca/i)
  assert.match(result.draft_sms, /Is it okay if I send the full digital package here too\?/i)
  assert.doesNotMatch(result.draft_sms, /what email should I send|What address and time|drop the postcards/i)
})

test('partnership assistant answers identity after digital package email approval', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Rose Laflamme', city: 'Windsor' },
    touches: conversation([
      { direction: 'outbound', text: 'Perfect, thanks Rose. I will make arrangements to drop it off. What address and time work best? Is it okay if I send the full digital package here too?' },
      { direction: 'inbound', text: 'Digital is good. My email rose@jumprealty.ca' },
      { direction: 'inbound', text: 'Is this Hunter?' },
    ]),
  })

  assert.equal(result.intent, 'confirms_identity')
  assert.equal(result.recommended_action, 'send_package')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.equal(result.goal_state.digital_package, 'ready_to_send')
  assert.match(result.draft_sms, /Yes, Rose, this is Hunter/i)
  assert.match(result.draft_sms, /rose@jumprealty\.ca/i)
  assert.match(result.draft_sms, /digital package/i)
  assert.doesNotMatch(result.draft_sms, /What address and time|What is the best address|Is it okay if I send/i)
})

test('partnership assistant treats recent client referral requests as credibility requests', async () => {
  delete process.env.PARTNERSHIP_DIGITAL_PACKAGE_URL
  delete process.env.PARTNERSHIP_RATE_CARD_URL
  delete process.env.PARTNERSHIP_REFERRAL_PROGRAM_URL
  delete process.env.PARTNERSHIP_FLYER_IMAGE_URL
  delete process.env.OPENAI_API_KEY

  const result = await suggestPartnershipReply({
    contact: { ...contact, name: 'Shaun Cushing', city: 'Windsor' },
    touches: inbound('Absolutely. If you could add a couple referrals of recent clients, that would be great as well'),
  })

  assert.equal(result.intent, 'asks_for_references')
  assert.equal(result.recommended_action, 'draft_reply')
  assert.equal(result.goal_state.physical_delivery, 'not_needed')
  assert.match(result.draft_sms, /Absolutely, Shaun/i)
  assert.match(result.draft_sms, /recent client feedback/i)
  assert.match(result.draft_sms, /referral examples/i)
  assert.match(result.draft_sms, /Is it okay if I send that here too\?/i)
  assert.doesNotMatch(result.draft_sms, /What address and time|drop the postcards|relationship managers/i)
})
