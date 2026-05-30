import { NextResponse } from 'next/server'
import { applyLeadMediaAnalysis, analyzeLeadPhotosWithVision, uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const purpose = String(formData.get('purpose') || 'customer_media')
    const room = String(formData.get('room') || 'other')
    const notes = String(formData.get('notes') || '').trim() || undefined
    const files = (formData.getAll('files') as File[]).filter(Boolean)
    if (!files.length) {
      return NextResponse.json({ error: 'No media files provided' }, { status: 400 })
    }

    const assets = await uploadLeadMediaAssets({
      leadId: lead.id,
      namespace: purpose === 'receipt' ? `receipt-upload-${Date.now()}` : `rep-upload-${Date.now()}`,
      files,
      room: purpose === 'receipt' ? 'Receipts' : room,
      source: purpose === 'receipt' ? 'receipt_upload' : 'rep_upload',
      category: purpose === 'receipt' ? 'receipt' : 'customer_media',
      uploadedByUserId: session?.userId,
      uploadedByName: session?.name,
      notes,
    })

    const shouldAnalyzeInventory = purpose !== 'receipt'
    const imageUrls = shouldAnalyzeInventory ? assets.filter(asset => asset.kind === 'image').map(asset => asset.url) : []
    const detectedItems = imageUrls.length > 0 ? await analyzeLeadPhotosWithVision(room, imageUrls) : []
    const nextLead = applyLeadMediaAnalysis(lead, {
      assets,
      detectedItems,
      source: purpose === 'receipt' ? 'receipt_upload' : 'rep_upload',
    })

    const savedLead = await saveSalesLead({
      ...nextLead,
      lastTouchedAt: new Date().toISOString(),
      lastTouchedByUserId: session?.userId || nextLead.lastTouchedByUserId,
      lastTouchedByName: session?.name || nextLead.lastTouchedByName,
    })

    return NextResponse.json({
      ok: true,
      lead: savedLead,
      uploadedCount: assets.length,
      analyzedImageCount: imageUrls.length,
      skippedVideoCount: assets.filter(asset => asset.kind === 'video' || asset.kind === 'document').length,
      detectedItems,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Media upload failed' },
      { status: 400 }
    )
  }
}
