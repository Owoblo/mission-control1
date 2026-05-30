import { defaultFollowUpDate, normalizePartnershipStage } from '@/lib/marketing'
import { digitsOnly, normalizePhone } from '@/lib/sales-phones'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type InboundChannel = 'email' | 'phone' | 'sms'

interface PausePartnershipSequenceInput {
  channel: InboundChannel
  email?: string | null
  phone?: string | null
  occurredAt?: string
  notes?: string | null
  metadata?: Record<string, unknown>
}

interface MarketContactMatch {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  stage: string | null
  decision: string | null
  sequence_paused: boolean
  pipeline_phase: string | null
}

function normalizeEmail(value?: string | null) {
  return (value || '').trim().toLowerCase()
}

function phoneMatches(left?: string | null, right?: string | null) {
  const leftDigits = digitsOnly(normalizePhone(left))
  const rightDigits = digitsOnly(normalizePhone(right))
  if (!leftDigits || !rightDigits) return false
  return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits)
}

async function findPartnershipContactMatch(input: PausePartnershipSequenceInput) {
  const normalizedEmail = normalizeEmail(input.email)
  const normalizedPhone = normalizePhone(input.phone)
  if (!normalizedEmail && !normalizedPhone) return null

  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/market_contacts?select=id,name,email,phone,stage,decision,sequence_paused,pipeline_phase&batch_id=not.is.null&order=created_at.desc&limit=2000`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) return null

  const contacts = (await response.json()) as MarketContactMatch[]
  const matches = contacts.filter(contact => (
    (normalizedEmail && normalizeEmail(contact.email) === normalizedEmail) ||
    (normalizedPhone && phoneMatches(contact.phone, normalizedPhone))
  ))

  if (matches.length === 0) return null

  matches.sort((left, right) => {
    const leftStage = normalizePartnershipStage(left.stage)
    const rightStage = normalizePartnershipStage(right.stage)
    const leftScore =
      (left.decision ? 0 : 4) +
      (left.sequence_paused ? 0 : 2) +
      (leftStage === 'closed_lost' ? 0 : 1)
    const rightScore =
      (right.decision ? 0 : 4) +
      (right.sequence_paused ? 0 : 2) +
      (rightStage === 'closed_lost' ? 0 : 1)

    return rightScore - leftScore
  })

  return matches[0] ?? null
}

export async function pausePartnershipSequenceForInbound(input: PausePartnershipSequenceInput) {
  const contact = await findPartnershipContactMatch(input)
  if (!contact) return { matched: false as const }

  const occurredAt = input.occurredAt || new Date().toISOString()
  const { url, headers } = requireSupabaseEnv()
  const currentStage = normalizePartnershipStage(contact.stage)
  const shouldAdvanceToConnected = ['target', 'mail_sent', 'follow_up_due', 'attempting_contact'].includes(currentStage)
  const nextFollowUp =
    contact.decision === 'indifferent'
      ? defaultFollowUpDate(occurredAt, 30)
      : contact.decision
        ? null
        : undefined

  await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        sequence_paused: true,
        sequence_paused_reason: `${input.channel}_reply`,
        pipeline_phase: contact.decision ? contact.pipeline_phase : 'engaged',
        stage: shouldAdvanceToConnected ? 'connected' : contact.stage,
        last_inbound_at: occurredAt,
        last_touch_at: occurredAt,
        next_follow_up: nextFollowUp,
      }),
    }),
    fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${contact.id}&status=eq.pending`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        status: 'cancelled',
        error: `Paused after inbound ${input.channel}`,
      }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: contact.id,
        channel: input.channel,
        direction: 'inbound',
        notes: input.notes?.trim() || `Inbound ${input.channel} reply received`,
        created_by: 'System',
        created_at: occurredAt,
        metadata: input.metadata ?? {},
      }),
    }),
  ])

  return {
    matched: true as const,
    contactId: contact.id,
    contactName: contact.name,
  }
}
