import { getSalesLead } from '@/lib/server/sales-repository'
import { getListingPropertyContext } from '@/lib/listing'
import {
  buildInventoryScanDraftFromInventory,
  classifyPhotosByRoom,
  detectFurnitureInRoom,
  getOpenAIConfig,
  suggestTruckConfig,
  validateInventory,
  analyzePhotoBatch,
} from '@/lib/server/inventory-enrichment'
import { applyMovePolicyToInventory } from '@/lib/move-policy'
import { hasInternalSession } from '@/lib/server/session'
import type { InventoryItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const lead = await getSalesLead(params.id)
  if (!lead) return new Response('Lead not found', { status: 404 })

  const photos = (lead.supabaseListing?.carouselphotos || [])
    .map((p: string | { url?: string }) => (typeof p === 'string' ? p : p?.url))
    .filter((u): u is string => !!u)
  const propertyContext = getListingPropertyContext(lead.supabaseListing)

  if (photos.length === 0) return new Response('No MLS photos on this lead', { status: 400 })

  const config = getOpenAIConfig()
  if (!config) return new Response('OpenAI not configured', { status: 400 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // client disconnected
        }
      }

      try {
        send({
          type: 'start',
          totalPhotos: photos.length,
          totalBatches: 0,
          propertyContext: propertyContext ?? null,
        })

        send({
          type: 'progress',
          batch: 0,
          totalBatches: 0,
          status: 'Classifying photos by room…',
        })

        // Phase 1: classify all photos by room
        let roomMap: Record<string, string[]> = {}
        try {
          roomMap = await classifyPhotosByRoom(photos, config, propertyContext)
        } catch {
          // Phase 1 failure: fall back to batch scan
        }

        const rooms = Object.entries(roomMap).filter(([, rp]) => rp.length > 0)
        const roomCount = rooms.length

        if (roomCount === 0) {
          // ── Fallback: batch scan ──────────────────────────────────────────
          const BATCH_SIZE = 7
          const batches: string[][] = []
          for (let i = 0; i < photos.length; i += BATCH_SIZE) {
            batches.push(photos.slice(i, i + BATCH_SIZE))
          }

          send({
            type: 'start',
            totalPhotos: photos.length,
            totalBatches: batches.length,
            propertyContext: propertyContext ?? null,
          })

          const allItems: InventoryItem[] = []
          for (let i = 0; i < batches.length; i++) {
            const from = i * BATCH_SIZE + 1
            const to = Math.min((i + 1) * BATCH_SIZE, photos.length)
            send({
              type: 'progress',
              batch: i,
              totalBatches: batches.length,
              status: `Scanning photos ${from}–${to} of ${photos.length}…`,
            })
            try {
              const items = await analyzePhotoBatch(batches[i], i, propertyContext)
              allItems.push(...items)
              send({ type: 'batch', batch: i + 1, totalBatches: batches.length, items, runningCount: allItems.length })
            } catch (err) {
              send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
            }
          }

          const validationFlags = validateInventory(allItems, propertyContext)
          const scan = buildInventoryScanDraftFromInventory({
            inventory: allItems,
            source: 'mls_photo_ai',
            confidence: 'low',
            validationFlags,
            notes: `Batch scan fallback from ${photos.length} MLS photos. Room classification unavailable in stream mode.`,
          })
          send({
            type: 'done',
            allItems: scan.inventory,
            totalItems: scan.totalItems,
            truckRecommendation: suggestTruckConfig(scan.totalCubicFeet),
            validationFlags,
            scan,
            propertyContext: propertyContext ?? null,
          })
          return
        }

        // ── Phase 2: per-room detection ───────────────────────────────────
        send({
          type: 'start',
          totalPhotos: photos.length,
          totalBatches: roomCount,
          propertyContext: propertyContext ?? null,
        })

        const roomLabels = rooms.map(([r]) => r.replace(/_\d+$/, '').replace(/_/g, ' '))
        send({
          type: 'progress',
          batch: 0,
          totalBatches: roomCount,
          status: `Found ${roomCount} room${roomCount > 1 ? 's' : ''}: ${roomLabels.join(', ')}`,
        })

        const allItems: InventoryItem[] = []

        for (let i = 0; i < rooms.length; i++) {
          const [roomName, roomPhotos] = rooms[i]
          const displayRoom = roomName.replace(/_\d+$/, '').replace(/_/g, ' ')

          send({
            type: 'progress',
            batch: i + 1,
            totalBatches: roomCount,
            status: `Scanning ${displayRoom} (${roomPhotos.length} photo${roomPhotos.length > 1 ? 's' : ''})…`,
          })

          if (i > 0) await new Promise(r => setTimeout(r, 1200))

          try {
            const items = await detectFurnitureInRoom(roomName, roomPhotos, config)
            allItems.push(...items)
            send({
              type: 'batch',
              batch: i + 1,
              totalBatches: roomCount,
              items,
              runningCount: allItems.length,
            })
          } catch (err) {
            send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
          }
        }

        // Phase 3: validate
        const policyInventory = applyMovePolicyToInventory(allItems, { enforceExclusion: true })
        const validationFlags = validateInventory(policyInventory, propertyContext)
        const scan = buildInventoryScanDraftFromInventory({
          inventory: policyInventory,
          source: 'mls_photo_ai',
          confidence: roomCount >= 4 ? 'high' : roomCount >= 2 ? 'medium' : 'low',
          validationFlags,
          notes: `Stream scan across ${roomCount} room groups from ${photos.length} MLS photos.`,
        })

        send({
          type: 'done',
          allItems: scan.inventory,
          totalItems: scan.totalItems,
          truckRecommendation: suggestTruckConfig(scan.totalCubicFeet),
          validationFlags,
          scan,
          propertyContext: propertyContext ?? null,
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
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
