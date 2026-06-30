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

function isRetryableOpenAiNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  const cause = (error as { cause?: { code?: string; message?: string } })?.cause
  return message.includes('terminated') ||
    message.includes('ECONNRESET') ||
    cause?.code === 'ECONNRESET' ||
    cause?.message?.includes('ECONNRESET')
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
  // Build richer context — the more the model knows, the more specific the message
  const l = payload.lead
  const missingFields: string[] = []
  if (!l.moveDate) missingFields.push('move date')
  if (!l.destCity && !l.destAddress) missingFields.push('destination')
  if (!l.originAddress && !l.originCity) missingFields.push('origin address')
  if (!l.jobFactors?.packingStatus) missingFields.push('packing status')
  if (!l.email) missingFields.push('email address')

  const leadSummary = {
    name: l.name,
    stage: l.stage,
    moveType: l.moveType,
    moveDate: l.moveDate,
    origin: [l.originAddress, l.originCity].filter(Boolean).join(', ') || null,
    destination: [l.destAddress, l.destCity].filter(Boolean).join(', ') || null,
    inventoryItems: l.totalItems || null,
    cubicFeet: l.totalCubicFeet || null,
    packingStatus: l.jobFactors?.packingStatus || null,
    estimatedBoxes: l.jobFactors?.estimatedBoxes || null,
    quoteStatus: l.quoteId ? l.stage : null,
    notes: l.notes,
    followUpNote: l.followUpNote,
    inboundMessage: l.inboundMessage,
    missingToFinalizeQuote: missingFields.length > 0 ? missingFields : null,
  }

  const systemPrompt = `ROLE
You write follow-up SMS and email messages for Saturn Star Moving sales reps. Your job is to move a quoted lead toward booking — not to provide customer service. Every message must sound like a confident closer who knows their value, never like someone begging for a reply.

HARD RULES — NEVER DO THESE
- Never write "feel free to reach out," "let me know how I can help," "just checking in," "no pressure," "whenever you get a chance," or any passive service-desk phrasing.
- Never apologize for following up or for existing.
- Never end a message without a single, specific question or a clear next step.
- Never bury the most important leverage at the bottom — lead with it.
- Never sound generic. Reference the customer's actual situation, route, or last conversation.

ALWAYS DO THESE
- Open with context that proves you remember them (their route, their date, what they said last).
- Lead with the binding estimate as the core differentiator whenever price or competitors are in play: the price is locked, no surprise fees, no fuel/truck charges at the end — most cheaper quotes are not binding.
- Create one real, honest reason to respond now (date is held but can't be held indefinitely; need one piece of info to lock the binding price; crew availability). Keep urgency truthful — never manufacture pressure that isn't real.
- Close with ONE easy yes/no or either/or question the customer can answer in seconds (e.g. "are you packing yourself or do you want us to bring the boxes?").
- Keep SMS to 3-5 short sentences. Keep it warm but direct — like a trusted expert who has done this a thousand times.
- End by stating you'll get them confirmed/booked once they answer.

TONE
Direct, calm, confident. Warm but not soft. You are the guide who has it handled, not a clerk waiting to be told what to do. Speed and certainty win moves.

CHANNEL RULES
- SMS: 3-5 short sentences, max 400 characters. No subject line.
- Email: Slightly fuller, still direct. Include a subject line that creates a reason to open (not "Follow up" — something specific to their move).

Return only valid JSON.`

  const userPrompt = `CHANNEL: ${channel}
GOAL: ${goal}

LEAD CONTEXT:
${JSON.stringify(leadSummary, null, 2)}

RECENT CONVERSATION HISTORY:
${JSON.stringify(history.slice(-10), null, 2)}

Return JSON with exactly:
{
  "draft": "message body only — ready to send, no preamble",
  "subject": "required for email, omit for SMS"
}`

  let response: Response
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.4,
        max_tokens: 600,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: AbortSignal.timeout(25000),
    })
  } catch (error) {
    const message = isRetryableOpenAiNetworkError(error)
      ? 'Smart compose connection reset. Please try again.'
      : 'Smart compose could not reach OpenAI. Please try again.'
    return NextResponse.json({ error: message, retryable: true }, { status: 502 })
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return NextResponse.json({ error: `Smart compose failed: ${detail.slice(0, 200)}` }, { status: 502 })
  }

  let content = '{}'
  try {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    content = data.choices?.[0]?.message?.content || '{}'
  } catch (error) {
    const message = isRetryableOpenAiNetworkError(error)
      ? 'Smart compose connection reset. Please try again.'
      : 'Smart compose returned an unreadable response. Please try again.'
    return NextResponse.json({ error: message, retryable: true }, { status: 502 })
  }

  try {
    const parsed = JSON.parse(content) as { draft?: string; subject?: string }
    return NextResponse.json({ ok: true, draft: parsed.draft || '', subject: parsed.subject || '' })
  } catch {
    return NextResponse.json({ error: 'Failed to parse smart compose response' }, { status: 500 })
  }
}
