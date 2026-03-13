import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, syncLeadFromQuoteStatus } from '@/lib/sales'
import { recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { deleteSalesLead, getSalesLead, getSalesQuote, saveSalesLead } from '@/lib/server/sales-repository'

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json(lead)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lead' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const updates = (await request.json()) as Partial<typeof current>
    let nextLead = normalizeLead({
      ...current,
      ...updates,
      id: current.id,
    })

    if (nextLead.quoteId && updates.stage === undefined) {
      const quote = await getSalesQuote(nextLead.quoteId)
      if (quote) {
        nextLead = syncLeadFromQuoteStatus(nextLead, quote)
      }
    }

    nextLead = normalizeLead({
      ...nextLead,
      leadScore: calculateLeadScore(nextLead),
    })

    const saved = await saveSalesLead(nextLead)
    await recordLeadUpdateAudit(current, saved)
    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update lead' },
      { status: 400 }
    )
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    await deleteSalesLead(params.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete lead' },
      { status: 400 }
    )
  }
}
