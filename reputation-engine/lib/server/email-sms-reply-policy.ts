import { createHash, timingSafeEqual } from 'node:crypto'

export function replyTokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function parseReplyAddress(address: string, domain: string) {
  const match = /^sms\+([a-f0-9]{40})@([a-z0-9.-]+)$/i.exec(address.trim())
  return match && match[2].toLowerCase() === domain.toLowerCase() ? match[1].toLowerCase() : null
}

/** Only the top plain-text reply becomes SMS; ambiguous HTML and attachments fail closed. */
export function extractSmsReply(text: string, autoSubmitted = '', attachments = 0) {
  if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') throw Error('Automatic email replies cannot send SMS')
  if (attachments) throw Error('Attachments require review in CRM')
  if (typeof text !== 'string' || text.length > 50000) throw Error('A plain-text reply is required')
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const result: string[] = []
  for (const line of lines) {
    if (/^\s*(>|On .{1,500}wrote:|[-_]{3,}|Begin forwarded message:|From:|Sent:|--\s*$|Sent from my |Get Outlook for |Best regards,?\s*$|Kind regards,?\s*$|Regards,?\s*$)/i.test(line)) break
    result.push(line)
  }
  const body = result.join('\n').trim()
  if (!body || body.length > 1200) throw Error('Reply must contain 1–1200 characters above the quoted email')
  if (/Partner inbound SMS|Open Partner Thread|Received \(Eastern Time\)/i.test(body)) throw Error('Quoted notification detected; reply in CRM')
  return body
}

export function validateReplyEnvelope(input: {
  from: string; authenticatedSender: string; to: string; tokenRecipient: string;
  domain: string; authenticationPassed: boolean; expiresAt: string; status: string;
}, now = Date.now()) {
  const email = input.from.trim().toLowerCase()
  if (!input.authenticationPassed || email !== input.authenticatedSender.toLowerCase() || email !== input.tokenRecipient.toLowerCase()) throw Error('Sender authentication failed')
  if (!parseReplyAddress(input.to, input.domain)) throw Error('Invalid reply address')
  if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now) throw Error('Reply address expired; use the latest notification or CRM')
  if (input.status !== 'pending') throw Error('Reply already processed or awaiting review')
}

export function emailSmsSecretsEqual(actual: string, expected: string) {
  if (!actual || !expected) return false
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
