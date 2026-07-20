export const maxDuration = 60

import { NextResponse } from 'next/server'
import { synthesizeLeadIntelligence } from '@/lib/server/call-intelligence'
import { getLatestSalesQuoteByLeadId, getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getWorkerSharedSecret, requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'
import { normalizePhone } from '@/lib/sales-phones'

function isInternalRequest(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  const expected = getWorkerSharedSecret()
  return !!secret && !!expected && secret === expected
}

async function fetchLeadSmsMessages(phone: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    // Normalize to E.164 (+15196351744) — Twilio always stores in this format.
    // Also query the bare 10-digit version in case some messages were saved without +1.
    const e164 = normalizePhone(phone) || phone
    const digits10 = phone.replace(/\D/g, '').slice(-10)
    const bare = digits10.length === 10 ? digits10 : null

    const enc164 = encodeURIComponent(e164)
    // Build an OR across both formats so we never miss messages regardless of how they were stored
    const orClause = bare && bare !== e164
      ? `or=(from_number.eq.${enc164},to_number.eq.${enc164},from_number.eq.${encodeURIComponent(bare)},to_number.eq.${encodeURIComponent(bare)})`
      : `or=(from_number.eq.${enc164},to_number.eq.${enc164})`

    const res = await fetch(
      `${url}/rest/v1/sms_messages?select=direction,body,created_at&${orClause}&order=created_at.asc&limit=200`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) return []
    return (await res.json()) as Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>
  } catch {
    return []
  }
}

async function fetchLeadEmailMessages(email: string) {
  try {
    const { url, headers } = requireSupabaseEnv()
    const enc = encodeURIComponent(email.toLowerCase())
    const res = await fetch(
      `${url}/rest/v1/email_messages?select=direction,subject,body_preview,created_at&or=(from_address.ilike.${enc},to_address.ilike.${enc})&order=created_at.asc&limit=100`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) return []
    return (await res.json()) as Array<{ direction: 'inbound' | 'outbound'; subject?: string; body_preview?: string; created_at: string }>
  } catch {
    return []
  }
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    return NextResponse.json({ intelligence: lead.intelligence || null })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const internal = isInternalRequest(_req)
    if (!internal) {
      const session = await getSessionUser()
      if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const [smsMessages, emailMessages, latestQuote] = await Promise.all([
      lead.phone ? fetchLeadSmsMessages(lead.phone) : Promise.resolve([]),
      lead.email ? fetchLeadEmailMessages(lead.email) : Promise.resolve([]),
      getLatestSalesQuoteByLeadId(lead.id).catch(() => null),
    ])

    const intelligence = await synthesizeLeadIntelligence(lead, {
      smsMessages,
      emailMessages,
      quoteSentAt: latestQuote?.sentAt || undefined,
      quoteAmount: latestQuote?.total || undefined,
      quoteStatus: latestQuote?.status || undefined,
    })

    if (!intelligence) {
      return NextResponse.json({ error: 'Intelligence synthesis failed — check OPENAI_API_KEY' }, { status: 422 })
    }

    const explicitFollowUpDate = intelligence.followUpAt?.slice(0, 10)
    const scheduledFollowUpDate = intelligence.followUpSchedule.find(item => item.dueDate)?.dueDate
    const autoFollowUpDate = explicitFollowUpDate || (!lead.followUpDate ? scheduledFollowUpDate : undefined)
    const autoFollowUpNote =
      intelligence.followUpNote ||
      intelligence.followUpSchedule.find(item => item.script)?.script ||
      intelligence.nextActionDetail ||
      intelligence.nextAction

    const saved = await saveSalesLead({
      ...lead,
      intelligence,
      followUpDate:
        lead.stage === 'booked' || lead.stage === 'lost'
          ? undefined
          : autoFollowUpDate || lead.followUpDate,
      followUpNote:
        lead.stage === 'booked' || lead.stage === 'lost'
          ? undefined
          : autoFollowUpNote || lead.followUpNote,
    })
    return NextResponse.json({ intelligence: saved.intelligence })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
