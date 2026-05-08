import { uid } from '@/lib/sales'
import { getSaturnBranchLabel } from '@/lib/sales-phones'
import { saveFollowUpLog } from '@/lib/server/sales-repository'
import type { FollowUpLog } from '@/lib/types'

export type SalesAlertSeverity = 'warning' | 'critical'

const ALERT_PREFIX = '[SYSTEM ALERT]'

export function buildSalesAlertNote(input: {
  title: string
  severity?: SalesAlertSeverity
  branchNumber?: string | null
  details?: string | null
}) {
  const severity = input.severity || 'warning'
  const branchLabel = getSaturnBranchLabel(input.branchNumber)
  const header = `${ALERT_PREFIX}[${severity}] ${input.title}${branchLabel ? ` — ${branchLabel} line` : ''}`
  return input.details ? `${header}\n${input.details}` : header
}

export function parseSalesAlertNote(notes?: string | null) {
  const raw = (notes || '').trim()
  const match = raw.match(/^\[SYSTEM ALERT\]\[(warning|critical)\]\s+(.+)$/i)
  if (!match) return null

  const [header, ...detailLines] = raw.split('\n')
  return {
    severity: match[1].toLowerCase() as SalesAlertSeverity,
    title: match[2].trim(),
    preview: detailLines.join(' ').trim() || header.replace(/^\[SYSTEM ALERT\]\[(warning|critical)\]\s+/i, ''),
  }
}

export async function createSalesSystemAlert(input: {
  title: string
  leadId?: string | null
  quoteId?: string | null
  severity?: SalesAlertSeverity
  branchNumber?: string | null
  details?: string | null
  occurredAt?: string
}) {
  const timestamp = input.occurredAt || new Date().toISOString()
  const log: FollowUpLog = {
    id: uid('fu'),
    leadId: input.leadId || undefined,
    quoteId: input.quoteId || undefined,
    type: 'note',
    date: timestamp,
    createdAt: timestamp,
    notes: buildSalesAlertNote(input),
  }

  return saveFollowUpLog(log)
}
