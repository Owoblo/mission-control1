const SLOW_REQUEST_MS = 500
const SLOW_DEPENDENCY_MS = 250

export async function measureDependency<T>(
  operation: string,
  work: Promise<T>,
  details: Record<string, string | number | boolean | null | undefined> = {},
) {
  const startedAt = performance.now()
  try {
    return { value: await work, durationMs: logSlowDependency(operation, startedAt, details) }
  } catch (error) {
    logSlowDependency(operation, startedAt, { ...details, failed: true })
    throw error
  }
}

export function finishTimedResponse(
  response: Response,
  startedAt: number,
  operation: string,
  details: Record<string, string | number | boolean | null | undefined> = {},
) {
  const durationMs = Math.round(performance.now() - startedAt)
  const dependencyTimings = response.headers.get('Server-Timing')
  response.headers.set('Server-Timing', [dependencyTimings, `app;dur=${durationMs}`].filter(Boolean).join(', '))
  response.headers.set('X-Response-Time', `${durationMs}ms`)
  if (durationMs >= SLOW_REQUEST_MS) {
    console.warn(JSON.stringify({
      event: 'slow_request',
      operation,
      durationMs,
      ...details,
    }))
  }
  return response
}

export function logSlowDependency(
  operation: string,
  startedAt: number,
  details: Record<string, string | number | boolean | null | undefined> = {},
) {
  const durationMs = Math.round(performance.now() - startedAt)
  if (durationMs >= SLOW_DEPENDENCY_MS) {
    console.warn(JSON.stringify({
      event: 'slow_dependency',
      operation,
      durationMs,
      ...details,
    }))
  }
  return durationMs
}
