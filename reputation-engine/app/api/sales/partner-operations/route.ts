import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLead, listSalesLeads } from '@/lib/server/sales-repository'
import { createPartnerJobMessage, listPartnerJobMessages, listPartnerJobReports, updatePartnerJobReport } from '@/lib/server/partner-operations'
import { listSubcontractors } from '@/lib/server/subcontractors'
import { sendSalesMessage } from '@/lib/server/sales-messaging'

const OPS_NUMBER = '+12267746581'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const leadId = new URL(request.url).searchParams.get('leadId') || undefined
  const leads = leadId ? [await getSalesLead(leadId)].filter(Boolean) : await listSalesLeads()
  const allowed = leads.filter(lead => lead && leadMatchesSessionBranch(lead, session))
  const allowedIds = new Set(allowed.map(lead => lead!.id))
  const reports = (await listPartnerJobReports(leadId)).filter(report => allowedIds.has(report.leadId))
  const messages = leadId && allowedIds.has(leadId) ? await listPartnerJobMessages(leadId) : []
  return NextResponse.json({ reports, messages, jobs: allowed.map(lead => ({ id: lead!.id, name: lead!.name, moveDate: lead!.moveDate, branch: lead!.branch })) })
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => ({})) as { action?: 'reply' | 'update_report'; leadId?: string; subcontractorId?: string; offerId?: string; message?: string; urgent?: boolean; reportId?: string; status?: string; resolutionNote?: string }
  const lead = body.leadId ? await getSalesLead(body.leadId) : null
  if (!lead || !leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  if (body.action === 'reply') {
    if (!body.message?.trim() || !body.subcontractorId) return NextResponse.json({ error: 'Partner and message are required.' }, { status: 400 })
    const contractor = (await listSubcontractors()).find(item => item.id === body.subcontractorId)
    if (!contractor) return NextResponse.json({ error: 'Partner not found.' }, { status: 404 })
    const sent = await sendSalesMessage({ channel: 'sms', to: contractor.phone, fromNumber: OPS_NUMBER, leadId: lead.id, actor: 'human', actorName: session?.name || 'Operations', actorUserId: session?.userId, body: `Saturn Star Operations · Job ${lead.id}: ${body.message.trim()}` })
    if (sent.result.blocked) return NextResponse.json({ error: sent.result.reason || 'SMS blocked' }, { status: 400 })
    const message = await createPartnerJobMessage({ leadId: lead.id, offerId: body.offerId, subcontractorId: contractor.id, direction: 'operations_to_partner', channel: 'sms', body: body.message.trim(), media: [], senderName: session?.name || 'Operations', urgent: !!body.urgent })
    return NextResponse.json({ message }, { status: 201 })
  }
  if (body.action === 'update_report') {
    if (!body.reportId || !body.status) return NextResponse.json({ error: 'Report and status are required.' }, { status: 400 })
    return NextResponse.json({ report: await updatePartnerJobReport(body.reportId, { status: body.status, resolutionNote: body.resolutionNote, actorName: session?.name }) })
  }
  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
}
