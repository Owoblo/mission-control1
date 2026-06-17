import { digitsOnly, normalizePhone } from '@/lib/sales-phones'

export type PartnershipSmsCampaignConfig = {
  type: 'partnership_sms_campaign'
  template: string
  dailyCap: number
  senderNumbers: string[]
  timezone: string
  startHour: number
  endHour: number
  source?: string
}

export type PartnershipSmsContactInput = {
  name?: string | null
  company?: string | null
  title?: string | null
  email?: string | null
  phone?: string | null
  phone2?: string | null
  phone3?: string | null
  address?: string | null
  city?: string | null
  zone?: string | null
  industry?: string | null
  website?: string | null
  notes?: string | null
  category?: string | null
  external_id?: string | null
  profile_url?: string | null
  photo_url?: string | null
}

export const DEFAULT_PARTNERSHIP_SMS_TEMPLATE =
  [
    'Hey {{firstName}}, my name is John. I own Saturn Star Movers, a local moving company serving {{city}}.',
    '',
    'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
    '',
    'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
    '',
    'Would it be okay if I stopped by your office next week to drop off a few cards?',
  ].join('\n')

export const DEFAULT_PARTNERSHIP_SENDER_NUMBERS = [
  '+12268870667',
  '+12266055008',
]

export function normalizeOutboundNumber(value?: string | null) {
  const normalized = normalizePhone(value)
  return normalized.startsWith('+') ? normalized : ''
}

export function normalizeMarketingPhone(value?: string | null) {
  const digits = digitsOnly(value)
  if (!digits) return ''

  const nanp = digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits.length === 10
      ? digits
      : ''

  if (!nanp) return ''
  if (/^(\d)\1{9}$/.test(nanp)) return ''
  if (/^[01]/.test(nanp)) return ''
  if (/^[01]/.test(nanp.slice(3))) return ''

  return `+1${nanp}`
}

export function smsRecipientIssue(value?: string | null) {
  const raw = (value || '').trim()
  const digits = digitsOnly(raw)
  if (!digits) return raw ? 'No usable digits' : 'Missing phone'
  if (digits.length < 10) return 'Short code or incomplete number'
  if (digits.length > 11 || (digits.length === 11 && !digits.startsWith('1'))) return 'Not a US/Canada number'
  if (!normalizeMarketingPhone(raw)) return 'Invalid US/Canada phone format'
  return ''
}

export function contactPhoneKey(value?: string | null) {
  const digits = digitsOnly(normalizePhone(value))
  if (!digits) return ''
  return digits.length > 10 ? digits.slice(-10) : digits
}

export function firstFilledPhone(contact: PartnershipSmsContactInput) {
  return normalizeMarketingPhone(contact.phone) ||
    normalizeMarketingPhone(contact.phone2) ||
    normalizeMarketingPhone(contact.phone3)
}

function titleCaseNamePart(value: string) {
  if (!value) return value
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

export function formatPersonName(value?: string | null) {
  return (value || '')
    .trim()
    .split(/\s+/)
    .map(part => part
      .split('-')
      .map(piece => piece
        .split("'")
        .map(titleCaseNamePart)
        .join("'"))
      .join('-'))
    .join(' ')
}

export function firstNameFromName(name?: string | null) {
  return formatPersonName(name).split(/\s+/)[0] || 'there'
}

export function parseSmsCampaignConfig(notes?: unknown): PartnershipSmsCampaignConfig | null {
  if (!notes) return null
  let parsed: unknown = notes
  if (typeof notes === 'string') {
    try {
      parsed = JSON.parse(notes)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const config = parsed as Partial<PartnershipSmsCampaignConfig>
  if (config.type !== 'partnership_sms_campaign') return null
  const senderNumbers = (config.senderNumbers || [])
    .map(normalizeOutboundNumber)
    .filter(Boolean)
  return {
    type: 'partnership_sms_campaign',
    template: String(config.template || DEFAULT_PARTNERSHIP_SMS_TEMPLATE),
    dailyCap: Math.max(1, Math.min(500, Number(config.dailyCap || 100))),
    senderNumbers: senderNumbers.length ? senderNumbers : DEFAULT_PARTNERSHIP_SENDER_NUMBERS,
    timezone: String(config.timezone || 'America/Toronto'),
    startHour: Math.max(7, Math.min(20, Number(config.startHour || 10))),
    endHour: Math.max(8, Math.min(21, Number(config.endHour || 17))),
    source: typeof config.source === 'string' ? config.source : undefined,
  }
}

export function encodeSenderTemplateKey(fromNumber: string) {
  return `partnership_sms|${fromNumber}`
}

export function decodeSenderFromTemplateKey(templateKey?: unknown) {
  const value = String(templateKey || '')
  if (!value.startsWith('partnership_sms|')) return ''
  return normalizeOutboundNumber(value.slice('partnership_sms|'.length))
}

export function mergePartnershipSmsTemplate(
  template: string,
  contact: Record<string, unknown>,
) {
  const name = String(contact.name || '')
  const company = String(contact.company || 'your office')
  const city = String(contact.city || 'your area')
  const industry = String(contact.industry || 'real estate')
  const title = String(contact.title || contact.position || 'realtor')
  const zone = String(contact.zone || city)
  return template
    .replace(/\{\{firstName\}\}/gi, firstNameFromName(name))
    .replace(/\{\{name\}\}/gi, name || 'there')
    .replace(/\{\{company\}\}/gi, company)
    .replace(/\{\{brokerage\}\}/gi, company)
    .replace(/\{\{city\}\}/gi, city)
    .replace(/\{\{industry\}\}/gi, industry)
    .replace(/\{\{title\}\}/gi, title)
    .replace(/\{\{position\}\}/gi, title)
    .replace(/\{\{zone\}\}/gi, zone)
}

export function ensureSmsOptOutLine(message: string) {
  return message.trim()
}

export function isOptOutText(value?: string | null) {
  const text = (value || '').trim().toLowerCase()
  return /^(stop|unsubscribe|remove|remove me|do not text|don't text|dont text|opt out|cancel)\b/.test(text)
}

type PlainDate = { year: number; month: number; day: number }

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  }
}

function zonedDateToUtc(date: PlainDate, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0, 0)
  const parts = zonedParts(new Date(guess), timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0)
  return new Date(guess - (asUtc - guess))
}

function addDays(date: PlainDate, days: number): PlainDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days, 12, 0, 0, 0))
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
}

