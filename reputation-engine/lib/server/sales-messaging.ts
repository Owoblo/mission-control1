import { uid } from '@/lib/sales'
import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnBusinessNumberFromSmsMessage,
  getSaturnBranchLabel,
  getSaturnBranchNumberFromRawData,
  isSaturnBranchPhoneNumber,
  normalizePhone,
  pickSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { summarizeMessage } from '@/lib/server/call-intelligence'
import { logEvent } from '@/lib/server/analytics'
import { getTwilioCredentials, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import {
  getInboundLead,
  getSalesLead,
  listFollowUpLogs,
  saveFollowUpLog,
  saveSalesEmail,
  saveSalesLead,
} from '@/lib/server/sales-repository'
import type { CRMEmail, CRMLead, FollowUpLog } from '@/lib/types'

const DEFAULT_HUMAN_PAUSE_HOURS = 12

export interface SendSalesMessageInput {
  channel: 'email' | 'sms'
  to: string
  subject?: string
  body: string
  htmlBody?: string
  leadId?: string
  quoteId?: string
  notes?: string
  fromNumber?: string
  actor?: 'human' | 'automation'
  pauseAutomationHours?: number
}

export interface SendSalesMessageResult {
  ok: true
  result: Record<string, unknown>
  log: FollowUpLog
  email: CRMEmail | null
  lead: CRMLead | null
}

async function logSmsToSupabase(from: string, to: string, body: string, leadId: string | undefined, sid?: string | null) {
  try {
    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/sms_messages`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: uid('sms'),
        from_number: from,
        to_number: to,
        body,
        direction: 'outbound',
        lead_id: leadId || null,
        twilio_sid: sid || null,
        created_at: new Date().toISOString(),
      }),
    })
  } catch {
    // non-fatal
  }
}

type SmsHistoryMessage = {
  direction: 'inbound' | 'outbound'
  from_number: string
  to_number: string
  created_at: string
}

async function querySmsMessagesByFilter(filter: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    const response = await fetch(
      `${url}/rest/v1/sms_messages?select=direction,from_number,to_number,created_at&${filter}&order=created_at.desc&limit=50`,
      { headers, cache: 'no-store' }
    )
    if (!response.ok) return []
    return (await response.json()) as SmsHistoryMessage[]
  } catch {
    return []
  }
}

function pickRecentThreadBranchNumber(messages: SmsHistoryMessage[]) {
  for (const message of messages) {
    const branchNumber = getSaturnBusinessNumberFromSmsMessage(message)
    if (isSaturnBranchPhoneNumber(branchNumber)) {
      return branchNumber
    }
  }
  return null
}

async function resolveSmsFromNumber(input: SendSalesMessageInput) {
  const explicit = normalizePhone(input.fromNumber)
  if (isSaturnBranchPhoneNumber(explicit)) {
    return explicit
  }

  let inboundBranchNumber: string | null = null
  let recentCallBranchNumber: string | null = null

  if (input.leadId) {
    const lead = await getSalesLead(input.leadId).catch(() => null)

    recentCallBranchNumber =
      (lead?.callLogs || [])
        .slice()
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map(entry => normalizePhone(entry.branchNumber))
        .find(isSaturnBranchPhoneNumber) || null

    if (lead?.inboundId) {
      const inboundLead = await getInboundLead(lead.inboundId).catch(() => null)
      inboundBranchNumber = getSaturnBranchNumberFromRawData(inboundLead?.raw_data) || null
    }

    const leadMessages = await querySmsMessagesByFilter(`lead_id=eq.${encodeURIComponent(input.leadId)}`)
    const leadThreadBranch = pickRecentThreadBranchNumber(leadMessages)
    if (leadThreadBranch) {
      return leadThreadBranch
    }
  }

  const contactPhone = normalizePhone(input.to)
  if (contactPhone) {
    const contactMessages = await querySmsMessagesByFilter(
      `or=(from_number.eq.${encodeURIComponent(contactPhone)},to_number.eq.${encodeURIComponent(contactPhone)})`
    )
    const threadBranch = pickRecentThreadBranchNumber(contactMessages)
    if (threadBranch) {
      return threadBranch
    }
  }

  return pickSaturnBranchPhoneNumber(inboundBranchNumber, recentCallBranchNumber, DEFAULT_SATURN_BRANCH_NUMBER)
}

async function syncLeadMessagingState(leadId: string, actor: 'human' | 'automation') {
  const lead = await getSalesLead(leadId)
  if (!lead) return null

  const now = new Date().toISOString()
  const next: CRMLead = {
    ...lead,
    stage: lead.stage === 'new' ? 'contacted' : lead.stage,
    firstResponseAt: lead.firstResponseAt || now,
    lastOutboundAt: now,
  }

  if (actor === 'human') {
    const pauseHours = DEFAULT_HUMAN_PAUSE_HOURS
    next.lastHumanOutboundAt = now
    next.automationPausedUntil = new Date(Date.now() + pauseHours * 60 * 60 * 1000).toISOString()
    next.automationPauseReason = 'manual_outbound'
    if (lead.automationStatus !== 'do_not_contact') {
      next.automationStatus = 'paused'
    }
  } else {
    next.lastAutomationOutboundAt = now
    next.automationLastJobAt = now
    next.automationPauseReason = undefined
    if (!lead.automationStatus || lead.automationStatus === 'idle' || lead.automationStatus === 'active' || lead.automationStatus === 'paused') {
      next.automationStatus = 'active'
    }
  }

  return saveSalesLead(next)
}

export async function sendSalesMessage(input: SendSalesMessageInput): Promise<SendSalesMessageResult> {
  const actor = input.actor || 'human'
  let result: Record<string, unknown> = { ok: true }

  if (input.channel === 'email') {
    const resendKey = readEnv('RESEND_API_KEY')
    if (!resendKey) {
      throw new Error('Missing RESEND_API_KEY')
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Saturn Star Movers <business@starmovers.ca>',
        to: [input.to],
        subject: input.subject || 'Saturn Star Movers',
        html: input.htmlBody || `<p>${input.body.replace(/\n/g, '<br>')}</p>`,
        text: input.body,
        reply_to: 'business@inbound.starmovers.ca',
      }),
    })

    const resendResult = await resendRes.json().catch(() => ({})) as Record<string, unknown>
    if (!resendRes.ok) {
      throw new Error(String(resendResult?.message || 'Email send failed'))
    }
    result = { ok: true, id: resendResult.id }
  } else {
    const { accountSid, authToken } = getTwilioCredentials()
    const fromNumber = await resolveSmsFromNumber(input)
    const toNumber = normalizePhone(input.to) || input.to

    const smsRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: toNumber,
        From: fromNumber,
        Body: input.body,
      }).toString(),
    })

    const smsResult = await smsRes.json().catch(() => ({})) as Record<string, unknown>
    if (!smsRes.ok || !smsResult?.sid) {
      throw new Error(String(smsResult?.message || smsResult?.error || 'SMS send failed'))
    }
    result = { ok: true, sid: smsResult.sid, fromNumber, branchLabel: getSaturnBranchLabel(fromNumber) }
    void logSmsToSupabase(fromNumber, toNumber, input.body, input.leadId, String(smsResult.sid || ''))
  }

  const now = new Date().toISOString()
  const log: FollowUpLog = {
    id: uid('fu'),
    leadId: input.leadId,
    quoteId: input.quoteId,
    type: input.channel,
    date: now,
    createdAt: now,
    notes:
      input.notes ||
      (input.channel === 'email'
        ? `Email sent to ${input.to}${input.subject ? ` — ${input.subject}` : ''}`
        : `SMS sent to ${input.to}`),
  }

  const savedLog = await saveFollowUpLog(log)

  let emailRecord: CRMEmail | null = null
  if (input.channel === 'email') {
    emailRecord = await saveSalesEmail({
      id: uid('em'),
      leadId: input.leadId || null,
      quoteId: input.quoteId || null,
      to: input.to,
      from: 'business@starmovers.ca',
      subject: input.subject || 'Saturn Star Moving',
      body: input.body,
      templateType: input.quoteId ? 'quote_sent' : actor === 'automation' ? 'automation' : 'first_contact',
      direction: 'outbound',
      status: 'sent',
      sentAt: now,
    })
  }

  const lead = input.leadId ? await syncLeadMessagingState(input.leadId, actor) : null

  if (input.quoteId && input.leadId && input.channel === 'email') {
    try {
      const currentLead = lead || (await getSalesLead(input.leadId))
      if (currentLead && !currentLead.followUpDate) {
        const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await saveSalesLead({
          ...currentLead,
          followUpDate: tomorrow.toISOString().slice(0, 10),
          followUpNote: currentLead.followUpNote || 'Follow up on sent quote',
        })
      }
    } catch {
      // best-effort
    }
  }

  if (input.leadId && input.body) {
    ;(async () => {
      try {
        const messageLead = lead || (await getSalesLead(input.leadId!))
        if (!messageLead) return

        const allLogs = await listFollowUpLogs()
        const sameLeadMsgLogs = allLogs.filter(
          entry =>
            entry.leadId === input.leadId &&
            (entry.type === 'sms' || entry.type === 'email') &&
            entry.notes
        )

        const thread = sameLeadMsgLogs
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
          .map(entry => ({
            direction: 'outbound' as const,
            text: entry.notes || '',
            date: entry.date,
          }))

        const aiSummary = await summarizeMessage(messageLead, input.body, input.channel, 'outbound', thread)
        if (aiSummary) {
          await saveFollowUpLog({ ...savedLog, aiSummary })
        }

        void logEvent(input.channel === 'sms' ? 'sms_sent' : 'email_sent', {
          leadId: input.leadId,
          lead: messageLead,
          properties: {
            channel: input.channel,
            message_direction: 'outbound',
            message_length: input.body.length,
            thread_length: sameLeadMsgLogs.length,
            has_ai_summary: !!aiSummary,
            move_readiness: aiSummary?.moveReadiness,
            ai_sentiment: aiSummary?.sentiment,
            ai_intent: aiSummary?.intent,
            automation_actor: actor,
          },
        })
      } catch {
        // never fail the send
      }
    })()
  }

  return {
    ok: true,
    result,
    log: savedLog,
    email: emailRecord,
    lead,
  }
}
