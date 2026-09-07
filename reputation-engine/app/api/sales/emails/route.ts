import { NextResponse } from 'next/server'
import { listSalesEmails, getSalesLead, saveSalesEmail } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('leadId')
    const emailId = searchParams.get('id')
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
    if (emailId) {
      const email = sorted.find(item => item.id === emailId)
      return email
        ? NextResponse.json(email)
        : NextResponse.json({ error: 'Email not found' }, { status: 404 })
    }
    const limit = Math.min(250, Math.max(1, Number(searchParams.get('limit')) || 150))
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)
    const search = (searchParams.get('search') || '').trim().toLowerCase().slice(0, 80)
    const matched = search
      ? sorted.filter(email => [email.from, email.to, email.subject, email.body]
          .filter(Boolean).join(' ').toLowerCase().includes(search))
      : sorted
    const page = matched.slice(offset, offset + limit)
    const response = NextResponse.json(page.map(email => ({
      ...email,
      body: email.body?.slice(0, 160) || '',
      htmlBody: undefined,
    })))
    response.headers.set('X-Has-More', String(offset + page.length < matched.length))
    response.headers.set('X-Total-Count', String(matched.length))
    response.headers.set('X-Unread-Count', String(filtered.filter(email => email.direction === 'inbound' && !email.readAt).length))
    return response
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
