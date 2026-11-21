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
  // Greeting addressees and the person speaking are not customer identities.
  // Prefer an explicit naming statement; conflicting explicit names stay unconfirmed.
  const namePattern = "([A-Z][a-z]+(?:[ '-][A-Z][a-z]+){0,2})"
  const explicit = [...combined.matchAll(new RegExp("\\b(?:[Hh]is|[Hh]er|[Tt]heir|[Cc]ustomer['’]s|[Cc]lient['’]s) name is\\s+" + namePattern, 'g'))].map(match => match[1].replace(/[.,].*$/, '').trim())
  const relationship = combined.match(new RegExp("\\b(?:my|our) (?:grandson|granddaughter|son|daughter|client|customer)\\s+" + namePattern))?.[1]
  const candidates = explicit.length ? explicit : relationship ? [relationship] : []
  const unique = [...new Set(candidates.map(name => name.trim()))]
  const customerName = unique.length === 1 ? unique[0] : undefined
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
