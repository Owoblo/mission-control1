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
  dedupePhotosBeforeVision,
  mapScanRooms,
} from '@/lib/server/inventory-enrichment'
import { applyMovePolicyToInventory } from '@/lib/move-policy'
import { hasInternalSession } from '@/lib/server/session'
import type { InventoryItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const lead = await getSalesLead(params.id)
  if (!lead) return new Response('Lead not found', { status: 404 })

  const rawPhotos = (lead.supabaseListing?.carouselphotos || [])
    .map((p: string | { url?: string }) => (typeof p === 'string' ? p : p?.url))
    .filter((u): u is string => !!u)
  const photos = await dedupePhotosBeforeVision(rawPhotos)
  const propertyContext = getListingPropertyContext(lead.supabaseListing)

  if (photos.length === 0) return new Response('No MLS photos on this lead', { status: 400 })

  const config = getOpenAIConfig()
  if (!config) return new Response('OpenAI not configured', { status: 400 })

  const scanController = new AbortController()
  const scanSignal = AbortSignal.any([_req.signal, scanController.signal, AbortSignal.timeout(250_000)])
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          scanController.abort() // client disconnected
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
          roomMap = await classifyPhotosByRoom(photos, config, propertyContext, scanSignal)
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
              const items = await analyzePhotoBatch(batches[i], i, propertyContext, scanSignal)
              allItems.push(...items)
              send({ type: 'batch', batch: i + 1, totalBatches: batches.length, items, runningCount: allItems.length })
            } catch (err) {
              throw new Error(`Photos ${from}–${to} could not be scanned. Your existing inventory is unchanged. ${(err as Error).message}`)
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

        let completed = 0
        const results = await mapScanRooms(rooms, async ([roomName, roomPhotos]) => {
          const displayRoom = roomName.replace(/_\d+$/, '').replace(/_/g, ' ')
          send({ type: 'progress', batch: completed, totalBatches: roomCount, status: `Scanning ${displayRoom} (${roomPhotos.length} photos)…` })
          const items = await detectFurnitureInRoom(roomName, roomPhotos, config, scanSignal)
          completed++
          send({ type: 'batch', batch: completed, totalBatches: roomCount, items })
          return items
        })
        allItems.push(...results.flat())

        // Phase 3: validate
        const policyInventory = applyMovePolicyToInventory(allItems, { enforceExclusion: true })
        const validationFlags = validateInventory(policyInventory, propertyContext)
        const scan = buildInventoryScanDraftFromInventory({
          inventory: policyInventory,
          source: 'mls_photo_ai',
          confidence: 'medium',
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
        scanController.abort()
        send({ type: 'error', error: (err as Error).message })
      } finally {
        try { controller.close() } catch { /* stream was cancelled */ }
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
