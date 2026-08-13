import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { normalizeLead } from '@/lib/sales'

export async function POST(
  _request: Request,
  props: { params: Promise<{ id: string; assetId: string }> }
) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const asset = (lead.mediaAssets || []).find(item => item.id === params.assetId)
    if (!asset) return NextResponse.json({ error: 'Uploaded media was not found' }, { status: 404 })
    if (asset.removed) return NextResponse.json({ ok: true, alreadyRemoved: true })

    const updated = normalizeLead({
      ...lead,
      mediaAssets: (lead.mediaAssets || []).map(asset =>
        asset.id === params.assetId
          ? { ...asset, removed: true, removedAt: new Date().toISOString() }
          : asset
      ),
    })

    await saveSalesLead(updated)
    return NextResponse.json({ ok: true, assetId: params.assetId })
  } catch (err) {
    console.error('[media/remove] error', err)
    return NextResponse.json({ error: 'Failed to remove media' }, { status: 500 })
  }
}
