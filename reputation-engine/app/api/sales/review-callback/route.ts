/**
 * Public endpoint — called from the customer-facing review page.
 * No session required. Stamps review lifecycle events onto the CRM lead
 * identified by reviewJobId.
 *
 * POST { jobId, event: 'rated' | 'completed' | 'flagged', rating?, notes? }
 */
import { NextResponse } from 'next/server'
import { listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      jobId?: string
      event?: 'rated' | 'completed' | 'flagged'
      rating?: number
      notes?: string
    }

    if (!body.jobId || !body.event) {
      return NextResponse.json({ ok: false, error: 'jobId and event are required' }, { status: 400 })
    }

    // Find the CRM lead that was linked to this job
    const leads = await listSalesLeads()
    const lead = leads.find(l => l.reviewJobId === body.jobId)

    if (!lead) {
      // No lead linked — that's fine, not every job comes from the CRM
      return NextResponse.json({ ok: true, linked: false })
    }

    const now = new Date().toISOString()
    const updates: Partial<typeof lead> = {}

    if (body.event === 'rated' && body.rating !== undefined) {
      updates.reviewRating = body.rating
    }

    if (body.event === 'completed') {
      updates.reviewCompletedAt = now
      if (body.rating !== undefined) updates.reviewRating = body.rating
    }

    if (body.event === 'flagged' && body.notes) {
      updates.reviewNotes = body.notes
    }

    await saveSalesLead({ ...lead, ...updates })

    return NextResponse.json({ ok: true, linked: true, leadId: lead.id })
  } catch (error) {
    console.error('review-callback error:', error)
    // Never crash — the customer page should still work even if CRM stamp fails
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
}
