import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { defaultFollowUpDate } from '@/lib/marketing'
import { getAppBaseUrl, readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { activateAffiliatePartner } from '@/lib/server/affiliate-bridge'
import { syncPartnershipActionToSheet, type PartnershipSheetAction } from '@/lib/server/partnership-sheet-sync'

type SheetUpdateAction = PartnershipSheetAction

interface MarketContact {
  id: string
  name: string | null
  company: string | null
  title: string | null
  email: string | null
  phone: string | null
  address?: string | null
  city: string | null
  industry: string | null
  stage: string | null
  decision: string | null
  batch_id: string | null
  next_follow_up: string | null
}

interface SheetContactUpdates {
  name?: string | null
  company?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  industry?: string | null
  stage?: string | null
  next_follow_up?: string | null
}

interface MarketTouch {
  id: string
  channel: string | null
  direction: string | null
  notes: string | null
  created_by: string | null
  created_at: string
}

interface AiSheetUpdate {
  action: SheetUpdateAction
  actionLabel: string
  status: string
  relationshipSummary: string
  nextStep: string
  sheetNote: string
  sheetTarget: string
}

const ACTION_LABELS: Record<SheetUpdateAction, string> = {
  active_partner: 'Active partner',
  drop_cards: 'Drop cards',
  meeting_requested: 'Meeting requested',
  needs_follow_up: 'Needs follow-up',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
}

const CONTACT_UPDATE_FIELDS = new Set<keyof SheetContactUpdates>([
  'name',
  'company',
  'title',
  'email',
  'phone',
  'address',
  'city',
  'industry',
  'stage',
  'next_follow_up',
])

function workflowUpdatesForAction(action: SheetUpdateAction, now: string): Record<string, unknown> {
  if (action === 'active_partner') {
    return {
      decision: 'agreed',
      stage: 'partnership_active',
      pipeline_phase: 'maintenance',
      sequence_paused: true,
      sequence_paused_reason: 'sheet_update:active_partner',
      partnership_outcome: 'secured',
      partnership_outcome_at: now,
      partnership_started_at: now,
      account_status: 'active',
      next_follow_up: null,
    }
  }
  if (action === 'drop_cards') {
    return {
      stage: 'qualified',
      pipeline_phase: 'field_visit',
      sequence_paused: true,
      sequence_paused_reason: 'sheet_update:drop_cards',
      next_follow_up: defaultFollowUpDate(now, 3),
    }
  }
  if (action === 'meeting_requested') {
    return {
      stage: 'qualified',
      pipeline_phase: 'field_visit',
      sequence_paused: true,
      sequence_paused_reason: 'sheet_update:meeting_requested',
      next_follow_up: defaultFollowUpDate(now, 1),
    }
  }
  if (action === 'needs_follow_up') {
    return {
      stage: 'follow_up_due',
      pipeline_phase: 'nurture',
      sequence_paused: true,
      sequence_paused_reason: 'sheet_update:needs_follow_up',
      next_follow_up: defaultFollowUpDate(now, 2),
    }
  }
  if (action === 'not_interested') {
    return {
      decision: 'rejected',
      stage: 'closed_lost',
      pipeline_phase: 'removed',
      sequence_paused: true,
      sequence_paused_reason: 'sheet_update:not_interested',
      partnership_outcome: 'declined',
      partnership_outcome_at: now,
      account_status: 'closed',
      next_follow_up: null,
    }
  }
  return {
    decision: 'bad_number',
    stage: 'dnc',
    pipeline_phase: 'removed',
    sequence_paused: true,
    sequence_paused_reason: 'sheet_update:wrong_number',
    account_status: 'closed',
    next_follow_up: null,
  }
}

function fallbackActionFromInstruction(instruction: string): SheetUpdateAction {
  const text = instruction.toLowerCase()
  if (/\b(active partner|active partners|partner secured|partnership active|agreed|won)\b/.test(text)) return 'active_partner'
  if (/\b(drop|bring|deliver).{0,24}\b(card|cards|flyer|flyers|brochure|brochures)\b/.test(text)) return 'drop_cards'
  if (/\b(meeting|appointment|book|schedule|come by|drop by)\b/.test(text)) return 'meeting_requested'
  if (/\b(not interested|declined|rejected|pass|closed lost)\b/.test(text)) return 'not_interested'
  if (/\b(wrong number|bad number|not the right number)\b/.test(text)) return 'wrong_number'
  return 'needs_follow_up'
}

function compactTouches(touches: MarketTouch[]) {
  return touches
    .slice(-80)
    .map(touch => {
      const when = new Date(touch.created_at).toISOString()
      const direction = touch.direction || 'unknown'
      const channel = touch.channel || 'note'
      const author = touch.created_by ? ` by ${touch.created_by}` : ''
      const note = (touch.notes || '').replace(/\s+/g, ' ').trim()
      return `[${when}] ${channel} ${direction}${author}: ${note || '(no body)'}`
    })
    .join('\n')
}

function extractJsonObject(value: string) {
  const trimmed = value.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const match = trimmed.match(/\{[\s\S]*\}/)
  return match?.[0] || '{}'
}

function normalizeAiResult(parsed: Partial<AiSheetUpdate>, instruction: string, touches: MarketTouch[]): AiSheetUpdate {
  const action = parsed.action && ACTION_LABELS[parsed.action] ? parsed.action : fallbackActionFromInstruction(instruction)
  const latestInbound = [...touches].reverse().find(touch => touch.direction === 'inbound')
  const fallbackSummary = latestInbound?.notes
    ? `Latest inbound reply: ${latestInbound.notes}`
    : touches.length > 0
      ? `Conversation has ${touches.length} logged touch${touches.length === 1 ? '' : 'es'}.`
      : 'No conversation history is logged yet.'

  return {
    action,
    actionLabel: parsed.actionLabel?.trim() || ACTION_LABELS[action],
    status: parsed.status?.trim() || ACTION_LABELS[action],
    relationshipSummary: parsed.relationshipSummary?.trim() || fallbackSummary,
    nextStep: parsed.nextStep?.trim() || 'Review this partner and follow up manually from the partnership inbox.',
    sheetNote: parsed.sheetNote?.trim() || parsed.nextStep?.trim() || 'Review this partner and follow up manually from the partnership inbox.',
    sheetTarget: parsed.sheetTarget?.trim() || 'Use the rep instruction and action to choose the closest partnership sheet section.',
  }
}

async function analyzeSheetUpdate(input: {
  instruction: string
  contact: MarketContact
  touches: MarketTouch[]
}): Promise<AiSheetUpdate> {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) {
    throw new Error('OpenAI is not configured, so the sheet was not updated.')
  }

  const model = readEnv('OPENAI_AUTOMATION_MODEL') || 'gpt-4o-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You update a Saturn Star Movers partnership Google Sheet from a manual rep instruction.',
            'Use only the supplied contact and conversation history.',
            'Return JSON only with keys: action, actionLabel, status, relationshipSummary, nextStep, sheetNote, sheetTarget.',
            'action must be one of: active_partner, drop_cards, meeting_requested, needs_follow_up, not_interested, wrong_number.',
            'relationshipSummary should be concise, specific, and explain where the relationship currently stands.',
            'nextStep should be an internal task for the CRM.',
            'sheetNote is the exact concise note that should be written into the Google Sheet Notes cell.',
            'sheetNote must summarize what to do next with this partner based on the conversation, not recap the whole conversation.',
            'Use plain task language such as "Drop by their office to meet them and bring cards/flyers."',
            'sheetTarget should describe where the rep wants this placed in the sheet when the instruction names a page, tab, list, section, or future destination.',
          ].join(' '),
        },
        {
          role: 'user',
          content: [
            `Rep instruction:\n${input.instruction}`,
            `Contact:\n${JSON.stringify(input.contact, null, 2)}`,
            `Conversation history, oldest to newest:\n${compactTouches(input.touches) || '(none)'}`,
          ].join('\n\n'),
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`OpenAI sheet update analysis failed: ${response.status}`)
  }

  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = payload.choices?.[0]?.message?.content || '{}'
  const parsed = JSON.parse(extractJsonObject(content)) as Partial<AiSheetUpdate>
  return normalizeAiResult(parsed, input.instruction, input.touches)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({})) as {
    instruction?: string
    action?: SheetUpdateAction
    sheet_note?: string
    sheet_target?: string
    contact_updates?: SheetContactUpdates
  }
  const instruction = body.instruction?.trim()
  const contactUpdates = body.contact_updates || {}
  const hasStructuredUpdate = Boolean(
    body.action ||
    body.sheet_note?.trim() ||
    body.sheet_target?.trim() ||
    Object.values(contactUpdates).some(value => value !== undefined)
  )
  if (!instruction && !hasStructuredUpdate) {
    return NextResponse.json({ error: 'Add a note, status, or contact update for this partner.' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const [contactRes, touchesRes] = await Promise.all([
    fetch(
      `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=id,name,company,title,email,phone,address,city,industry,stage,decision,batch_id,next_follow_up&limit=1`,
      { headers, cache: 'no-store' }
    ),
    fetch(
      `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(id)}&select=id,channel,direction,notes,created_by,created_at&order=created_at.asc&limit=200`,
      { headers, cache: 'no-store' }
    ),
  ])

  if (!contactRes.ok) return NextResponse.json({ error: 'Could not load partner' }, { status: 500 })
  if (!touchesRes.ok) return NextResponse.json({ error: 'Could not load conversation' }, { status: 500 })

  const [contact] = await contactRes.json() as MarketContact[]
  if (!contact) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })

  const touches = await touchesRes.json() as MarketTouch[]
  const now = new Date().toISOString()
  let ai: AiSheetUpdate
  if (instruction) {
    try {
      ai = await analyzeSheetUpdate({ instruction, contact, touches })
    } catch {
      ai = normalizeAiResult({}, instruction, touches)
    }
  } else {
    const action = body.action && ACTION_LABELS[body.action] ? body.action : 'needs_follow_up'
    ai = {
      action,
      actionLabel: ACTION_LABELS[action],
      status: ACTION_LABELS[action],
      relationshipSummary: body.sheet_note?.trim() || 'Manual CRM update from partnership desk.',
      nextStep: body.sheet_note?.trim() || 'Review this partner and follow up manually from the partnership inbox.',
      sheetNote: body.sheet_note?.trim() || 'Manual CRM update from partnership desk.',
      sheetTarget: body.sheet_target?.trim() || 'Partnership CRM',
    }
  }
  const sheetNote = ai.sheetNote
  const internalNote = [
    instruction ? `Manual instruction: ${instruction}` : '',
    `Sheet target: ${ai.sheetTarget}`,
    `Relationship summary: ${ai.relationshipSummary}`,
    `Next sheet note: ${sheetNote}`,
  ].filter(Boolean).join('\n')

  const sanitizedUpdates = Object.fromEntries(
    Object.entries(contactUpdates)
      .filter(([key, value]) => CONTACT_UPDATE_FIELDS.has(key as keyof SheetContactUpdates) && value !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' && value.trim() === '' ? null : value])
  )
  const shouldApplyWorkflowAction = Boolean(body.action || (instruction && ai.action !== 'needs_follow_up'))
  const contactPatch = {
    ...(shouldApplyWorkflowAction ? workflowUpdatesForAction(ai.action, now) : {}),
    ...sanitizedUpdates,
    last_touch_at: now,
  }

  let updatedContact = contact
  if (Object.keys(contactPatch).length > 1) {
    const updateRes = await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=*`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(contactPatch),
    })
    if (!updateRes.ok) return NextResponse.json({ error: 'Could not update partner fields' }, { status: 500 })
    const [nextContact] = await updateRes.json() as MarketContact[]
    if (nextContact) updatedContact = nextContact
  }

  const syncResult = await syncPartnershipActionToSheet({
    timestamp: now,
    action: ai.action,
    action_label: ai.actionLabel,
    status: ai.status,
    next_step: sheetNote,
    rep: session.name ?? 'Rep',
    latest_message: null,
    latest_message_at: null,
    sheet_note: sheetNote,
    sheet_target: ai.sheetTarget,
    routing_instruction: instruction,
    app_contact_url: getAppBaseUrl()
      ? `${getAppBaseUrl()}/marketing/partners?tab=phone&contact=${encodeURIComponent(id)}`
      : null,
    contact: {
      id,
      name: updatedContact.name ?? null,
      company: updatedContact.company ?? null,
      title: updatedContact.title ?? null,
      city: updatedContact.city ?? null,
      address: updatedContact.address ?? null,
      phone: updatedContact.phone ?? null,
      email: updatedContact.email ?? null,
      industry: updatedContact.industry ?? null,
      stage: updatedContact.stage ?? null,
      decision: updatedContact.decision ?? null,
      batch_id: updatedContact.batch_id ?? null,
      next_follow_up: updatedContact.next_follow_up ?? null,
    },
  }).catch(() => ({ configured: true, ok: false }))

  await fetch(`${url}/rest/v1/market_touches`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({
      contact_id: id,
      channel: 'note',
      direction: 'internal',
      notes: `Manual sheet update completed.\n${internalNote}`,
      outcome_code: `sheet_update:${ai.action}`,
      next_step: ai.nextStep,
      metadata: {
        source: 'manual_partnership_sheet_update',
        action: ai.action,
        instruction: instruction || null,
        contactUpdates: sanitizedUpdates,
        workflowApplied: shouldApplyWorkflowAction,
        relationshipSummary: ai.relationshipSummary,
        sheetNote,
        sheetTarget: ai.sheetTarget,
        sheetSyncConfigured: syncResult.configured,
        sheetSyncOk: syncResult.ok,
      },
      created_by: session.name ?? 'Rep',
      created_at: now,
    }),
  })

  if (shouldApplyWorkflowAction && ai.action === 'active_partner') {
    void activateAffiliatePartner(id).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    action: ai.action,
    label: ai.actionLabel,
    status: ai.status,
    summary: ai.relationshipSummary,
    nextStep: ai.nextStep,
    sheetNote,
    sheetTarget: ai.sheetTarget,
    sheetSyncConfigured: syncResult.configured,
    sheetSyncOk: syncResult.ok,
    contact: updatedContact,
  })
}
