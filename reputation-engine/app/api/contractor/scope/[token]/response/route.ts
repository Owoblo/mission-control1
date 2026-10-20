import { scopeReviewByToken, saveScopeReviews } from '@/lib/server/contractor-scope-review'
import { initialScopePricing, transitionScopePricing } from '@/lib/contractor-scope-pricing'
import { rateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createHash } from 'node:crypto'
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const headers = { 'Cache-Control': 'no-store' }
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Invalid origin' }, { status: 403, headers })
  if (!request.headers.get('content-type')?.includes('application/json')) return Response.json({ error: 'JSON required' }, { status: 415, headers })
  const { token } = await params
  if (!/^[a-f0-9]{64}$/.test(token)) return Response.json({ error: 'Review unavailable' }, { status: 404, headers })
  const key = createHash('sha256').update(token).digest('hex')
  if (!rateLimit(`scope-response:${key}:${getClientIp(request)}`, 20, 60000).allowed) return Response.json({ error: 'Please wait a minute before trying again.' }, { status: 429, headers })
  try {
    const raw = await request.text()
    if (raw.length > 6000) return Response.json({ error: 'Response too long' }, { status: 413, headers })
    const input = JSON.parse(raw)
    if (!input || typeof input !== 'object' || Array.isArray(input)) return Response.json({ error: 'Invalid response' }, { status: 400, headers })
    const found = await scopeReviewByToken(token)
    if (!found) return Response.json({ error: 'This review link is unavailable. Contact John.' }, { status: 404, headers })
    const { row, review } = found
    const current = review.pricing || initialScopePricing()
    const pricing = transitionScopePricing(current, 'contractor', input)
    if (pricing !== current) await saveScopeReviews(row, row.data.contractorScopeReviews!.map(r => r.id === review.id ? { ...r, pricing } : r))
    return Response.json({ pricing }, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? 'Invalid response' : error instanceof Error && !/Could not load/.test(error.message) ? error.message : 'Could not save. Refresh and try again.' }, { status: 409, headers })
  }
}
