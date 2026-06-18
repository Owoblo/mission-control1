import { NextResponse } from 'next/server'
import { getSalesOverview, listSalesLeadSearchSnapshots } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (new URL(request.url).searchParams.get('mode') === 'search') {
      const leads = await listSalesLeadSearchSnapshots()
      return NextResponse.json({ leads })
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
