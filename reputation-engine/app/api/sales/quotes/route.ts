import { NextResponse } from 'next/server'
import { dateStamp, estimateLeadQuote, genQuoteNumber, normalizeClient, normalizeQuote, syncLeadFromQuoteStatus, uid } from '@/lib/sales'
import { recordQuoteCreatedAudit } from '@/lib/server/sales-audit'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getLatestSalesQuoteByLeadId, getSalesLead, listSalesClients, saveSalesClient, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { randomToken } from '@/lib/server/security'
import type { CRMClient, CRMQuote } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as { leadId?: string; moveType?: string }
    if (!payload.leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
    }

    const lead = await getSalesLead(payload.leadId)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // If lead has a primary quote, allow adding more (multi-job support — e.g. residential + commercial)
    // Don't block — just create a new quote and track it in quoteIds

    const existingQuote = await getLatestSalesQuoteByLeadId(lead.id)
    if (existingQuote && !lead.quoteId) {
      // Re-link orphaned quote
      const existingIds = lead.quoteIds || []
      const allIds = Array.from(new Set([...existingIds, existingQuote.id]))
      const savedLead = await saveSalesLead(syncLeadFromQuoteStatus({ ...lead, quoteId: existingQuote.id, quoteIds: allIds }, existingQuote))
      return NextResponse.json({ quote: existingQuote, lead: savedLead })
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

    const estimate = estimateLeadQuote(lead)
    const quote: CRMQuote = normalizeQuote({
      id: uid('qt'),
      number: genQuoteNumber(lead.name),
      clientId: client.id,
      leadId: lead.id,
      moveDate: lead.moveDate,
      moveType: lead.moveType || 'residential',
      originAddress: lead.originAddress,
      originCity: lead.originCity,
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
      status: 'draft',
      validDays: 30,
      acceptToken: randomToken('accept'),
      lineItems: estimate.lineItems,
      discountAmount: 0,
      discountLabel: '',
      subtotal: estimate.subtotal,
      hst: estimate.hst,
      total: estimate.total,
      deposit: estimate.deposit,
      balance: estimate.balance,
      createdAt: dateStamp(),
    })

    const savedQuote = await saveSalesQuote(quote)

    let savedLead
    try {
      // Track all quote IDs for this lead (multi-job support)
      const existingIds = lead.quoteIds || (lead.quoteId ? [lead.quoteId] : [])
      const allIds = Array.from(new Set([...existingIds, savedQuote.id]))
      const primaryQuoteId = lead.quoteId || savedQuote.id
      const isFirstQuote = !lead.quoteId
      const leadWithQuoteIds = { ...lead, quoteId: primaryQuoteId, quoteIds: allIds }
      // Only sync stage from quote status for the first/primary quote — avoid regressing stage on additional jobs
      savedLead = isFirstQuote
        ? await saveSalesLead(syncLeadFromQuoteStatus(leadWithQuoteIds, savedQuote))
        : await saveSalesLead(leadWithQuoteIds)
    } catch (leadError) {
      // Quote was created but lead link failed. On retry, getLatestSalesQuoteByLeadId will
      // find and re-link the orphaned quote automatically — no data loss.
      throw new Error(
        `Quote ${savedQuote.id} saved but lead update failed: ${leadError instanceof Error ? leadError.message : 'unknown'}`
      )
    }

    await recordQuoteCreatedAudit(savedQuote, session?.name)

    return NextResponse.json({ quote: savedQuote, lead: savedLead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create quote' },
      { status: 400 }
    )
  }
}
