/**
 * POST /api/sales/leads/call-brief
 * Generates an AI pre-call brief for a lead: what happened, context, talking points.
 */
import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getLatestSalesQuoteByLeadId } from '@/lib/server/sales-repository'
import { readEnv } from '@/lib/server/runtime'
import { formatMoney } from '@/lib/sales'

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leadId } = (await request.json()) as { leadId?: string }
  if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  const [lead, quote] = await Promise.all([
    getSalesLead(leadId),
    getLatestSalesQuoteByLeadId(leadId).catch(() => null),
  ])
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Build context from available data
  const parts: string[] = []

  // Identity
  parts.push(`Customer: ${lead.name || 'Unknown'}${lead.phone ? ` (${lead.phone})` : ''}`)

  // Move details
  if (lead.originCity || lead.destCity) {
    parts.push(`Move: ${lead.originCity || '?'} → ${lead.destCity || '?'}${lead.moveDate ? `, date: ${lead.moveDate}` : ', date not set'}`)
  }
  if (lead.moveType) parts.push(`Type: ${lead.moveType}`)
  if (lead.totalCubicFeet) parts.push(`Volume: ~${lead.totalCubicFeet} cu ft`)

  // Quote status
  if (quote) {
    const status = quote.status
    const total = quote.total ? formatMoney(quote.total) : null
    const sentAt = quote.sentAt?.slice(0, 10)
    const viewedAt = quote.viewedAt?.slice(0, 10)
    if (status === 'accepted') {
      parts.push(`Quote: ACCEPTED — ${total ? `${total}` : ''} — move is booked`)
    } else if (status === 'declined') {
      parts.push(`Quote: DECLINED by customer`)
    } else if (viewedAt) {
      parts.push(`Quote: sent ${total ? `${total} ` : ''}on ${sentAt}, VIEWED by customer on ${viewedAt} — no response yet`)
    } else if (sentAt) {
      parts.push(`Quote: sent ${total ? `${total} ` : ''}on ${sentAt} — NOT yet viewed`)
    } else {
      parts.push(`Quote: drafted but not sent`)
    }
  } else {
    parts.push(`Quote: none sent yet`)
  }

  // Stage
  const stageLabels: Record<string, string> = {
    new: 'Brand new lead — no contact yet',
    contacted: 'Rep has spoken with them',
    pricing: 'Currently building a quote',
    nurture: 'Shopping around / undecided',
    quoted: 'Quote sent, awaiting decision',
    booked: 'Job booked',
  }
  if (lead.stage) parts.push(`Stage: ${stageLabels[lead.stage] || lead.stage}`)

  // Last follow-up note
  if (lead.followUpNote) parts.push(`Last note: "${lead.followUpNote}"`)

  // Call history
  const calls = lead.callLogs || []
  if (calls.length > 0) {
    const last = calls[0]
    const lastCallDir = last.direction === 'inbound' ? 'they called us' : 'we called them'
    parts.push(`Last call: ${last.date?.slice(0, 10) || 'unknown date'} (${lastCallDir})${last.notes ? ` — ${last.notes.slice(0, 100)}` : ''}`)
  }

  // Source
  if (lead.source) parts.push(`Source: ${lead.source}`)

  const context = parts.join('\n')

  const prompt = `You are a sales coach for Saturn Star Moving Company, a professional moving company in Windsor/Ontario.

A sales rep is about to follow up with a customer. Based on the context below, give them a pre-call brief: 3-5 short bullet points that:
1. Summarize the situation (what's happened so far)
2. Flag any key signals (viewed quote but no response, customer said X, long silence)
3. Give 1 concrete talking point or approach for this specific call

Be direct, actionable, and specific to this customer. No fluff. Use plain language like a colleague briefing another colleague.

Customer context:
${context}

Return ONLY the bullet points, one per line, starting with a bullet character (•). No intro text.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 300,
        temperature: 0.4,
      }),
    })

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      error?: { message?: string }
    }

    if (!res.ok || data.error) {
      return NextResponse.json({ error: data.error?.message || 'AI failed' }, { status: 500 })
    }

    const raw = data.choices?.[0]?.message?.content?.trim() || ''
    const bullets = raw
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('•') || l.startsWith('-') || l.startsWith('*'))
      .map(l => l.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean)

    return NextResponse.json({ ok: true, bullets, context: parts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 })
  }
}
