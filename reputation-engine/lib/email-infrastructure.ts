export type DnsEvidence = { domain: string; mx: string[]; spf: string[]; dmarc: string[]; errors: string[] }
export type SenderEvidence = { from_email: string; domain: string; provider: string; status: string; daily_cap: number; pause_reason: string | null }
export type WarmupEvidence = { email: string; status: string; smtpHost: string | null; imapHost: string | null; sentToday: number | null; spamRate14Days: number | null }

// Observational only. Passing DNS checks must never authorize campaign dispatch.
export function assessEmailInfrastructure(sender: SenderEvidence, dns?: DnsEvidence, warmup?: WarmupEvidence) {
  const holds: string[] = []
  const unknowns = ['Independent placement on the campaign sending path has not been verified here.', 'End-to-end reply, opt-out and sequencer stop tests are not recorded here.']
  if (sender.status !== 'active') holds.push(`CRM sender is ${sender.status}.`)
  if (sender.pause_reason) holds.push(sender.pause_reason)
  if (!dns || dns.errors.length) unknowns.push('DNS evidence is unavailable or incomplete.')
  if (dns) {
    if (!dns.mx.length) holds.push('No receiving MX record observed.')
    if (dns.spf.length !== 1) holds.push('Exactly one SPF record is required.')
    if (dns.dmarc.length !== 1) holds.push('Exactly one DMARC record is required.')
  }
  if (!warmup) unknowns.push('No matching warmup connection observed.')
  else {
    if (warmup.status !== 'active') holds.push(`Warmup connection is ${warmup.status}.`)
    if (warmup.spamRate14Days !== null && warmup.spamRate14Days > 0) holds.push('Warmup network reports Spam placements; review before ramping.')
    if (warmup.sentToday === null || warmup.sentToday === 0) unknowns.push('No completed sending activity confirmed today by the warmup counter.')
    if (sender.provider === 'ses' && !/^email-smtp\.[a-z0-9-]+\.amazonaws\.com$/.test(warmup.smtpHost || '')) holds.push('Warmup SMTP path is not confirmed as SES.')
    if (sender.provider !== 'ses') unknowns.push('Match the warmup transport to the campaign provider before interpreting results.')
  }
  return { state: holds.length ? 'hold' as const : 'review' as const, holds, unknowns, campaignAuthorized: false as const }
}

export function normalizeWarmupAccount(row: Record<string, any>): WarmupEvidence {
  const number = (value: unknown, max = Infinity) => {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null
  }
  return {
    email: String(row.email || '').toLowerCase(), status: String(row.status_code || 'unknown'),
    smtpHost: typeof row.smtp?.host === 'string' ? row.smtp.host : null,
    imapHost: typeof row.imap?.host === 'string' ? row.imap.host : null,
    sentToday: number(row.emails_sent_today), spamRate14Days: number(row.spam_rate_in_last_14_days, 100),
  }
}
