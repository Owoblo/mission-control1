import assert from 'node:assert/strict'
import test from 'node:test'
import { PARTNER_BUSINESS_CARDS, findPartnerBusinessCard, businessCardUrl, attachBusinessCard, appendBusinessCardReply } from '../../lib/partner-business-cards'
import { messageLinkParts } from '../../lib/message-links'

test('city cards match Sarnia and St Thomas rather than their London phone hub', () => {
  assert.equal(findPartnerBusinessCard('Sarnia / Lambton')?.slug, 'sarnia')
  assert.equal(findPartnerBusinessCard('Saint Thomas')?.slug, 'st-thomas')
  assert.equal(findPartnerBusinessCard('Cambridge area')?.slug, 'cambridge')
  assert.equal(findPartnerBusinessCard('Kitchener / Waterloo / Cambridge'), null)
  assert.equal(findPartnerBusinessCard('Unknown city'), null)
})

test('Ottawa cards preserve Dexa branding and all catalog cities have unique assets', () => {
  assert.equal(findPartnerBusinessCard('Ottawa')?.business, 'Dexa Movers')
  assert.ok(PARTNER_BUSINESS_CARDS.length >= 241)
  assert.equal(new Set(PARTNER_BUSINESS_CARDS.map(card => businessCardUrl(card))).size, PARTNER_BUSINESS_CARDS.length)
})

test('changing city replaces the old library attachment without duplicating cards or removing other uploads', () => {
  const sarnia = findPartnerBusinessCard('Sarnia')!
  const london = findPartnerBusinessCard('London')!
  const current = ['https://example.com/other.jpg', businessCardUrl(london)]
  const next = attachBusinessCard(current, sarnia)
  assert.deepEqual(next, ['https://example.com/other.jpg', businessCardUrl(sarnia)])
  assert.deepEqual(attachBusinessCard(next, sarnia), next)
})

test('Blinq links become clickable without trailing punctuation or changing the message', () => {
  const message = 'Here is mine:\n\nhttps://s.blinq.me/cmj2axlef02iks60mk243mm26.'
  const parts = messageLinkParts(message)
  assert.equal(parts.map(p => p.text).join(''), message)
  assert.equal(parts.find(p => p.href)?.href, 'https://s.blinq.me/cmj2axlef02iks60mk243mm26')
  assert.equal(messageLinkParts('(https://example.com/a(b))').find(p => p.href)?.href, 'https://example.com/a(b)')
  assert.equal(messageLinkParts('www.example.com').find(p => p.href)?.href, 'https://www.example.com')
  assert.ok(!messageLinkParts('javascript:alert(1) <script>alert(1)</script>').some(p => p.href))
})

test('switching cards updates only the prepared card reply and retains the user draft', () => {
  const first = appendBusinessCardReply('Thanks Kevin!', findPartnerBusinessCard('London')!)
  const next = appendBusinessCardReply(first, findPartnerBusinessCard('Sarnia')!)
  assert.ok(next.startsWith('Thanks Kevin!'))
  assert.ok(next.includes('Sarnia digital card'))
  assert.ok(!next.includes('London digital card'))
  assert.equal(appendBusinessCardReply(next, findPartnerBusinessCard('Sarnia')!), next)
})

 test('GTA and Hamilton cards use local consumer number and versioned assets', () => {
  for (const city of ['Toronto', 'Mississauga', 'Hamilton', 'Milton', 'King', 'GTA']) {
    const card = findPartnerBusinessCard(city)!
    assert.ok(card, city)
    assert.equal(card.phone, '(437) 782-3004')
    assert.ok(businessCardUrl(card).includes('2026-09-26-gta'))
  }
  const toronto = findPartnerBusinessCard('Toronto')!
  const hamilton = findPartnerBusinessCard('Hamilton')!
  assert.deepEqual(attachBusinessCard([businessCardUrl(toronto)], hamilton), [businessCardUrl(hamilton)])
})

test('all GTA cards use Sold2Move assets and the city email convention', () => {
  const gta = PARTNER_BUSINESS_CARDS.filter(card => card.region === 'toronto')
  assert.equal(gta.length, 29)
  for (const card of gta) {
    assert.equal(card.email, `${card.slug.replaceAll('-', '')}@starmovers.ca`)
    assert.ok(businessCardUrl(card).includes('/2026-09-26-gta-sold2move-v2/'))
  }
  const card = findPartnerBusinessCard('Hamilton')!
  const old = 'https://idbyrtwdeeruiutoukct.supabase.co/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-26-gta/toronto/card.jpg'
  assert.deepEqual(attachBusinessCard([old, 'https://example.com/photo.jpg'], card), ['https://example.com/photo.jpg', businessCardUrl(card)])
})
