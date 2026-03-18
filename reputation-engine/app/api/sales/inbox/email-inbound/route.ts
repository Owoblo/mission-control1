/**
 * POST /api/sales/inbox/email-inbound
 * Receives forwarded emails from the Cloudflare Email Worker.
 * Matches sender to existing lead (by email) or logs for review.
 * Secured by WORKER_SHARED_SECRET header.
 */
import { NextResponse } from 'next/server'
import { listSalesLeads, saveSalesEmail, saveFollowUpLog } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

export async function POST(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  if (secret !== process.env.WORKER_SHARED_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const { from, fromName, subject, body, to, receivedAt } = await request.json() as {
      from: string
      fromName?: string
      subject?: string
      body: string
      htmlBody?: string
      to?: string
      receivedAt?: string
    }

    if (!from || !body) return NextResponse.json({ error: 'from and body required' }, { status: 400 })

    const now = receivedAt || new Date().toISOString()

    // Try to match to an existing lead by email
    const leads = await listSalesLeads()
    const matchedLead = leads.find(l => l.email?.toLowerCase() === from.toLowerCase())

    if (matchedLead) {
      // Save as email record on existing lead
      await saveSalesEmail({
        id: uid('em'),
        leadId: matchedLead.id,
        quoteId: null,
        to: to || 'business@starmovers.ca',
        from,
        subject: subject || '(no subject)',
        body,
        templateType: 'inbound_reply',
        direction: 'inbound',
        status: 'sent',
        sentAt: now,
      })

      // Save as timeline event
      await saveFollowUpLog({
        id: uid('fu'),
        leadId: matchedLead.id,
        type: 'email',
        date: now,
        createdAt: now,
        notes: `Email received from ${fromName || from}: ${subject || '(no subject)'}`,
      })

      return NextResponse.json({ ok: true, matched: true, leadId: matchedLead.id })
    }

    // No match — log for review
    return NextResponse.json({ ok: true, matched: false, from, subject })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Inbound email failed' }, { status: 500 })
  }
}
