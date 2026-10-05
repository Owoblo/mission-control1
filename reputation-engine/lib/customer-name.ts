/** Phone-only intake records are identifiers, not customer names. */
export function knownCustomerName(value?: string | null): string | undefined {
  const name = (value || '').trim()
  if (!name || !/\p{L}/u.test(name) || /^[^@\s]+@[^@\s]+$/.test(name) || /^(unknown|new (moving )?lead|caller|customer)$/i.test(name)) return undefined
  return name
}
export function customerFirstName(value?: string | null) {
  return knownCustomerName(value)?.split(/\s+/)[0] || 'there'
}
