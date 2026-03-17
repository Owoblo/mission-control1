import { NextResponse } from 'next/server'
import { matchInventoryPreset } from '@/lib/item-presets'
import { analyzeListingPhotos } from '@/lib/server/inventory-enrichment'
import {
  getListingInventoryScan,
  lookupListingsByAddress,
  saveListingInventoryScan,
} from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { address?: string; analyze?: boolean; forceAnalyze?: boolean }
    if (!payload.address || payload.address.trim().length < 5) {
      return NextResponse.json({ error: 'Address must be at least 5 characters' }, { status: 400 })
    }

    const listings = await lookupListingsByAddress(payload.address.trim())
    const listing = listings[0] || null

    if (!listing) {
      return NextResponse.json({ listing: null, scan: null, analysisAvailable: false })
    }

    const photosAvailable = Array.isArray(listing.carouselphotos) && listing.carouselphotos.length > 0 && !!process.env.OPENAI_API_KEY
    const scan = await getListingInventoryScan(listing.zpid)
    if (scan && !(payload.analyze && payload.forceAnalyze)) {
      return NextResponse.json({ listing, scan, analysisAvailable: photosAvailable })
    }

    if (payload.analyze) {
      if (!Array.isArray(listing.carouselphotos) || listing.carouselphotos.length === 0) {
        return NextResponse.json({ error: 'No MLS photos are available for this listing.' }, { status: 400 })
      }
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ error: 'OPENAI_API_KEY is not configured for MLS photo analysis.' }, { status: 400 })
      }
      const analyzed = await analyzeListingPhotos(listing)
      const normalizedScan = analyzed
        ? {
            ...analyzed,
            inventory: (analyzed.inventory || []).map(item => {
              const preset = matchInventoryPreset(item.name || item.item)
              if (!preset) return item
              return {
                ...item,
                room: item.room || preset.room,
                cubicFeet: item.cubicFeet || preset.item.cubicFeet,
                weightLbs: item.weightLbs || preset.item.weightLbs,
              }
            }),
          }
        : analyzed
      if (normalizedScan) {
        try {
          await saveListingInventoryScan(listing.zpid, normalizedScan)
        } catch (error) {
          console.error('Failed to cache listing inventory scan', error)
        }
      }
      return NextResponse.json({
        listing,
        scan: normalizedScan,
        analysisAvailable: !!normalizedScan,
      })
    }

    return NextResponse.json({
      listing,
      scan: null,
      analysisAvailable: Array.isArray(listing.carouselphotos) && listing.carouselphotos.length > 0 && !!process.env.OPENAI_API_KEY,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Address enrichment failed' },
      { status: 400 }
    )
  }
}
