export type PartnershipReferralDetails = {
  customerName?: string
  customerPhone?: string
  phoneOwnershipNote?: string
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return undefined
}

/** Extract only explicit referral details; do not assume the partner's number is the customer's. */
export function extractPartnershipReferralDetails(notes: string[], partnerPhone?: string | null): PartnershipReferralDetails {
  const combined = notes.join('\n')
  const customerName = combined.match(/\b([A-Z][a-z]+)\s+(?:my\s+)?grandson\b/i)?.[1]
    || combined.match(/\b([A-Z][a-z]+)\s+(?:said|says)\s+(?:he|she|they)\s+will\s+confirm\b/i)?.[1]
  const phoneMatches = [...combined.matchAll(/(?:\+?1[\s().-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}/g)]
    .map(match => normalizePhone(match[0]))
    .filter((value): value is string => Boolean(value))
  const partner = partnerPhone ? normalizePhone(partnerPhone) : undefined
  const customerPhone = phoneMatches.find(value => value !== partner)
  const phoneOwnershipNote = customerPhone
    ? /\b(?:said|says)\s+(?:he|she|they)\s+will\s+confirm\b/i.test(combined)
      ? 'Partner says the referred person will confirm; verify whose number this is before calling.'
      : undefined
    : undefined
  return { customerName, customerPhone, phoneOwnershipNote }
}
