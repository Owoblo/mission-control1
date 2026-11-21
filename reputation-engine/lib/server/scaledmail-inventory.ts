export type ScaledMailDomain = { domain: string; provider: string; status: string; mailboxCount: number | null; emails: string[] }

/** Inventory only: no purchasing, credentials export, configuration or sends. */
export async function readScaledMailInventory(key: string, organizationId: string, request: typeof fetch = fetch) {
  if (!key || !organizationId) return { status: 'Not connected', domains: [] as ScaledMailDomain[], complete: false }
  const url = new URL('https://server.scaledmail.com/api/v1/domains')
  url.searchParams.set('organization_id', organizationId)
  url.searchParams.set('password', 'false')
  const response = await request(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('ScaledMail inventory unavailable')
  const payload = await response.json()
  if (!Array.isArray(payload.domains)) throw new Error('Unexpected ScaledMail inventory response')
  const domains: ScaledMailDomain[] = payload.domains.slice(0, 200).map((row: Record<string, any>) => {
    const domain = String(row.domain || '').toLowerCase()
    return {
      domain, provider: String(row.order_type || 'unknown'), status: String(row.status || 'unknown'),
      mailboxCount: Number.isInteger(row.total_mailboxes) && row.total_mailboxes >= 0 ? row.total_mailboxes : null,
      emails: Array.isArray(row.mailbox) ? row.mailbox.filter((m: any) => typeof m.alias === 'string' && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(m.alias)).map((m: any) => `${m.alias}@${domain}`) : [],
    }
  })
  return { status: 'Connected', domains, complete: payload.domains.length <= 200 && Number.isInteger(payload.total) && payload.total === payload.domains.length }
}
