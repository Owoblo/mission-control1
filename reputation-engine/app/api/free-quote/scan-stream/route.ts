import { analyzePhotoBatch } from '@/lib/server/inventory-enrichment'
import { lookupListingsByAddress } from '@/lib/server/sales-repository'
import { clientIp, consumeRateLimit } from '@/lib/server/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 120

const BATCH_SIZE = 6

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

  const body = await request.json().catch(() => ({})) as { address?: string }
  const address = (body.address || '').trim()

  if (!address || address.length < 5) {
    return new Response('Address required', { status: 400, headers: corsHeaders })
  }

  const rateLimit = consumeRateLimit(`free-quote:scan:${clientIp(request)}`, {
    limit: 6,
    windowMs: 60 * 60 * 1000,
  })
  if (!rateLimit.allowed) {
    return new Response('Too many scan requests. Please try again later.', {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': String(rateLimit.retryAfterSeconds || 3600) },
    })
  }

  if (!process.env.OPENAI_API_KEY) {
    return new Response('Not configured', { status: 400, headers: corsHeaders })
  }

  // Look up listing
  const listings = await lookupListingsByAddress(address).catch(() => [])
  const listing  = listings[0] || null

  const allPhotos: string[] = listing
    ? Array.from(new Set(
        (listing.carouselphotos || [])
          .map((p: string | { url?: string }) => (typeof p === 'string' ? p : p?.url))
          .filter((u): u is string => !!u)
      ))
    : []

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* client disconnected */ }
      }

      try {
        if (!listing) {
          send({ type: 'no_listing' })
          controller.close()
          return
        }

        // Send all photo URLs immediately so the frontend can show them right away
        send({
          type: 'photos',
          photos: allPhotos,
          listing: {
            address: listing.address,
            city: listing.city,
          },
        })

        if (allPhotos.length === 0) {
          send({ type: 'no_photos' })
          controller.close()
          return
        }

        // Skip first 3 (exterior) and cap at 30 interior photos
        const interiorPhotos = allPhotos.slice(3, 33)
        const batches: string[][] = []
        for (let i = 0; i < interiorPhotos.length; i += BATCH_SIZE) {
          batches.push(interiorPhotos.slice(i, i + BATCH_SIZE))
        }

        send({
          type: 'start',
          totalPhotos: interiorPhotos.length,
          totalBatches: batches.length,
          // Which photo indices (from allPhotos) are interior and will be scanned
          interiorIndices: interiorPhotos.map((url) => allPhotos.indexOf(url)),
        })

        const allItems: object[] = []

        for (let i = 0; i < batches.length; i++) {
          const batchPhotoIndices = batches[i].map((url) => allPhotos.indexOf(url))
          const from = i * BATCH_SIZE + 1
          const to   = Math.min((i + 1) * BATCH_SIZE, interiorPhotos.length)

          send({
            type: 'scanning',
            batch: i + 1,
            totalBatches: batches.length,
            photoIndices: batchPhotoIndices,
            status: `Scanning photos ${from}–${to} of ${interiorPhotos.length}…`,
          })

          try {
            const items = await analyzePhotoBatch(batches[i], i)
            allItems.push(...items)
            send({
              type: 'items',
              batch: i + 1,
              items,
              runningCount: allItems.length,
            })
          } catch (err) {
            send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
          }
        }

        const totalCubicFeet = allItems.reduce(
          (sum, item) => sum + ((item as { cubicFeet?: number }).cubicFeet || 0),
          0
        )

        send({
          type: 'done',
          totalItems: allItems.length,
          totalCubicFeet: Math.round(totalCubicFeet),
        })
      } catch (err) {
        send({ type: 'error', error: (err as Error).message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
