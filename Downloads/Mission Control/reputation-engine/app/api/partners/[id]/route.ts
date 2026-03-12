import { NextResponse } from 'next/server'
import { deletePartnerRecord } from '@/lib/server/repository'

export const dynamic = 'force-dynamic'

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await deletePartnerRecord(params.id)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
