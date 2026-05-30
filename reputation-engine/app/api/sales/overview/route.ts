import { NextResponse } from 'next/server'
import { getSalesOverview } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export async function GET() {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const overview = await getSalesOverview()
    return NextResponse.json(overview)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sales overview' },
      { status: 500 }
    )
  }
}
