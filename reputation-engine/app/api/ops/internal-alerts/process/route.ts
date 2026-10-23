import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { processInternalAlerts } from '@/lib/server/alert-outbox'
export const maxDuration = 60
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try { return Response.json(await processInternalAlerts()) }
  catch { return Response.json({ error: 'Internal alert delivery failed' }, { status: 503 }) }
}
