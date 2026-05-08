import { NextResponse } from 'next/server'
import { listSalesEmails } from '@/lib/server/sales-repository'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('leadId')
    const emails = await listSalesEmails()
    const filtered = leadId ? emails.filter(e => e.leadId === leadId) : emails
    const sorted = [...filtered].sort((a, b) => b.sentAt > a.sentAt ? 1 : -1)
    return NextResponse.json(sorted)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
