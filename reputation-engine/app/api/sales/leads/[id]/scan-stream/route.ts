import { getSalesLead } from '@/lib/server/sales-repository'
import { analyzePhotoBatch } from '@/lib/server/inventory-enrichment'
import { hasInternalSession } from '@/lib/server/session'

export const runtime = 'nodejs'
export const maxDuration = 300

const BATCH_SIZE = 7

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const lead = await getSalesLead(params.id)
  if (!lead) return new Response('Lead not found', { status: 404 })

  const photos = (lead.supabaseListing?.carouselphotos || [])
    .map((p: string | { url?: string }) => (typeof p === 'string' ? p : p?.url))
    .filter((u): u is string => !!u)

  if (photos.length === 0) return new Response('No MLS photos on this lead', { status: 400 })
  if (!process.env.OPENAI_API_KEY) return new Response('OpenAI not configured', { status: 400 })

  const batches: string[][] = []
  for (let i = 0; i < photos.length; i += BATCH_SIZE) {
    batches.push(photos.slice(i, i + BATCH_SIZE))
  }

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
        send({ type: 'start', totalBatches: batches.length, totalPhotos: photos.length })

        const allItems: object[] = []

        for (let i = 0; i < batches.length; i++) {
          const from = i * BATCH_SIZE + 1
          const to = Math.min((i + 1) * BATCH_SIZE, photos.length)
          send({
            type: 'progress',
            batch: i + 1,
            totalBatches: batches.length,
            status: `Scanning photos ${from}–${to} of ${photos.length}…`,
          })

          try {
            const items = await analyzePhotoBatch(batches[i], i)
            allItems.push(...items)
            send({
              type: 'batch',
              batch: i + 1,
              totalBatches: batches.length,
              items,
              runningCount: allItems.length,
            })
          } catch (err) {
            send({ type: 'batch_error', batch: i + 1, error: (err as Error).message })
          }
        }

        send({ type: 'done', allItems, totalItems: allItems.length })
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
