import type { CRMLead } from './types'
export const DEFAULT_NURTURE_INTERVAL_DAYS = 14
export const DEFAULT_NURTURE_RETURN_WINDOW_DAYS = 30

export function calendarDate(value: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}
export function validNurtureDate(value?: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(value + 'T00:00:00Z')
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}
export function isWithinNurtureReturnWindow(moveDate?: string | null, today = new Date(), windowDays = DEFAULT_NURTURE_RETURN_WINDOW_DAYS) {
  if (!validNurtureDate(moveDate)) return false
  const daysAway = (Date.parse(moveDate + 'T00:00:00Z') - Date.parse(calendarDate(today) + 'T00:00:00Z')) / 86400000
  return daysAway >= 0 && daysAway <= windowDays
}
export function nextNurtureCheckInDate(base: Date | string, intervalDays = DEFAULT_NURTURE_INTERVAL_DAYS) {
  const date = typeof base === 'string' ? base.slice(0, 10) : calendarDate(base)
  if (!validNurtureDate(date) || !Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) throw new Error('Choose a check-in interval between 1 and 365 days.')
  return new Date(Date.parse(date + 'T00:00:00Z') + intervalDays * 86400000).toISOString().slice(0, 10)
}
export function applyNurtureTransition(current: CRMLead, next: CRMLead, now = new Date()): CRMLead {
  if (next.stage === 'lost') return { ...next, followUpDate: undefined, followUpNote: undefined, followUpStatus: undefined, nurtureNextCheckInAt: undefined }
  if (next.stage !== 'nurture') return { ...next, nurtureNextCheckInAt: undefined }
  const entering = current.stage !== 'nurture'
  if ((entering || next.moveDate !== current.moveDate) && (!validNurtureDate(next.moveDate) || next.moveDate < calendarDate(now))) throw new Error('Confirm a valid expected move date before moving to Nurture.')
  const interval = next.nurtureIntervalDays ?? DEFAULT_NURTURE_INTERVAL_DAYS
  const window = next.nurtureReturnWindowDays ?? DEFAULT_NURTURE_RETURN_WINDOW_DAYS
  if (!Number.isInteger(interval) || interval < 1 || interval > 365 || !Number.isInteger(window) || window < 0 || window > 365) throw new Error('Check-in interval must be 1–365 days; return window must be 0–365 days.')
  const date = entering || !next.followUpDate ? nextNurtureCheckInDate(now, interval) : next.followUpDate
  if (!validNurtureDate(date)) throw new Error('Choose a valid next check-in date.')
  return { ...next, moveDateFlexible: false, nurtureIntervalDays: interval, nurtureReturnWindowDays: window, followUpDate: date, followUpStatus: 'pending', nurtureNextCheckInAt: date + 'T14:00:00.000Z', lostAt: undefined, lostReason: undefined, lostNotes: undefined }
}

export function recordNurtureCheckIn(lead: CRMLead, notes: string, actor: { name?: string; userId?: string }, now = new Date()): CRMLead {
  if (lead.stage !== 'nurture' || !notes.trim()) throw new Error('Record check-in notes on a Nurture lead.')
  const date = nextNurtureCheckInDate(now, lead.nurtureIntervalDays)
  return { ...lead, nurtureLastCheckInAt: now.toISOString(), followUpDate: date, followUpStatus: 'pending', nurtureNextCheckInAt: date + 'T14:00:00.000Z', nurtureCheckIns: [...(lead.nurtureCheckIns || []), { id: crypto.randomUUID(), at: now.toISOString(), notes: notes.trim(), actorName: actor.name, actorUserId: actor.userId }] }
}

export function nurtureReminderDue(lead: CRMLead, now = new Date()) {
  return lead.stage === 'nurture' && validNurtureDate(lead.followUpDate) && lead.followUpDate <= calendarDate(now)
}
