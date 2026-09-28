import { getSaturnTrackingLabel, getSaturnTrackingSource } from '../sales-phones'
import { createHash } from 'node:crypto'
import { classifyInteraction } from '../interaction-classification'
import { requireSupabaseEnv } from './runtime'

export interface InteractionInput {
  source: string
  channel: 'call' | 'sms' | 'email' | 'voicemail' | 'web_form'
  eventId?: string
  sender?: string
  recipient?: string
  occurredAt?: string
  timezone?: string
  body?: string
  raw: unknown
  provenance?: Record<string, unknown>
  leadId?: string
}

export async function interactionRpc(name: string, body: Record<string, unknown>) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Interaction ${name} failed (${response.status})`)
  return response.json()
}

export async function storeInteraction(input: InteractionInput): Promise<string> {
  const id = createHash('sha256').update(`${input.source}:${input.eventId || JSON.stringify(input.raw)}`).digest('hex')
  await interactionRpc('capture_crm_interaction', {
    p_id: id,
    p_event: { ...input, occurredAt: input.occurredAt || new Date().toISOString(), timezone: input.timezone || null,
      provenance: {
        source: input.source, channel: input.channel,
        campaign: null, batch: null, referrer: null, referralPartner: null,
        searchSource: null, listingSource: null, directMailSource: null,
        city: null, serviceMarket: null, origin: null, destination: null,
        localTimeOfDay: null, localDayOfWeek: null, responseDelaySeconds: null,
        messageVersion: null, staffOrAutomationActor: null,
        ...input.provenance,
      },
    },
    p_classification: classifyInteraction(input.body),
  })
  return id
}

export async function captureTwilioInteraction(raw: string, source: string, channel: InteractionInput['channel']) {
  const form = new URLSearchParams(raw)
  const providerId = form.get('MessageSid') || form.get('SmsSid') || form.get('CallSid')
  return storeInteraction({ source, channel,
    eventId: providerId ? [providerId, form.get('RecordingSid'), form.get('TranscriptionSid'), form.get('RecordingStatus'), form.get('CallStatus')].filter(Boolean).join(':') : undefined,
    sender: form.get('From') || undefined, recipient: form.get('To') || undefined,
    body: form.get('Body') || form.get('TranscriptionText') || undefined,
    raw, provenance: { ...Object.fromEntries(form), source: getSaturnTrackingSource(form.get('To') || '') || source, trackingLabel: getSaturnTrackingLabel(form.get('To') || '') || null },
  })
}
