import dotenv from 'dotenv'
import { buildSalesCaseSitrep } from '../lib/sales-case-sitrep'
import { uid } from '../lib/sales'
import { getSalesLeadForUpdate, listFollowUpLogs, listSalesEmails, listSalesLeads, listSalesQuotes, saveFollowUpLog, saveSalesLead } from '../lib/server/sales-repository'
import { listSmsMessages } from '../lib/server/sms-threads'
import { requireSupabaseEnv } from '../lib/server/runtime'
import type { SalesCasePartnershipTouch } from '../lib/sales-case-sitrep'

dotenv.config({ path: '.vercel/.env.production.local' })

const MARKER = 'CASE SITREP v1 — '
const startAt = new Date('2026-09-21T04:00:00.000Z')
const endAt = new Date('2026-10-22T03:59:59.999Z')
const startDate = '2026-09-21'
const endDate = '2026-10-21'
const apply = process.argv.includes('--apply')
const refresh = process.argv.includes('--refresh')

function timestampInWindow(value?: string) {
  if (!value) return false
  const time = Date.parse(value)
  return Number.isFinite(time) && time >= startAt.getTime() && time <= endAt.getTime()
}

function dateInWindow(value?: string) {
  return Boolean(value && value >= startDate && value <= endDate)
}

async function readPartnershipTouches(contactIds: string[]) {
  const ids = Array.from(new Set(contactIds.filter(Boolean)))
  if (!ids.length) return new Map<string, SalesCasePartnershipTouch[]>()
  const { url, headers } = requireSupabaseEnv()
  const grouped = new Map<string, SalesCasePartnershipTouch[]>()
  for (let offset = 0; offset < ids.length; offset += 40) {
    const batch = ids.slice(offset, offset + 40)
    const query = new URLSearchParams({
      select: 'id,contact_id,direction,channel,notes,created_at',
      contact_id: `in.(${batch.join(',')})`,
      order: 'created_at.asc',
      limit: '5000',
    })
    const response = await fetch(`${url}/rest/v1/market_touches?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error(`Could not read linked Partnerships history (${response.status}).`)
    const rows = await response.json() as Array<{ id: string; contact_id: string; direction?: string; channel?: string; notes?: string | null; created_at: string }>
    for (const row of rows) {
      const touches = grouped.get(row.contact_id) || []
      touches.push({ id: row.id, direction: row.direction, channel: row.channel, notes: row.notes, createdAt: row.created_at })
      grouped.set(row.contact_id, touches)
    }
  }
  return grouped
}

async function main() {
  const [leads, quotes, logs, emails] = await Promise.all([
    listSalesLeads(), listSalesQuotes(), listFollowUpLogs(), listSalesEmails(),
  ])
  const lost = leads.filter(lead => lead.stage === 'lost' && timestampInWindow(lead.lostAt))
  const booked = leads.filter(lead => ['booked', 'completed', 'customer_success'].includes(lead.stage)
    && (timestampInWindow(lead.bookedAt) || dateInWindow(lead.moveDate)))
  const targets = [...lost, ...booked]
  const touchesByContact = await readPartnershipTouches(targets.flatMap(lead => [lead.partnerReferralContactId, lead.relationshipContactId].filter((id): id is string => Boolean(id))))
  const summaries: Array<{ id: string; name: string; stage: string; events: number; callLogs: number; messageCount: number; partnerTouches: number; reportLength: number; flags: string[] }> = []
  let attached = 0
  let refreshed = 0
  let alreadyPresent = 0

  for (const target of targets) {
    let lead = target
    if (lead.id === 'lead_5p16pkjjt' && (!lead.originAccess || !lead.destAccess)) {
      const latest = await getSalesLeadForUpdate(lead.id)
      if (!latest) throw new Error(`Jesse lead disappeared before access update: ${lead.id}`)
      const updated = {
        ...latest.lead,
        originAccess: latest.lead.originAccess || 'Apartment, 2nd floor (1 flight); elevator availability not confirmed',
        destAccess: latest.lead.destAccess || 'Apartment, 2nd floor (1 flight); elevator availability not confirmed',
        originStairFlights: latest.lead.originStairFlights ?? 1,
        destStairFlights: latest.lead.destStairFlights ?? 1,
      }
      if (apply) await saveSalesLead(updated, latest.updatedAt)
      lead = updated
    }
    const [messages] = await Promise.all([
      listSmsMessages(lead.phone || lead.identityPhone, lead.id),
    ])
    const leadQuotes = quotes.filter(quote => quote.leadId === lead.id || lead.quoteIds?.includes(quote.id))
    const leadLogs = logs.filter(log => log.leadId === lead.id || leadQuotes.some(quote => log.quoteId === quote.id))
    const leadEmails = emails.filter(email => email.leadId === lead.id || leadQuotes.some(quote => email.quoteId === quote.id))
    const partnerTouches = [lead.partnerReferralContactId, lead.relationshipContactId]
      .filter((id): id is string => Boolean(id))
      .flatMap(id => touchesByContact.get(id) || [])
      .filter((touch, index, all) => all.findIndex(item => item.id === touch.id) === index)
    const report = buildSalesCaseSitrep({
      lead,
      messages: messages.map(message => ({ id: message.id, direction: message.direction, body: message.body, createdAt: message.created_at, channel: 'sms' })),
      partnershipTouches: partnerTouches,
      contextNotes: lead.id === 'lead_5p16pkjjt'
        ? ['Owner confirms an apartment move from a 2nd floor to a 2nd floor; elevator availability was not stated.']
        : [],
      emails: leadEmails,
      followUps: leadLogs,
      quotes: leadQuotes,
      asOf: new Date(),
    })
    const reportExists = (lead.stage === 'lost' ? lead.lostNotes : lead.notes)?.includes(MARKER)
    const auditLogExists = logs.some(log => log.leadId === lead.id && log.notes?.includes(MARKER))
    const flags = [
      lead.moveDate && dateInWindow(lead.moveDate) && lead.moveDate < '2026-10-21' && lead.stage === 'booked' ? 'past move date; still booked' : '',
      lead.stage === 'lost' && (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || Number(lead.depositAmount || 0) > 0) ? 'lost with payment/deposit recorded' : '',
      !lead.originAccess ? 'origin access missing' : '',
      !lead.destAccess ? 'destination access missing' : '',
      !lead.moveDate ? 'move date missing' : '',
    ].filter(Boolean)
    summaries.push({ id: lead.id, name: lead.name, stage: lead.stage, events: (lead.callLogs?.length || 0) + messages.length + partnerTouches.length + leadEmails.length + leadLogs.length + leadQuotes.length, callLogs: lead.callLogs?.length || 0, messageCount: messages.length, partnerTouches: partnerTouches.length, reportLength: report.length, flags })
    if (reportExists) {
      if (!apply || !refresh) {
        alreadyPresent += 1
        if (!apply || auditLogExists) continue
      }
    }
    if (!apply) continue

    const latest = await getSalesLeadForUpdate(lead.id)
    if (!latest) throw new Error(`Lead disappeared before SITREP save: ${lead.id}`)
    const latestField = latest.lead.stage === 'lost' ? 'lostNotes' : 'notes'
    const existing = latest.lead[latestField] || ''
    const existingReportIndex = existing.indexOf(MARKER)
    const shouldWriteReport = existingReportIndex < 0 || refresh
    if (shouldWriteReport) {
      const preservedText = existingReportIndex >= 0 ? existing.slice(0, existingReportIndex).trim() : existing.trim()
      const updatedLead = {
        ...latest.lead,
        [latestField]: [preservedText, report].filter(Boolean).join('\n\n'),
      }
      await saveSalesLead(updatedLead, latest.updatedAt)
      if (existingReportIndex >= 0) refreshed += 1
      else attached += 1
    }
    if (!auditLogExists) {
      const now = new Date().toISOString()
      const auditLog = {
        id: uid('fu'),
        leadId: latest.lead.id,
        type: 'note' as const,
        date: now,
        createdAt: now,
        notes: `${MARKER}${latest.lead.name} attached to ${latestField}. Evidence: ${lead.callLogs?.length || 0} calls, ${messages.length} sales SMS, ${partnerTouches.length} partnership touches, ${leadEmails.length} emails, ${leadQuotes.length} quotes. Refresh the report after new activity; inspect any DATA GAPS / FOLLOW-UP flags.`,
      }
      let saved = false
      for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
        try {
          await saveFollowUpLog(auditLog)
          saved = true
        } catch (error) {
          if (attempt === 2) throw error
          await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
        }
      }
    }
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preview',
    window: `${startDate} through ${endDate} (America/Toronto)`,
    totals: { lost: lost.length, bookedLike: booked.length, target: targets.length, attached, refreshed, alreadyPresent },
    summaries,
  }, null, 2))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
