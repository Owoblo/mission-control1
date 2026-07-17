import { createHash } from 'crypto'

export type QuoteSendJobChannel = 'email' | 'sms'
export type QuoteSendJobStatus = 'pending' | 'running' | 'sent' | 'failed' | 'cancelled'
export type QuoteSendJobActor = 'human' | 'automation'

export type QuoteSendJobInput = {
  quoteId: string
  leadId?: string | null
  channel: QuoteSendJobChannel
  recipient: string
  subject?: string | null
  body: string
  htmlBody?: string | null
  notes?: string | null
  followUpDate?: string | null
}

export type QuoteSendJob = QuoteSendJobInput & {
  id: string
  status: QuoteSendJobStatus
  actor: QuoteSendJobActor
  actorUserId?: string | null
  actorName?: string | null
  dedupeKey: string
  attempts: number
  maxAttempts: number
  dueAt: string
  lockedAt?: string | null
  sentAt?: string | null
  completedAt?: string | null
  lastError?: string | null
  result: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function normalizeText(value?: string | null) {
  return (value || '').trim()
}

export function normalizeQuoteSendRecipient(channel: QuoteSendJobChannel, value: string) {
  const trimmed = normalizeText(value)
  if (channel === 'email') return trimmed.toLowerCase()
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return trimmed
}

export function buildQuoteSendDedupeKey(input: QuoteSendJobInput) {
  const contentHash = createHash('sha256')
    .update([
      input.quoteId,
      input.leadId || '',
      input.channel,
      normalizeQuoteSendRecipient(input.channel, input.recipient),
      normalizeText(input.subject),
      normalizeText(input.body),
      normalizeText(input.htmlBody),
    ].join('\n'))
    .digest('hex')
    .slice(0, 32)

  return `quote-send:${input.quoteId}:${input.channel}:${contentHash}`
}
