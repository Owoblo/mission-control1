import { Resolver } from 'node:dns/promises'
import { randomUUID } from 'node:crypto'
import { assessEmailInfrastructure, normalizeWarmupAccount, type SenderEvidence, type DnsEvidence, type WarmupEvidence } from '../email-infrastructure'
import { readEnv, requireSupabaseEnv } from './runtime'
import { readScaledMailInventory } from './scaledmail-inventory'

async function domainDns(domain: string): Promise<DnsEvidence> {
  const evidence: DnsEvidence = { domain, mx: [], spf: [], dmarc: [], errors: [] }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    evidence.errors.push('Invalid domain'); return evidence
  }
  const resolver = new Resolver({ timeout: 3000, tries: 1 })
  const results = await Promise.allSettled([resolver.resolveMx(domain), resolver.resolveTxt(domain), resolver.resolveTxt(`_dmarc.${domain}`)])
  const [mx, txt, dmarc] = results
  if (mx.status === 'fulfilled') evidence.mx = mx.value.map(r => `${r.priority} ${r.exchange}`)
  if (txt.status === 'fulfilled') evidence.spf = txt.value.map(r => r.join('')).filter(r => /^v=spf1(?:\s|$)/i.test(r))
  if (dmarc.status === 'fulfilled') evidence.dmarc = dmarc.value.map(r => r.join('')).filter(r => /^v=DMARC1(?:;|\s|$)/i.test(r))
  results.forEach((r, i) => { if (r.status === 'rejected') evidence.errors.push(`${['MX', 'SPF', 'DMARC'][i]} lookup failed or has no record`) })
  return evidence
}

export async function getEmailInfrastructure() {
  const { url, headers } = requireSupabaseEnv()
  const read = async (table: string, select: string) => {
    const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams({ select, limit: '201' })}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('CRM inventory unavailable')
    const rows = await response.json()
    if (!Array.isArray(rows)) throw new Error('Invalid CRM inventory')
    return rows
  }
  const [senderRows, domainRows] = await Promise.all([
    read('email_sender_accounts', 'from_email,domain,provider,status,daily_cap,pause_reason'),
    read('crm_email_domains', 'domain,status,pause_reason'),
  ])
  const senders = senderRows.slice(0, 200) as SenderEvidence[]
  const warnings: string[] = []
  const scaledmail = await readScaledMailInventory(readEnv('SCALEDMAIL_API_KEY'), readEnv('SCALEDMAIL_ORGANIZATION_ID')).catch(() => ({ status: 'Unavailable', domains: [], complete: false }))
  if (scaledmail.status === 'Unavailable') warnings.push('ScaledMail inventory could not be read; provisioning is unverified.')
  if (scaledmail.status === 'Connected' && !scaledmail.complete) warnings.push('ScaledMail inventory coverage is incomplete.')
  if (senderRows.length > 200 || domainRows.length > 200) warnings.push('Inventory exceeds this view’s 200-record bound; coverage is incomplete.')
  const domains = [...new Set([...senders.map(s => s.domain), ...domainRows.slice(0, 200).map(d => String(d.domain)), ...scaledmail.domains.map(d => d.domain)])]
  const dns: DnsEvidence[] = []
  for (let i = 0; i < domains.length; i += 10) dns.push(...await Promise.all(domains.slice(i, i + 10).map(domainDns)))
  let warmup: WarmupEvidence[] = []
  let warmupStatus = 'Not connected in this environment'
  const key = readEnv('MAILIVERY_API_KEY')
  if (key) {
    try {
      // Never return the provider response: it may contain mailbox credentials.
      const response = await fetch('https://app.mailivery.io/api/v1/campaigns?per_page=100&include_connection_details=true', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'X-Request-ID': randomUUID() }, cache: 'no-store', signal: AbortSignal.timeout(10000), redirect: 'error',
      })
      if (!response.ok) throw new Error('Provider read failed')
      const payload = await response.json()
      const data = payload.data ?? payload
      const rows = Array.isArray(data) ? data : data.data
      if (!Array.isArray(rows)) throw new Error('Invalid provider response')
      warmup = rows.map(normalizeWarmupAccount)
      warmupStatus = 'Connected; first 100 accounts'
      if (rows.length >= 100) warnings.push('Warmup account coverage may be incomplete; this view reads the first 100 accounts.')
    } catch { warmupStatus = 'Unavailable'; warnings.push('Warmup provider could not be read. Missing data is not healthy status.') }
  }
  return {
    checkedAt: new Date().toISOString(), campaignAuthorized: false, warnings, warmupStatus, scaledmail,
    monitoring: 'Refresh on demand. This view does not schedule monitoring or enforce sending pauses.',
    senders: senders.map(sender => {
      const domain = domainRows.find(d => d.domain === sender.domain)
      const connection = warmup.find(w => w.email === sender.from_email.toLowerCase())
      const assessment = assessEmailInfrastructure(sender, dns.find(d => d.domain === sender.domain), connection)
      if (!domain) { assessment.state = 'hold'; assessment.holds.push('Domain control record is missing.') }
      else if (domain.status !== 'active' || domain.pause_reason) {
        assessment.state = 'hold'; assessment.holds.push(`Domain is ${domain.status}${domain.pause_reason ? `: ${domain.pause_reason}` : ''}`)
      }
      return { ...sender, warmup: connection ?? null, ...assessment }
    }),
    domains: dns.map(d => ({ ...d, control: domainRows.find(row => row.domain === d.domain) ?? null })),
    prerequisites: [
      'Confirm ScaledMail order and provision new Google mailboxes.',
      'Confirm managed Google mailbox API access for the internal CRM sending and reply adapter.',
      'Verify DKIM signatures and SPF/DMARC alignment on real received headers.',
      'Collect untouched seed placement through the actual Google sending path.',
      'Test reply import, cross-channel opt-out propagation and sequencer stop-on-reply.',
      'Test duplicate prevention, ambiguous send reconciliation and emergency pauses.',
    ],
  }
}
