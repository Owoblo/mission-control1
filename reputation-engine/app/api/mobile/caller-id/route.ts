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
  const resolution = await resolveVoiceCallerId({
    phone: searchParams.get('phone'),
    leadId: searchParams.get('leadId'),
  })
  const suggested = allowedSalesLines.find(line => line.number === resolution.fromNumber)
    || allowedSalesLines[0]

  return NextResponse.json({
    ok: true,
    line: suggested,
    reason: suggested.number === resolution.fromNumber ? resolution.reason : 'assigned_branch',
  })
}
