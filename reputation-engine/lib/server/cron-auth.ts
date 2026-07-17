import { readEnv } from './runtime'

export const CRON_API_PATHS = new Set([
  '/api/ops/lead-flow-health',
  '/api/marketing/sequence/process',
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
