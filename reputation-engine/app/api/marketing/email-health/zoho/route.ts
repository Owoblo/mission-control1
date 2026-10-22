import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { openZohoMailbox } from '@/lib/partnership-core/zoho.mjs'
import { checkZohoMailbox } from '@/lib/server/zoho-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  if (!canAccessSalesWorkspace(await getSessionUser())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    if (new URL(request.url).searchParams.get('market') === 'ottawa') {
      const mailbox = await openZohoMailbox('ottawa')
      return NextResponse.json({ok: true, mailbox: mailbox.mailbox, accountId: mailbox.accountId, replySendTested: false}, {headers: {'Cache-Control': 'no-store'}})
    }
    return NextResponse.json(await checkZohoMailbox(), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ ok: false, reason: 'zoho_connection_check_failed' }, { status: 502 })
  }
}
