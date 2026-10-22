export function partnershipPhoneDigits(value?: string | null) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export function partnershipPhonesMatch(left?: string | null, right?: string | null) {
  const leftDigits = partnershipPhoneDigits(left)
  const rightDigits = partnershipPhoneDigits(right)
  if (!leftDigits || !rightDigits) return false
  return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits)
}

export function partnershipPhoneLookupSuffix(value?: string | null) {
  const digits = partnershipPhoneDigits(value)
  return digits.length >= 4 ? digits.slice(-4) : digits
}

export function samePartnershipIdentity(rows: Array<{ name?: string | null; company?: string | null }>) {
  if (!rows.length || rows.some(row => !String(row.company || row.name || "").trim())) return false
  const identities = new Set(rows.map((row) => `${String(row.company || '').trim().toLowerCase()}|${String(row.name || '').trim().toLowerCase()}`))
  return identities.size === 1
}
