export function cityFromFormattedAddress(address?: string | null) {
  const parts = String(address || '').split(',').map(part => part.trim()).filter(Boolean)
  if (parts.length < 2) return undefined
  const candidate = parts[1]
  if (/^(?:ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|NT|NU|YT)(?:\s|$)/i.test(candidate)) return undefined
  if (/^(?:Canada|United States|USA)$/i.test(candidate)) return undefined
  return candidate
}

export function selectedAddressCity(address: string, suggestedCity?: string | null) {
  return suggestedCity?.trim() || cityFromFormattedAddress(address)
}
