import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSaturnTrackingSource, normalizePhone } from '@/lib/sales-phones'

type Message = { twilio_sid?: string | null; lead_id?: string | null; from_number: string; to_number: string; direction: string }

const SID_KEYS = ['twilioSid', 'messageSid', 'twilio_sid'] as const

// Read only provider IDs, never touch notes or attachment metadata. Large inbox
// reads use this index instead of one ownership request per handful of messages.
export async function listPartnershipMessageSids(): Promise<Set<string>> {
  const { url, headers } = requireSupabaseEnv()
  const sids = new Set<string>()
  for (let offset = 0; ; offset += 1000) {
    const query = new URLSearchParams({
      select: SID_KEYS.map(key => `${key}:metadata->>${key}`).join(','),
      or: `(${SID_KEYS.map(key => `metadata->>${key}.not.is.null`).join(',')})`,
      order: 'id.asc', limit: '1000', offset: String(offset),
    })
    const response = await fetch(`${url}/rest/v1/market_touches?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to verify SMS conversation ownership')
    const rows = await response.json() as Record<string, string | null>[]
    for (const row of rows) for (const key of SID_KEYS) if (row[key]) sids.add(row[key]!)
    if (rows.length < 1000) return sids
  }
}

// A partnership touch is authoritative even when legacy phone-based linking
// has already attached its SMS row to a customer lead.
export async function excludePartnershipMessages<T extends Message>(messages: T[], knownPartnerSids?: Set<string>): Promise<T[]> {
  if (!messages.length) return []
  const { url, headers } = requireSupabaseEnv()
  const sids = [...new Set(messages.map(row => row.twilio_sid).filter((sid): sid is string => Boolean(sid)))]
  const partnerSids = knownPartnerSids ?? (sids.length > 80 ? await listPartnershipMessageSids() : new Set<string>())
  for (let start = 0; !knownPartnerSids && sids.length <= 80 && start < sids.length; start += 40) {
    const chunk = sids.slice(start, start + 40)
    const query = new URLSearchParams({ select: 'metadata', or: `(${SID_KEYS.map(key => `metadata->>${key}.in.(${chunk.join(',')})`).join(',')})` })
    const response = await fetch(`${url}/rest/v1/market_touches?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to verify SMS conversation ownership')
    for (const row of await response.json()) {
      for (const key of SID_KEYS) {
        if (typeof row.metadata?.[key] === 'string') partnerSids.add(row.metadata[key])
      }
    }
  }
  return messages.filter(row => {
    if (row.twilio_sid && partnerSids.has(row.twilio_sid)) return false
    const businessNumber = row.direction === 'outbound' ? row.from_number : row.to_number
    return Boolean(row.lead_id) || getSaturnTrackingSource(businessNumber) !== 'partnership_outreach'
  })
}

export async function getSalesSmsReplyLeadId(phone: string, businessPhone: string): Promise<string | null> {
  const normalized = normalizePhone(phone)
  const business = normalizePhone(businessPhone)
  if (!normalized || !business) return null
  const { url, headers } = requireSupabaseEnv()
  const query = new URLSearchParams({
    select: 'twilio_sid,lead_id,from_number,to_number,direction',
    to_number: `in.(${normalized},${normalized.replace(/^\+1/, '')})`,
    from_number: `in.(${business},${business.replace(/^\+1/, '')})`,
    direction: 'eq.outbound', order: 'created_at.desc,id.desc', limit: '1',
  })
  const response = await fetch(`${url}/rest/v1/sms_messages?${query}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to resolve SMS reply context')
  const rows = await response.json() as Message[]
  if (!rows[0]?.lead_id) return null
  return (await excludePartnershipMessages(rows)).length === 1 ? rows[0].lead_id : null
}

export async function isReplyToSalesSms(phone: string, businessPhone: string): Promise<boolean> {
  return Boolean(await getSalesSmsReplyLeadId(phone, businessPhone))
}
