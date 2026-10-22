import { randomBytes } from 'node:crypto'
import type { SessionPayload } from '@/lib/auth'
import { readEnv, requireSupabaseEnv } from './runtime'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
import { partnershipRecordMatchesSession } from './partnership-access'
import { replyTokenHash } from './email-sms-reply-policy'

export function emailSmsOperator(email: string): SessionPayload | null {
  try {
    const actors = JSON.parse(readEnv('EMAIL_SMS_REPLY_OPERATORS') || '{}')
    const actor = actors[email.toLowerCase()]
    if (!actor || !['owner', 'manager', 'partnership_manager'].includes(actor.role) || !actor.userId || !actor.name) return null
    return { ...actor, exp: Date.now() + 60000 }
  } catch { return null }
}

export async function replyDb(table: string, query: Record<string, string>, method = 'GET', body?: unknown) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, {
    method, headers: { ...headers, Prefer: 'return=representation' }, cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw Error(`Email reply storage failed (${response.status})`)
  return response.json()
}

export async function createSmsReplyAddress(email: string, contactId: string, fromNumber: string, toNumber: string) {
  const domain = readEnv('EMAIL_SMS_REPLY_DOMAIN')
  if (readEnv('EMAIL_SMS_REPLY_ENABLED') !== 'true' || readEnv('EMAIL_SMS_REPLY_NOTIFICATIONS_ENABLED') !== 'true' || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain) || !readEnv('EMAIL_SMS_INGRESS_SECRET')) return null
  const actor = emailSmsOperator(email)
  if (!actor || !isPartnershipSenderNumber(fromNumber) || !/^\+1\d{10}$/.test(toNumber)) return null
  const [contact] = await replyDb('market_contacts', { id: 'eq.' + contactId, select: '*' })
  if (!contact || !partnershipRecordMatchesSession(actor, contact) || contact.do_not_contact || contact.cross_channel_suppressed_at) return null
  const [source] = await replyDb('market_touches', { contact_id: 'eq.' + contactId, channel: 'eq.sms', direction: 'eq.inbound', order: 'created_at.desc', limit: '1', select: 'id,metadata' })
  if (!source?.id || source.metadata?.to !== fromNumber || source.metadata?.from !== toNumber) return null
  const token = randomBytes(20).toString('hex')
  await replyDb('partnership_email_sms_replies', {}, 'POST', {
    token_hash: replyTokenHash(token), source_touch_id: source.id, contact_id: contactId, operator_email: email.toLowerCase(),
    from_number: fromNumber, to_number: toNumber, expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  })
  return `sms+${token}@${domain}`
}
