import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { scopeLead, saveScopeReviews, newScopeReview } from '@/lib/server/contractor-scope-review'
import { listSubcontractors } from '@/lib/server/subcontractors'
import { getSalesQuote } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return Response.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => ({}))
  if (typeof body.leadId !== 'string' || typeof body.contractorId !== 'string') return Response.json({ error: 'Choose a job and contractor.' }, { status: 400 })
  try {
    const row = await scopeLead(body.leadId)
    if (!row || (session?.role !== 'owner' && session?.branch && row.data.branch !== session.branch)) return Response.json({ error: 'Job not found' }, { status: 404 })
    const contractor = (await listSubcontractors()).find(item => item.id === body.contractorId)
    if (!contractor) return Response.json({ error: 'Contractor not found.' }, { status: 404 })
    const existing = row.data.contractorScopeReviews || []
    if (body.action === 'revoke') {
      const review = existing.find(item => item.id === body.reviewId && item.contractorId === contractor.id)
      if (!review) return Response.json({ error: 'Review not found' }, { status: 404 })
      await saveScopeReviews(row, existing.map(item => item.id === review.id ? { ...item, revoked: true } : item))
      return Response.json({ ok: true })
    }
    if (contractor.status === 'blocked' || /OWNER OUTREACH HOLD|IDENTITY REVIEW HOLD|DECLINED CONTRACTOR OUTREACH|AD-CHANNEL PREFERENCE/.test(contractor.notes || '')) return Response.json({ error: 'Contractor is unavailable for review.' }, { status: 409 })
    if (body.action !== 'create') return Response.json({ error: 'Invalid action' }, { status: 400 })
    // Reuse the current link on retries. Scope reviews never award work or send messages.
    let review = existing.find(item => item.contractorId === contractor.id && !item.revoked && Date.parse(item.expiresAt) > Date.now())
    if (!review) {
      const quote = row.data.quoteId ? await getSalesQuote(row.data.quoteId) : null
      review = newScopeReview(row.data, quote, contractor.id, contractor.contactName)
      await saveScopeReviews(row, [...existing, review])
    }
    return Response.json({ url: `${new URL(request.url).origin}/contractor/scope/${review.token}`, reviewId: review.id, scope: review.scope, createdAt: review.createdAt, expiresAt: review.expiresAt }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return Response.json({ error: 'Could not prepare the review. Refresh and try again.' }, { status: 409 }) }
}
