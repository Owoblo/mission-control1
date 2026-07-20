import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import type { CRMLead, LeadMediaAsset } from '@/lib/types'

type JobCostRow = {
  id: string
  lead_id: string
  category: string
  description: string | null
  amount_cents: number
  cost_date: string
  created_at: string
  created_by: string
}

function canAccessAssignedCrewJob(lead: CRMLead, session: Awaited<ReturnType<typeof getSessionUser>>) {
  if (!session) return false
  if (session.role === 'owner' || session.role === 'manager' || session.role === 'operations_lead') {
    return true
  }
  if (session.role !== 'crew') return false
  const crewKeys = new Set([session.userId, session.name].filter(Boolean))
  return (lead.assignedCrew || []).some(member => crewKeys.has(member))
}

function categoryLabel(value: string) {
  return value
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function buildReceiptNotes(category: string, amountCents: number | null, notes?: string) {
  const parts = [`Crew expense · ${categoryLabel(category)}`]
  if (amountCents !== null) {
    parts.push(`$${(amountCents / 100).toFixed(2)}`)
  }
  if (notes?.trim()) {
    parts.push(notes.trim())
  }
  return parts.join(' · ')
}

function parseAmountToCents(value: FormDataEntryValue | null) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Enter a valid expense amount.')
  }
  return Math.round(parsed * 100)
}

async function createJobCost(input: {
  leadId: string
  category: string
  description?: string
  amountCents: number
  costDate: string
  createdBy: string
}) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/job_costs`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: uid('jc'),
      lead_id: input.leadId,
      category: input.category,
      description: input.description?.trim() || null,
      amount_cents: input.amountCents,
      cost_date: input.costDate,
      created_by: input.createdBy,
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error('Failed to log the crew expense in finance.')
  }

  const [row] = await response.json() as JobCostRow[]
  return row
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionUser()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    if (!canAccessAssignedCrewJob(lead, session)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const files = (formData.getAll('files') as File[]).filter(Boolean)
    if (files.length === 0) {
      return NextResponse.json({ error: 'Attach at least one receipt or invoice image.' }, { status: 400 })
    }

    const category = String(formData.get('category') || 'other').trim() || 'other'
    const rawNotes = String(formData.get('notes') || '').trim()
    const submissionId = String(formData.get('submission_id') || '').trim()
    if (submissionId && (lead.mediaAssets || []).some(asset => asset.notes?.includes(`[submission:${submissionId}]`))) {
      return NextResponse.json({ ok: true, lead, uploadedCount: 0, createdCost: null, duplicate: true })
    }
    const costDate = String(formData.get('cost_date') || '').trim() || new Date().toISOString().slice(0, 10)
    const amountCents = parseAmountToCents(formData.get('amount'))
    const assetNotes = `${buildReceiptNotes(category, amountCents, rawNotes)}${submissionId ? ` · [submission:${submissionId}]` : ''}`

    let createdCost: JobCostRow | null = null
    if (amountCents !== null) {
      createdCost = await createJobCost({
        leadId: lead.id,
        category,
        description: rawNotes || assetNotes,
        amountCents,
        costDate,
        createdBy: session.userId || session.name || session.role || 'crew',
      })
    }

    const uploadedAssets = await uploadLeadMediaAssets({
      leadId: lead.id,
      namespace: `crew-receipt-${submissionId || Date.now()}`,
      files,
      room: 'Receipts',
      source: 'receipt_upload',
      category: 'receipt',
      uploadedByUserId: session.userId,
      uploadedByName: session.name,
      notes: assetNotes,
    })

    const linkedAssets = createdCost
      ? uploadedAssets.map(asset => ({
          ...asset,
          linkedCostId: createdCost.id,
          linkedCostCategory: createdCost.category,
          linkedCostAmountCents: createdCost.amount_cents,
          linkedAt: new Date().toISOString(),
        } satisfies LeadMediaAsset))
      : uploadedAssets

    const savedLead = await saveSalesLead({
      ...lead,
      mediaAssets: [...(lead.mediaAssets || []), ...linkedAssets],
      lastTouchedAt: new Date().toISOString(),
      lastTouchedByUserId: session.userId || lead.lastTouchedByUserId,
      lastTouchedByName: session.name || lead.lastTouchedByName,
    })

    return NextResponse.json({
      ok: true,
      lead: savedLead,
      uploadedCount: linkedAssets.length,
      createdCost,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload crew expense' },
      { status: 400 }
    )
  }
}
