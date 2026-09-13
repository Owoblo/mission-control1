import { promises as dns } from 'node:dns'
import { readEnv } from '@/lib/server/runtime'

export type EmailVerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown'

export interface EmailVerificationResult {
  email: string
  normalizedEmail: string
  status: EmailVerificationStatus
  reason: string
  provider: 'local' | 'zerobounce'
  raw?: unknown
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLE_ACCOUNTS = new Set([
  'admin', 'administrator', 'billing', 'bookings', 'careers', 'contact', 'customerservice',
  'hello', 'help', 'hr', 'info', 'inquiries', 'mail', 'marketing', 'media', 'no-reply',
  'noreply', 'office', 'orders', 'reception', 'sales', 'service', 'support', 'team',
])
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', 'guerrillamail.com', 'mailinator.com', 'tempmail.com', 'yopmail.com',
  'throwawaymail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com',
])

export function normalizeEmailAddress(email: string) {
  return email.trim().toLowerCase()
}

function splitEmail(email: string) {
  const normalizedEmail = normalizeEmailAddress(email)
  const [localPart = '', domain = ''] = normalizedEmail.split('@')
  return { normalizedEmail, localPart, domain }
}

function localRiskCheck(email: string): EmailVerificationResult | null {
  const { normalizedEmail, localPart, domain } = splitEmail(email)
  if (!EMAIL_RE.test(normalizedEmail)) {
    return { email, normalizedEmail, status: 'invalid', reason: 'bad_syntax', provider: 'local' }
  }
  if (!domain || domain.includes('..')) {
    return { email, normalizedEmail, status: 'invalid', reason: 'bad_domain', provider: 'local' }
  }
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email, normalizedEmail, status: 'invalid', reason: 'disposable_domain', provider: 'local' }
  }
  if (ROLE_ACCOUNTS.has(localPart.replace(/[._-].*$/, ''))) {
    return { email, normalizedEmail, status: 'risky', reason: 'role_based_address', provider: 'local' }
  }
  return null
}

function mapZeroBounceStatus(email: string, raw: Record<string, unknown>): EmailVerificationResult {
  const normalizedEmail = normalizeEmailAddress(email)
  const status = String(raw.status || '').toLowerCase()
  const subStatus = String(raw.sub_status || '').toLowerCase()
  const reason = subStatus || status || 'unknown'

  if (status === 'valid') {
    return { email, normalizedEmail, status: 'valid', reason: 'valid', provider: 'zerobounce', raw }
  }
  if (status === 'invalid' || status === 'do_not_mail' || status === 'spamtrap' || status === 'abuse') {
    return { email, normalizedEmail, status: 'invalid', reason, provider: 'zerobounce', raw }
  }
  if (status === 'catch-all' || status === 'unknown') {
    return { email, normalizedEmail, status: 'risky', reason, provider: 'zerobounce', raw }
  }
  return { email, normalizedEmail, status: 'unknown', reason, provider: 'zerobounce', raw }
}

async function verifyWithZeroBounce(email: string): Promise<EmailVerificationResult | null> {
  const apiKey = readEnv('ZEROBOUNCE_API_KEY')
  if (!apiKey) return null

  const endpoint = new URL('https://api.zerobounce.net/v2/validate')
  endpoint.searchParams.set('api_key', apiKey)
  endpoint.searchParams.set('email', normalizeEmailAddress(email))

  const response = await fetch(endpoint, { cache: 'no-store' })
  if (!response.ok) {
    return { email, normalizedEmail: normalizeEmailAddress(email), status: 'unknown', reason: `zerobounce_${response.status}`, provider: 'zerobounce' }
  }
  const raw = await response.json() as Record<string, unknown>
  return mapZeroBounceStatus(email, raw)
}

async function verifyLocally(email: string): Promise<EmailVerificationResult> {
  const risk = localRiskCheck(email)
  if (risk?.status === 'invalid') return risk

  const { normalizedEmail, domain } = splitEmail(email)
  try {
    const records = await dns.resolveMx(domain)
    if (!records.length) {
      return { email, normalizedEmail, status: 'invalid', reason: 'no_mx_records', provider: 'local' }
    }
  } catch {
    return { email, normalizedEmail, status: 'invalid', reason: 'mx_lookup_failed', provider: 'local' }
  }

  if (risk?.status === 'risky') return risk
  return { email, normalizedEmail, status: 'valid', reason: 'syntax_and_mx_passed', provider: 'local' }
}

export async function verifyEmailAddress(email: string): Promise<EmailVerificationResult> {
  const local = await verifyLocally(email)
  if (local.status === 'invalid') return local

  const external = await verifyWithZeroBounce(email).catch(() => null)
  if (external) return external
  return local
}

export function emailVerificationAllowsSend(result: EmailVerificationResult) {
  if (result.status === 'valid') return true
  if (result.status === 'risky') {
    return ['true', '1', 'yes'].includes(readEnv('PARTNERSHIP_EMAIL_ALLOW_RISKY').toLowerCase())
  }
  return false
}
