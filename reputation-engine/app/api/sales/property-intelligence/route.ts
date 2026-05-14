import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { analyzePropertyAccess } from '@/lib/server/property-intelligence'

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')?.trim()
    if (!address || address.length < 5) {
      return NextResponse.json({ error: 'address is required' }, { status: 400 })
    }

    const access = await analyzePropertyAccess(address)
    return NextResponse.json(access)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to analyze property' },
      { status: 500 }
    )
  }
}
