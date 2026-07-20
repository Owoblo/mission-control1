import { NextResponse } from 'next/server'
import {
  applyInventoryVerificationToInventory,
  buildInventoryVerificationSummary,
  buildSurveyVerificationPayload,
  canonicalizeSurveyRoomLabel,
} from '@/lib/inventory-verification'
import { uid } from '@/lib/sales'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { sendRepAlertEmail, surveyCompletedEmail } from '@/lib/server/internal-notifications'
import type {
  CRMLead,
  InventoryVerification,
  InventoryVerificationAddedItem,
  InventoryVerificationDecision,
  InventoryVerificationItemChoice,
} from '@/lib/types'

async function getLeadRowByToken(token: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data&data->>surveyToken=eq.${encodeURIComponent(token)}&deleted=not.is.true&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return null
  const rows = await response.json() as Array<{ id: string; data: Record<string, unknown> }>
  return rows[0] || null
}

async function loadLeadByToken(token: string) {
  const row = await getLeadRowByToken(token)
  if (!row) return null

  const expiresAt = row.data.surveyTokenExpiresAt as string | undefined
  if (expiresAt && new Date(expiresAt) < new Date()) {
    return { row, expired: true as const, lead: null }
  }

  const lead = await getSalesLead(row.id)
  if (!lead) return null
  return { row, expired: false as const, lead }
}

function buildRoomBreakdown(items: CRMLead['inventory']) {
  return (items || []).reduce<Record<string, number>>((rooms, item) => {
    if (item.included === false) return rooms
    const room = item.room?.trim() || 'Unassigned'
    rooms[room] = (rooms[room] || 0) + Math.max(1, Number(item.qty || 1))
    return rooms
  }, {})
}

function sanitizeDecision(value: unknown): InventoryVerificationDecision | null {
  return value === 'going' || value === 'not_going' || value === 'unsure' ? value : null
}

function sanitizeItemChoices(input: unknown, fallback: InventoryVerificationItemChoice[] = [], now: string) {
  if (!Array.isArray(input)) return fallback

  const nextChoices: InventoryVerificationItemChoice[] = []
  for (const choice of input) {
    if (!choice || typeof choice !== 'object') continue
    const rawChoice = choice as Record<string, unknown>
    const itemKey = String(rawChoice.itemKey || '').trim()
    const decision = sanitizeDecision(rawChoice.decision)
    if (!itemKey || !decision) continue
    const note = String(rawChoice.note || '').trim() || undefined
    nextChoices.push({
      itemKey,
      decision,
      note,
      updatedAt: now,
      updatedBy: 'customer',
    })
  }

  return nextChoices
}

function sanitizeAddedItems(input: unknown, fallback: InventoryVerificationAddedItem[] = [], now: string) {
  if (!Array.isArray(input)) return fallback

  const nextItems: InventoryVerificationAddedItem[] = []
  for (const item of input) {
    if (!item || typeof item !== 'object') continue
    const rawItem = item as Record<string, unknown>
    const name = String(rawItem.name || '').trim()
    const room = canonicalizeSurveyRoomLabel(String(rawItem.room || '').trim() || 'Unassigned')
    if (!name) continue
    nextItems.push({
      id: String(rawItem.id || uid('inv_verify')),
      room,
      name,
      qty: Math.max(1, Math.min(50, Number(rawItem.qty || 1) || 1)),
      note: String(rawItem.note || '').trim() || undefined,
      createdAt: String(rawItem.createdAt || now),
      createdBy: 'customer',
    })
  }

  return nextItems
}

async function saveVerificationUpdate(
  lead: CRMLead,
  update: {
    itemChoices?: unknown
    addedItems?: unknown
    addressConfirmed?: unknown
    addressMismatchNote?: unknown
    markCompleted?: boolean
  }
) {
  const now = new Date().toISOString()
  const existingVerification = lead.inventoryVerification || {}
  const nextVerification: InventoryVerification = {
    startedAt: existingVerification.startedAt || now,
    lastUpdatedAt: now,
    completedAt: update.markCompleted
      ? (existingVerification.completedAt || now)
      : existingVerification.completedAt,
    addressConfirmed: typeof update.addressConfirmed === 'boolean'
      ? update.addressConfirmed
      : existingVerification.addressConfirmed,
    addressMismatchNote: typeof update.addressMismatchNote === 'string'
      ? (update.addressMismatchNote.trim() || undefined)
      : existingVerification.addressMismatchNote,
    itemChoices: sanitizeItemChoices(update.itemChoices, existingVerification.itemChoices || [], now),
    addedItems: sanitizeAddedItems(update.addedItems, existingVerification.addedItems || [], now),
  }

  const nextInventory = applyInventoryVerificationToInventory(lead.inventory || [], nextVerification)
  const updatedLead: CRMLead = {
    ...lead,
    inventory: nextInventory,
    roomBreakdown: buildRoomBreakdown(nextInventory),
    inventoryVerification: nextVerification,
    surveyCompletedAt: update.markCompleted ? (lead.surveyCompletedAt || now) : lead.surveyCompletedAt,
  }

  return saveSalesLead(updatedLead)
}

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  try {
    const result = await loadLeadByToken(params.token)
    if (!result) return NextResponse.json({ error: 'Invalid or expired survey link' }, { status: 404 })
    if (result.expired) return NextResponse.json({ error: 'This survey link has expired' }, { status: 410 })
    return NextResponse.json(buildSurveyVerificationPayload(result.lead))
  } catch (error) {
    console.error('[survey] GET error', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  try {
    const result = await loadLeadByToken(params.token)
    if (!result) return NextResponse.json({ error: 'Invalid or expired survey link' }, { status: 404 })
    if (result.expired) return NextResponse.json({ error: 'This survey link has expired' }, { status: 410 })

    const body = (await request.json().catch(() => ({}))) as {
      itemChoices?: unknown
      addedItems?: unknown
      addressConfirmed?: unknown
      addressMismatchNote?: unknown
      markCompleted?: boolean
    }

    const updatedLead = await saveVerificationUpdate(result.lead, body)
    return NextResponse.json({
      ok: true,
      verification: updatedLead.inventoryVerification,
      summary: buildInventoryVerificationSummary(updatedLead.inventoryVerification),
      surveyCompletedAt: updatedLead.surveyCompletedAt || null,
    })
  } catch (error) {
    console.error('[survey] PATCH error', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(_request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  try {
    const result = await loadLeadByToken(params.token)
    if (!result) return NextResponse.json({ error: 'Invalid or expired survey link' }, { status: 404 })
    if (result.expired) return NextResponse.json({ error: 'This survey link has expired' }, { status: 410 })

    const updatedLead = await saveVerificationUpdate(result.lead, { markCompleted: true })

    // Notify team — customer completed their survey
    if (updatedLead.name && !result.lead.surveyCompletedAt) {
      void sendRepAlertEmail(
        `📋 ${updatedLead.name} completed their photo survey`,
        surveyCompletedEmail(updatedLead.name, updatedLead.id, updatedLead.surveyPhotoCount || 0)
      ).catch(() => {})
    }

    return NextResponse.json({
      ok: true,
      verification: updatedLead.inventoryVerification,
      surveyCompletedAt: updatedLead.surveyCompletedAt || null,
    })
  } catch (error) {
    console.error('[survey] POST complete error', error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
