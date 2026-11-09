import { readEnv } from '@/lib/server/runtime'
import { emailSmsSecretsEqual, extractSmsReply, parseReplyAddress, replyTokenHash, validateReplyEnvelope } from '@/lib/server/email-sms-reply-policy'
import { emailSmsOperator, replyDb } from '@/lib/server/email-sms-reply-store'
import { sendPartnershipSmsReply } from '@/lib/server/partnership-sms-reply'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'

/** Dedicated trusted mail ingress ONLY. Not a public From-header-to-SMS webhook. */
export async function POST(request: Request) {
  if (readEnv('EMAIL_SMS_REPLY_ENABLED') !== 'true') return Response.json({ error: 'Email SMS replies disabled' }, { status: 503 })
  const secret = readEnv('EMAIL_SMS_INGRESS_SECRET')
  if (!secret || !emailSmsSecretsEqual(request.headers.get('x-email-sms-secret') || '', secret)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const raw = await request.text()
  if (raw.length > 60000) return Response.json({ error: 'Email too large' }, { status: 413 })
  let row: Record<string, any> | undefined
  let claimed = false
  try {
    const input = JSON.parse(raw)
    // authenticationPassed/authenticatedSender must be asserted by the trusted ingress
    // after cryptographic mail authentication, NEVER copied from sender-supplied headers.
    const token = parseReplyAddress(String(input.to || ''), readEnv('EMAIL_SMS_REPLY_DOMAIN'))
    if (!token) throw Error('Invalid reply address')
    ;[row] = await replyDb('partnership_email_sms_replies', { token_hash: 'eq.' + replyTokenHash(token), select: '*' })
    if (!row) throw Error('Unknown reply address')
    if (typeof input.messageId !== 'string' || !input.messageId || input.messageId.length > 500) throw Error('Missing stable email message ID')
    validateReplyEnvelope({ from: String(input.from || ''), authenticatedSender: String(input.authenticatedSender || ''), to: input.to,
      tokenRecipient: row.operator_email, domain: readEnv('EMAIL_SMS_REPLY_DOMAIN'), authenticationPassed: input.authenticationPassed === true,
      expiresAt: row.expires_at, status: row.status })
    const actor = emailSmsOperator(row.operator_email)
    if (!actor) throw Error('Operator access revoked')
    const [latestInbound] = await replyDb('market_touches', { contact_id: 'eq.' + row.contact_id, channel: 'eq.sms', direction: 'eq.inbound', order: 'created_at.desc', limit: '1', select: 'id,notes' })
    if (latestInbound?.id !== row.source_touch_id) throw Error('A newer SMS has arrived; reply to its notification or use CRM')
    if (/^Inbound SMS:\s*(stop|unsubscribe|cancel|end|quit|stopall)\s*$/i.test(latestInbound.notes || '')) throw Error('Contact opted out')
    const body = extractSmsReply(input.text, String(input.autoSubmitted || ''), Number(input.attachments || 0))
    const [contact] = await replyDb('market_contacts', { id: 'eq.' + row.contact_id, select: 'phone,do_not_contact,cross_channel_suppressed_at' })
    if (contact?.do_not_contact || contact?.cross_channel_suppressed_at) throw Error('Contact is suppressed; review in CRM')
    if (String(contact?.phone || '').replace(/\D/g, '') !== row.to_number.replace(/\D/g, '')) throw Error('Contact phone changed; review in CRM')
    const intervening = await replyDb('market_touches', { contact_id: 'eq.' + row.contact_id, direction: 'eq.outbound', channel: 'in.(sms,email)', created_at: 'gt.' + row.created_at, select: 'id', limit: '1' })
    if (intervening.length) throw Error('Conversation already answered since this notification; review in CRM')
    const claim = await replyDb('partnership_email_sms_replies', { token_hash: 'eq.' + row.token_hash, status: 'eq.pending' }, 'PATCH', { status: 'processing', inbound_message_id: input.messageId })
    if (!claim.length) throw Error('Reply already claimed')
    claimed = true
    const response = await sendPartnershipSmsReply(actor, row.contact_id, { body, from_number: row.from_number, media_urls: [] })
    const result = await response.json()
    await replyDb('partnership_email_sms_replies', { token_hash: 'eq.' + row.token_hash }, 'PATCH', { status: response.ok && result.sid ? 'accepted' : 'review_required', result: { ...result, operatorEmail: row.operator_email, inboundEmailId: input.messageId } })
    if (!response.ok || !result.sid) throw Error('SMS was not confirmed; inspect the CRM before retrying')
    await sendRepAlertEmail('Your email reply was accepted for SMS delivery', '<p>Your SMS reply was accepted by Twilio and logged in CRM. Carrier delivery is not yet confirmed.</p>', [row.operator_email])
    return Response.json({ ok: true, sid: result.sid })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reply needs review'
    if (row && claimed) {
      await replyDb('partnership_email_sms_replies', { token_hash: 'eq.' + row.token_hash, status: 'eq.processing' }, 'PATCH', { status: 'review_required', result: { error: message } }).catch(() => {})
    }
    // Only the stored operator receives errors, never an arbitrary supplied address.
    if (row) await sendRepAlertEmail('SMS email reply needs review', '<p>Your email reply could not be confirmed as sent. Open the CRM conversation to inspect its status before retrying. Do not assume the SMS was delivered.</p>', [row.operator_email])
    return Response.json({ error: message }, { status: 409 })
  }
}
