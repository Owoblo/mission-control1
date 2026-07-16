import { requireSupabaseEnv } from '@/lib/server/runtime'

export interface DaySchedule { open: string; close: string }

export interface BlockedCaller {
  phone: string
  tag: string
  note?: string
  blockedAt: string
  blockedBy?: string
}

export interface DialerSettings {
  businessHours: {
    enabled: boolean
    timezone: string
    schedule: {
      mon: DaySchedule | null
      tue: DaySchedule | null
      wed: DaySchedule | null
      thu: DaySchedule | null
      fri: DaySchedule | null
      sat: DaySchedule | null
      sun: DaySchedule | null
    }
  }
  ivr: { enabled: boolean; greeting: string }
  queue: { enabled: boolean; maxWaitSeconds: number }
  voicemail: { enabled: boolean; greeting: string }
  notifications: {
    emails: string[]
    repPhones: string[]        // SMS to these numbers for missed calls, voicemails, and caller ID
    notifyOnMissedCall: boolean
    notifyOnSms: boolean
    notifyOnVoicemail: boolean
    notifyCallerIdSms: boolean // ping rep phone when a saved lead calls on Groundwire
  }
  sipUsers: string[]
  ringTimeout: number
  blockedCallers: BlockedCaller[]
}

export const DEFAULT_SETTINGS: DialerSettings = {
  businessHours: {
    enabled: true,
    timezone: 'America/Toronto',
    schedule: {
      mon: { open: '08:00', close: '21:00' },
      tue: { open: '08:00', close: '21:00' },
      wed: { open: '08:00', close: '21:00' },
      thu: { open: '08:00', close: '21:00' },
      fri: { open: '08:00', close: '21:00' },
      sat: { open: '08:00', close: '21:00' },
      sun: { open: '10:00', close: '18:00' },
    },
  },
  ivr: {
    enabled: false,
    greeting: 'Press 1 to get a moving quote. Press 2 for an existing booking. Or stay on the line to speak with a rep.',
  },
  queue: { enabled: true, maxWaitSeconds: 120 },
  voicemail: {
    enabled: true,
    greeting: "Hi! You've reached Saturn Star Moving. Please leave a short message and we'll call you back within the hour.",
  },
  notifications: {
    emails: ['business@starmovers.ca'],
    repPhones: ['+12267241730'],
    notifyOnMissedCall: true,
    notifyOnSms: true,
    notifyOnVoicemail: true,
    notifyCallerIdSms: true,
  },
  sipUsers: ['john', 'salesrep1'],
  ringTimeout: 28,
  blockedCallers: [],
}

export function normalizeBlockedCallerPhone(value?: string | null) {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`
  return ''
}

export function findBlockedCaller(settings: DialerSettings, phone?: string | null) {
  const normalized = normalizeBlockedCallerPhone(phone)
  if (!normalized) return null
  return (settings.blockedCallers || []).find(entry => normalizeBlockedCallerPhone(entry.phone) === normalized) || null
}

// 30-second in-memory cache — avoids a DB hit on every inbound call
let _cached: DialerSettings | null = null
let _cacheExp = 0

export async function getDialerSettings(): Promise<DialerSettings> {
  if (_cached && Date.now() < _cacheExp) return _cached

  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/saturn_config?key=eq.dialer&select=value&limit=1`,
      { headers, cache: 'no-store' }
    )
    if (res.ok) {
      const rows = (await res.json()) as Array<{ value: unknown }>
      if (rows[0]?.value && typeof rows[0].value === 'object') {
        _cached = deepMerge(DEFAULT_SETTINGS, rows[0].value as Partial<DialerSettings>)
        _cacheExp = Date.now() + 30_000
        return _cached
      }
    }
  } catch { /* fall through */ }

  return DEFAULT_SETTINGS
}

export async function saveDialerSettings(settings: DialerSettings): Promise<void> {
  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/saturn_config`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: 'dialer', value: settings, updated_at: new Date().toISOString() }),
  })
  _cached = settings
  _cacheExp = Date.now() + 30_000
}

export function isWithinBusinessHoursSettings(settings: DialerSettings): boolean {
  if (!settings.businessHours.enabled) return true

  try {
    const tz = settings.businessHours.timezone || 'America/Toronto'
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
    }).formatToParts(new Date())

    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10)
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10)
    const wd = parts.find(p => p.type === 'weekday')?.value?.toLowerCase().slice(0, 3) || ''

    type Day = keyof DialerSettings['businessHours']['schedule']
    const dayMap: Record<string, Day> = {
      mon: 'mon', tue: 'tue', wed: 'wed', thu: 'thu', fri: 'fri', sat: 'sat', sun: 'sun',
    }
    const dayKey = dayMap[wd]
    if (!dayKey) return true

    const sched = settings.businessHours.schedule[dayKey]
    if (!sched) return false

    const [oh, om] = sched.open.split(':').map(Number)
    const [ch, cm] = sched.close.split(':').map(Number)
    const cur = hour * 60 + minute
    return cur >= oh * 60 + om && cur < ch * 60 + cm
  } catch {
    return true
  }
}

export function getNotificationEmails(settings: DialerSettings): string[] {
  return settings.notifications?.emails?.length ? settings.notifications.emails : ['business@starmovers.ca']
}

function deepMerge<T>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key of Object.keys(source as object) as (keyof T)[]) {
    const sv = source[key]
    const tv = target[key]
    if (sv !== null && typeof sv === 'object' && !Array.isArray(sv) &&
        tv !== null && typeof tv === 'object' && !Array.isArray(tv)) {
      result[key] = deepMerge(tv as object, sv as object) as T[keyof T]
    } else if (sv !== undefined) {
      result[key] = sv as T[keyof T]
    }
  }
  return result
}
