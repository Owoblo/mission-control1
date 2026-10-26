import { normalizePhone } from '../sales-phones'
import { requireSupabaseEnv, getAppBaseUrl } from './runtime'
import { enqueueInternalAlert } from './alert-outbox'

type Contractor = { id: string; company_name: string; contact_name?: string; phone: string }
type Inbound = { from: string; to: string; body: string; sid: string; at: string }
async function read(table: string, query: Record<string, string>) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to resolve contractor SMS ownership')
  return response.json()
}

// A saved contractor plus the most recent non-customer, non-realtor outbound
// on this exact business line establishes the recruiting conversation.
export async function findInboundContractor(from: string, to: string): Promise<Contractor | null> {
  const phone = normalizePhone(from), line = normalizePhone(to)
  if (!phone || !line || !/^\+1\d{10}$/.test(phone)) return null
  const variants = [phone, phone.slice(2)]
  const contractors = await read('subcontractors', { select: 'id,company_name,contact_name,phone', phone: `in.(${variants.join(',')})`, limit: '2' })
  if (contractors.length !== 1) return null
  const [last] = await read('sms_messages', { select: 'twilio_sid,lead_id', direction: 'eq.outbound', from_number: `eq.${line}`, to_number: `in.(${variants.join(',')})`, order: 'created_at.desc', limit: '1' })
  if (!last?.twilio_sid || last.lead_id) return null
  const touches = await read('market_touches', { select: 'id', or: `(${['twilioSid', 'messageSid', 'twilio_sid'].map(key => `metadata->>${key}.eq.${last.twilio_sid}`).join(',')})`, limit: '1' })
  return touches.length ? null : contractors[0]
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
export function contractorInboundEmail(contractor: Contractor, input: Inbound) {
  const name = contractor.company_name || contractor.contact_name || input.from
  const link = `${getAppBaseUrl()}/sales/contractors/${encodeURIComponent(contractor.id)}?tab=messages`
  const time = new Date(input.at).toLocaleString('en-CA', { timeZone: 'America/Toronto' })
  return {
    subject: `Contractor inbound SMS — ${name.replace(/[\r\n]/g, ' ')}`,
    html: `<h2>Contractor inbound SMS — ${escapeHtml(name)}</h2><p><b>Phone:</b> ${escapeHtml(input.from)}<br><b>Received (Eastern):</b> ${escapeHtml(time)}<br><b>Business number:</b> ${escapeHtml(input.to)}</p><div style="white-space:pre-wrap;padding:16px;background:#f1f5f9">${escapeHtml(input.body)}</div><p><a href="${escapeHtml(link)}">Open contractor conversation</a></p><p>Call or text the contractor using the business line. Replies to this notification email go to business@starmovers.ca.</p>`,
  }
}

export async function notifyContractorInbound(contractor: Contractor, input: Inbound, enqueue = enqueueInternalAlert) {
  if (!input.sid) throw new Error('Provider message ID required for contractor alert')
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_tasks?on_conflict=source_key`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ id: `contractor-sms-${input.sid}`, source_key: `contractor-sms:${input.sid}`, title: `Contractor SMS: ${contractor.company_name}`, description: `From: ${input.from}\nTo: ${input.to}\nReceived: ${input.at}\nProvider ID: ${input.sid}\n\n${input.body}`, category: 'operations', status: 'open', priority: 'normal', owner_name: 'John', related_type: null, related_id: contractor.id, related_label: contractor.company_name, source: 'condition', created_by_name: 'Contractor inbound SMS' }),
  })
  if (!response.ok) throw new Error('Could not preserve contractor inbound SMS task')
  const created = Boolean((await response.json()).length)
  const email = contractorInboundEmail(contractor, input)
  // A provider retry must repair a previously saved task whose alert failed.
  // The durable event key prevents re-emailing an already queued notification.
  await enqueue(`contractor-sms:${input.sid}`, { recipients: ['business@starmovers.ca'], ...email })
  return created
}
