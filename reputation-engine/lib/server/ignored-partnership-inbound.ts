import { createHash } from 'node:crypto'

export function ignoresPartnershipInbound(contact: { tags?: unknown }) {
  return Array.isArray(contact.tags) && contact.tags.includes('automated_sender') && contact.tags.includes('ignore_inbound_review')
}

// An owner-marked automated sender is archived without changing relationship
// state, generating suggestions, sending alerts, or creating handoff tasks.
export async function archiveIgnoredPartnershipInbound(input: {
  url: string; headers: HeadersInit; contactId: string; channel: string;
  occurredAt: string; notes?: string | null; metadata?: Record<string, unknown>
}, request: typeof fetch = fetch) {
  const providerId = input.metadata?.messageSid || input.metadata?.callSid || input.metadata?.call_sid
  const hash = createHash('sha256').update(JSON.stringify(['ignored-partner-inbound', input.contactId, input.channel, providerId || [input.occurredAt, input.notes]])).digest('hex')
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
  const headers = new Headers(input.headers)
  headers.set('Content-Type', 'application/json')
  headers.set('Prefer', 'resolution=ignore-duplicates,return=minimal')
  const response = await request(`${input.url}/rest/v1/market_touches?on_conflict=id`, {
    method: 'POST', headers, body: JSON.stringify({
      id, contact_id: input.contactId, channel: input.channel, direction: 'inbound',
      notes: input.notes || `Ignored automated ${input.channel} message`, created_by: 'System', created_at: input.occurredAt,
      outcome_code: 'automated_reply', next_step: null, next_follow_up_on: null,
      metadata: { ...input.metadata, ignored_automated_sender: true, partnership_review: {
        reviewed_at: new Date().toISOString(), reply_required: false,
        note: 'Owner-designated automated sender: archive without notifications, suggestions or follow-up.'
      } }
    })
  })
  if (!response.ok) throw new Error(`Ignored inbound archive failed (${response.status})`)
  return id
}
