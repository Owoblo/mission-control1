export class ReadUnavailableError extends Error {
  constructor(public readonly status = 503) {
    super('Data is temporarily unavailable. Please try again.')
    this.name = 'ReadUnavailableError'
  }
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 522, 524])

/** Preserve existing response/error handling, adding a deadline only to reads. */
export function fetchWithReadDeadline(input: string | URL | Request, init?: RequestInit) {
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return fetch(input, init)
  const caller = init?.signal || (input instanceof Request ? input.signal : undefined)
  const deadline = AbortSignal.timeout(8_000)
  return fetch(input, {
    ...init,
    signal: caller ? AbortSignal.any([caller, deadline]) : deadline,
  })
}

/** GET/HEAD only. Consume the body within the deadline, and never retry writes. */
export async function fetchRead(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: 0 | 1 } = {},
): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') throw new Error('fetchRead only supports GET and HEAD')
  const retries = options.retries ?? 0
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted()
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 8_000)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    try {
      const response = await fetch(url, { ...init, signal })
      if (!response.ok) {
        await response.body?.cancel()
        throw new ReadUnavailableError(response.status)
      }
      const body = method === 'HEAD' || response.status === 204 ? null : await response.arrayBuffer()
      return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      init.signal?.throwIfAborted()
      const transient = error instanceof ReadUnavailableError
        ? TRANSIENT_STATUSES.has(error.status)
        : error instanceof TypeError || timeout.aborted
      if (!transient || attempt >= retries) throw error
      // One bounded retry with jitter; callers that poll handle their own backoff.
      await new Promise(resolve => setTimeout(resolve, 300 + Math.floor(Math.random() * 300)))
    }
  }
}

/** Never overlap polls. Errors increase the delay; success restores the cadence. */
export function startReadPolling(
  task: (signal: AbortSignal) => Promise<void>,
  options: { intervalMs: () => number; maxDelayMs?: number },
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  async function run() {
    try {
      await task(controller.signal)
      failures = 0
    } catch {
      failures = Math.min(failures + 1, 6)
    }
    if (!controller.signal.aborted) {
      timer = setTimeout(() => void run(), Math.min(
        options.intervalMs() * 2 ** failures,
        options.maxDelayMs ?? 120_000,
      ))
    }
  }
  void run()
  return () => { controller.abort(); if (timer) clearTimeout(timer) }
}
