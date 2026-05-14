import { NextResponse } from 'next/server'
import { listSalesEmails } from '@/lib/server/sales-repository'
import type { CRMEmail } from '@/lib/types'

export type { CRMEmail as EmailMessage }

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const email = (searchParams.get('email') || '').toLowerCase().trim()
    if (!email) return NextResponse.json([])

    const all = await listSalesEmails()
    const filtered = all.filter((msg: CRMEmail) =>
      msg.from?.toLowerCase() === email ||
      msg.to?.toLowerCase() === email
    )
    filtered.sort((a: CRMEmail, b: CRMEmail) => (b.sentAt > a.sentAt ? 1 : -1))
    return NextResponse.json(filtered)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
