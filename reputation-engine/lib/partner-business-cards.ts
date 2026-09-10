import catalog from './data/partner-business-cards.json'

export type PartnerBusinessCard = typeof catalog[number]
export const PARTNER_BUSINESS_CARDS: PartnerBusinessCard[] = catalog
export const BUSINESS_CARD_ASSET_BASE = 'https://idbyrtwdeeruiutoukct.supabase.co/storage/v1/object/public/ops-media/partnership-library/business-cards/2026-09-10'

export function normalizeCardCity(value: string) {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\bsaint\b/g, 'st').replace(/\b(?:and surrounding areas|surrounding areas|area)\b/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** Match service cities, never phone-number hubs. Ambiguous cities require a choice. */
export function findPartnerBusinessCard(city?: string | null): PartnerBusinessCard | null {
  if (!city?.trim()) return null
  const key = normalizeCardCity(city)
  const exact = PARTNER_BUSINESS_CARDS.find(card => card.slug === key || normalizeCardCity(card.city) === key)
  if (exact) return exact
  const parts = city.split(/\s*(?:\/|,|\band\b|&)\s*/i).map(normalizeCardCity).filter(Boolean)
  const matches = PARTNER_BUSINESS_CARDS.filter(card => parts.includes(card.slug) || parts.includes(normalizeCardCity(card.city)))
  return matches.length === 1 ? matches[0] : null
}

export function businessCardUrl(card: PartnerBusinessCard, format: 'image' | 'pdf' = 'image') {
  return `${BUSINESS_CARD_ASSET_BASE}/${card.slug}/card.${format === 'pdf' ? 'pdf' : 'jpg'}`
}

export function businessCardReply(card: PartnerBusinessCard) {
  return `Here you go! Here's our ${card.city} digital card. Looking forward to working with you.`
}

export function attachBusinessCard(current: string[], card: PartnerBusinessCard) {
  // Switching cities replaces this library's previous card while keeping other uploads.
  return [...current.filter(url => !url.startsWith(`${BUSINESS_CARD_ASSET_BASE}/`)), businessCardUrl(card)]
}

export function appendBusinessCardReply(current: string, card: PartnerBusinessCard) {
  const reply = businessCardReply(card)
  if (current.includes(reply)) return current
  for (const previous of PARTNER_BUSINESS_CARDS) {
    const previousReply = businessCardReply(previous)
    if (current.includes(previousReply)) return current.replace(previousReply, reply)
  }
  return [current.trim(), reply].filter(Boolean).join('\n\n')
}
