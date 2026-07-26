import { uid } from '@/lib/sales'
import { reconcileTentativeReservation } from '@/lib/tentative-reservation'
import { listSalesLeads, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'

export async function runTentativeReservationReconciliation(now = new Date()) {
  const leads = await listSalesLeads()
  const candidates = leads.filter(lead => lead.tentativeReservationStatus === 'active')
  const summary = { scanned: candidates.length, converted: 0, released: 0, expired: 0, errors: [] as string[] }

  for (const lead of candidates) {
    const result = reconcileTentativeReservation(lead, now)
    if (!result.changed || !result.outcome) continue
    try {
      await saveSalesLead(result.lead)
      summary[result.outcome] += 1
      await saveFollowUpLog({
        id: uid('fu'),
        leadId: lead.id,
        type: 'status_change',
        date: now.toISOString(),
        createdAt: now.toISOString(),
        notes: result.outcome === 'expired'
          ? 'Tentative courtesy hold expired. Moved to nurture for human availability review; no customer message was sent.'
          : result.outcome === 'converted'
            ? 'Tentative reservation converted to a confirmed booking.'
            : 'Tentative reservation released after the lead closed.',
      }).catch(() => undefined)
    } catch (error) {
      summary.errors.push(`${lead.id}: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  }

  return {
    status: summary.errors.length > 0 ? 'warn' as const : 'ok' as const,
    ranAt: now.toISOString(),
    ...summary,
  }
}
