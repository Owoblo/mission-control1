interface RateLimitRecord {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitRecord>()

export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now()
  const record = store.get(key)

  if (!record || now >= record.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 }
  }

  if (record.count >= maxRequests) {
    return { allowed: false, remaining: 0, retryAfterMs: record.resetAt - now }
  }

  record.count++
  return { allowed: true, remaining: maxRequests - record.count, retryAfterMs: 0 }
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}
