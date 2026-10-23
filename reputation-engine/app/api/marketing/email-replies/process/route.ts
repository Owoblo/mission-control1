import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getSessionUser } from '@/lib/server/session'
import { canSeeAllPartnershipMarkets } from '@/lib/server/partnership-access'
import { syncAllPartnershipZohoReplies } from '@/lib/server/partnership-zoho-sync'
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try { return NextResponse.json(await syncAllPartnershipZohoReplies()) }
  catch (error) { console.error('Partnership mailbox sync failed', error); return NextResponse.json({ error: 'Partnership mailbox sync failed' }, { status: 500 }) }
}

export async function POST() {
  if (!canSeeAllPartnershipMarkets(await getSessionUser())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try { return NextResponse.json(await syncAllPartnershipZohoReplies()) }
  catch (error) { console.error('Partnership mailbox sync failed', error); return NextResponse.json({ error: 'Partnership mailbox sync failed' }, { status: 500 }) }
}
