/**
 * POST /api/sales/leads/[id]/scan-survey
 *
 * Scans customer-uploaded survey photos that are already stored in Supabase Storage.
 * AI runs on the rep side — the customer already uploaded and left.
 *
 * Merge logic:
 *   - Rooms covered by survey photos → replace with fresh AI scan
 *   - Rooms only in MLS/prior scans → keep as-is
 */
import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { analyzeLeadPhotosWithVision } from '@/lib/server/lead-media'
import { applyInventoryVerificationToInventory } from '@/lib/inventory-verification'
import { normalizeLead } from '@/lib/sales'
import type { LeadMediaAsset } from '@/lib/types'

export const maxDuration = 300

function buildRoomBreakdown(items: ReturnType<typeof normalizeLead>['inventory']) {
  return (items || []).reduce<Record<string, number>>((acc, item) => {
    if (item.included === false) return acc
    const room = item.room?.trim() || 'Unassigned'
    acc[room] = (acc[room] || 0) + Math.max(1, Number(item.qty || 1))
    return acc
  }, {})
}

export async function POST(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Scan any customer-facing image assets already stored on the lead.
    // This includes uploaded survey photos, rep uploads, and persisted MMS images.
    const surveyImageAssets: LeadMediaAsset[] = (lead.mediaAssets || [])
      .filter((a: LeadMediaAsset) => ['survey', 'rep_upload', 'mms'].includes(a.source) && a.kind === 'image' && a.url)

    if (surveyImageAssets.length === 0) {
      return NextResponse.json({ error: 'No customer photos found yet. Ask the customer to upload or text them first.' }, { status: 400 })
    }

    // Group photos by room
    const byRoom = new Map<string, string[]>()
    for (const asset of surveyImageAssets) {
      const room = asset.room || 'other'
      if (!byRoom.has(room)) byRoom.set(room, [])
      byRoom.get(room)!.push(asset.url)
    }

    // Scan each room (this is the AI-heavy part — runs on rep's side, not customer's)
    const allDetectedItems: ReturnType<typeof normalizeLead>['inventory'] = []
    const scannedRooms = new Set<string>()

    for (const [room, photoUrls] of Array.from(byRoom.entries())) {
      try {
        const items = (await analyzeLeadPhotosWithVision(room, photoUrls)).map(item => ({
          ...item,
          source: 'survey_ai' as const,
        }))
        allDetectedItems.push(...items)
        scannedRooms.add(room)
      } catch (err) {
        console.error(`[scan-survey] Room scan failed for ${room}:`, err)
        // Non-fatal — continue with other rooms
      }
    }

    // Smart merge:
    // Keep existing inventory items for rooms NOT covered by survey photos (MLS data stays)
    // Replace rooms that have survey photos with fresh scan results
    const existingInventory = lead.inventory || []
    const keptInventory = existingInventory.filter(item => {
      if (item.source === 'customer_verification') return true
      const room = item.room?.trim() || 'Unassigned'
      return !scannedRooms.has(room)
    })

    const nextInventory = applyInventoryVerificationToInventory(
      [...keptInventory, ...allDetectedItems],
      lead.inventoryVerification
    )
    const includedItems = nextInventory.filter(item => item.included !== false)

    const updatedLead = normalizeLead({
      ...lead,
      inventory: nextInventory,
      totalCubicFeet: includedItems.reduce((s, i) => s + (i.cubicFeet || 0) * Math.max(1, i.qty || 1), 0),
      totalWeightLbs: includedItems.reduce((s, i) => s + (i.weightLbs || 0) * Math.max(1, i.qty || 1), 0),
      totalItems: includedItems.reduce((s, i) => s + Math.max(1, i.qty || 1), 0),
      roomBreakdown: buildRoomBreakdown(nextInventory),
      surveyScannedAt: new Date().toISOString(),
    } as typeof lead & { surveyScannedAt: string })

    await saveSalesLead(updatedLead)

    return NextResponse.json({
      ok: true,
      scannedRooms: Array.from(scannedRooms),
      detectedItems: allDetectedItems.length,
      totalItems: nextInventory.length,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Scan failed' },
      { status: 500 }
    )
  }
}
