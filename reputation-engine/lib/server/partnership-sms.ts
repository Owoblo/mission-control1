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

const STOP_LINE = 'If this is not relevant, reply STOP and I will not follow up.'

export const DEFAULT_PARTNERSHIP_SMS_TEMPLATE =
  [
    'Hey {{firstName}}, my name is John. I own Saturn Star Movers, a local moving company serving {{city}}.',
    '',
    'I know your clients probably ask for moving referrals from time to time, so I wanted to personally introduce myself instead of just sending a random email.',
    '',
    'We are licensed and insured, and I would love to be a reliable local option if any of your buyers or sellers ever need help after closing.',
    '',
    'Would it be okay if I stopped by your office next week to drop off a few cards?',
    '',
    STOP_LINE,
  ].join('\n')

export const DEFAULT_PARTNERSHIP_SENDER_NUMBERS = [
  '+12268870667',
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

export function firstNameFromName(name?: string | null) {
  return (name || '').trim().split(/\s+/)[0] || 'there'
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
  if (/\bstop\b/i.test(message) && /\bopt\s*out\b/i.test(message)) return message.trim()
  return `${message.trim()} ${STOP_LINE}`
}

export function isOptOutText(value?: string | null) {
  const text = (value || '').trim().toLowerCase()
  return /^(stop|unsubscribe|remove|remove me|do not text|don't text|dont text|opt out|cancel)\b/.test(text)
}

function nextBusinessDay(date: Date) {
  const next = new Date(date)
  next.setDate(next.getDate() + 1)
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

export function buildPartnershipSmsSchedule(options: {
  count: number
  dailyCap: number
  senderNumbers: string[]
  startDate?: string | null
  startHour?: number
  endHour?: number
}) {
  const count = Math.max(0, options.count)
  const dailyCap = Math.max(1, options.dailyCap)
  const senders = options.senderNumbers.length ? options.senderNumbers : DEFAULT_PARTNERSHIP_SENDER_NUMBERS
  const startHour = options.startHour ?? 10
  const endHour = Math.max(startHour + 1, options.endHour ?? 17)
  const now = new Date()
  let day = options.startDate ? new Date(`${options.startDate}T${String(startHour).padStart(2, '0')}:00:00`) : new Date(now)
  if (!options.startDate) {
    if (day.getHours() < startHour) {
      day.setHours(startHour, 0, 0, 0)
    } else if (day.getHours() >= endHour) {
      day = nextBusinessDay(day)
      day.setHours(startHour, 0, 0, 0)
    } else {
      day.setMinutes(day.getMinutes() + 10, 0, 0)
    }
  } else {
    day.setHours(startHour, 0, 0, 0)
  }
  while (day.getDay() === 0 || day.getDay() === 6) day = nextBusinessDay(day)

  const schedule: Array<{ scheduledAt: string; fromNumber: string }> = []
  const minutesInWindow = Math.max(60, (endHour - startHour) * 60)
  for (let index = 0; index < count; index++) {
    const dayIndex = Math.floor(index / dailyCap)
    const positionInDay = index % dailyCap
    let scheduledDay = new Date(day)
    for (let i = 0; i < dayIndex; i++) scheduledDay = nextBusinessDay(scheduledDay)
    const spacing = minutesInWindow / Math.max(1, dailyCap)
    const minuteOffset = Math.floor(positionInDay * spacing) + (positionInDay % 4)
    scheduledDay.setHours(startHour, minuteOffset, 0, 0)
    schedule.push({
      scheduledAt: scheduledDay.toISOString(),
      fromNumber: senders[index % senders.length],
    })
  }
  return schedule
}
