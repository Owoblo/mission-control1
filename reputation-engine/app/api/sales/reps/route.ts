import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { listSalesLeads, listFollowUpLogs } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session || (session.role !== 'owner' && session.role !== 'manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { url, headers } = requireSupabaseEnv()

  const [leads, followUps, quotesRes] = await Promise.all([
    listSalesLeads().catch(() => []),
    listFollowUpLogs().catch(() => []),
    fetch(`${url}/rest/v1/crm_quotes?select=id,lead_id,total,status&limit=10000`, { headers, cache: 'no-store' }),
  ])

  const quotes = quotesRes.ok ? (await quotesRes.json()) as Array<{ id: string; lead_id: string; total: number; status: string }> : []
  const quotesByLead = new Map<string, typeof quotes[0][]>()
  for (const q of quotes) {
    if (!quotesByLead.has(q.lead_id)) quotesByLead.set(q.lead_id, [])
    quotesByLead.get(q.lead_id)!.push(q)
  }

  // Group leads by rep
  const repMap = new Map<string, {
    name: string
    leads: typeof leads
    booked: typeof leads
    lost: typeof leads
  }>()

  for (const lead of leads) {
    const rep = lead.assignedRep || 'Unassigned'
    if (!repMap.has(rep)) repMap.set(rep, { name: rep, leads: [], booked: [], lost: [] })
    const bucket = repMap.get(rep)!
    bucket.leads.push(lead)
    if (lead.stage === 'booked') bucket.booked.push(lead)
    if (lead.stage === 'lost') bucket.lost.push(lead)
  }

  const stats = Array.from(repMap.entries()).map(([repId, data]) => {
    const totalLeads = data.leads.length
    const bookedLeads = data.booked.length
    const lostLeads = data.lost.length
    const closeRate = totalLeads > 0 ? Math.round((bookedLeads / totalLeads) * 100) : 0

    // Revenue from booked leads
    const revenue = data.booked.reduce((sum, l) => {
      const leadQuotes = quotesByLead.get(l.id) || []
      const accepted = leadQuotes.find(q => q.status === 'accepted' || q.status === 'invoiced')
      return sum + Number(accepted?.total || 0)
    }, 0)
    const avgDealSize = bookedLeads > 0 ? Math.round(revenue / bookedLeads) : 0

    // Days to close (booked leads)
    const daysToCloseArr = data.booked
      .filter(l => l.bookedAt && l.createdAt)
      .map(l => Math.round((new Date(l.bookedAt!).getTime() - new Date(l.createdAt).getTime()) / 86400000))
    const avgDaysToClose = daysToCloseArr.length > 0
      ? Math.round(daysToCloseArr.reduce((a, b) => a + b, 0) / daysToCloseArr.length)
      : null

    // Average touchpoints to close
    const touchpointsArr = data.booked.map(l => {
      const calls = (l.callLogs || []).length
      const msgs = followUps.filter(f => f.leadId === l.id).length
      return calls + msgs
    })
    const avgTouchpoints = touchpointsArr.length > 0
      ? Math.round(touchpointsArr.reduce((a, b) => a + b, 0) / touchpointsArr.length * 10) / 10
      : null

    // Response time: avg minutes from lead created to first call
    const responseTimes = data.leads
      .filter(l => l.callLogs && l.callLogs.length > 0 && l.createdAt)
      .map(l => {
        const firstCall = (l.callLogs || []).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0]
        if (!firstCall?.date) return null
        const mins = (new Date(firstCall.date).getTime() - new Date(l.createdAt).getTime()) / 60000
        return mins > 0 && mins < 10080 ? mins : null // ignore >7 days (data noise)
      })
      .filter((v): v is number => v !== null)
    const avgResponseMins = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null

    // Most common lost reasons
    const lostReasonCounts: Record<string, number> = {}
    for (const l of data.lost) {
      if (l.lostReason) lostReasonCounts[l.lostReason] = (lostReasonCounts[l.lostReason] || 0) + 1
    }
    const topLostReasons = Object.entries(lostReasonCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([reason, count]) => ({ reason, count }))

    // Move type breakdown for booked
    const moveTypeCounts: Record<string, number> = {}
    for (const l of data.booked) {
      if (l.moveType) moveTypeCounts[l.moveType] = (moveTypeCounts[l.moveType] || 0) + 1
    }

    // AI move readiness signals from latest calls
    const hotLeads = data.leads.filter(l =>
      (l.callLogs || []).some(c => c.aiSummary?.moveReadiness === 'hot')
    ).length

    return {
      repId,
      totalLeads,
      bookedLeads,
      lostLeads,
      inProgress: totalLeads - bookedLeads - lostLeads,
      closeRate,
      revenue,
      avgDealSize,
      avgDaysToClose,
      avgTouchpoints,
      avgResponseMins,
      hotLeads,
      topLostReasons,
      moveTypeCounts,
    }
  })

  // Sort by revenue desc
  stats.sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({ reps: stats, totalLeads: leads.length })
}
