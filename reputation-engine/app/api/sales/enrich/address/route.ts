import { NextResponse } from 'next/server'
import { matchInventoryPreset } from '@/lib/item-presets'
import { getListingPropertyContext } from '@/lib/listing'
import { analyzeListingPhotos } from '@/lib/server/inventory-enrichment'
import {
  getListingInventoryScan,
  lookupListingByReference,
  resolveListingsByAddress,
  saveListingInventoryScan,
} from '@/lib/server/sales-repository'
import { selectListingCandidate } from '@/lib/listing-match'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { address?: string; listingUrl?: string; listingId?: string; analyze?: boolean; forceAnalyze?: boolean }
    if ((!payload.address || payload.address.trim().length < 5) && !payload.listingUrl) {
      return NextResponse.json({ error: 'Enter an address or listing link' }, { status: 400 })
    }

    const address = payload.address?.trim() || ''
    const linkedListing = payload.listingUrl ? await lookupListingByReference(payload.listingUrl.trim()) : null
    let match = linkedListing
      ? { status: 'selected' as const, listing: linkedListing, candidates: [linkedListing], requestedAddress: address || linkedListing.address, requestedUnit: null, requiresSelection: false }
      : payload.listingUrl
        ? { status: 'no_match' as const, listing: null, candidates: [], requestedAddress: address, requestedUnit: null, requiresSelection: false }
        : await resolveListingsByAddress(address)
    if (payload.listingId) match = selectListingCandidate(match, payload.listingId)
    const listing = match.listing

    if (!listing) {
      return NextResponse.json({ ...match, scan: null, analysisAvailable: false })
    }

    const photosAvailable = Array.isArray(listing.carouselphotos) && listing.carouselphotos.length > 0 && !!process.env.OPENAI_API_KEY
    const scan = await getListingInventoryScan(listing.zpid)
    if (scan && !(payload.analyze && payload.forceAnalyze)) {
      return NextResponse.json({ ...match, listing, scan, analysisAvailable: photosAvailable })
    }

    if (payload.analyze) {
      if (!Array.isArray(listing.carouselphotos) || listing.carouselphotos.length === 0) {
        return NextResponse.json({ error: 'No MLS photos are available for this listing.' }, { status: 400 })
      }
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ error: 'OPENAI_API_KEY is not configured for MLS photo analysis.' }, { status: 400 })
      }
      const analyzed = await analyzeListingPhotos(listing, getListingPropertyContext(listing))
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
        ...match,
        listing,
        scan: normalizedScan,
        analysisAvailable: !!normalizedScan,
      })
    }

    return NextResponse.json({
      ...match,
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
