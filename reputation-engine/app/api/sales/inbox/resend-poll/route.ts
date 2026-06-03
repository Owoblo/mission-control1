/**
 * POST /api/sales/inbox/resend-poll
 * Polls Resend's receiving API and injects new emails into the CRM.
 * More reliable than webhooks — bypasses Svix signature issues entirely.
 * Triggered by Vercel cron every 2 minutes + manually anytime.
 */
import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { getWorkerSharedSecret, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'
import { pausePartnershipSequenceForInbound } from '@/lib/server/partnership-inbound'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { saveSalesEmail, saveFollowUpLog } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { uid } from '@/lib/sales'

const INBOUND_DOMAINS = ['inbound.starmovers.ca', 'starmovers.ca']

type ResendEmail = {
  id: string
  to: string[]
  from: string
  created_at: string
  subject: string
  html?: string
  text?: string
}

async function fetchReceivedEmails(apiKey: string): Promise<ResendEmail[]> {
  const res = await fetch('https://api.resend.com/emails/receiving', {
    headers: { Authorization: `Bearer ${apiKey}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Resend API error: ${res.status}`)
  const data = (await res.json()) as { data?: ResendEmail[] }
  return (data.data || []).filter(e =>
    e.to?.some(addr => INBOUND_DOMAINS.some(d => addr.includes(d)))
  )
}

async function fetchEmailContent(apiKey: string, emailId: string): Promise<ResendEmail | null> {
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return await res.json() as ResendEmail
  } catch { return null }
}

async function isAlreadyImported(resendId: string): Promise<boolean> {
  try {
    const { url, headers } = requireSupabaseEnv()
    // We store resend ID as subject prefix [resend:ID] to allow exact dedup
    const res = await fetch(
      `${url}/rest/v1/crm_emails?select=id&data->>subject=like.%5Bresend%3A${encodeURIComponent(resendId)}%5D*&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) return false
    const rows = (await res.json()) as Array<{ id: string }>
    return rows.length > 0
  } catch { return false }
}

async function importEmail(email: ResendEmail) {
  if (await isAlreadyImported(email.id)) return { skipped: true }

  // Parse sender
  const fromRaw = email.from || ''
  const nameMatch = fromRaw.match(/^(.+?)\s*</)
  const fromName = nameMatch ? nameMatch[1].trim() : undefined
  const from = fromRaw.replace(/^.+<(.+)>$/, '$1').trim() || fromRaw
  const to = email.to?.[0] || 'business@inbound.starmovers.ca'
  const receivedAt = email.created_at

  // Prefix subject with resend ID for dedup on next run
  const subject = `[resend:${email.id}] ${email.subject || '(no subject)'}`
  const body = email.text || email.html?.replace(/<[^>]+>/g, ' ').trim() || ''

  if (!from) return { skipped: true, reason: 'no sender' }

  // Pause partnership sequences if this is a reply from a partner
  const partnership = await pausePartnershipSequenceForInbound({
    channel: 'email',
    email: from,
    occurredAt: receivedAt,
    notes: `Inbound email: ${email.subject}`,
    metadata: { from, to, subject: email.subject },
  }).catch(() => ({ matched: false as const }))

  if (partnership.matched) {
    // Still save so it shows in email tab
    await saveSalesEmail({
      id: uid('em'),
      leadId: null,
      quoteId: null,
      to,
      from,
      subject,
      body: body || '(partnership reply)',
      templateType: 'inbound_reply',
      direction: 'inbound',
      status: 'sent',
      sentAt: receivedAt,
    })
    return { ok: true, partnershipMatched: true }
  }

  // Match/create lead via automation
  const automation = await processInboundAutomationEvent({
    source: 'email_reply',
    channel: 'email',
    email: from,
    name: fromName,
    subject: email.subject,
    message: body,
    receivedAt,
    raw: { resendId: email.id, from, to },
  })

  const leadId = automation.lead?.id || null

  await saveSalesEmail({
    id: uid('em'),
    leadId,
    quoteId: null,
    to,
    from,
    subject,
    body: body || '(no body)',
    templateType: 'inbound_reply',
    direction: 'inbound',
    status: 'sent',
    sentAt: receivedAt,
  })

  if (leadId) {
    await saveFollowUpLog({
      id: uid('fu'),
      leadId,
      type: 'email',
      date: receivedAt,
      createdAt: receivedAt,
      notes: `Email received from ${fromName || from}: ${email.subject || '(no subject)'}`,
    })
  }

  return { ok: true, matched: !!leadId, leadId, from, subject: email.subject }
}

export async function GET(request: Request) {
  return POST(request)
}

export async function POST(request: Request) {
  // Accept: x-internal-secret (worker calls), Vercel cron, or an authenticated sales user.
  const internalSecret = request.headers.get('x-internal-secret')
  const expectedSecret = getWorkerSharedSecret()
  const isWorker = internalSecret && expectedSecret && internalSecret === expectedSecret
  const isVercelCron = isAuthorizedCronRequest(request)
  if (!isWorker && !isVercelCron) {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const apiKey = readEnv('RESEND_API_KEY')
    if (!apiKey) return NextResponse.json({ error: 'RESEND_API_KEY not set' }, { status: 500 })

    const emails = await fetchReceivedEmails(apiKey)

    const results = []
    for (const summary of emails) {
      // Fetch full content (text/html body)
      const full = await fetchEmailContent(apiKey, summary.id) || summary
      const result = await importEmail(full)
      results.push({ id: summary.id, from: summary.from, subject: summary.subject, ...result })
    }

    const imported = results.filter(r => r.ok).length
    const skipped = results.filter(r => r.skipped).length

    return NextResponse.json({ ok: true, total: emails.length, imported, skipped, results })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Poll failed' },
      { status: 500 }
    )
  }
}
