import { readEnv } from '@/lib/server/runtime'

const INSTANTLY_BASE = 'https://api.instantly.ai/api/v2'

function getApiKey() {
  const key = readEnv('INSTANTLY_API_KEY')
  if (!key) throw new Error('INSTANTLY_API_KEY not configured')
  return key
}

function instantlyHeaders() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  }
}

async function instantlyFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${INSTANTLY_BASE}${path}`, {
    ...options,
    headers: { ...instantlyHeaders(), ...(options.headers as Record<string, string> ?? {}) },
    cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  if (!res.ok) throw new Error(`Instantly ${res.status}: ${typeof data === 'object' ? JSON.stringify(data) : String(data)}`)
  return data
}

export interface InstantlyCampaign {
  id: string
  name: string
  status: number
  timestamp_created: string
}

export interface InstantlyLead {
  id: string
  email: string
  first_name?: string
  last_name?: string
  company_name?: string
  campaign_id: string
  status?: string
  timestamp_created?: string
}

export async function listInstantlyCampaigns(): Promise<InstantlyCampaign[]> {
  const data = await instantlyFetch('/campaigns?limit=100&skip=0') as { items?: InstantlyCampaign[] }
  return data.items ?? []
}

export async function getCampaign(campaignId: string): Promise<InstantlyCampaign | null> {
  try {
    return await instantlyFetch(`/campaigns/${campaignId}`) as InstantlyCampaign
  } catch {
    return null
  }
}

export interface AddLeadPayload {
  email: string
  first_name?: string
  last_name?: string
  company_name?: string
  phone?: string
  website?: string
  custom_variables?: Record<string, string>
}

export async function addLeadToCampaign(campaignId: string, lead: AddLeadPayload): Promise<InstantlyLead> {
  return await instantlyFetch(`/leads`, {
    method: 'POST',
    body: JSON.stringify({
      campaign_id: campaignId,
      email: lead.email,
      first_name: lead.first_name ?? '',
      last_name: lead.last_name ?? '',
      company_name: lead.company_name ?? '',
      phone: lead.phone ?? '',
      website: lead.website ?? '',
      custom_variables: lead.custom_variables ?? {},
    }),
  }) as InstantlyLead
}

export async function removeLeadFromCampaign(campaignId: string, email: string): Promise<void> {
  await instantlyFetch(`/leads`, {
    method: 'DELETE',
    body: JSON.stringify({ campaign_id: campaignId, emails: [email] }),
  })
}

export async function getLeadStatus(campaignId: string, email: string): Promise<InstantlyLead | null> {
  try {
    const data = await instantlyFetch(
      `/leads?campaign_id=${encodeURIComponent(campaignId)}&email=${encodeURIComponent(email)}&limit=1`
    ) as { items?: InstantlyLead[] }
    return data.items?.[0] ?? null
  } catch {
    return null
  }
}

export interface InstantlyWebhookEvent {
  event_type: 'email_sent' | 'email_opened' | 'email_clicked' | 'email_replied' | 'email_bounced' | 'unsubscribed'
  timestamp: string
  campaign_id?: string
  lead_email?: string
  lead?: { email?: string; first_name?: string; last_name?: string; company_name?: string }
  subject?: string
  body?: string
  open_count?: number
  click_count?: number
}

export function instantlyEventToTouch(event: InstantlyWebhookEvent): {
  channel: string
  direction: string
  notes: string
  outcome_code: string | null
  metadata: Record<string, unknown>
} {
  const email = event.lead_email ?? event.lead?.email ?? ''
  const subject = event.subject ?? ''

  switch (event.event_type) {
    case 'email_sent':
      return { channel: 'email', direction: 'outbound', notes: `Auto-email sent (Instantly): "${subject}"`, outcome_code: null, metadata: { source: 'instantly', event_type: 'email_sent', campaign_id: event.campaign_id } }
    case 'email_opened':
      return { channel: 'email', direction: 'inbound', notes: `Email opened${event.open_count ? ` ×${event.open_count}` : ''}${subject ? ` — "${subject}"` : ''}`, outcome_code: 'email_opened', metadata: { source: 'instantly', event_type: 'email_opened', open_count: event.open_count } }
    case 'email_clicked':
      return { channel: 'email', direction: 'inbound', notes: `Email link clicked${subject ? ` — "${subject}"` : ''}`, outcome_code: 'email_clicked', metadata: { source: 'instantly', event_type: 'email_clicked' } }
    case 'email_replied':
      return { channel: 'email', direction: 'inbound', notes: `Replied via Instantly${subject ? ` — "${subject}"` : ''}${event.body ? `\n\n${event.body.slice(0, 500)}` : ''}`, outcome_code: 'replied_positive', metadata: { source: 'instantly', event_type: 'email_replied', email } }
    case 'email_bounced':
      return { channel: 'email', direction: 'outbound', notes: `Email bounced — ${email}`, outcome_code: 'email_bounced', metadata: { source: 'instantly', event_type: 'email_bounced' } }
    case 'unsubscribed':
      return { channel: 'email', direction: 'inbound', notes: `Unsubscribed from Instantly sequence`, outcome_code: 'replied_negative', metadata: { source: 'instantly', event_type: 'unsubscribed' } }
    default:
      return { channel: 'email', direction: 'inbound', notes: `Instantly event: ${String(event.event_type)}`, outcome_code: null, metadata: { source: 'instantly', event_type: event.event_type } }
  }
}
