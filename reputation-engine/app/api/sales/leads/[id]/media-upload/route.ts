import { NextResponse } from 'next/server'
import { applyLeadMediaAnalysis, analyzeLeadPhotosWithVision, uploadLeadMediaAssets } from '@/lib/server/lead-media'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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
    const partyLabel = String(formData.get('partyLabel') || '').trim() || undefined
    const partyOwnerRaw = String(formData.get('partyOwner') || '').trim()
    const partyOwner = partyOwnerRaw === 'person_a' || partyOwnerRaw === 'person_b' ? partyOwnerRaw : undefined
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
      partyLabel,
    })

    // Step 1: Save assets to the lead immediately — photos land regardless of AI outcome
    const leadWithAssets = applyLeadMediaAnalysis(lead, {
      assets,
      detectedItems: [],
      source: purpose === 'receipt' ? 'receipt_upload' : 'rep_upload',
    })
    let savedLead = await saveSalesLead({
      ...leadWithAssets,
      lastTouchedAt: new Date().toISOString(),
      lastTouchedByUserId: session?.userId || leadWithAssets.lastTouchedByUserId,
      lastTouchedByName: session?.name || leadWithAssets.lastTouchedByName,
    })

    // Step 2: Attempt AI analysis — failure here doesn't undo the upload
    const shouldAnalyzeInventory = purpose !== 'receipt'
    const imageUrls = shouldAnalyzeInventory ? assets.filter(asset => asset.kind === 'image').map(asset => asset.url) : []
    let detectedItems: Awaited<ReturnType<typeof analyzeLeadPhotosWithVision>> = []
    let analyzeError: string | null = null
    let analyzedImageCount = 0

    if (imageUrls.length > 0) {
      try {
        analyzedImageCount = imageUrls.length
        detectedItems = (await analyzeLeadPhotosWithVision(room, imageUrls)).map(item => ({
          ...item,
          ...(partyOwner ? { owner: partyOwner } : {}),
        }))
        if (detectedItems.length > 0) {
          const nextLead = applyLeadMediaAnalysis(leadWithAssets, {
            assets: [],
            detectedItems,
            source: purpose === 'receipt' ? 'receipt_upload' : 'rep_upload',
          })
          savedLead = await saveSalesLead(nextLead)
        }
        const imageAssetIds = assets.filter(asset => asset.kind === 'image').map(asset => asset.id)
        for (const assetId of imageAssetIds) {
          savedLead = {
            ...savedLead,
            mediaAssets: (savedLead.mediaAssets || []).map(asset =>
              asset.id === assetId
                ? {
                    ...asset,
                    analysisStatus: 'scanned' as const,
                    analysisNotes: `Scanned as part of ${imageUrls.length} uploaded image${imageUrls.length === 1 ? '' : 's'} for ${room}.`,
                    detectedItemCount: detectedItems.length,
                  }
                : asset
            ),
          }
        }
        savedLead = await saveSalesLead(savedLead)
      } catch (err) {
        analyzeError = err instanceof Error ? err.message : 'AI scan failed'
        savedLead = {
          ...savedLead,
          mediaAssets: (savedLead.mediaAssets || []).map(asset =>
            assets.some(upload => upload.id === asset.id && upload.kind === 'image')
              ? {
                  ...asset,
                  analysisStatus: 'failed' as const,
                  analysisNotes: analyzeError || 'AI scan failed. Retry the scan from this lead.',
                }
              : asset
          ),
        }
        savedLead = await saveSalesLead(savedLead)
      }
    }

    return NextResponse.json({
      ok: true,
      uploadedCount: assets.length,
      analyzedImageCount,
      scanBatchCount: imageUrls.length > 0 ? Math.ceil(imageUrls.length / 4) : 0,
      skippedVideoCount: assets.filter(asset => asset.kind === 'video' || asset.kind === 'document').length,
      detectedItems,
      lead: savedLead,
      ...(analyzeError ? { analyzeWarning: `Photos saved but AI scan failed: ${analyzeError}. Use the Scan button to retry.` } : {}),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Media upload failed' },
      { status: 400 }
    )
  }
}
