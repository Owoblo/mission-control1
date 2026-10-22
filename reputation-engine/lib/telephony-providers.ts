export const GTA_SALES_NUMBER = '+14377823004'
export const GTA_PARTNERSHIP_NUMBER = '+14374650584'

export function isTelnyxNumber(number: string) {
  const digits = number.replace(/\D/g, '')
  return [GTA_SALES_NUMBER, GTA_PARTNERSHIP_NUMBER].some(line => line.slice(1) === (digits.length === 10 ? `1${digits}` : digits))
}

// Preserve the existing CRM receipt column while preventing cross-provider ID collisions.
export function isSmsProviderReceipt(id: unknown): id is string {
  return typeof id === 'string' && (/^(SM|MM)[a-f0-9]{32}$/i.test(id) || /^telnyx:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))
}
