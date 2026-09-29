import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { listMobilePhoneLines } from '@/lib/server/mobile-phone-access'
import { resolveVoiceCallerId } from '@/lib/server/voice-caller-id'

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allowedSalesLines = listMobilePhoneLines(session)
    .filter(line => line.workspace === 'sales')
  if (!allowedSalesLines.length) {
    return NextResponse.json({ error: 'No sales line is assigned to this account' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  try {
    const resolution = await resolveVoiceCallerId({
      phone: searchParams.get('phone'),
      leadId: searchParams.get('leadId'),
      historyOnly: true,
    })
    const suggested = allowedSalesLines.find(line => line.number === resolution.fromNumber)
    if (!suggested) return NextResponse.json({ error: 'The customer contacted a line you cannot use. Choose an available company number or ask your manager.', requiresSelection: true }, { status: 403 })
    return NextResponse.json({ ok: true, line: suggested, reason: resolution.reason })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not verify the customer’s line. Choose a company number.', requiresSelection: true }, { status: 422 })
  }
}
