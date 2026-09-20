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
export async function flushCrewQueue(): Promise<{ sent: number; dropped: number; remaining: number }> {
  let queue = readQueue()
  let sent = 0
  let dropped = 0
  for (const entry of queue) {
    let response: Response
    try {
      response = await fetch(endpointUrl(entry.token, entry.endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.payload),
      })
    } catch {
      break // offline or network error — keep the rest queued
    }
    if (response.ok) {
      sent += 1
    } else if (response.status >= 400 && response.status < 500) {
      dropped += 1 // permanent rejection — drop it, keep moving
    } else {
      break // 5xx — server is unhappy, stop and retry later
    }
    queue = queue.filter(item => item.id !== entry.id)
    writeQueue(queue)
  }
  return { sent, dropped, remaining: queue.length }
}
