import { NextResponse } from 'next/server'
import { matchInventoryPreset } from '@/lib/item-presets'
import { getListingPropertyContext } from '@/lib/listing'
import { analyzeListingPhotos } from '@/lib/server/inventory-enrichment'
import {
  getListingInventoryScan,
  lookupListingsByAddress,
  saveListingInventoryScan,
} from '@/lib/server/sales-repository'
import { clientIp, consumeRateLimit } from '@/lib/server/rate-limit'

// Allow up to 60s for the AI photo analysis
export const maxDuration = 60

export async function OPTIONS() {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}

export async function POST(request: Request) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  try {
    const rateLimit = consumeRateLimit(`free-quote:analyze:${clientIp(request)}`, {
      limit: 12,
      windowMs: 60 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many quote analysis requests. Please try again later.' },
        { status: 429, headers: { ...corsHeaders, 'Retry-After': String(rateLimit.retryAfterSeconds || 3600) } }
      )
    }

    const payload = (await request.json()) as { address?: string; analyze?: boolean }

    if (!payload.address || payload.address.trim().length < 5) {
      return NextResponse.json({ error: 'Please enter a valid address' }, { status: 400, headers: corsHeaders })
    }

    const listings = await lookupListingsByAddress(payload.address.trim())
    const listing = listings[0] || null

    if (!listing) {
      return NextResponse.json(
        { listing: null, scan: null, analysisAvailable: false },
        { headers: corsHeaders }
      )
    }

    const photosAvailable =
      Array.isArray(listing.carouselphotos) &&
      listing.carouselphotos.length > 0 &&
      !!process.env.OPENAI_API_KEY

    // First call — just return listing info + photos, no AI yet
    if (!payload.analyze) {
      return NextResponse.json(
        { listing, scan: null, analysisAvailable: photosAvailable },
        { headers: corsHeaders }
      )
    }

    // Check for a cached scan first (skip re-running AI)
    const cachedScan = await getListingInventoryScan(listing.zpid)
    if (cachedScan) {
      return NextResponse.json({ listing, scan: cachedScan, analysisAvailable: photosAvailable }, { headers: corsHeaders })
    }

    // No photos → return listing without inventory
    if (!photosAvailable) {
      return NextResponse.json({ listing, scan: null, analysisAvailable: false }, { headers: corsHeaders })
    }

    // Run AI inventory scan
    const analyzed = await analyzeListingPhotos(listing, getListingPropertyContext(listing))
    const normalizedScan = analyzed
      ? {
          ...analyzed,
          inventory: (analyzed.inventory || []).map(item => {
            const preset = matchInventoryPreset(item.name || (item as Record<string, unknown>).item as string)
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
      try { await saveListingInventoryScan(listing.zpid, normalizedScan) } catch {}
    }

    return NextResponse.json(
      { listing, scan: normalizedScan, analysisAvailable: !!normalizedScan },
      { headers: corsHeaders }
    )
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analysis failed' },
      { status: 400, headers: corsHeaders }
    )
  }
}
