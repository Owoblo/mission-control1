import { NextResponse } from 'next/server'
import { deletePartnerRecord } from '@/lib/server/repository'
import { hasInternalSession } from '@/lib/server/session'

export const dynamic = 'force-dynamic'

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    if (!(await hasInternalSession())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await deletePartnerRecord(params.id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
