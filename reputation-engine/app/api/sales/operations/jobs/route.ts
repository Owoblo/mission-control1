import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { listCapacityConflicts } from '@/lib/operations-capacity'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'

const conflictAlertCooldown = new Map<string, number>()
const CONFLICT_ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000

async function maybeSendConflictAlert(conflicts: ReturnType<typeof listCapacityConflicts>) {
  if (conflicts.length === 0) return

  const activeConflicts = conflicts.filter(conflict => conflict.date >= new Date().toISOString().slice(0, 10))
  if (activeConflicts.length === 0) return

  const alertKey = activeConflicts.map(conflict => `${conflict.branch}:${conflict.date}`).join('|')
  const lastSentAt = conflictAlertCooldown.get(alertKey) || 0
  if (Date.now() - lastSentAt < CONFLICT_ALERT_COOLDOWN_MS) return

  conflictAlertCooldown.set(alertKey, Date.now())

  const rows = activeConflicts
    .slice(0, 8)
    .map(conflict => `<li><b>${conflict.date}</b> · ${conflict.branch} · trucks ${conflict.trucksUsed}/${conflict.truckCapacity} · crew ${conflict.crewUsed}/${conflict.crewCapacity}</li>`)
    .join('')

  await sendRepAlertEmail(
    `Operations conflict alert · ${activeConflicts.length} red date${activeConflicts.length === 1 ? '' : 's'}`,
    `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 12px;color:#1a2744">Red scheduling conflicts detected</h2>
      <p style="margin:0 0 16px;color:#475569">Booked work is over the estimated truck or crew capacity on these dates.</p>
      <ul style="margin:0 0 16px 18px;padding:0;color:#1a2744">${rows}</ul>
      <p style="margin:0;color:#64748b;font-size:12px">Review Operations in Saturn Star OS and reassign trucks or crew immediately.</p>
    </div>`
  )
}

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const branchFilter = searchParams.get('branch') || session?.branch || null

  const [leads, quotes] = await Promise.all([listSalesLeads(), listSalesQuotes()])

  const bookedLeads = leads.filter(l => {
    if (!isBookedLikeStage(l.stage) && l.paymentStatus !== 'deposit_received' && l.paymentStatus !== 'paid_in_full') {
      return false
    }
    // operations_lead: filter to their branch (from session or query param)
    if (branchFilter && l.branch && l.branch !== branchFilter) return false
    return true
  })

  const jobs = bookedLeads.map(lead => ({
    lead,
    quote: quotes.find(q => q.leadId === lead.id && (q.status === 'accepted' || q.status === 'sent' || q.status === 'invoiced')) || null,
  })).sort((a, b) => {
    const dateA = a.quote?.moveDate || a.lead.moveDate || '9999'
    const dateB = b.quote?.moveDate || b.lead.moveDate || '9999'
    return dateA.localeCompare(dateB)
  })

  const conflicts = listCapacityConflicts(jobs)
  void maybeSendConflictAlert(conflicts)

  return NextResponse.json({ jobs, branch: branchFilter, conflicts })
}
