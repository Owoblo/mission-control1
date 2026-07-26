import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { listRecentConversationThreads } from '@/lib/server/sales-automation-repository'
import type { ConversationMemory, ConversationQuality } from '@/lib/conversation-experience'

export const dynamic = 'force-dynamic'

async function isAuthorized(request: Request) {
  if (isAuthorizedCronRequest(request)) return true
  const session = await getSessionUser()
  return !!session && canAccessSalesWorkspace(session)
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const threads = await listRecentConversationThreads(300)
  const scored = threads.flatMap(thread => {
    const quality = thread.metadata?.conversationQuality as ConversationQuality | undefined
    const experience = thread.metadata?.conversationExperience as ConversationMemory | undefined
    return quality && experience ? [{ thread, quality, experience }] : []
  })
  const violationCounts: Record<string, number> = {}
  const stageCounts: Record<string, number> = {}
  const emotionCounts: Record<string, number> = {}
  for (const item of scored) {
    stageCounts[item.experience.stage] = (stageCounts[item.experience.stage] || 0) + 1
    emotionCounts[item.experience.emotion] = (emotionCounts[item.experience.emotion] || 0) + 1
    for (const violation of item.quality.violations) {
      violationCounts[violation] = (violationCounts[violation] || 0) + 1
    }
  }
  const averageScore = scored.length
    ? Math.round(scored.reduce((sum, item) => sum + item.quality.score, 0) / scored.length)
    : null
  const interactions = threads.flatMap(thread =>
    Array.isArray(thread.metadata?.conversationInteractionHistory)
      ? thread.metadata.conversationInteractionHistory as Array<{
          outboundAt?: string
          respondedToPreviousAutomation?: boolean
          stage?: string
          emotion?: string
          questionTopic?: string
          qualityScore?: number
        }>
      : []
  )
  const responseEligible = interactions.filter(item => item.respondedToPreviousAutomation !== undefined)
  const now = Date.now()
  const awaitingReplyOver24Hours = threads.filter(thread => {
    if (!thread.lastAutomationOutboundAt) return false
    if (thread.lastInboundAt && new Date(thread.lastInboundAt).getTime() > new Date(thread.lastAutomationOutboundAt).getTime()) return false
    return now - new Date(thread.lastAutomationOutboundAt).getTime() > 24 * 60 * 60 * 1000
  }).length
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    sampleSize: scored.length,
    averageScore,
    contractPassRate: scored.length
      ? Math.round(scored.filter(item => item.quality.violations.length === 0).length / scored.length * 100)
      : null,
    bundledQuestionRate: scored.length
      ? Math.round(scored.filter(item => item.quality.bundledQuestion).length / scored.length * 100)
      : null,
    repeatedQuestionRate: scored.length
      ? Math.round(scored.filter(item => item.quality.repeatedQuestion).length / scored.length * 100)
      : null,
    customerResponseRate: responseEligible.length
      ? Math.round(responseEligible.filter(item => item.respondedToPreviousAutomation).length / responseEligible.length * 100)
      : null,
    awaitingReplyOver24Hours,
    averageTurns: scored.length
      ? Math.round(scored.reduce((sum, item) => sum + item.experience.turnCount, 0) / scored.length * 10) / 10
      : null,
    stageCounts,
    emotionCounts,
    violationCounts,
    recentLowScores: scored
      .filter(item => item.quality.score < 64)
      .slice(0, 20)
      .map(item => ({
        leadId: item.thread.leadId,
        channel: item.thread.channel,
        score: item.quality.score,
        violations: item.quality.violations,
        preview: item.thread.lastOutboundPreview,
      })),
  })
}
