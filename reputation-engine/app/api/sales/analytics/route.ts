import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { listSalesLeads } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  // Fetch leads + quotes in parallel
  const [leads, quotesRes, followupsRes] = await Promise.all([
    listSalesLeads().catch(() => []),
    fetch(`${url}/rest/v1/crm_quotes?select=id,lead_id,status,total,deposit_paid,balance_paid,created_at,move_date`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/crm_followup_logs?select=type,created_at&order=created_at.desc&limit=500`, { headers, cache: 'no-store' }),
  ])

  const quotes = quotesRes.ok ? (await quotesRes.json()) as Record<string, unknown>[] : []
  const followups = followupsRes.ok ? (await followupsRes.json()) as { type: string; created_at: string }[] : []

  // ── Lead metrics ──────────────────────────────────────────────
  const stageCounts: Record<string, number> = {}
  const sourceCounts: Record<string, number> = {}
  const cityCounts: Record<string, number> = {}
  const weeklyLeads: Record<string, number> = {}
  const monthlyLeads: Record<string, number> = {}

  for (const lead of leads) {
    stageCounts[lead.stage || 'new'] = (stageCounts[lead.stage || 'new'] || 0) + 1
    if (lead.source) sourceCounts[lead.source] = (sourceCounts[lead.source] || 0) + 1
    if (lead.originCity) cityCounts[lead.originCity] = (cityCounts[lead.originCity] || 0) + 1
    const d = lead.createdAt?.slice(0, 10) || ''
    if (d) {
      const month = d.slice(0, 7)
      monthlyLeads[month] = (monthlyLeads[month] || 0) + 1
      // ISO week
      const week = getISOWeek(d)
      weeklyLeads[week] = (weeklyLeads[week] || 0) + 1
    }
  }

  // ── Quote metrics ─────────────────────────────────────────────
  let totalQuoted = 0, totalAccepted = 0
  let revenueQuoted = 0, revenueBooked = 0, revenueCollected = 0
  const monthlyRevenue: Record<string, number> = {}

  for (const q of quotes) {
    const total = Number(q.total || 0)
    const status = String(q.status || '')
    totalQuoted++
    revenueQuoted += total
    if (['accepted', 'invoiced'].includes(status)) {
      totalAccepted++
      revenueBooked += total
      const month = String(q.created_at || '').slice(0, 7)
      if (month) monthlyRevenue[month] = (monthlyRevenue[month] || 0) + total
    }
    if (status === 'invoiced') {
      revenueCollected += Number(q.deposit_paid || 0) + Number(q.balance_paid || 0)
    }
  }

  const conversionRate = totalQuoted > 0 ? Math.round((totalAccepted / totalQuoted) * 100) : 0

  // ── Followup / activity metrics ───────────────────────────────
  const activityByType: Record<string, number> = {}
  const weeklyActivity: Record<string, number> = {}

  for (const f of followups) {
    activityByType[f.type] = (activityByType[f.type] || 0) + 1
    const week = getISOWeek(f.created_at?.slice(0, 10) || '')
    if (week) weeklyActivity[week] = (weeklyActivity[week] || 0) + 1
  }

  // ── Booked jobs ───────────────────────────────────────────────
  const booked = leads.filter(l => l.stage === 'booked')
  const bookedRevenue = booked.reduce((sum, l) => {
    const q = quotes.find(q => String(q.lead_id) === l.id)
    return sum + Number(q?.total || 0)
  }, 0)

  // Last 6 months sorted
  const last6Months = getLast6Months()

  return NextResponse.json({
    totals: {
      leads: leads.length,
      leadsThisMonth: monthlyLeads[last6Months[5]] || 0,
      quoted: totalQuoted,
      accepted: totalAccepted,
      conversionRate,
      revenueQuoted,
      revenueBooked,
      revenueCollected,
      bookedJobs: booked.length,
      bookedRevenue,
    },
    stageCounts,
    sourceCounts,
    cityCounts,
    activityByType,
    monthlyLeads: last6Months.map(m => ({ month: m, count: monthlyLeads[m] || 0 })),
    monthlyRevenue: last6Months.map(m => ({ month: m, amount: monthlyRevenue[m] || 0 })),
    weeklyActivity: Object.entries(weeklyActivity).sort(([a], [b]) => a.localeCompare(b)).slice(-8).map(([week, count]) => ({ week, count })),
  })
}

function getLast6Months(): string[] {
  const months: string[] = []
  const d = new Date()
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    months.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function getISOWeek(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(`${dateStr}T12:00:00`)
  const thursday = new Date(d)
  thursday.setDate(d.getDate() - d.getDay() + 4)
  const year = thursday.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const week = Math.ceil(((thursday.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}
