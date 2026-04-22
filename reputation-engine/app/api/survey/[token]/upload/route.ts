import { NextResponse } from 'next/server'
import { applyLeadMediaAnalysis, analyzeLeadPhotosWithVision, uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function getLeadByToken(token: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_leads?select=id,data&deleted=not.is.true`, { headers })
  if (!response.ok) return null
  const rows = await response.json() as Array<{ id: string; data: Record<string, unknown> }>
  return rows.find(row => row.data?.surveyToken === token) || null
}

export async function POST(
  request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const row = await getLeadByToken(params.token)
    if (!row) {
      return NextResponse.json({ error: 'Invalid survey link' }, { status: 404 })
    }

    const lead = await getSalesLead(row.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const expiresAt = row.data.surveyTokenExpiresAt as string | undefined
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'Survey link has expired' }, { status: 410 })
    }

    const formData = await request.formData()
    const room = (formData.get('room') as string) || 'other'
    const files = (formData.getAll('photos') as File[]).filter(Boolean)
    if (!files.length) {
      return NextResponse.json({ error: 'No photos provided' }, { status: 400 })
    }

    const assets = await uploadLeadMediaAssets({
      leadId: lead.id,
      namespace: params.token,
      files,
      room,
      source: 'survey',
    })
    const imageUrls = assets.filter(asset => asset.kind === 'image').map(asset => asset.url)
    const detectedItems = imageUrls.length > 0 ? await analyzeLeadPhotosWithVision(room, imageUrls) : []
    const updatedLead = applyLeadMediaAnalysis(lead, {
      assets,
      detectedItems,
      source: 'survey',
    })

    await saveSalesLead(updatedLead)

    return NextResponse.json({
      ok: true,
      detectedItems,
      uploadedCount: assets.length,
      analyzedImageCount: imageUrls.length,
      skippedVideoCount: assets.filter(asset => asset.kind === 'video').length,
      totalInventoryCount: updatedLead.inventory?.length || 0,
    })
  } catch (error) {
    console.error('[survey/upload] error', error)
    return NextResponse.json({ error: 'Upload failed', detail: String(error) }, { status: 500 })
  }
}
