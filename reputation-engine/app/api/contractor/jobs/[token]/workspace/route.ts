import { NextResponse } from 'next/server'
import { getSalesQuote, listSalesLeads, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { createPartnerJobMessage, createPartnerJobReport, listPartnerJobMessages, listPartnerJobReports } from '@/lib/server/partner-operations'
import { uid } from '@/lib/sales'
import type { MoveExecutionIssue, QuoteChangeEntry } from '@/lib/types'

async function contextForToken(token: string) {
  const leads = await listSalesLeads()
  for (const lead of leads) {
    const entry = (lead.crewPayouts || []).find(item => item.dispatchToken === token && item.subcontractorId)
    if (!entry) continue
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null
    return { lead, entry, quote }
  }
  return null
}

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const match = await contextForToken(token)
  if (!match) return NextResponse.json({ error: 'Partner job access not found.' }, { status: 404 })
  const [messages, reports] = await Promise.all([listPartnerJobMessages(match.lead.id), listPartnerJobReports(match.lead.id)])
  return NextResponse.json({ messages, reports, operationsPhone: '+12267746581' })
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const match = await contextForToken(token)
  if (!match) return NextResponse.json({ error: 'Partner job access not found.' }, { status: 404 })
  const body = await request.json().catch(() => ({})) as { action?: 'message' | 'report'; body?: string; urgent?: boolean; reportType?: string; severity?: 'routine' | 'urgent' | 'critical'; summary?: string; details?: string; requestedExtraHours?: number; requestedAdjustment?: number; media?: Array<{ url: string; contentType?: string }> }
  const base = { leadId: match.lead.id, offerId: match.entry.subcontractorOfferId, subcontractorId: match.entry.subcontractorId }
  if (body.action === 'message') {
    if (!body.body?.trim()) return NextResponse.json({ error: 'Message is required.' }, { status: 400 })
    const message = await createPartnerJobMessage({ ...base, direction: 'partner_to_operations', channel: 'portal', body: body.body.trim(), media: body.media || [], senderName: match.entry.workerName, urgent: !!body.urgent })
    return NextResponse.json({ message }, { status: 201 })
  }
  if (body.action === 'report') {
    if (!body.reportType || !body.summary?.trim()) return NextResponse.json({ error: 'Report type and summary are required.' }, { status: 400 })
    const report = await createPartnerJobReport({ ...base, reportType: body.reportType, severity: body.severity || 'urgent', summary: body.summary.trim(), details: body.details?.trim(), requestedExtraHours: body.requestedExtraHours, requestedAdjustment: body.requestedAdjustment, media: body.media || [], reportedBy: match.entry.workerName })
    const now = new Date().toISOString()
    const issue: MoveExecutionIssue = { id: uid('issue'), category: body.reportType.includes('damage') ? 'damage' : body.reportType.includes('truck') ? 'truck' : body.reportType.includes('crew') ? 'crew' : body.reportType.includes('inventory') ? 'inventory' : body.reportType.includes('access') || body.reportType.includes('parking') ? 'access' : 'other', severity: body.severity === 'critical' ? 'high' : body.severity === 'urgent' ? 'medium' : 'low', note: `${body.summary.trim()}${body.details?.trim() ? ` — ${body.details.trim()}` : ''}`, createdAt: now, createdBy: match.entry.workerName }
    await saveSalesLead({ ...match.lead, moveExecutionLog: { ...(match.lead.moveExecutionLog || {}), issues: [...(match.lead.moveExecutionLog?.issues || []), issue], updatedAt: now, updatedBy: match.entry.workerName }, lastTouchedAt: now })
    const scopeTypes = new Set(['additional_inventory', 'additional_labor', 'additional_truck', 'customer_disagreement'])
    if (match.quote && scopeTypes.has(body.reportType)) {
      const change: QuoteChangeEntry = { id: uid('chg'), changedAt: now, changedBy: match.entry.workerName, reason: body.summary.trim(), note: body.details?.trim(), changeType: 'scope_change', previousTotal: match.quote.total, newTotal: match.quote.total, estimatedExtraCost: body.requestedAdjustment, deltaHours: body.requestedExtraHours, customerNotified: false, approvalRequired: true, approvalStatus: 'pending', originalBillingModel: match.quote.billingModel }
      await saveSalesQuote({ ...match.quote, changeLog: [...(match.quote.changeLog || []), change] })
    }
    await createPartnerJobMessage({ ...base, direction: 'system', channel: 'system', body: `FIELD REPORT · ${body.reportType.replaceAll('_', ' ')} · ${body.summary.trim()}`, media: body.media || [], senderName: 'Partner reporting system', urgent: body.severity !== 'routine' })
    return NextResponse.json({ report }, { status: 201 })
  }
  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
}
