import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSalesLead, listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'
import type { CRMLead, LeadMediaAsset } from '@/lib/types'

interface JobCost {
  id: string
  lead_id: string
  category: string
  description: string | null
  amount_cents: number
  cost_date: string
  created_at: string
  created_by: string
  linkedReceiptCount?: number
}

interface ReceiptUploadSummary {
  assetId: string
  leadId: string
  leadName: string
  branch?: string
  moveDate?: string
  url: string
  filename?: string
  mimeType?: string
  uploadedAt: string
  uploadedByName?: string
  notes?: string
  linkedCostId?: string
  linkedCostCategory?: string
  linkedCostAmountCents?: number
  linkedAt?: string
}

function uid() {
  return 'jc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function isReceiptAsset(asset: LeadMediaAsset) {
  return asset.category === 'receipt' || asset.source === 'receipt_upload'
}

function summarizeReceiptAsset(lead: CRMLead, asset: LeadMediaAsset): ReceiptUploadSummary {
  return {
    assetId: asset.id,
    leadId: lead.id,
    leadName: lead.name || 'Unnamed lead',
    branch: lead.branch,
    moveDate: lead.moveDate,
    url: asset.url,
    filename: asset.filename,
    mimeType: asset.mimeType,
    uploadedAt: asset.uploadedAt,
    uploadedByName: asset.uploadedByName,
    notes: asset.notes,
    linkedCostId: asset.linkedCostId,
    linkedCostCategory: asset.linkedCostCategory,
    linkedCostAmountCents: asset.linkedCostAmountCents,
    linkedAt: asset.linkedAt,
  }
}

async function loadReceiptUploads(leadId?: string | null) {
  const leads = leadId
    ? [await getSalesLead(leadId)].filter((lead): lead is CRMLead => !!lead)
    : await listSalesLeads()

  return leads
    .flatMap(lead =>
      (lead.mediaAssets || [])
        .filter(isReceiptAsset)
        .map(asset => summarizeReceiptAsset(lead, asset))
    )
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt))
}

async function updateLinkedReceiptAssets(
  leadId: string,
  receiptAssetIds: string[],
  updates: Partial<LeadMediaAsset>
) {
  if (!leadId || receiptAssetIds.length === 0) return
  const lead = await getSalesLead(leadId)
  if (!lead) return

  const receiptIdSet = new Set(receiptAssetIds)
  const mediaAssets = (lead.mediaAssets || []).map(asset => (
    receiptIdSet.has(asset.id)
      ? { ...asset, ...updates }
      : asset
  ))

  await saveSalesLead({
    ...lead,
    mediaAssets,
  })
}

async function clearReceiptLinksForCost(cost: JobCost | null) {
  if (!cost || !cost.lead_id || cost.lead_id === 'overhead') return
  const lead = await getSalesLead(cost.lead_id)
  if (!lead) return

  const mediaAssets = (lead.mediaAssets || []).map(asset => (
    asset.linkedCostId === cost.id
      ? {
          ...asset,
          linkedCostId: undefined,
          linkedCostCategory: undefined,
          linkedCostAmountCents: undefined,
          linkedAt: undefined,
        }
      : asset
  ))

  await saveSalesLead({
    ...lead,
    mediaAssets,
  })
}

async function fetchJobCosts(leadId?: string | null) {
  const { url, headers } = requireSupabaseEnv()
  const filter = leadId ? `&lead_id=eq.${leadId}` : ''
  const res = await fetch(
    `${url}/rest/v1/job_costs?select=*${filter}&order=cost_date.desc&limit=200`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) {
    throw new Error('Failed to load costs')
  }
  return res.json() as Promise<JobCost[]>
}

async function fetchJobCostById(id: string) {
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/job_costs?select=*&id=eq.${id}&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json() as JobCost[]
  return rows[0] || null
}

// GET /api/sales/finance?lead_id=xxx  — costs for one job + linked receipts
// GET /api/sales/finance               — all costs + receipt inbox
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { searchParams } = new URL(request.url)
    const leadId = searchParams.get('lead_id')
    const [costs, receiptUploads] = await Promise.all([
      fetchJobCosts(leadId),
      loadReceiptUploads(leadId),
    ])

    const linkedReceiptCountByCostId = new Map<string, number>()
    receiptUploads.forEach(receipt => {
      if (!receipt.linkedCostId) return
      linkedReceiptCountByCostId.set(
        receipt.linkedCostId,
        (linkedReceiptCountByCostId.get(receipt.linkedCostId) || 0) + 1
      )
    })

    return NextResponse.json({
      costs: costs.map(cost => ({
        ...cost,
        linkedReceiptCount: linkedReceiptCountByCostId.get(cost.id) || 0,
      })),
      receiptUploads,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load finance data' },
      { status: 500 }
    )
  }
}

// POST /api/sales/finance — create a cost entry, optionally linked to uploaded receipts
export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    lead_id?: string
    category: string
    description?: string
    amount_cents: number
    cost_date: string
    receipt_asset_ids?: string[]
  }

  if (!body.category || !body.amount_cents || !body.cost_date) {
    return NextResponse.json({ error: 'category, amount_cents, cost_date required' }, { status: 400 })
  }

  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(`${url}/rest/v1/job_costs`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({
        id: uid(),
        lead_id: body.lead_id ?? 'overhead',
        category: body.category,
        description: body.description?.trim() || null,
        amount_cents: Math.round(body.amount_cents),
        cost_date: body.cost_date,
        created_by: session.userId ?? session.role,
      }),
    })
    if (!res.ok) return NextResponse.json({ error: 'Failed to save cost' }, { status: 500 })
    const [row] = (await res.json()) as JobCost[]

    const receiptAssetIds = Array.isArray(body.receipt_asset_ids)
      ? body.receipt_asset_ids.map(value => String(value || '').trim()).filter(Boolean)
      : []

    if (row.lead_id !== 'overhead' && receiptAssetIds.length > 0) {
      await updateLinkedReceiptAssets(row.lead_id, receiptAssetIds, {
        linkedCostId: row.id,
        linkedCostCategory: row.category,
        linkedCostAmountCents: row.amount_cents,
        linkedAt: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      ...row,
      linkedReceiptCount: receiptAssetIds.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save cost' },
      { status: 500 }
    )
  }
}

// DELETE /api/sales/finance?id=xxx
export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existingCost = await fetchJobCostById(id).catch(() => null)
  await clearReceiptLinksForCost(existingCost)

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/job_costs?id=eq.${id}`, { method: 'DELETE', headers })
  return NextResponse.json({ ok: true })
}
