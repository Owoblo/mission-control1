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

export function buildRecentSaleMessage(input: {
  realtorName: string
  address: string
  city?: string | null
  relationship: RecentSaleRelationship
}) {
  const salutation = firstName(input.realtorName)
  const location =
    input.relationship === 'active_partner' || input.relationship === 'warm'
      ? `on ${streetOnly(input.address)}`
      : `in ${compact(input.city) || 'the area'}`

  if (input.relationship === 'active_partner') {
    return `Hi ${salutation}, congratulations on your recent sale ${location}. Nice work getting it across the finish line. If your clients need any help organizing the move, I’m always happy to make the transition easier for them.`
  }
  if (input.relationship === 'warm' || input.relationship === 'known') {
    return `Hi ${salutation}, congratulations on your recent sale ${location}. I wanted to wish you and your clients a smooth closing. If moving support would make the transition easier, I’m happy to help.`
  }
  return `Hi ${salutation}, congratulations on your recent sale ${location}. Wishing you and your clients a smooth closing. If they need moving support, Saturn Star would be happy to help make the transition easier.`
}
