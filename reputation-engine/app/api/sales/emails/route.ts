import { NextResponse } from 'next/server'
import { listSalesEmails, getSalesLead, saveSalesEmail } from '@/lib/server/sales-repository'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('leadId')
    const emails = await listSalesEmails()

    let filtered = emails
    if (leadId) {
      // Match by leadId directly, OR by the lead's email address so inbound emails show even if not yet linked
      const lead = await getSalesLead(leadId).catch(() => null)
      const leadEmail = lead?.email?.toLowerCase().trim()
      filtered = emails.filter(e =>
        e.leadId === leadId ||
        (leadEmail && (
          e.from?.toLowerCase() === leadEmail ||
          e.to?.toLowerCase() === leadEmail
        ))
      )
      // Backfill leadId on matched emails (fire-and-forget)
      if (lead && leadEmail) {
        const unlinked = filtered.filter(e => !e.leadId)
        if (unlinked.length > 0) {
          void Promise.all(unlinked.map(email => saveSalesEmail({ ...email, leadId }).catch(() => {})))
        }
      }
    }

    const sorted = [...filtered].sort((a, b) => b.sentAt > a.sentAt ? 1 : -1)
    return NextResponse.json(sorted)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
