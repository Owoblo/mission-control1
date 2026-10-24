import { NextResponse } from 'next/server'
import { dateStamp, estimateLeadQuote, genQuoteNumber, getDefaultPaymentTerms, normalizeClient, normalizeQuote, uid } from '@/lib/sales'
import { recordQuoteCreatedAudit } from '@/lib/server/sales-audit'
import { canAccessSalesWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getLatestSalesQuoteByLeadId, getSalesLead, getSalesQuote, listSalesClients, saveSalesClient } from '@/lib/server/sales-repository'
import { randomToken } from '@/lib/server/security'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMClient, CRMQuote, CRMLead } from '@/lib/types'

async function ensurePrimaryQuote(leadId: string, quote: CRMQuote) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/ensure_crm_primary_quote`, { method: 'POST', headers, body: JSON.stringify({ p_lead: leadId, p_quote: quote }) })
  if (!response.ok) throw new Error('The quote could not be linked safely. Refresh before trying again.')
  return response.json() as Promise<{ quote: CRMQuote; lead: CRMLead; created: boolean }>
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as { leadId?: string; moveType?: string; separateJob?: boolean; jobLabel?: string }
    if (!payload.leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
    }

    const lead = await getSalesLead(payload.leadId)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (payload.separateJob) return NextResponse.json({ error: 'Use Add additional quote to create an independent job scope. Existing bookings and deposits stay unchanged.' }, { status: 409 })

    if (lead.quoteId) {
      const primary = await getSalesQuote(lead.quoteId)
      if (!primary) throw new Error('The linked quote could not be found. Resolve its link before creating another quote.')
      return NextResponse.json({ quote: primary, lead })
    }

    const existingQuote = await getLatestSalesQuoteByLeadId(lead.id)
    if (existingQuote && !lead.quoteId) {
      return NextResponse.json(await ensurePrimaryQuote(lead.id, existingQuote))
    }

    const clients = await listSalesClients()
    let client =
      clients.find(item => item.name === lead.name || (!!lead.phone && item.phone === lead.phone)) || null

    if (!client) {
      const newClient: CRMClient = normalizeClient({
        id: uid('cli'),
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        type: lead.moveType === 'long-distance' ? 'long-distance' : 'residential',
        company: '',
        createdAt: dateStamp(),
      })
      client = await saveSalesClient(newClient)
    }

    const isConjointMovingScope = Boolean(lead.jobFactors?.conjointMove)
    const quoteMoveType = isConjointMovingScope && lead.moveType === 'labor-only' ? 'residential' : lead.moveType || 'residential'
    const quoteType = isConjointMovingScope && lead.quoteType === 'labor_only' ? 'standard' : lead.quoteType
    const trimmedJobLabel = typeof payload.jobLabel === 'string' ? payload.jobLabel.trim().slice(0, 80) : ''
    const defaultJobLabel =
      payload.separateJob
        ? 'Separate moving option'
        : isConjointMovingScope
          ? 'Conjoint residential move'
          : quoteType === 'storage'
            ? 'Storage / staged move'
            : ''
    const jobLabel = trimmedJobLabel || defaultJobLabel || undefined
    const estimate = estimateLeadQuote({ ...lead, moveType: quoteMoveType, quoteType })
    const paymentTerms = getDefaultPaymentTerms(quoteMoveType)
    const quote: CRMQuote = normalizeQuote({
      id: uid('qt'),
      number: genQuoteNumber(lead.name),
      clientId: client.id,
      leadId: lead.id,
      moveDate: lead.moveDate,
      moveType: quoteMoveType,
      quoteType,
      jobLabel: lead.additionalJobLabel || jobLabel,
      parentQuoteId: lead.parentQuoteId,
      additionalJobKind: lead.additionalJobKind,
      originAddress: lead.originAddress,
      originCity: lead.originCity,
      destAddress: lead.destAddress,
      destCity: lead.destCity,
      crewSize: estimate.crewSize,
      estimatedHours: estimate.estimatedHours,
      truckCount: estimate.truckCount,
      estimatedWeightLbs: estimate.estimatedWeightLbs,
      longDistanceDistanceKm: estimate.longDistanceDistanceKm,
      longDistanceTruckCost: estimate.longDistanceTruckCost,
      longDistanceGasCost: estimate.longDistanceGasCost,
      longDistanceInsuranceCost: estimate.longDistanceInsuranceCost,
      longDistanceMiscCost: estimate.longDistanceMiscCost,
      longDistanceMarkupRate: estimate.longDistanceMarkupRate,
      paymentTerms,
      status: 'draft',
      validDays: 30,
      acceptToken: randomToken('accept'),
      lineItems: estimate.lineItems,
      moveDescription: lead.parentQuoteId ? `${lead.additionalJobLabel || 'Additional work'} — separately priced additional scope. The original booking and its payment remain unchanged. ${lead.notes || ''}` : jobLabel ? `Quote option: ${jobLabel}` : undefined,
      discountAmount: 0,
      discountLabel: '',
      subtotal: estimate.subtotal,
      hst: estimate.hst,
      total: estimate.total,
      deposit: estimate.deposit,
      balance: estimate.balance,
      createdAt: dateStamp(),
    })

    const result = await ensurePrimaryQuote(lead.id, quote)
    if (result.created) await recordQuoteCreatedAudit(result.quote, session?.name)
    return NextResponse.json({ quote: result.quote, lead: result.lead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create quote' },
      { status: 400 }
    )
  }
}
