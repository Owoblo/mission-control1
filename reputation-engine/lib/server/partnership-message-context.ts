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
  async function customerLeadId(id?: string | null) {
    if (!id || id.startsWith('partner-handoff-')) return null
    const response = await fetch(`${url}/rest/v1/crm_leads?${new URLSearchParams({ id: `eq.${id}`, select: 'id,data,deleted', limit: '1' })}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to verify customer conversation ownership')
    const [row] = await response.json() as Array<{ id: string; deleted: boolean; data: { leadKind?: string; conversationReview?: { kind?: string; status?: string } } }>
    if (!row || row.deleted || row.data.leadKind && row.data.leadKind !== 'customer' || row.data.conversationReview?.kind === 'no_active_move' && row.data.conversationReview.status === 'open') return null
    return id
  }
  const query = new URLSearchParams({
    select: 'twilio_sid,lead_id,from_number,to_number,direction',
    to_number: `in.(${normalized},${normalized.replace(/^\+1/, '')})`,
    from_number: `in.(${business},${business.replace(/^\+1/, '')})`,
    direction: 'eq.outbound', order: 'created_at.desc,id.desc', limit: '1',
  })
  const response = await fetch(`${url}/rest/v1/sms_messages?${query}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to resolve SMS reply context')
  const rows = await response.json() as Message[]
  // A manually sent Sales follow-up may lack lead_id. On a dedicated Sales
  // line, retain the last explicitly linked conversation for this exact pair.
  // Do not reach back across a newer partnership message on shared lines.
  if (rows.length && !rows[0].lead_id && ['google_online_search', 'direct_mail'].includes(getSaturnTrackingSource(business) || '')) {
    query.set('lead_id', 'not.is.null')
    const linkedResponse = await fetch(`${url}/rest/v1/sms_messages?${query}`, { headers, cache: 'no-store' })
    if (!linkedResponse.ok) throw new Error('Unable to resolve SMS reply context')
    const linked = await linkedResponse.json() as Message[]
    return customerLeadId((await excludePartnershipMessages(linked))[0]?.lead_id)
  }
  if (!rows[0]?.lead_id || rows[0].lead_id.startsWith('partner-handoff-')) return null
  return (await excludePartnershipMessages(rows)).length === 1 ? customerLeadId(rows[0].lead_id) : null
}

export async function isReplyToSalesSms(phone: string, businessPhone: string): Promise<boolean> {
  return Boolean(await getSalesSmsReplyLeadId(phone, businessPhone))
}
