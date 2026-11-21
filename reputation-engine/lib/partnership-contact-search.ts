interface SearchablePartner {
  name?: string | null
  company?: string | null
  email?: string | null
  phone?: string | null
  city?: string | null
}

/** Contact search deliberately excludes message bodies and internal notes. */
export function matchesPartnershipContactSearch(contact: SearchablePartner, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if ([contact.name, contact.company, contact.email, contact.phone, contact.city]
    .some(value => value?.toLowerCase().includes(q))) return true
  const digits = q.replace(/\D/g, '')
  return digits.length > 0 && /^[+\d\s().-]+$/.test(q)
    && (contact.phone || '').replace(/\D/g, '').includes(digits)
}
