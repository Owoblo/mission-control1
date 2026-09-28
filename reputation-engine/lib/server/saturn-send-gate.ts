export type SendGateResult =
  | { allowed: true }
  | { allowed: false; reason: 'empty_message' | 'unresolved_template_variable' | 'invalid_recipient' | 'invalid_sender' }

const TEMPLATE_TOKEN = /\{\{?\s*(first(?:Name|_name)?|name|company|brokerage|city|zone|industry|title|position|rep(?:Name|_name)?)\s*\}?\}/i

export function hasUnresolvedTemplateVariable(value: string | null | undefined) {
  return TEMPLATE_TOKEN.test(String(value || ''))
}

export function validateOutboundMessage(input: {
  body?: string | null
  to?: string | null
  from?: string | null
  mediaUrls?: readonly string[]
}): SendGateResult {
  const body = String(input.body || '').trim()
  const hasMedia = input.mediaUrls?.some(url => typeof url === 'string' && url.trim().length > 0)
  if (!body && !hasMedia) return { allowed: false, reason: 'empty_message' }
  if (hasUnresolvedTemplateVariable(body)) return { allowed: false, reason: 'unresolved_template_variable' }
  if (!/^\+1\d{10}$/.test(String(input.to || '').trim())) return { allowed: false, reason: 'invalid_recipient' }
  if (!/^\+1\d{10}$/.test(String(input.from || '').trim())) return { allowed: false, reason: 'invalid_sender' }
  return { allowed: true }
}
