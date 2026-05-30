import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLeadByContact } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const phone = new URL(request.url).searchParams.get('phone') || ''
    if (phone.replace(/\D/g, '').length < 10) {
      return NextResponse.json({ lead: null })
    }

    const matched = await getSalesLeadByContact(phone, undefined, undefined)
    return NextResponse.json({ lead: matched })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to match lead by phone' },
      { status: 500 }
    )
  }
}
