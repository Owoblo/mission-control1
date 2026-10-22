import { isSmsProviderReceipt } from '@/lib/telephony-providers'
import { createHash } from 'node:crypto'

type Input = {
  url: string; headers: HeadersInit; jobId: string; contactId: string; touchId: string
  existingMetadata?: Record<string, unknown>; fromNumber: string; toNumber: string
  body: string; mediaUrls: string[]; now: string; provider: { sid?: string; status?: string }
}

/** Persist the provider receipt first; a partial CRM failure must never trigger another send. */
export async function persistScheduledReplyReceipt(input: Input, request: typeof fetch = fetch) {
  const { url, headers, provider, now } = input
  if (!provider.sid || !isSmsProviderReceipt(provider.sid)) throw new Error('Ambiguous Twilio acceptance: missing message SID; inspect reservation before retry')
  async function write(path: string, method: string, body: unknown, insert = false) {
    const h = new Headers(headers)
    h.set('Content-Type', 'application/json')
    h.set('Prefer', insert ? 'resolution=ignore-duplicates,return=representation' : 'return=representation')
    const response = await request(url + '/rest/v1/' + path, { method, headers: h, body: JSON.stringify(body) })
    if (!response.ok) throw new Error(`Scheduled SMS receipt write failed (${response.status}); provider SID ${provider.sid}; do not resend`)
    const rows = await response.json() as unknown[]
    if (!insert && rows.length !== 1) throw new Error(`Scheduled SMS receipt target missing; provider SID ${provider.sid}; do not resend`)
  }
  const old = input.existingMetadata || {}
  const scheduled = old.scheduled_reply && typeof old.scheduled_reply === 'object' ? old.scheduled_reply : {}
  await write('market_touches?id=eq.' + input.touchId, 'PATCH', {
    outcome_code: 'scheduled_reply_sent', next_step: 'Accepted by Twilio; check provider delivery status.',
    metadata: { ...old, twilioSid: provider.sid, provider_status: provider.status || 'accepted',
      scheduled_reply: { ...scheduled, status: 'accepted', twilioSid: provider.sid, accepted_at: now } },
  })
  const hash = createHash('sha256').update('scheduled-receipt:' + input.jobId).digest('hex')
  const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
  await write('market_touches', 'POST', {
    id, contact_id: input.contactId, channel: 'sms', direction: 'outbound',
    notes: input.body + (input.mediaUrls.length ? `\n[MMS: ${input.mediaUrls.join(', ')}]` : ''),
    created_by: 'Scheduled Reply', created_at: now,
    metadata: { scheduled_reply: true, from: input.fromNumber, to: input.toNumber,
      scheduled_touch_id: input.touchId, mediaUrls: input.mediaUrls, twilioSid: provider.sid,
      provider_status: provider.status || 'accepted', delivery_state: 'accepted' },
  }, true)
  await write('market_contacts?id=eq.' + input.contactId, 'PATCH', { last_touch_at: now })
  // Preserve existing follow-up promises instead of replacing them with an arbitrary three days.
  await write('sequence_jobs?id=eq.' + input.jobId, 'PATCH', { status: 'sent', sent_at: now, error: null })
}
