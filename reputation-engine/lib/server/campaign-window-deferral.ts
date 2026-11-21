import { buildPartnershipSmsSchedule } from './partnership-sms'

// Jobs can wait for their original window. Moving them to another day requires
// a fresh release decision and a paced schedule.
export function deferredCampaignSmsTime(notes: unknown, reason: string, now = new Date()) {
  if (reason !== 'campaign_window_not_open') return null

  try {
    const config = typeof notes === 'string' ? JSON.parse(notes) : notes
    if (!config || typeof config !== 'object') return null
    const timezone = typeof config.timezone === 'string' ? config.timezone : 'America/Toronto'
    const startHour = Number(config.startHour ?? 10)
    const endHour = Number(config.endHour ?? 17)
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour) return null

    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map(({ type, value }) => [type, value]))
    const startDate = `${parts.year}-${parts.month}-${parts.day}`
    const [slot] = buildPartnershipSmsSchedule({ count: 1, dailyCap: 1, senderNumbers: [], startDate, startHour, endHour, timezone, includeWeekends: true })
    const slotAt = Date.parse(slot.scheduledAt)
    return slotAt > now.getTime() ? slot.scheduledAt : null
  } catch {
    return null
  }
}
