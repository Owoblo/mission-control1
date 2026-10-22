import { readEnv } from './runtime'

export const CRON_API_PATHS = new Set([
  '/api/sales/follow-up-radar/process',
  '/api/ops/database-health',
  '/api/ops/lead-flow-health',
  '/api/ops/performance-health',
  '/api/ops/media-reconciliation',
  '/api/ops/tentative-reservations',
  '/api/marketing/sequence/process',
  '/api/marketing/recent-sales/digest',
  '/api/marketing/partnership-digest',
  '/api/marketing/partnership-discovery/process',
  '/api/marketing/email-replies/process',
  '/api/sales/inbox/resend-poll',
  '/api/sales/automation/process',
  '/api/sales/quote-send-jobs/process',
  '/api/sales/recordings/cleanup',
])

export function isCronApiPath(pathname: string) {
  return CRON_API_PATHS.has(pathname)
}

export function isAuthorizedCronRequest(request: Request) {
  const cronSecret = readEnv('CRON_SECRET')
  const auth = request.headers.get('authorization')
  return !!cronSecret && auth === `Bearer ${cronSecret}`
}

/**
 * Partnership automation has its own secret so it cannot reuse or rotate a
 * Stripe and platform-wide cron credential. Keep this separate from the
 * shared cron guard above and use it only on partnership-specific routes.
 */
export function isAuthorizedPartnershipCronRequest(request: Request) {
  const partnershipSecret = readEnv('PARTNERSHIP_CRON_SECRET')
  const auth = request.headers.get('authorization')
  return !!partnershipSecret && auth === `Bearer ${partnershipSecret}`
}
