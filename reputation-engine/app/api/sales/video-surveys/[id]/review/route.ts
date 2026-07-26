import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import {
  appendVideoSurveyEvent,
  getVideoSurveySession,
  listVideoSurveyEvidence,
  listVideoSurveyMarkers,
  listVideoSurveyRecordings,
  updateVideoSurveyEvidence,
  updateVideoSurveySession,
} from '@/lib/server/video-survey-repository'
import { normalizeLead, uid } from '@/lib/sales'
import { videoInventoryDedupeKey } from '@/lib/video-survey-analysis'
import type { InventoryItem } from '@/lib/types'
import { randomToken } from '@/lib/server/security'
import { getAppBaseUrl } from '@/lib/server/runtime'

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  const session = await getVideoSurveySession(id)
  if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
  const [evidence, recordings, markers] = await Promise.all([
    listVideoSurveyEvidence(id),
    listVideoSurveyRecordings(id),
    listVideoSurveyMarkers(id),
  ])
  return NextResponse.json({ session, evidence, recordings, markers })
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await props.params
  const session = await getVideoSurveySession(id)
  if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as {
    evidenceId?: string
    reviewStatus?: 'approved' | 'rejected' | 'merged' | 'edited'
    itemName?: string
    room?: string
    quantity?: number
    disposition?: 'moving' | 'staying' | 'uncertain'
    cubicFeet?: number
    weightLbs?: number
  }
  if (!body.evidenceId || !body.reviewStatus) {
    return NextResponse.json({ error: 'Evidence and review decision are required.' }, { status: 400 })
  }
  const evidence = await updateVideoSurveyEvidence(body.evidenceId, {
    review_status: body.reviewStatus,
    reviewed_by_user_id: user?.userId,
    reviewed_at: new Date().toISOString(),
    ...(body.itemName ? { item_name: body.itemName.slice(0, 160) } : {}),
    ...(body.room ? { room: body.room.slice(0, 100) } : {}),
    ...(Number.isFinite(body.quantity) ? { quantity: Math.max(1, Math.round(Number(body.quantity))) } : {}),
    ...(body.disposition ? { disposition: body.disposition } : {}),
    ...(Number.isFinite(body.cubicFeet) ? { estimated_cubic_feet: Math.max(0, Number(body.cubicFeet)) } : {}),
    ...(Number.isFinite(body.weightLbs) ? { estimated_weight_lbs: Math.max(0, Number(body.weightLbs)) } : {}),
  })
  await appendVideoSurveyEvent({
    sessionId: id,
    type: `evidence.${body.reviewStatus}`,
    actorType: 'rep',
    actorId: user?.userId,
    payload: { evidenceId: body.evidenceId },
  })
  return NextResponse.json({ evidence })
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser()
    if (!canAccessSalesWorkspace(user)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const session = await getVideoSurveySession(id)
    if (!session) return NextResponse.json({ error: 'Video survey not found.' }, { status: 404 })
    const body = await request.json().catch(() => ({})) as { action?: string }
    if (body.action !== 'apply_approved_inventory') {
      return NextResponse.json({ error: 'Invalid review action.' }, { status: 400 })
    }
    const [lead, evidence] = await Promise.all([
      getSalesLead(session.leadId),
      listVideoSurveyEvidence(id),
    ])
    if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
    const approved = evidence.filter(item =>
      ['approved', 'edited'].includes(String(item.review_status)) &&
      String(item.disposition) === 'moving'
    )
    if (!approved.length) {
      return NextResponse.json({ error: 'Approve at least one moving item first.' }, { status: 409 })
    }
    const unresolved = evidence.filter(item =>
      String(item.review_status) === 'pending' || String(item.disposition) === 'uncertain'
    )
    if (unresolved.length) {
      return NextResponse.json({ error: `Resolve ${unresolved.length} uncertain or unreviewed item${unresolved.length === 1 ? '' : 's'} first.` }, { status: 409 })
    }

    const existing = Array.isArray(lead.inventory) ? [...lead.inventory] : []
    const byKey = new Map(existing.map((item, index) => [
      videoInventoryDedupeKey({ room: item.room || 'Unassigned', itemName: item.name || item.item || '' }),
      index,
    ]))
    for (const row of approved) {
      const key = videoInventoryDedupeKey({
        room: String(row.room || 'Unassigned'),
        itemName: String(row.item_name || ''),
      })
      const item: InventoryItem = {
        id: uid('inv_video'),
        name: String(row.item_name || 'Item'),
        qty: Math.max(1, Number(row.quantity || 1)),
        room: String(row.room || 'Unassigned'),
        cubicFeet: Math.max(0, Number(row.estimated_cubic_feet || 0)),
        weightLbs: Math.max(0, Number(row.estimated_weight_lbs || 0)),
        included: true,
        confidence: Number(row.confidence || 0),
        source: 'survey_ai',
        notes: `Video survey evidence ${String(row.id)}`,
      }
      const existingIndex = byKey.get(key)
      if (existingIndex == null) {
        byKey.set(key, existing.length)
        existing.push(item)
      } else {
        existing[existingIndex] = {
          ...existing[existingIndex],
          qty: Math.max(Number(existing[existingIndex].qty || 1), item.qty || 1),
          cubicFeet: Math.max(Number(existing[existingIndex].cubicFeet || 0), Number(item.cubicFeet || 0)),
          weightLbs: Math.max(Number(existing[existingIndex].weightLbs || 0), Number(item.weightLbs || 0)),
          notes: [existing[existingIndex].notes, item.notes].filter(Boolean).join(' · '),
        }
      }
    }
    const included = existing.filter(item => item.included !== false)
    const verificationToken = randomToken('surv')
    const verificationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const updatedLead = normalizeLead({
      ...lead,
      inventory: existing,
      totalItems: included.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0),
      totalCubicFeet: included.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0),
      totalWeightLbs: included.reduce((sum, item) => sum + Number(item.weightLbs || 0) * Math.max(1, Number(item.qty || 1)), 0),
      inventoryVerification: {
        ...(lead.inventoryVerification || {}),
        startedAt: lead.inventoryVerification?.startedAt || new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      },
      surveyToken: verificationToken,
      surveyTokenExpiresAt: verificationExpiresAt,
      surveyRequestedAt: lead.surveyRequestedAt || new Date().toISOString(),
    })
    await saveSalesLead(updatedLead)
    await updateVideoSurveySession(id, {
      status: 'completed',
      metadata: {
        ...(session.metadata || {}),
        approvedInventoryAppliedAt: new Date().toISOString(),
        approvedInventoryCount: approved.length,
      },
    })
    await appendVideoSurveyEvent({
      sessionId: id,
      type: 'inventory.applied_to_lead',
      actorType: 'rep',
      actorId: user?.userId,
      payload: { approvedCount: approved.length, unresolvedCount: 0 },
    })
    return NextResponse.json({
      ok: true,
      lead: updatedLead,
      applied: approved.length,
      verificationUrl: `${getAppBaseUrl('https://go.quote2move.com')}/survey/${verificationToken}`,
    })
  } catch (error) {
    console.error('[video-survey/review-apply]', error)
    return NextResponse.json({ error: 'Could not apply reviewed inventory.' }, { status: 500 })
  }
}
