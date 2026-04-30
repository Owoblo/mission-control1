import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { getSalesLead, getSalesQuote, saveSalesLead, saveFollowUpLog, listFollowUpLogs } from '@/lib/server/sales-repository'
import { analyzeLeadForFollowUp } from '@/lib/server/call-intelligence'
import { uid } from '@/lib/sales'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authed = await hasInternalSession()
    if (!authed) return new Response('Unauthorized', { status: 401 })

    const { id } = await params

    const [lead, allLogs] = await Promise.all([
      getSalesLead(id),
      listFollowUpLogs(),
    ])

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const leadLogs = allLogs.filter(l => l.leadId === id)
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null

    const analysis = await analyzeLeadForFollowUp(lead, leadLogs, quote ?? null)
    if (!analysis) {
      return NextResponse.json({ error: 'AI analysis unavailable — check OPENAI_API_KEY' }, { status: 503 })
    }

    const now = new Date().toISOString()

    // Persist the suggested follow-up date back to the lead
    const updatedLead = await saveSalesLead({
      ...lead,
      followUpDate: analysis.suggestedDate,
      followUpNote: analysis.followUpNote,
    })

    // Log the AI recommendation to the timeline
    await saveFollowUpLog({
      id: uid('fu'),
      leadId: id,
      type: 'note',
      date: now,
      createdAt: now,
      notes: `🤖 AI follow-up scheduled for ${analysis.suggestedDate} via ${analysis.suggestedChannel}. ${analysis.followUpNote}${analysis.commitmentDetected ? ` Commitment detected: "${analysis.commitmentDetected}"` : ''}`,
    })

    return NextResponse.json({ ok: true, analysis, lead: updatedLead })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI follow-up analysis failed' },
      { status: 500 }
    )
  }
}
