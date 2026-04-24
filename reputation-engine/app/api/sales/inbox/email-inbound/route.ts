/**
 * POST /api/sales/inbox/email-inbound
 * Receives inbound emails from Resend (email.received webhook)
 * OR forwarded emails from the Cloudflare Email Worker (legacy, x-internal-secret).
 */
import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import { getWorkerSharedSecret, readEnv } from '@/lib/server/runtime'
import { saveSalesEmail, saveFollowUpLog } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const workerSecret = request.headers.get('x-internal-secret')
  const expectedWorkerSecret = getWorkerSharedSecret()
  const isWorker = workerSecret && expectedWorkerSecret && workerSecret === expectedWorkerSecret

  if (!isWorker) {
    const resendSecret = readEnv('RESEND_WEBHOOK_SECRET')
    if (resendSecret) {
      const svixSignature = request.headers.get('svix-signature')
      if (!svixSignature) return new Response('Unauthorized', { status: 401 })
    }
  }

  try {
    const raw = (await request.json()) as Record<string, unknown>

    let from = ''
    let fromName: string | undefined
    let subject: string | undefined
    let body = ''
    let htmlBody: string | undefined
    let to: string | undefined
    let receivedAt: string | undefined

    if (raw.type === 'email.received' && raw.data && typeof raw.data === 'object') {
      const data = raw.data as Record<string, unknown>
      from = (data.from as string) || ''
      subject = (data.subject as string) || ''
      body = (data.text as string) || ''
      htmlBody = (data.html as string) || undefined
      to = Array.isArray(data.to) ? (data.to[0] as string) : (data.to as string) || 'business@starmovers.ca'
      receivedAt = new Date().toISOString()
      const match = from.match(/^(.+?)\s*</)
      if (match) {
        fromName = match[1].trim()
        from = from.replace(/^.+<(.+)>$/, '$1').trim()
      }
    } else {
      const legacy = raw as {
        from?: string
        fromName?: string
        subject?: string
        body?: string
        htmlBody?: string
        to?: string
        receivedAt?: string
      }
      from = legacy.from || ''
      fromName = legacy.fromName
      subject = legacy.subject
      body = legacy.body || ''
      htmlBody = legacy.htmlBody
      to = legacy.to
      receivedAt = legacy.receivedAt
    }

    if (!from || !body) {
      return NextResponse.json({ error: 'from and body required' }, { status: 400 })
    }

    const now = receivedAt || new Date().toISOString()
    const partnership = await pausePartnershipSequenceForInbound({
      channel: 'email',
      email: from,
      occurredAt: now,
      notes: subject ? `Inbound email: ${subject}` : 'Inbound email reply received',
      metadata: {
        from,
        to,
        subject,
      },
    }).catch(() => ({ matched: false as const }))

    if (partnership.matched) {
      return NextResponse.json({ ok: true, partnershipMatched: true, partnershipContactId: partnership.contactId })
    }

    const automation = await processInboundAutomationEvent({
      source: 'email_reply',
      channel: 'email',
      email: from,
      name: fromName,
      subject,
      message: body,
      receivedAt: now,
      raw,
    })

    const leadId = automation.lead?.id || null

    await saveSalesEmail({
      id: uid('em'),
      leadId,
      quoteId: null,
      to: to || 'business@inbound.starmovers.ca',
      from,
      subject: subject || '(no subject)',
      body: htmlBody ? `${body}\n\n[html included]` : body,
      templateType: 'inbound_reply',
      direction: 'inbound',
      status: 'sent',
      sentAt: now,
    })

    if (leadId) {
      await saveFollowUpLog({
        id: uid('fu'),
        leadId,
        type: 'email',
        date: now,
        createdAt: now,
        notes: `Email received from ${fromName || from}: ${subject || '(no subject)'}`,
      })
    }

    return NextResponse.json({ ok: true, matched: !!leadId, leadId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Inbound email failed' },
      { status: 500 }
    )
  }
}
