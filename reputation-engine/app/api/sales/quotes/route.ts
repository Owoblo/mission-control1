import { NextResponse } from 'next/server'
import { dateStamp, estimateLeadQuote, genQuoteNumber, normalizeClient, normalizeQuote, syncLeadFromQuoteStatus, uid } from '@/lib/sales'
import { getLatestSalesQuoteByLeadId, getSalesLead, listSalesClients, saveSalesClient, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import type { CRMClient, CRMQuote } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { leadId?: string; force?: boolean }
    if (!payload.leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
    }

    const lead = await getSalesLead(payload.leadId)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Without force=true, return existing quote if one exists (prevents accidental duplicates)
    if (!payload.force) {
      if (lead.quoteId) {
        return NextResponse.json({ error: 'Lead already has a linked quote', quoteId: lead.quoteId }, { status: 409 })
      }
      const existingQuote = await getLatestSalesQuoteByLeadId(lead.id)
      if (existingQuote) {
        const savedLead = await saveSalesLead(syncLeadFromQuoteStatus({ ...lead, quoteId: existingQuote.id }, existingQuote))
        return NextResponse.json({ quote: existingQuote, lead: savedLead })
      }
    }

    // force=true: supersede any existing quote with a brand-new one (fresh pricing, new token)
    if (payload.force) {
      const existingQuote = await getLatestSalesQuoteByLeadId(lead.id)
      if (existingQuote && existingQuote.status !== 'accepted') {
        // Invalidate old quote by clearing its token
        await saveSalesQuote({ ...existingQuote, acceptToken: '', status: 'declined' })
      }
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
      acceptToken: uid('accept') + Date.now().toString(36),
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
      savedLead = await saveSalesLead(syncLeadFromQuoteStatus({ ...lead, quoteId: savedQuote.id }, savedQuote))
    } catch (leadError) {
      // Quote was created but lead link failed. On retry, getLatestSalesQuoteByLeadId will
      // find and re-link the orphaned quote automatically — no data loss.
      throw new Error(
        `Quote ${savedQuote.id} saved but lead update failed: ${leadError instanceof Error ? leadError.message : 'unknown'}`
      )
    }

    return NextResponse.json({ quote: savedQuote, lead: savedLead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create quote' },
      { status: 400 }
    )
  }
}
