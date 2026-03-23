import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { summarizeMessage } from '@/lib/server/call-intelligence'
import { logEvent } from '@/lib/server/analytics'
import { requireSupabaseEnv, requireWorkerBaseUrl } from '@/lib/server/runtime'
import { getSalesLead, listFollowUpLogs, saveFollowUpLog, saveSalesEmail, saveSalesLead } from '@/lib/server/sales-repository'
import type { CRMEmail, FollowUpLog } from '@/lib/types'

const MY_NUMBER = '+12267732993'

async function logSmsToSupabase(to: string, body: string, leadId: string | undefined) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: uid('sms'),
        from_number: MY_NUMBER,
        to_number: to,
        body,
        direction: 'outbound',
        lead_id: leadId || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      channel?: 'email' | 'sms'
      to?: string
      subject?: string
      body?: string
      htmlBody?: string
      leadId?: string
      quoteId?: string
      followUpDate?: string
      notes?: string
    }

    if (!payload.channel || !payload.to || !payload.body) {
      return NextResponse.json({ error: 'channel, to, and body are required' }, { status: 400 })
    }

    const workerPath = payload.channel === 'email' ? '/send-email' : '/send-sms'
    const workerSecret = process.env.WORKER_SHARED_SECRET
    if (!workerSecret) {
      return NextResponse.json({ error: 'Missing WORKER_SHARED_SECRET' }, { status: 500 })
    }
    const workerBody =
      payload.channel === 'email'
        ? {
            to: payload.to,
            subject: payload.subject || 'Saturn Star Moving',
            body: payload.body,
            htmlBody: payload.htmlBody || undefined,
          }
        : { to: payload.to, body: payload.body }

    const response = await fetch(`${requireWorkerBaseUrl()}${workerPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': workerSecret,
      },
      body: JSON.stringify(workerBody),
    })
    const result = await response.json().catch(() => ({}))

    if (!response.ok || !result?.ok) {
      return NextResponse.json({ error: result?.error || 'Send failed' }, { status: response.status || 500 })
    }

    const log: FollowUpLog = {
      id: uid('fu'),
      leadId: payload.leadId,
      quoteId: payload.quoteId,
      type: payload.channel,
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes:
        payload.notes ||
        (payload.channel === 'email'
          ? `Email sent to ${payload.to}${payload.subject ? ` — ${payload.subject}` : ''}`
          : `SMS sent to ${payload.to}`),
    }
    const savedLog = await saveFollowUpLog(log)

    // AI summary + analytics — fire async, don't block the response
    if (payload.leadId && payload.body) {
      ;(async () => {
        try {
          const lead = await getSalesLead(payload.leadId!)
          if (!lead) return
          const allLogs = await listFollowUpLogs()
          const sameLeadMsgLogs = allLogs.filter(l => l.leadId === payload.leadId && (l.type === 'sms' || l.type === 'email') && l.notes)
          const thread = sameLeadMsgLogs
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map(l => ({ direction: 'outbound' as const, text: l.notes!, date: l.date }))
          const aiSummary = await summarizeMessage(lead, payload.body!, payload.channel as 'sms' | 'email', 'outbound', thread)
          if (aiSummary) {
            await saveFollowUpLog({ ...savedLog, aiSummary })
          }
          void logEvent(payload.channel === 'sms' ? 'sms_sent' : 'email_sent', {
            leadId: payload.leadId,
            lead,
            properties: {
              channel: payload.channel as 'sms' | 'email',
              message_direction: 'outbound',
              message_length: payload.body!.length,
              thread_length: sameLeadMsgLogs.length,
              has_ai_summary: !!aiSummary,
              move_readiness: aiSummary?.moveReadiness,
              ai_sentiment: aiSummary?.sentiment,
              ai_intent: aiSummary?.intent,
            },
          })
        } catch {
          // best-effort — never fail the send
        }
      })()
    }

    // Log outbound SMS to sms_messages so it appears in the 2-way thread view
    if (payload.channel === 'sms') {
      void logSmsToSupabase(payload.to, payload.body, payload.leadId)
    }

    let emailRecord: CRMEmail | null = null
    if (payload.channel === 'email') {
      emailRecord = await saveSalesEmail({
        id: uid('em'),
        leadId: payload.leadId || null,
        quoteId: payload.quoteId || null,
        to: payload.to,
        from: 'business@starmovers.ca',
        subject: payload.subject || 'Saturn Star Moving',
        body: payload.body,
        templateType: payload.quoteId ? 'quote_sent' : 'first_contact',
        direction: 'outbound',
        status: 'sent',
        sentAt: new Date().toISOString(),
      })
    }

    // Auto follow-up: when a quote is sent, set 24h follow-up on the lead if none exists
    if (payload.quoteId && payload.leadId && payload.channel === 'email') {
      try {
        const lead = await getSalesLead(payload.leadId)
        if (lead && !lead.followUpDate) {
          const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
          const followUpDate = tomorrow.toISOString().slice(0, 10)
          await saveSalesLead({
            ...lead,
            followUpDate,
            followUpNote: 'Follow up on sent quote',
          })
        }
      } catch {
        // best-effort — don't fail the send because of this
      }
    }

    return NextResponse.json({ ok: true, result, log: savedLog, email: emailRecord })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 400 }
    )
  }
}
