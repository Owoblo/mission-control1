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

/** Use clearly personal name segments; business-only labels keep a neutral reply. */
export function businessCardFirstName(name?: string | null) {
  const businessWords = /\b(mortgages?|mortgagebroker|mortgageagent|financial|finance|funding|lending|realtors?|realty|real|estate|team|group|associates?|brokerage|brokers?|insurance|solutions?|services?|company|inc|ltd|limited|centre|center|bank|rbc|bmo|cibc|dominion|verico|invis|tmg|dlc|kw|your|the|one|source|true|north|london|windsor|ottawa|sarnia|waterloo|kitchener|cambridge|guelph|woodstock)\b/i
  for (const part of (name || '').split(/\s+[–—-]\s+|\s*[|,]\s*/)) {
    const clean = part.trim().replace(/^(?:Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+/i, '')
    if (businessWords.test(clean)) continue
    const words = clean.split(/\s+/)
    if (words.length < 2 || words.length > 4 || !words.every(word => /^[\p{L}][\p{L}'’.-]*$/u.test(word))) continue
    const first = words[0]
    if (first.length < 2 || first.endsWith('.')) continue
    return first === first.toUpperCase() || first === first.toLowerCase()
      ? first[0].toUpperCase() + first.slice(1).toLowerCase() : first
  }
  return ''
}

export function businessCardReply(card: PartnerBusinessCard, firstName = '') {
  return `Here you go! Here's our ${card.city} digital card. Looking forward to working with you${firstName ? ` ${firstName}` : ''}.`
}

export function attachBusinessCard(current: string[], card: PartnerBusinessCard) {
  // Switching cities replaces this library's previous card while keeping other uploads.
  return [...current.filter(url => !url.startsWith(`${BUSINESS_CARD_ASSET_BASE}/`)), businessCardUrl(card)]
}

export function appendBusinessCardReply(current: string, card: PartnerBusinessCard, firstName = '') {
  const reply = businessCardReply(card, firstName)
  if (current.includes(reply)) return current
  for (const previous of PARTNER_BUSINESS_CARDS) {
    for (const name of [firstName, '']) {
      const previousReply = businessCardReply(previous, name)
      if (current.includes(previousReply)) return current.replace(previousReply, reply)
    }
  }
  return [current.trim(), reply].filter(Boolean).join('\n\n')
}
