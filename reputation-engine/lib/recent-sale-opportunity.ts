export type RecentSaleRelationship =
  | 'active_partner'
  | 'warm'
  | 'known'
  | 'cold'
  | 'unmatched'

export type RecentSaleContact = {
  id: string
  name?: string | null
  company?: string | null
  phone?: string | null
  email?: string | null
  city?: string | null
  stage?: string | null
  relationship_temperature?: string | null
  relationship_score?: number | null
  partnership_outcome?: string | null
  last_inbound_at?: string | null
}

export type ListingRepresentative = {
  name: string
  role?: string | null
  phone?: string | null
  email?: string | null
  brokerage?: string | null
}

function compact(value?: string | null) {
  return (value || '').trim()
}

export function digits(value?: string | null) {
  return compact(value).replace(/\D/g, '').slice(-10)
}

export function normalizePersonName(value?: string | null) {
  return compact(value)
    .toLowerCase()
    .replace(/\b(realtor|salesperson|sales person|broker|broker of record|representative)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeBrokerage(value?: string | null) {
  return compact(value)
    .toLowerCase()
    .replace(/\b(incorporated|inc|limited|ltd|brokerage|real estate|realty)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildRecentSaleEventKey(input: {
  mls?: string | null
  address: string
  city?: string | null
  realtorName: string
}) {
  const property = compact(input.mls) || `${compact(input.address)}|${compact(input.city)}`
  return `${property}|${normalizePersonName(input.realtorName)}`
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, '_')
}

export function scoreRecentSaleContact(
  representative: ListingRepresentative,
  contact: RecentSaleContact
) {
  const repPhone = digits(representative.phone)
  const contactPhone = digits(contact.phone)
  const repEmail = compact(representative.email).toLowerCase()
  const contactEmail = compact(contact.email).toLowerCase()
  const repName = normalizePersonName(representative.name)
  const contactName = normalizePersonName(contact.name)
  const repBrokerage = normalizeBrokerage(representative.brokerage)
  const contactBrokerage = normalizeBrokerage(contact.company)
  const sameCity =
    compact(contact.city).toLowerCase() !== '' &&
    compact(contact.city).toLowerCase() === compact((representative as { city?: string }).city).toLowerCase()

  let score = 0
  const reasons: string[] = []
  if (repPhone && repPhone === contactPhone) {
    score += 100
    reasons.push('phone')
  }
  if (repEmail && repEmail === contactEmail) {
    score += 100
    reasons.push('email')
  }
  if (repName && repName === contactName) {
    score += 55
    reasons.push('name')
  }
  if (repBrokerage && contactBrokerage && repBrokerage === contactBrokerage) {
    score += 35
    reasons.push('brokerage')
  }
  if (sameCity) {
    score += 10
    reasons.push('city')
  }

  return { score, reasons }
}

export function classifyRecentSaleRelationship(contact?: RecentSaleContact | null): RecentSaleRelationship {
  if (!contact) return 'unmatched'
  const stage = compact(contact.stage).toLowerCase()
  const outcome = compact(contact.partnership_outcome).toLowerCase()
  const temperature = compact(contact.relationship_temperature).toLowerCase()
  if (
    outcome === 'secured' ||
    ['partnership_active', 'partnered', 'referring', 'active_partner'].includes(stage)
  ) return 'active_partner'
  if (temperature === 'hot' || temperature === 'warm' || (contact.relationship_score || 0) >= 45) return 'warm'
  if (contact.last_inbound_at || !['', 'new', 'prospect', 'cold'].includes(stage)) return 'known'
  return 'cold'
}

function firstName(value: string) {
  return compact(value).split(/\s+/)[0] || 'there'
}

function streetOnly(address: string) {
  return compact(address).split(',')[0] || 'your recent sale'
}

export const RECENT_SALE_MESSAGE_TEMPLATE = `Hi {{name}}, congratulations on the sale of {{address}}.

I wanted to reach out in case your client still needs help with their move. We’d be happy to provide them with a straightforward estimate and make the process as easy as possible.

No pressure at all, but would you be comfortable passing along our number to them?`

export function buildRecentSaleMessage(input: {
  realtorName: string
  address: string
  city?: string | null
  relationship: RecentSaleRelationship
}) {
  return RECENT_SALE_MESSAGE_TEMPLATE
    .replaceAll('{{name}}', firstName(input.realtorName))
    .replaceAll('{{address}}', streetOnly(input.address))
}

function httpUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const parsed = new URL(value.trim())
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : ''
  } catch {
    return ''
  }
}

export function buildRecentSaleListingUrl(input: {
  address: string
  city?: string | null
  verificationSource?: string | null
  metadata?: Record<string, unknown> | null
}) {
  const metadata = input.metadata || {}
  const directCandidates = [
    metadata.listing_url,
    metadata.listingUrl,
    metadata.ListingURL,
    metadata.source_url,
    metadata.sourceUrl,
    metadata.realtor_url,
    metadata.realtorUrl,
    metadata.zillow_url,
    metadata.zillowUrl,
    metadata.property_url,
    metadata.propertyUrl,
    metadata.url,
    input.verificationSource,
  ]
  for (const candidate of directCandidates) {
    const url = httpUrl(candidate)
    if (url) return url
  }

  const query = [`"${streetOnly(input.address)}"`, compact(input.city), 'Ontario']
    .filter(Boolean)
    .join(' ')
  return `https://www.google.com/search?q=${encodeURIComponent(`site:realtor.ca/real-estate OR site:zillow.com/homedetails ${query}`)}`
}
