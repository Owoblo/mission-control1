import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { createHash } from 'node:crypto'
/**
 * POST /api/sales/inbox/email-inbound
 * Receives authenticated SES imports or legacy internal email forwards.
 */
import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import { getWorkerSharedSecret, requireSupabaseEnv } from '@/lib/server/runtime'
import { saveSalesEmail, saveFollowUpLog } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const workerSecret = request.headers.get('x-internal-secret')
  const expectedWorkerSecret = getWorkerSharedSecret()
  const isWorker = workerSecret && expectedWorkerSecret && workerSecret === expectedWorkerSecret
  const isHealthCheck = isWorker && request.headers.get('x-health-check') === '1'

  const rawBody = await request.text()

  if (!isWorker) return new Response('Unauthorized', { status: 401 })

  try {
    const raw = JSON.parse(rawBody) as Record<string, unknown>

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
    const providerMessageId = typeof raw.providerMessageId === 'string' ? raw.providerMessageId : null
    const emailId = providerMessageId ? 'em_ses_' + createHash('sha256').update(providerMessageId).digest('hex').slice(0, 32) : uid('em')
    if (providerMessageId) {
      const { url, headers } = requireSupabaseEnv()
      const existing = await fetch(`${url}/rest/v1/crm_emails?id=eq.${emailId}&select=id&limit=1`, { headers, cache: 'no-store' })
      if (!existing.ok) throw new Error('Inbound email deduplication lookup failed')
      if ((await existing.json()).length) return NextResponse.json({ ok: true, duplicate: true, emailId })
    }
    if (isHealthCheck) {
      await saveSalesEmail({
        id: emailId,
        leadId: null,
        quoteId: null,
        to: to || 'business@inbound.starmovers.ca',
        from,
        subject: subject || '[Health Check] Inbound email',
        body,
        templateType: 'health_check',
        direction: 'inbound',
        status: 'sent',
        sentAt: now,
      })

      return NextResponse.json({ ok: true, healthCheck: true, emailId })
    }

    const partnership = await pausePartnershipSequenceForInbound({
      channel: 'email',
      email: from,
      occurredAt: now,
      notes: `Inbound email: ${subject || '(no subject)'}\n\n${body}`,
      metadata: {
        from,
        to,
        subject,
      },
    }).catch(() => ({ matched: false as const }))

    if (partnership.matched) {
      await saveSalesEmail({ id: emailId, leadId: null, quoteId: null, from, to: to || 'business@inbound.starmovers.ca', subject: subject || '(no subject)', body, templateType: 'partnership_inbound', direction: 'inbound', status: 'sent', sentAt: now })
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
      id: emailId,
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
      queueLeadIntelligenceRefresh(leadId, new URL(request.url).origin)
    }

    const escapedBody = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendRepAlertEmail(`New customer email — ${subject || '(no subject)'}`, `<p>From: ${from.replace(/[<>&]/g, '')}</p><pre style="white-space:pre-wrap">${escapedBody}</pre>`)
    return NextResponse.json({ ok: true, matched: !!leadId, leadId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Inbound email failed' },
      { status: 500 }
    )
  }
}
