import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLeadForUpdate, saveSalesLead } from '@/lib/server/sales-repository'
import { canEditLead } from '@/lib/server/sales-permissions'
import { draftFeedback, feedbackEvidence } from '@/lib/server/customer-feedback'
import { emptyFeedback, validateFeedback } from '@/lib/customer-feedback'

async function access(props: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const row = await getSalesLeadForUpdate((await props.params).id)
  if (!row) return { error: NextResponse.json({ error: 'Lead not found' }, { status: 404 }) }
  if (!canEditLead(session, row.lead)) return { error: NextResponse.json({ error: 'You cannot review this lead.' }, { status: 403 }) }
  return { session, row }
}
export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await access(props)
    if (auth.error) return auth.error
    const { row } = auth
    return NextResponse.json({ feedback: row.lead.customerFeedback || emptyFeedback(), evidence: await feedbackEvidence(row.lead), version: row.updatedAt,
      suppressed: row.lead.automationStatus === 'do_not_contact' })
  } catch { return NextResponse.json({ error: 'Could not load feedback and its evidence. Please retry.' }, { status: 503 }) }
}
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const auth = await access(props)
    if (auth.error) return auth.error
    const body = await request.json()
    const { row, session } = auth
    const evidence = await feedbackEvidence(row.lead)
    if (body.action === 'draft') return NextResponse.json({ feedback: await draftFeedback(evidence) })
    if (body.action !== 'save' || body.reviewed !== true) return NextResponse.json({ error: 'Review the evidence before saving.' }, { status: 400 })
    if (body.version !== row.updatedAt) return NextResponse.json({ error: 'This lead changed. Reload feedback and review again.' }, { status: 409 })
    const feedback = validateFeedback(body.feedback, evidence)
    feedback.reviewedAt = new Date().toISOString()
    feedback.reviewedBy = session.name || session.userId
    feedback.requestedAt = row.lead.customerFeedback?.requestedAt || (feedback.status === 'requested' ? feedback.reviewedAt : undefined)
    await saveSalesLead({ ...row.lead, customerFeedback: feedback }, row.updatedAt)
    const saved = await getSalesLeadForUpdate(row.lead.id)
    if (!saved) throw new Error('Feedback saved, but refresh failed. Reload before editing again.')
    return NextResponse.json({ feedback: saved.lead.customerFeedback, version: saved.updatedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save feedback.'
    return NextResponse.json({ error: message }, { status: message.includes('changed while saving') ? 409 : 400 })
  }
}
