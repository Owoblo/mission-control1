// Store identifiers only. Never store card fields or customer form contents.
export function paymentOperationId(scope: string) {
  const key = `crm:payment-command:${scope}`
  const previous = sessionStorage.getItem(key)
  if (previous) return previous
  const id = crypto.randomUUID()
  sessionStorage.setItem(key, id)
  return id
}
