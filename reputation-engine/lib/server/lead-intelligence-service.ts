import { synthesizeLeadIntelligence } from '@/lib/server/call-intelligence'
import { getLatestSalesQuoteByLeadId, getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { normalizePhone } from '@/lib/sales-phones'

async function fetchLeadSmsMessages(phone: string) {
  const { url, headers } = requireSupabaseEnv()
  const e164 = normalizePhone(phone) || phone
  const digits10 = phone.replace(/\D/g, '').slice(-10)
  const bare = digits10.length === 10 ? digits10 : null
  const enc164 = encodeURIComponent(e164)
  const orClause = bare && bare !== e164
    ? `or=(from_number.eq.${enc164},to_number.eq.${enc164},from_number.eq.${encodeURIComponent(bare)},to_number.eq.${encodeURIComponent(bare)})`
    : `or=(from_number.eq.${enc164},to_number.eq.${enc164})`
  const response = await fetch(
    `${url}/rest/v1/sms_messages?select=direction,body,created_at&${orClause}&order=created_at.asc&limit=200`,
    { headers, cache: 'no-store' },
  )
  if (!response.ok) return []
  return response.json() as Promise<Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>>
}

async function fetchLeadEmailMessages(email: string) {
  const { url, headers } = requireSupabaseEnv()
  const encoded = encodeURIComponent(email.toLowerCase())
  const response = await fetch(
    `${url}/rest/v1/email_messages?select=direction,subject,body_preview,created_at&or=(from_address.ilike.${encoded},to_address.ilike.${encoded})&order=created_at.asc&limit=100`,
    { headers, cache: 'no-store' },
  )
  if (!response.ok) return []
  return response.json() as Promise<Array<{ direction: 'inbound' | 'outbound'; subject?: string; body_preview?: string; created_at: string }>>
}

export async function refreshLeadIntelligence(leadId: string) {
  const lead = await getSalesLead(leadId)
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const [smsMessages, emailMessages, latestQuote] = await Promise.all([
    lead.phone ? fetchLeadSmsMessages(lead.phone).catch(() => []) : Promise.resolve([]),
    lead.email ? fetchLeadEmailMessages(lead.email).catch(() => []) : Promise.resolve([]),
    getLatestSalesQuoteByLeadId(lead.id).catch(() => null),
  ])
  const intelligence = await synthesizeLeadIntelligence(lead, {
    smsMessages,
    emailMessages,
    quoteSentAt: latestQuote?.sentAt || undefined,
    quoteAmount: latestQuote?.total || undefined,
    quoteStatus: latestQuote?.status || undefined,
  })
  if (!intelligence) throw new Error('Intelligence synthesis failed — check OPENAI_API_KEY')

  const explicitFollowUpDate = intelligence.followUpAt?.slice(0, 10)
  const scheduledFollowUpDate = intelligence.followUpSchedule.find(item => item.dueDate)?.dueDate
  const autoFollowUpDate = explicitFollowUpDate || (!lead.followUpDate ? scheduledFollowUpDate : undefined)
  const autoFollowUpNote =
    intelligence.followUpNote ||
    intelligence.followUpSchedule.find(item => item.script)?.script ||
    intelligence.nextActionDetail ||
    intelligence.nextAction
  return saveSalesLead({
    ...lead,
    intelligence,
    followUpDate: lead.stage === 'booked' || lead.stage === 'lost' ? undefined : autoFollowUpDate || lead.followUpDate,
    followUpNote: lead.stage === 'booked' || lead.stage === 'lost' ? undefined : autoFollowUpNote || lead.followUpNote,
  })
}
