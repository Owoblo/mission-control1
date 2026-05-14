import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { readEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'
import type { CRMLead } from '@/lib/types'

export const maxDuration = 30

type ComposeMessage = {
  direction: 'inbound' | 'outbound'
  body?: string
  subject?: string
  created_at?: string
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 })
  }

  const payload = (await request.json()) as {
    lead?: Partial<CRMLead> | null
    smsHistory?: ComposeMessage[]
    emailHistory?: ComposeMessage[]
    goal?: string
    channel?: 'sms' | 'email'
  }

  if (!payload.lead || !payload.channel) {
    return NextResponse.json({ error: 'lead and channel are required' }, { status: 400 })
  }

  const channel = payload.channel
  const goal = (payload.goal || 'follow_up').trim()
  const history = channel === 'sms' ? payload.smsHistory || [] : payload.emailHistory || []
  const leadSummary = {
    name: payload.lead.name,
    stage: payload.lead.stage,
    moveDate: payload.lead.moveDate,
    originCity: payload.lead.originCity,
    destCity: payload.lead.destCity,
    notes: payload.lead.notes,
    inboundMessage: payload.lead.inboundMessage,
    followUpDate: payload.lead.followUpDate,
    followUpNote: payload.lead.followUpNote,
  }

  const systemPrompt = `You write calm, direct customer messages for Saturn Star Moving.

Rules:
- Sound human, not robotic.
- Keep SMS under 420 characters unless the user history requires more detail.
- Keep email concise and useful.
- Never invent pricing, dates, or promises that are not in the lead data.
- Push the conversation toward the next concrete step.
- If the customer already wrote in, acknowledge what they said.
- Return only valid JSON.`

  const userPrompt = `CHANNEL: ${channel}
GOAL: ${goal}
LEAD:
${JSON.stringify(leadSummary, null, 2)}

RECENT HISTORY:
${JSON.stringify(history.slice(-10), null, 2)}

Return JSON:
{
  "draft": "message body only",
  "subject": "only for email when helpful"
}`

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.35,
      max_tokens: 450,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return NextResponse.json({ error: `Smart compose failed: ${detail.slice(0, 200)}` }, { status: 500 })
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content || '{}'

  try {
    const parsed = JSON.parse(content) as { draft?: string; subject?: string }
    return NextResponse.json({ ok: true, draft: parsed.draft || '', subject: parsed.subject || '' })
  } catch {
    return NextResponse.json({ error: 'Failed to parse smart compose response' }, { status: 500 })
  }
}
