import { NextResponse } from 'next/server'
import { SALES_ACADEMY_MODULES, SALES_ACADEMY_RELEASES } from '@/lib/sales-academy'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { listSalesAcademyProgress } from '@/lib/server/sales-academy-repository'
import { getSessionUser } from '@/lib/server/session'

export async function GET() {
  const session = await getSessionUser()
  if (!session || !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.userId || session.name || 'sales-user'
  const progressResult = await listSalesAcademyProgress(userId)
  const progressByModule = Object.fromEntries(progressResult.rows.map(row => [row.moduleId, row]))

  return NextResponse.json({
    user: {
      id: userId,
      name: session.name || 'Team Member',
      role: session.role || 'sales_rep',
    },
    modules: SALES_ACADEMY_MODULES,
    releases: SALES_ACADEMY_RELEASES,
    progress: progressByModule,
    storageAvailable: progressResult.storageAvailable,
    generatedAt: new Date().toISOString(),
  })
}
