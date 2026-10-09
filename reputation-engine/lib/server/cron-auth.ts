import { readEnv } from './runtime'

export const CRON_API_PATHS = new Set([
  '/api/ops/database-health',
  '/api/ops/lead-flow-health',
  '/api/ops/media-reconciliation',
  '/api/ops/tentative-reservations',
  '/api/marketing/sequence/process',
  '/api/marketing/recent-sales/digest',
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
