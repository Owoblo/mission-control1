/**
 * Data Export — dump everything for LLM pattern analysis
 * GET /api/admin/export?format=json&from=2025-01-01
 *
 * Returns structured JSON with all leads, events, calls, quotes,
 * costs, and outcomes — ready to paste into Claude/GPT for analysis.
 */

import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { listFollowUpLogs, listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'

async function queryTable(table: string, fromDate?: string) {
  const { url, headers } = requireSupabaseEnv()
  let endpoint = `${url}/rest/v1/${table}?order=created_at.asc&limit=10000`
  if (fromDate) endpoint += `&created_at=gte.${fromDate}`
  const res = await fetch(endpoint, { headers })
  if (!res.ok) return []
  return res.json()
}

export async function GET(req: Request) {
  try {
    const session = await getSessionUser()
    if (!session || (session.role !== 'owner' && session.role !== 'manager')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const url = new URL(req.url)
    const fromDate = url.searchParams.get('from') || undefined

    const [leads, quotes, followUps, events, outcomes, costs] = await Promise.all([
      listSalesLeads(),
      listSalesQuotes(),
      listFollowUpLogs(),
      queryTable('analytics_events', fromDate),
      queryTable('job_outcomes', fromDate),
      queryTable('job_costs', fromDate),
    ])

    // Build enriched lead summaries for easy LLM analysis
    const enrichedLeads = leads.map(lead => {
      const leadQuotes = quotes.filter(q => q.leadId === lead.id)
      const leadFollowUps = followUps.filter(f => f.leadId === lead.id)
      const leadEvents = (events as any[]).filter((e: any) => e.lead_id === lead.id)
      const leadCosts = (costs as any[]).filter((c: any) => c.lead_id === lead.id)
      const leadOutcome = (outcomes as any[]).find((o: any) => o.lead_id === lead.id)

      const totalCosts = leadCosts.reduce((sum: number, c: any) => sum + (c.amount_cents || 0), 0)
      const bestQuote = leadQuotes.find(q => q.status === 'accepted') || leadQuotes[0]

      return {
        id: lead.id,
        name: lead.name,
        stage: lead.stage,
        source: lead.source,
        moveType: lead.moveType,
        originCity: lead.originCity,
        destCity: lead.destCity,
        moveDate: lead.moveDate,
        assignedRep: lead.assignedRep,
        leadScore: lead.leadScore,
        createdAt: lead.createdAt,
        bookedAt: lead.bookedAt,
        lostReason: lead.lostReason,
        lostNotes: lead.lostNotes,
        totalCubicFeet: lead.totalCubicFeet,
        totalItems: lead.totalItems,
        hasSpecialtyItems: !!(lead.jobFactors?.hasPiano || lead.jobFactors?.hasSafe),
        floorsOrigin: lead.jobFactors?.originFloors,
        floorsDest: lead.jobFactors?.destFloors,
        hasElevator: lead.jobFactors?.originHasElevator || lead.jobFactors?.destHasElevator,
        depositMethod: lead.depositMethod,
        depositAmount: lead.depositAmount,
        // Quote data
        quotedAmount: bestQuote?.total,
        quoteStatus: bestQuote?.status,
        crewSize: bestQuote?.crewSize,
        estimatedHours: bestQuote?.estimatedHours,
        truckCount: bestQuote?.truckCount,
        discountGiven: bestQuote?.discountAmount,
        // Derived metrics
        daysToClose: lead.bookedAt ? Math.round((new Date(lead.bookedAt).getTime() - new Date(lead.createdAt).getTime()) / 86400000) : null,
        callCount: (lead.callLogs || []).filter(c => c.type === 'call').length,
        touchpointCount: leadFollowUps.length + (lead.callLogs || []).length,
        smsCount: leadFollowUps.filter(f => f.type === 'sms').length,
        emailCount: leadFollowUps.filter(f => f.type === 'email').length,
        consultationCount: (lead.callLogs || []).filter(c => c.source === 'consultation').length,
        // AI insights from calls (most recent)
        latestMoveReadiness: (lead.callLogs || []).slice().reverse().find(c => c.aiSummary?.moveReadiness)?.aiSummary?.moveReadiness,
        // Financial
        revenueCents: bestQuote?.total ? Math.round(bestQuote.total * 100) : null,
        totalCostsCents: totalCosts,
        netProfitCents: bestQuote?.total ? Math.round(bestQuote.total * 100) - totalCosts : null,
        // Job outcome
        actualHours: leadOutcome?.actual_hours,
        customerRating: leadOutcome?.customer_rating,
        reviewLeft: leadOutcome?.review_left,
        referralGenerated: leadOutcome?.referral_generated,
        damageFlagged: leadOutcome?.damage_flag,
      }
    })

    // Summary stats for quick LLM context
    const bookedLeads = enrichedLeads.filter(l => isBookedLikeStage(l.stage))
    const lostLeads = enrichedLeads.filter(l => l.stage === 'lost')
    const totalRevenue = bookedLeads.reduce((sum, l) => sum + (l.revenueCents || 0), 0) / 100

    const summary = {
      exportDate: new Date().toISOString(),
      fromDate: fromDate || 'all time',
      totals: {
        leads: enrichedLeads.length,
        booked: bookedLeads.length,
        lost: lostLeads.length,
        conversionRate: enrichedLeads.length > 0 ? Math.round((bookedLeads.length / enrichedLeads.length) * 100) : 0,
        totalRevenue,
        analyticsEvents: (events as any[]).length,
      },
    }

    const payload = {
      _instructions: 'Saturn Star Moving Company — full operational data export. Analyze for patterns in conversion rates, pricing, rep performance, lead sources, call effectiveness, and cost optimization.',
      summary,
      leads: enrichedLeads,
      analyticsEvents: events,
      jobOutcomes: outcomes,
    }

    const format = url.searchParams.get('format')
    if (format === 'csv') {
      // Simple CSV of leads for spreadsheet use
      const csvHeaders = Object.keys(enrichedLeads[0] || {}).join(',')
      const csvRows = enrichedLeads.map(l =>
        Object.values(l).map(v => (typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v ?? ''))).join(',')
      )
      return new Response([csvHeaders, ...csvRows].join('\n'), {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="saturn-star-export-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    )
  }
}
