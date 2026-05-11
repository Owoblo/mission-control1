import {
  classifyPhotosByRoom,
  detectFurnitureInRoom,
  getOpenAIConfig,
  suggestTruckConfig,
  analyzePhotoBatch,
} from '@/lib/server/inventory-enrichment'
import { applyMovePolicyToInventory } from '@/lib/move-policy'
import { getClientIp, rateLimit } from '@/lib/server/rate-limit'
import { lookupListingsByAddress } from '@/lib/server/sales-repository'
import { getListingPropertyContext, getListingBedrooms, getListingBathrooms } from '@/lib/listing'

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

  const ip = getClientIp(request)
  const { allowed, retryAfterMs } = rateLimit(`scan:${ip}`, 5, 60_000)
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Too many requests. Please wait a moment and try again.' }),
      {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) },
      }
    )
  }

  const body = await request.json().catch(() => ({})) as { address?: string }
  const address = (body.address || '').trim()

  if (!address || address.length < 5) {
    return new Response('Address required', { status: 400, headers: corsHeaders })
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

        const propertyContext = getListingPropertyContext(listing)

        // Send all photo URLs immediately
        send({
          type: 'photos',
          photos: allPhotos,
          listing: {
            address: listing.address,
            city: listing.city,
            bedrooms: getListingBedrooms(listing) ?? null,
            bathrooms: getListingBathrooms(listing) ?? null,
          },
        })

        if (allPhotos.length === 0) {
          send({ type: 'no_photos' })
          controller.close()
          return
        }

        // Skip first 3 (exterior) and cap at 30 interior photos
        const interiorPhotos = allPhotos.slice(3, 33)

        const config = getOpenAIConfig()
        if (!config) {
          send({ type: 'error', error: 'OpenAI not configured' })
          controller.close()
          return
        }

        // Phase 1: try room classification
        send({
          type: 'start',
          totalPhotos: interiorPhotos.length,
          totalBatches: 0,
          interiorIndices: interiorPhotos.map((url) => allPhotos.indexOf(url)),
          status: 'Classifying photos by room…',
        })

        let roomMap: Record<string, string[]> = {}
        try {
          roomMap = await classifyPhotosByRoom(interiorPhotos, config, propertyContext)
        } catch {
          // fall through to batch scan
        }

        const rooms = Object.entries(roomMap).filter(([, rp]) => rp.length > 0)

        if (rooms.length > 0) {
          // Phase 2: per-room detection
          send({
            type: 'start',
            totalPhotos: interiorPhotos.length,
            totalBatches: rooms.length,
            interiorIndices: interiorPhotos.map((url) => allPhotos.indexOf(url)),
          })

          const allItems: object[] = []

          for (let i = 0; i < rooms.length; i++) {
            const [roomName, roomPhotos] = rooms[i]
            const displayRoom = roomName.replace(/_\d+$/, '').replace(/_/g, ' ')
            const batchPhotoIndices = roomPhotos.map((url) => allPhotos.indexOf(url))

            send({
              type: 'scanning',
              batch: i + 1,
              totalBatches: rooms.length,
              photoIndices: batchPhotoIndices,
              status: `Scanning ${displayRoom} (${roomPhotos.length} photo${roomPhotos.length > 1 ? 's' : ''})…`,
            })

            if (i > 0) await new Promise(r => setTimeout(r, 1200))

            try {
              const items = await detectFurnitureInRoom(roomName, roomPhotos, config)
              allItems.push(...items)
              send({ type: 'items', batch: i + 1, items, runningCount: allItems.length })
            } catch (err) {
              send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
            }
          }

          const policyItems = applyMovePolicyToInventory(allItems as Parameters<typeof applyMovePolicyToInventory>[0], { enforceExclusion: true })
          const included = policyItems.filter(item => item.included !== false)
          const totalCubicFeet = Math.round(included.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0))
          const truckRec = suggestTruckConfig(totalCubicFeet)

          send({
            type: 'done',
            totalItems: included.length,
            totalCubicFeet,
            truckRecommendation: truckRec,
          })
        } else {
          // Fallback: batch scan
          const batches: string[][] = []
          for (let i = 0; i < interiorPhotos.length; i += BATCH_SIZE) {
            batches.push(interiorPhotos.slice(i, i + BATCH_SIZE))
          }

          send({
            type: 'start',
            totalPhotos: interiorPhotos.length,
            totalBatches: batches.length,
            interiorIndices: interiorPhotos.map((url) => allPhotos.indexOf(url)),
          })

          const allItems: object[] = []

          for (let i = 0; i < batches.length; i++) {
            const batchPhotoIndices = batches[i].map((url) => allPhotos.indexOf(url))
            const from = i * BATCH_SIZE + 1
            const to = Math.min((i + 1) * BATCH_SIZE, interiorPhotos.length)

            send({
              type: 'scanning',
              batch: i + 1,
              totalBatches: batches.length,
              photoIndices: batchPhotoIndices,
              status: `Scanning photos ${from}–${to} of ${interiorPhotos.length}…`,
            })

            try {
              const items = await analyzePhotoBatch(batches[i], i, propertyContext)
              allItems.push(...items)
              send({ type: 'items', batch: i + 1, items, runningCount: allItems.length })
            } catch (err) {
              send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
            }
          }

          const totalCubicFeet = Math.round(
            (allItems as Array<{ cubicFeet?: number; qty?: number; included?: boolean }>)
              .filter(item => item.included !== false)
              .reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0)
          )

          send({
            type: 'done',
            totalItems: allItems.length,
            totalCubicFeet,
            truckRecommendation: suggestTruckConfig(totalCubicFeet),
          })
        }
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
