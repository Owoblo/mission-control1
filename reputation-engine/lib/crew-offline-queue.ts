// Offline queue for crew field actions.
// When the device has no connectivity, JSON crew actions (dispatch respond,
// workspace updates, walkthrough submit) are stored on-device and replayed
// in order when connectivity returns. File uploads are NOT queued — they
// need a live connection and the UI says so.

export type QueuedCrewAction = {
  id: string
  token: string
  endpoint: 'dispatch' | 'workspace' | 'walkthrough'
  payload: Record<string, unknown>
  queuedAt: string
}

const STORAGE_KEY = 'saturn-crew-offline-queue'

function readQueue(): QueuedCrewAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(queue: QueuedCrewAction[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // Storage full or unavailable — the action is lost, but the UI
    // already told the user to retry. Never throw from here.
  }
}

export function queueCrewAction(entry: Omit<QueuedCrewAction, 'id' | 'queuedAt'>): QueuedCrewAction {
  const full: QueuedCrewAction = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: new Date().toISOString(),
  }
  const queue = readQueue()
  queue.push(full)
  writeQueue(queue)
  return full
}

export function pendingCrewActionCount(): number {
  return readQueue().length
}

export function findQueuedAction(token: string, endpoint: QueuedCrewAction['endpoint']): QueuedCrewAction | null {
  return readQueue().find(action => action.token === token && action.endpoint === endpoint) ?? null
}

// ---- Walkthrough evidence media (IndexedDB) -------------------------------
// Arrival photos/videos captured while offline are stored on-device and
// uploaded during flush, before the queued walkthrough is posted. The server
// rejects walkthroughs without evidence, so posting the JSON alone would be
// silently dropped (4xx) — the media must ride along. Blobs never touch
// localStorage; they live in IndexedDB under the queue action's id.

const MEDIA_DB = 'saturn-crew-media-v1'
const MEDIA_STORE = 'walkthrough-media'

export type QueuedCrewMedia = {
  id: string
  actionId: string
  token: string
  file: File
  capturedAt: string
}

function idbFactory(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

function openMediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idbFactory()
    if (!factory) {
      reject(new Error('indexedDB unavailable'))
      return
    }
    const request = factory.open(MEDIA_DB, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE)) {
        request.result.createObjectStore(MEDIA_STORE, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function queueWalkthroughMedia(actionId: string, token: string, files: File[]): Promise<void> {
  if (!idbFactory() || files.length === 0) return
  const db = await openMediaDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MEDIA_STORE, 'readwrite')
      const store = tx.objectStore(MEDIA_STORE)
      for (const file of files) {
        const entry: QueuedCrewMedia = {
          id: `${actionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          actionId,
          token,
          file,
          capturedAt: new Date().toISOString(),
        }
        store.put(entry)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function getWalkthroughMedia(actionId: string): Promise<QueuedCrewMedia[]> {
  if (!idbFactory()) return []
  try {
    const db = await openMediaDb()
    try {
      const all = await new Promise<QueuedCrewMedia[]>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, 'readonly')
        const request = tx.objectStore(MEDIA_STORE).getAll()
        request.onsuccess = () => resolve(request.result || [])
        request.onerror = () => reject(request.error)
      })
      return all.filter(item => item.actionId === actionId)
    } finally {
      db.close()
    }
  } catch {
    return []
  }
}

export async function clearWalkthroughMedia(actionId: string): Promise<void> {
  if (!idbFactory()) return
  try {
    const items = await getWalkthroughMedia(actionId)
    if (items.length === 0) return
    const db = await openMediaDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, 'readwrite')
        const store = tx.objectStore(MEDIA_STORE)
        for (const item of items) store.delete(item.id)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  } catch {
    // Cleanup is best-effort; stale blobs are overwritten on the next capture.
  }
}

export type CrewFlushResult = {
  sent: number
  dropped: number
  remaining: number
  // Which queued action ids were accepted vs permanently rejected, so callers
  // can give honest per-action UI (e.g. a rejected walkthrough must be redone,
  // never silently treated as recorded).
  sentIds: string[]
  droppedIds: string[]
}

// Uploads on-device media for a queued action. Implemented by the page because
// only it knows the right upload endpoint and category for the media.
export type CrewMediaUploader = (
  token: string,
  files: File[],
) => Promise<Array<{ url: string; contentType?: string }>>

function mergeEvidence(
  payload: Record<string, unknown>,
  assets: Array<{ url: string; contentType?: string }>,
): Record<string, unknown> {
  const existing = Array.isArray(payload.evidence) ? (payload.evidence as Array<unknown>) : []
  return {
    ...payload,
    evidence: [
      ...existing,
      ...assets.map(asset => ({
        url: asset.url,
        kind: asset.contentType?.startsWith('video/') ? 'video' : 'image',
        label: 'Arrival walkthrough',
      })),
    ],
  }
}

function endpointUrl(token: string, endpoint: QueuedCrewAction['endpoint']): string {
  switch (endpoint) {
    case 'dispatch':
      return `/api/crew/dispatch/${token}`
    case 'workspace':
      return `/api/contractor/jobs/${token}/workspace`
    case 'walkthrough':
      return `/api/contractor/jobs/${token}/walkthrough`
  }
}

// Replays queued actions oldest-first. Removes an entry once the server
// accepts it or permanently rejects it (4xx — retrying is pointless and
// would block everything behind it). Stops on network failure or 5xx so
// order is preserved across connectivity flaps.
//
// Walkthrough actions with on-device media upload that media first (via
// uploadMedia) and merge the resulting URLs into the payload's evidence
// before posting. Without this step the server would 400-reject the
// walkthrough for missing evidence and the crew's work would be dropped.
export async function flushCrewQueue(uploadMedia?: CrewMediaUploader): Promise<CrewFlushResult> {
  let queue = readQueue()
  let sent = 0
  let dropped = 0
  const sentIds: string[] = []
  const droppedIds: string[] = []
  for (const entry of queue) {
    let payload = entry.payload
    if (entry.endpoint === 'walkthrough') {
      const media = await getWalkthroughMedia(entry.id)
      if (media.length > 0) {
        if (!uploadMedia) break // no uploader wired — stay queued, retry later
        let assets: Array<{ url: string; contentType?: string }>
        try {
          assets = await uploadMedia(
            entry.token,
            media.map(item => item.file),
          )
        } catch {
          break // upload failed (still offline?) — keep everything queued
        }
        if (assets.length === 0) break // nothing uploaded — stay queued
        payload = mergeEvidence(payload, assets)
      }
    }
    let response: Response
    try {
      response = await fetch(endpointUrl(entry.token, entry.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } catch {
      break // offline or network error — keep the rest queued
    }
    if (response.ok) {
      sent += 1
      sentIds.push(entry.id)
    } else if (response.status >= 400 && response.status < 500) {
      dropped += 1 // permanent rejection — drop it, keep moving
      droppedIds.push(entry.id)
    } else {
      break // 5xx — server is unhappy, stop and retry later
    }
    if (entry.endpoint === 'walkthrough') await clearWalkthroughMedia(entry.id)
    queue = queue.filter(item => item.id !== entry.id)
    writeQueue(queue)
  }
  return { sent, dropped, remaining: queue.length, sentIds, droppedIds }
}
