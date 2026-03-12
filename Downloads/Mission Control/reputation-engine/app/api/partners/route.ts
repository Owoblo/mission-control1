import { NextResponse } from 'next/server'
import { listPartners, savePartnerRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'
import { normalizePartner } from '@/lib/store'
import type { Partner } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(await listPartners())
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const payload = (await request.json()) as Partner
    const partner = normalizePartner(payload)
    return NextResponse.json(await savePartnerRecord(partner))
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
}
