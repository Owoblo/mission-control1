import cards from './data/partner-business-cards.json'

const key = (value?: string | null) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const categories: Record<string, [string, string]> = {
  'real estate': ['real_estate', 'Real estate'],
  'mortgage brokers': ['mortgage', 'Mortgage brokers and agents'],
  'mortgage brokers and agents': ['mortgage', 'Mortgage brokers and agents'],
  'bank mortgage specialists': ['bank_mortgage', 'Bank mortgage specialists'],
  'schools and tertiary institutions': ['education', 'Schools and tertiary institutions'],
  'oems, factories and large organizations': ['industrial', 'OEMs, factories and large organizations'],
  'hotels': ['hotel', 'Hotels'],
  'larger movers and subcontracting': ['moving_company', 'Moving companies and subcontractors'],
  'interior designers': ['interior_design', 'Interior designers'],
  'furniture stores': ['furniture', 'Furniture stores'],
  'cities and governments': ['government', 'Cities and governments'],
  'law firms': ['legal', 'Law firms'],
  'u-haul and vehicle rentals': ['vehicle_rental', 'Vehicle rentals'],
  'piano sellers': ['piano', 'Piano sellers'],
  'pool-table sellers': ['pool_table', 'Pool-table sellers'],
  'home stagers': ['home_staging', 'Home stagers'],
}
const roles: Record<string, string> = {
  'salesperson': 'Salesperson', 'sales person': 'Salesperson', 'sales representative': 'Salesperson',
  'real estate salesperson': 'Salesperson', 'real estate sales representative': 'Salesperson',
  'realtor® salesperson': 'Salesperson', 'broker': 'Broker', 'realtor® broker': 'Broker',
  'broker of record': 'Broker of record', 'broker manager': 'Broker manager',
  'listing_agent': 'Listing agent', 'co_listing_agent': 'Co-listing agent',
  'listing_representative': 'Listing representative', 'realtor®': 'Real estate agent',
  'real estate agent': 'Real estate agent', 'realtor': 'Real estate agent',
}
export function relationshipIdentity(contact: { industry?: string | null; title?: string | null; city?: string | null; preferred_channel?: string | null }) {
  const category = categories[key(contact.industry)]
  const title = contact.title?.trim() || ''
  const unresolvedRole = !title || /to confirm|individual or office as listed|business office \/ referral contact/i.test(title)
  const city = cards.find(c => key(c.city) === key(contact.city))
  const preferred = key(contact.preferred_channel)
  return {
    category: { id: category?.[0] || null, label: category?.[1] || contact.industry?.trim() || 'Not recorded', mapped: !!category },
    role: unresolvedRole ? 'Contact person / role to confirm' : roles[key(title)] || title,
    roleRecorded: !unresolvedRole,
    city: city?.city || contact.city?.trim() || 'Not recorded',
    cityMapped: !!city,
    serviceRegion: city?.region || null,
    phoneHub: city?.hub || null,
    companyBrand: city?.business || null,
    preferredChannel: preferred === 'call' ? 'phone' : preferred || null,
  }
}
export function canonicalChannel(channel?: string | null) {
  const value = key(channel)
  if (['call', 'phone', 'voicemail'].includes(value)) return 'phone'
  if (['sms', 'mms'].includes(value)) return 'sms'
  if (['direct_mail', 'postcard', 'mail'].includes(value)) return 'direct_mail'
  return value || 'note'
}
export function fulfilmentSummary(row: { id: string; title: string; status: string; category?: string; description?: string | null; due_at?: string | null; updated_at?: string | null }) {
  let data: Record<string, unknown> = {}
  let plainDescription: string | null = null
  try { const parsed = JSON.parse(row.description || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed } catch { plainDescription = row.description || null }
  const text = (value: unknown) => typeof value === 'string' ? value : null
  return { id: row.id, title: row.title, taskStatus: row.status, status: text(data.status) || row.status,
    reason: (text(data.reason) || text(data.note) || plainDescription)?.slice(0, 1200) || null, dueAt: row.due_at, updatedAt: row.updated_at,
    providerId: text(data.provider_id) || text(data.providerId) || text(data.email_message_id),
    dispatchStatus: text(data.dispatch_status), receiptStatus: text(data.receipt_status),
    hasPhoto: Array.isArray(data.image_evidence) && data.image_evidence.length > 0,
    photoReviewed: data.image_visually_reviewed === true,
  }
}
