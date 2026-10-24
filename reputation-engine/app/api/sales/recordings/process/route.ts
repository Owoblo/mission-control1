import { isAutomationRequestAuthorized } from '@/lib/server/automation-auth'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { processRecordingJobs } from '@/lib/server/recording-processing'
export const maxDuration = 300
async function run() {
  try { return Response.json({ jobs: await processRecordingJobs(1) }) }
  catch { return Response.json({ error: 'Recording processing is temporarily unavailable' }, { status: 503 }) }
}
export async function GET(request: Request) {
  return isAuthorizedCronRequest(request) ? run() : Response.json({ error: 'Unauthorized' }, { status: 401 })
}
export async function POST(request: Request) {
  return await isAutomationRequestAuthorized(request) ? run() : Response.json({ error: 'Unauthorized' }, { status: 401 })
}
