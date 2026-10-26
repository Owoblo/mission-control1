import { scopeReviewByToken, saveScopeReviews } from '@/lib/server/contractor-scope-review'
import { initialScopePricing, transitionScopePricing } from '@/lib/contractor-scope-pricing'
import { rateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createHash } from 'node:crypto'
import { getRepAlertRecipients } from '@/lib/server/internal-notifications'
import { priceLabel } from '@/lib/contractor-scope-pricing'
const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
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
    if (pricing !== current) {
      const event = pricing.events.at(-1)!
      const action = event.action === 'submit' ? 'submitted a bid' : event.action === 'counter' ? 'sent a counteroffer' : event.action === 'accept' ? 'accepted your offer' : event.action === 'decline' ? 'declined the job' : 'responded to the job offer'
      const amount = event.price ? priceLabel(event.price) : 'No price included'
      const href = `https://go.quote2move.com/sales/contractors?leadId=${encodeURIComponent(row.id)}`
      const alert = [`Contractor update — ${review.scope.contactName} ${action}`, `<h2>${escapeHtml(review.scope.contactName)} ${escapeHtml(action)}</h2><p><strong>Job:</strong> ${escapeHtml(review.scope.origin)} to ${escapeHtml(review.scope.destination)} on ${escapeHtml(review.scope.date)}</p><p><strong>Status:</strong> ${escapeHtml(pricing.status)}</p><p><strong>Price:</strong> ${escapeHtml(amount)}</p>${event.notes ? `<p><strong>Notes:</strong><br>${escapeHtml(event.notes).replace(/\n/g, '<br>')}</p>` : ''}<p><a href="${href}">Open contractor price responses in Mission Control</a></p><p>A price agreement is not an assignment or dispatch approval.</p>`] as const
      await saveScopeReviews(row, row.data.contractorScopeReviews!.map(r => r.id === review.id ? { ...r, pricing } : r), { eventKey: `contractor:${review.id}:${event.id}`, payload: { subject: alert[0], html: alert[1], recipients: await getRepAlertRecipients(row.data.branch) } })
    }
    return Response.json({ pricing }, { headers })
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? 'Invalid response' : error instanceof Error && !/Could not load/.test(error.message) ? error.message : 'Could not save. Refresh and try again.' }, { status: 409, headers })
  }
}
