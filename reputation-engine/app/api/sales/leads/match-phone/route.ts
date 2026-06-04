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

    const params = new URL(request.url).searchParams
    const phone = params.get('phone') || ''
    const email = params.get('email') || ''

    const hasValidPhone = phone.replace(/\D/g, '').length >= 10
    const hasValidEmail = email.includes('@') && email.length >= 5

    if (!hasValidPhone && !hasValidEmail) {
      return NextResponse.json({ lead: null })
    }

    const matched = await getSalesLeadByContact(
      hasValidPhone ? phone : undefined,
      hasValidEmail ? email : undefined,
      undefined,
    )
    return NextResponse.json({ lead: matched ? { id: matched.id, name: matched.name, stage: matched.stage } : null })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to match lead by phone' },
      { status: 500 }
    )
  }
}
