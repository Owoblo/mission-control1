import { isSaturnBranchPhoneNumber } from './sales-phones'
function normalizePhone(value?: string | null) {
  const input = (value || '').trim()
  let raw = /^sips?:/i.test(input) ? input.replace(/^sips?:/i, '').split('@')[0].split(';')[0] : input
  try { raw = decodeURIComponent(raw) } catch { return '' }
  if (/^sips?:/i.test(input) && !/^\+?\d{10,15}$/.test(raw)) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.startsWith('+') ? `+${digits}` : digits ? `+${digits}` : ''
}

export type TwilioCallMatch = {
  sid: string
  parent_call_sid?: string | null
  from: string
  to: string
  start_time: string
  duration?: string
  status?: string
  direction?: string
}

export type TwilioCallConversation = {
  call: TwilioCallMatch
  callSids: string[]
}

export function twilioPhoneFilters(phone: string) {
  const normalized = normalizePhone(phone)
  if (!normalized) return [] as Array<{ field: 'From' | 'To'; value: string }>

  const values = [
    normalized,
    `sip:${normalized}@sip.telnyx.com`,
    `sip:${normalized}@sip.telnyx.com;transport=tls`,
  ]
  return (['From', 'To'] as const).flatMap(field =>
    values.map(value => ({ field, value }))
  )
}

/** Collapse Twilio's parent/rep/customer legs to one customer-visible call. */
export function groupTwilioCallsByPhone(calls: TwilioCallMatch[], phone: string): TwilioCallConversation[] {
  const normalized = normalizePhone(phone)
  const matched = calls.filter(call => normalizePhone(call.from) === normalized || normalizePhone(call.to) === normalized)
  const groups = new Map<string, TwilioCallMatch[]>()

  for (const call of matched) {
    const root = call.parent_call_sid || call.sid
    const group = groups.get(root) || []
    group.push(call)
    groups.set(root, group)
  }

  return [...groups.values()].map(group => {
    // Inbound SIP calls expose the customer number on both the root and rep legs;
    // the root is the stable recording and timeline identity. Outbound SIP calls
    // expose the customer only on the child leg, so retain that leg.
    const call = group.find(item => !item.parent_call_sid && normalizePhone(item.from) === normalized)
      || group.find(item => normalizePhone(item.to) === normalized)
      || group.find(item => normalizePhone(item.from) === normalized)
      || group[0]
    const root = group[0].parent_call_sid || group[0].sid
    return { call, callSids: [...new Set([root, ...group.map(item => item.sid)])] }
  }).sort((a, b) => Date.parse(b.call.start_time) - Date.parse(a.call.start_time))
}

/** Signed provider callbacks may omit SipDomainSid after a Dial action. */
export function isOutboundTwilioCall(from: string, to: string, direction: string) {
  const source = normalizePhone(from), target = normalizePhone(to)
  if (source && !isSaturnBranchPhoneNumber(source) && isSaturnBranchPhoneNumber(target)) return false
  return direction.startsWith('outbound') || /^client:/i.test(from) || isSaturnBranchPhoneNumber(source) || (/^sips?:/i.test(from) && !!target && !isSaturnBranchPhoneNumber(target))
}
