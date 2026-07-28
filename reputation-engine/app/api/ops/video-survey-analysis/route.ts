import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { processNextVideoSurveyAnalysis } from '@/lib/server/video-survey-analysis-worker'
import { isVideoSurveyFeatureEnabled } from '@/lib/server/video-survey-provider'
import { reconcileOpenVideoSurveySessions } from '@/lib/server/video-survey-reconciliation'
import { isVideoSurveyDatabaseUnavailable } from '@/lib/server/video-survey-repository'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function authorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  return canAccessSalesWorkspace(await getSessionUser())
}

async function run(request: Request) {
  if (!(await authorized(request))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isVideoSurveyFeatureEnabled()) return NextResponse.json({ processed: false, reason: 'disabled' })
  try {
    const reconciliation = await reconcileOpenVideoSurveySessions()
    const analysis = await processNextVideoSurveyAnalysis()
    return NextResponse.json({ reconciliation, analysis })
  } catch (error) {
    if (isVideoSurveyDatabaseUnavailable(error)) {
      console.warn('[video-survey/analysis] database temporarily unavailable')
      return NextResponse.json(
        { processed: false, retryable: true, reason: 'database_unavailable' },
        { status: 503, headers: { 'Retry-After': '15' } }
      )
    }
    throw error
  }
}

export const GET = run
export const POST = run
