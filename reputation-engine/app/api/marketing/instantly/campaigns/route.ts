import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { listInstantlyCampaigns } from '@/lib/server/instantly'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const campaigns = await listInstantlyCampaigns()
    return NextResponse.json({ ok: true, campaigns })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
