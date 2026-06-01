import { NextResponse } from 'next/server'
import { getSalesLead, listFollowUpLogs } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { LOST_REASONS } from '@/lib/sales'
import { readEnv } from '@/lib/server/runtime'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const lead = await getSalesLead(params.id)
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  // Collect SMS/call context — last 10 entries, most recent first
  const allLogs = await listFollowUpLogs().catch(() => [])
  const leadLogs = allLogs
    .filter(l => l.leadId === params.id && (l.type === 'sms' || l.type === 'call' || l.type === 'note'))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10)

  const callNotes = (lead.callLogs || [])
    .filter(c => c.notes || c.aiSummary?.summary)
    .slice(-5)
    .map(c => `[Call] ${c.notes || c.aiSummary?.summary || ''}`)

  const smsLines = leadLogs
    .filter(l => l.type === 'sms')
    .map(l => `[SMS] ${l.notes || ''}`)

  const noteLines = leadLogs
    .filter(l => l.type === 'note' || l.type === 'call')
    .map(l => `[Note] ${l.notes || ''}`)

  const context = [...callNotes, ...smsLines, ...noteLines].join('\n').trim()

  if (!context) {
    return NextResponse.json({ suggestedReason: null, suggestedNotes: '', confidence: 'low' })
  }

  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return NextResponse.json({ suggestedReason: null, suggestedNotes: '', confidence: 'low' })

  const reasonList = LOST_REASONS.map(r => `- ${r.id}: ${r.label}`).join('\n')

  const prompt = `You are a CRM assistant for a moving company. A sales rep is marking this lead as lost.

Lead: ${lead.name || 'Unknown'} | Stage: ${lead.stage}

Recent activity (SMS, calls, notes):
${context}

Loss reason options:
${reasonList}

Based ONLY on the above activity, pick the single best loss reason ID and write a short rep-facing note (1–2 sentences, plain English, what the customer actually said or signalled). If there is no clear evidence, return null for reason.

Respond with valid JSON only: { "reason": "<id or null>", "notes": "<short note>" }`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 120,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    })

    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    const raw = data.choices?.[0]?.message?.content || '{}'
    const parsed = JSON.parse(raw) as { reason?: string | null; notes?: string }
    const validReason = LOST_REASONS.find(r => r.id === parsed.reason) ? parsed.reason : null

    return NextResponse.json({
      suggestedReason: validReason ?? null,
      suggestedNotes: parsed.notes || '',
      confidence: validReason ? 'high' : 'low',
    })
  } catch {
    return NextResponse.json({ suggestedReason: null, suggestedNotes: '', confidence: 'low' })
  }
}
