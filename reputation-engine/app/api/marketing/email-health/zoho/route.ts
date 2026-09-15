import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { checkZohoMailbox } from '@/lib/server/zoho-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  if (!canAccessSalesWorkspace(await getSessionUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json(await checkZohoMailbox(), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, reason: 'zoho_connection_check_failed' }, { status: 502 })
  }
}
