import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv as requireSupabase } from '@/lib/server/runtime'

// Lightweight count — polled by header every 30s for the badge
export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ count: 0 })

  const { url, headers } = requireSupabase()
  const res = await fetch(
    `${url}/rest/v1/inbound_leads?claimed=eq.false&select=id`,
    { headers: { ...headers, Prefer: 'count=exact' }, cache: 'no-store' }
  )

  const count = parseInt(res.headers.get('content-range')?.split('/')[1] ?? '0', 10)
  return NextResponse.json({ count: isNaN(count) ? 0 : count })
}