function dayOfWeek(date: PlainDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12, 0, 0, 0)).getUTCDay()
}

function nextBusinessDay(date: PlainDate) {
  let next = addDays(date, 1)
  while (dayOfWeek(next) === 0 || dayOfWeek(next) === 6) {
    next = addDays(next, 1)
  }
  return next
}

function advanceBusinessDays(date: PlainDate, days: number) {
  let next = date
  for (let i = 0; i < days; i++) next = nextBusinessDay(next)
  return next
}

function parsePlainDate(value?: string | null): PlainDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '')
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

export function buildPartnershipSmsSchedule(options: {
  count: number
  dailyCap: number
  senderNumbers: string[]
  startDate?: string | null
  startHour?: number
  endHour?: number
  timezone?: string
}) {
  const count = Math.max(0, options.count)
  const dailyCap = Math.max(1, options.dailyCap)
  const senders = options.senderNumbers.length ? options.senderNumbers : DEFAULT_PARTNERSHIP_SENDER_NUMBERS
  const startHour = options.startHour ?? 10
  const endHour = Math.max(startHour + 1, options.endHour ?? 17)
  const timezone = options.timezone || 'America/Toronto'
  const now = new Date()
  const nowParts = zonedParts(now, timezone)
  let day = parsePlainDate(options.startDate) || { year: nowParts.year, month: nowParts.month, day: nowParts.day }
  let firstHour = startHour
  let firstMinute = 0

  if (!options.startDate && nowParts.hour >= startHour && nowParts.hour < endHour) {
    const nextMinute = nowParts.minute + 10
    firstHour = nowParts.hour + Math.floor(nextMinute / 60)
    firstMinute = nextMinute % 60
    if (firstHour >= endHour) {
      day = nextBusinessDay(day)
      firstHour = startHour
      firstMinute = 0
    }
  } else if (!options.startDate && nowParts.hour >= endHour) {
    day = nextBusinessDay(day)
  } else {
    firstHour = startHour
    firstMinute = 0
  }
  while (dayOfWeek(day) === 0 || dayOfWeek(day) === 6) day = nextBusinessDay(day)

  const schedule: Array<{ scheduledAt: string; fromNumber: string }> = []
  const minutesInWindow = Math.max(60, (endHour - startHour) * 60)
  for (let index = 0; index < count; index++) {
    const dayIndex = Math.floor(index / dailyCap)
    const positionInDay = index % dailyCap
    const scheduledDay = advanceBusinessDays(day, dayIndex)
    const spacing = minutesInWindow / Math.max(1, dailyCap)
    const initialOffset = dayIndex === 0 ? Math.max(0, (firstHour - startHour) * 60 + firstMinute) : 0
    const minuteOffset = initialOffset + Math.floor(positionInDay * spacing) + (positionInDay % 4)
    const hour = startHour + Math.floor(minuteOffset / 60)
    const minute = minuteOffset % 60
    schedule.push({
      scheduledAt: zonedDateToUtc(scheduledDay, Math.min(hour, endHour - 1), minute, timezone).toISOString(),
      fromNumber: senders[index % senders.length],
    })
  }
  return schedule
}
