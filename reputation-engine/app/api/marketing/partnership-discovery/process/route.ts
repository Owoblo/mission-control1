import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { runPartnershipDiscovery } from '@/lib/server/partnership-discovery'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await runPartnershipDiscovery()
    return NextResponse.json(result, { status: result.ok ? 200 : 502 })
  } catch (error) {
    console.error('[partnership-discovery]', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Partnership discovery failed; inspect server logs' }, { status: 500 })
  }
}
