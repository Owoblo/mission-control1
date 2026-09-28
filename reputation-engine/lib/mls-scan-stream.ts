import type { InventoryItem, InventoryScanDraft } from './types'

export type MlsScanEvent = {
  type: string
  batch?: number
  totalBatches?: number
  totalPhotos?: number
  status?: string
  items?: InventoryItem[]
  allItems?: InventoryItem[]
  error?: string
  truckRecommendation?: { label: string; bufferedCubicFeet: number }
  validationFlags?: string[]
  scan?: InventoryScanDraft
}

/** A scan is usable only after a complete, error-free result. Never publish partial inventory. */
export async function readMlsScan(
  response: Response,
  onProgress: (event: MlsScanEvent) => void,
): Promise<MlsScanEvent & { allItems: InventoryItem[] }> {
  if (!response.ok) throw new Error(await response.text() || 'MLS scan could not start.')
  if (!response.body) throw new Error('MLS scan returned no response. Please retry.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let items: InventoryItem[] = []
  let result: MlsScanEvent | undefined
  function consume(line: string) {
    if (!line.startsWith('data:')) return
    const payload = line.slice(5).trim()
    if (!payload) return
    let event: MlsScanEvent
    try { event = JSON.parse(payload) } catch { throw new Error('MLS scan returned an invalid response. Please retry.') }
    if (!event || typeof event.type !== 'string') throw new Error('Invalid MLS scan event.')
    if (event.type === 'error' || event.type === 'batch_error') {
      throw new Error(event.error || 'Some listing photos could not be scanned. Please retry.')
    }
    if (event.type === 'batch') items.push(...(event.items || []))
    if (event.type === 'done') result = event
    else onProgress(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      lines.forEach(consume)
      if (done) { if (buffer) consume(buffer); break }
    }
    if (!result) throw new Error('MLS scan ended before it finished. Please retry; your inventory was kept.')
    return { ...result, allItems: result.scan?.inventory ?? result.allItems ?? items }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
