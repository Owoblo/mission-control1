import { NextResponse } from 'next/server'
import { getSalesAcademyModule } from '@/lib/sales-academy'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { saveSalesAcademyProgress } from '@/lib/server/sales-academy-repository'
import { getSessionUser } from '@/lib/server/session'

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      moduleId?: string
      completedLessons?: string[]
      scenarioAnswers?: Record<string, string>
      acknowledgedVersion?: string | null
      lastOpenedAt?: string | null
      completedAt?: string | null
    }

    const moduleId = String(body.moduleId || '')
    const module = getSalesAcademyModule(moduleId)
    if (!module) {
      return NextResponse.json({ error: 'Unknown academy module' }, { status: 400 })
    }

    const validLessonIds = new Set(module.lessons.map(lesson => lesson.id))
    const completedLessons = Array.isArray(body.completedLessons)
      ? body.completedLessons.filter(item => typeof item === 'string' && validLessonIds.has(item))
      : []

    const validScenarioIds = new Set(
      module.lessons
        .filter(lesson => lesson.type === 'scenario')
        .map(lesson => lesson.id)
    )

    const scenarioAnswers = Object.fromEntries(
      Object.entries(body.scenarioAnswers || {}).filter(([scenarioId, answerId]) =>
        validScenarioIds.has(scenarioId) && typeof answerId === 'string'
      )
    ) as Record<string, string>

    const record = await saveSalesAcademyProgress({
      userId: session.userId || session.name || 'sales-user',
      moduleId,
      completedLessons,
      scenarioAnswers,
      acknowledgedVersion: typeof body.acknowledgedVersion === 'string' ? body.acknowledgedVersion : null,
      lastOpenedAt: typeof body.lastOpenedAt === 'string' ? body.lastOpenedAt : null,
      completedAt: typeof body.completedAt === 'string' ? body.completedAt : null,
    })

    if (!record.storageAvailable) {
      return NextResponse.json({ error: 'Academy progress storage is not available yet.' }, { status: 503 })
    }

    return NextResponse.json({
      ok: true,
      record: record.record,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not save academy progress' },
      { status: 500 }
    )
  }
}
