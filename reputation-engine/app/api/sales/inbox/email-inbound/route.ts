/**
 * POST /api/sales/inbox/email-inbound
 * Receives inbound emails from Resend (email.received webhook)
 * OR forwarded emails from the Cloudflare Email Worker (legacy, x-internal-secret).
 */
import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import { getWorkerSharedSecret, readEnv } from '@/lib/server/runtime'
import { saveSalesEmail, saveFollowUpLog } from '@/lib/server/sales-repository'

async function verifySvixSignature(request: Request, rawBody: string): Promise<boolean> {
  const secret = readEnv('RESEND_WEBHOOK_SECRET')
  if (!secret) return true

  const msgId = request.headers.get('svix-id') || ''
  const msgTs = request.headers.get('svix-timestamp') || ''
  const msgSig = request.headers.get('svix-signature') || ''

  if (!msgId || !msgTs || !msgSig) return false

  // Replay protection: reject if timestamp is >5 minutes old
  const ts = parseInt(msgTs, 10)
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false

  // Decode the whsec_ secret
  const secretBytes = Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0))
  const toSign = new TextEncoder().encode(`${msgId}.${msgTs}.${rawBody}`)

  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, toSign)
  const computed = 'v1,' + btoa(String.fromCharCode(...Array.from(new Uint8Array(sig))))

  return msgSig.split(' ').some(s => s === computed)
}

export async function POST(request: Request) {
  const workerSecret = request.headers.get('x-internal-secret')
  const expectedWorkerSecret = getWorkerSharedSecret()
  const isWorker = workerSecret && expectedWorkerSecret && workerSecret === expectedWorkerSecret
  const isHealthCheck = isWorker && request.headers.get('x-health-check') === '1'

  const rawBody = await request.text()

  if (!isWorker) {
    const valid = await verifySvixSignature(request, rawBody)
    if (!valid) return new Response('Unauthorized', { status: 401 })
  }

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
    if (isHealthCheck) {
      const emailId = uid('em')
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
      queueLeadIntelligenceRefresh(leadId, new URL(request.url).origin)
    }

    return NextResponse.json({ ok: true, matched: !!leadId, leadId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Inbound email failed' },
      { status: 500 }
    )
  }
}
