import { uid } from '@/lib/sales'
import type { DialerEventPayload, DialerPresencePayload } from '@/lib/dialer'
import { requireSupabaseEnv } from '@/lib/server/runtime'

const DIALER_EVENT_TYPE = 'telephony_dialer_event'
const DIALER_PRESENCE_TYPE = 'telephony_presence'
const CALL_OUTCOME_EVENT_TYPE = 'telephony_call_outcome'

type AnalyticsRow = {
  id: string
  event_type: string
  lead_id?: string | null
  rep_id?: string | null
  ts: string
  properties: Record<string, unknown>
  created_at: string
}

type AnalyticsQueryRow = AnalyticsRow & {
  properties?: Record<string, unknown> | null
}

export interface DialerAnalyticsEventRecord {
  id: string
  eventType: string
  ts: string
  repId?: string | null
  leadId?: string | null
  properties: Record<string, unknown>
  createdAt: string
}

export interface HealthyBrowserPresence {
  active: boolean
  sessionCount: number
  sessions: string[]
  userIds: string[]
}

export interface TelephonyDashboardMetrics {
  totalCallsToday: number
  missedCallsToday: number
  failedCallsToday: number
  mediaConnectionFailuresToday: number
  avgAnswerTimeSeconds: number | null
  callsByRep: Array<{ rep: string; count: number }>
  callsBySourceNumber: Array<{ source: string; count: number }>
  browserCallsToday: number
  mobileCallsToday: number
  callsWithNoAudioToday: number
  abandonedBeforeAnswerToday: number
}

function normalizeProperties(properties?: Record<string, unknown> | null) {
  return properties && typeof properties === 'object' ? properties : {}
}

function toQueryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === '') return
    query.set(key, String(value))
  })
  return query.toString()
}

async function insertAnalyticsRow(row: AnalyticsRow) {
  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
    cache: 'no-store',
  })
}

async function queryAnalyticsRows(params: Record<string, string | number | undefined>) {
  const { url, headers } = requireSupabaseEnv()
  const query = toQueryString(params)
  const response = await fetch(`${url}/rest/v1/analytics_events?${query}`, {
    headers,
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Failed analytics query: ${response.status}`)
  }

  return response.json() as Promise<AnalyticsQueryRow[]>
}

function mapAnalyticsRow(row: AnalyticsQueryRow): DialerAnalyticsEventRecord {
  return {
    id: row.id,
    eventType: row.event_type,
    ts: row.ts,
    repId: row.rep_id ?? null,
    leadId: row.lead_id ?? null,
    properties: normalizeProperties(row.properties),
    createdAt: row.created_at,
  }
}

export async function logDialerAnalyticsEvent(options: {
  userId?: string | null
  userName?: string | null
  userRole?: string | null
  payload: DialerEventPayload
}) {
  const now = options.payload.timestamp || new Date().toISOString()
  const properties: Record<string, unknown> = {
    ...options.payload,
    timestamp: now,
    userId: options.userId || null,
    userName: options.userName || null,
    userRole: options.userRole || null,
  }

  await insertAnalyticsRow({
    id: uid('ev'),
    event_type: DIALER_EVENT_TYPE,
    lead_id: options.payload.leadId || null,
    rep_id: options.userId || null,
    ts: now,
    properties,
    created_at: now,
  })
}

export async function logDialerPresence(options: {
  userId?: string | null
  userName?: string | null
  userRole?: string | null
  payload: DialerPresencePayload
}) {
  const now = options.payload.timestamp || new Date().toISOString()
  const properties: Record<string, unknown> = {
    ...options.payload,
    timestamp: now,
    userId: options.userId || null,
    userName: options.userName || null,
    userRole: options.userRole || null,
  }

  await insertAnalyticsRow({
    id: uid('ev'),
    event_type: DIALER_PRESENCE_TYPE,
    rep_id: options.userId || null,
    ts: now,
    properties,
    created_at: now,
  })
}

export async function logTelephonyCallOutcome(options: {
  leadId?: string | null
  repId?: string | null
  timestamp?: string
  properties: Record<string, unknown>
}) {
  const now = options.timestamp || new Date().toISOString()
  await insertAnalyticsRow({
    id: uid('ev'),
    event_type: CALL_OUTCOME_EVENT_TYPE,
    lead_id: options.leadId || null,
    rep_id: options.repId || null,
    ts: now,
    properties: {
      ...options.properties,
      timestamp: now,
    },
    created_at: now,
  })
}

export async function listRecentDialerEvents(options: {
  userId?: string | null
  limit?: number
  sessionId?: string | null
  sinceMinutes?: number
} = {}) {
  const sinceMinutes = options.sinceMinutes ?? 24 * 60
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200))
  const cutoffIso = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()
  const rows = await queryAnalyticsRows({
    select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
    event_type: `eq.${DIALER_EVENT_TYPE}`,
    ts: `gte.${cutoffIso}`,
    order: 'ts.desc',
    limit: Math.max(limit * 3, 100),
  })

  const filtered = rows
    .map(mapAnalyticsRow)
    .filter(row => !options.userId || row.repId === options.userId)
    .filter(row => !options.sessionId || row.properties.sessionId === options.sessionId)
    .slice(0, limit)

  return filtered
}

export async function listRecentDialerPresence(options: {
  userId?: string | null
  identity?: string | null
  limit?: number
  sinceMinutes?: number
} = {}) {
  const sinceMinutes = options.sinceMinutes ?? 10
  const limit = Math.max(1, Math.min(options.limit ?? 100, 300))
  const cutoffIso = new Date(Date.now() - sinceMinutes * 60 * 1000).toISOString()
  const rows = await queryAnalyticsRows({
    select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
    event_type: `eq.${DIALER_PRESENCE_TYPE}`,
    ts: `gte.${cutoffIso}`,
    order: 'ts.desc',
    limit,
  })

  return rows
    .map(mapAnalyticsRow)
    .filter(row => !options.userId || row.repId === options.userId)
    .filter(row => !options.identity || row.properties.identity === options.identity)
}

export async function getHealthyBrowserPresence(options: {
  identity?: string | null
  maxAgeSeconds?: number
}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? 90
  const rows = await listRecentDialerPresence({
    identity: options.identity || null,
    sinceMinutes: Math.max(2, Math.ceil(maxAgeSeconds / 60) + 2),
    limit: 200,
  })

  const cutoff = Date.now() - maxAgeSeconds * 1000
  const latestBySession = new Map<string, DialerAnalyticsEventRecord>()
  for (const row of rows) {
    const sessionId = String(row.properties.sessionId || '')
    if (!sessionId || latestBySession.has(sessionId)) continue
    latestBySession.set(sessionId, row)
  }

  const healthyStates = new Set(['ready', 'busy', 'incoming'])
  const healthySessions = Array.from(latestBySession.values()).filter(row => {
    const ts = new Date(row.ts).getTime()
    const state = String(row.properties.state || '')
    const online = row.properties.online !== false
    return ts >= cutoff && healthyStates.has(state) && online
  })

  return {
    active: healthySessions.length > 0,
    sessionCount: healthySessions.length,
    sessions: healthySessions.map(row => String(row.properties.sessionId || '')),
    userIds: healthySessions
      .map(row => String(row.properties.userId || ''))
      .filter(Boolean),
  } satisfies HealthyBrowserPresence
}

function summarizeCountMap(input: Map<string, number>) {
  return Array.from(input.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
}

export async function buildTelephonyDashboardMetrics() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const sinceIso = todayStart.toISOString()

  const [callOutcomeRows, dialerEventRows] = await Promise.all([
    queryAnalyticsRows({
      select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
      event_type: `eq.${CALL_OUTCOME_EVENT_TYPE}`,
      ts: `gte.${sinceIso}`,
      order: 'ts.desc',
      limit: 600,
    }).catch(() => [] as AnalyticsQueryRow[]),
    queryAnalyticsRows({
      select: 'id,event_type,lead_id,rep_id,ts,properties,created_at',
      event_type: `eq.${DIALER_EVENT_TYPE}`,
      ts: `gte.${sinceIso}`,
      order: 'ts.desc',
      limit: 600,
    }).catch(() => [] as AnalyticsQueryRow[]),
  ])

  const outcomes = callOutcomeRows.map(mapAnalyticsRow)
  const dialerEvents = dialerEventRows.map(mapAnalyticsRow)

  const answerTimes = outcomes
    .map(row => Number(row.properties.answerTimeSeconds))
    .filter(value => Number.isFinite(value) && value >= 0)

  const callsByRep = new Map<string, number>()
  const callsBySource = new Map<string, number>()

  outcomes.forEach(row => {
    const rep = String(row.properties.repName || row.properties.repId || row.repId || 'Unassigned')
    callsByRep.set(rep, (callsByRep.get(rep) || 0) + 1)

    const source = String(row.properties.branchNumber || row.properties.sourceNumber || 'Unknown')
    callsBySource.set(source, (callsBySource.get(source) || 0) + 1)
  })

  const browserAcceptedByCallSid = new Set(
    dialerEvents
      .filter(row => row.properties.event === 'call_accepted' && row.properties.callSid)
      .map(row => String(row.properties.callSid))
  )

  const totalCallsToday = outcomes.length
  const missedCallsToday = outcomes.filter(row => row.properties.missed === true).length
  const failedCallsToday = outcomes.filter(row => row.properties.failed === true).length
  const mediaConnectionFailuresToday = dialerEvents.filter(row => Number(row.properties.errorCode) === 53405).length
  const callsWithNoAudioToday = outcomes.filter(row => row.properties.audioConnected === false).length
  const abandonedBeforeAnswerToday = outcomes.filter(row => row.properties.abandonedBeforeAnswer === true).length
  const browserCallsToday = outcomes.filter(row => browserAcceptedByCallSid.has(String(row.properties.callSid || ''))).length
  const mobileCallsToday = Math.max(totalCallsToday - browserCallsToday, 0)

  return {
    totalCallsToday,
    missedCallsToday,
    failedCallsToday,
    mediaConnectionFailuresToday,
    avgAnswerTimeSeconds: answerTimes.length
      ? Math.round(answerTimes.reduce((sum, value) => sum + value, 0) / answerTimes.length)
      : null,
    callsByRep: summarizeCountMap(callsByRep).slice(0, 6).map(item => ({ rep: item.key, count: item.count })),
    callsBySourceNumber: summarizeCountMap(callsBySource).slice(0, 6).map(item => ({ source: item.key, count: item.count })),
    browserCallsToday,
    mobileCallsToday,
    callsWithNoAudioToday,
    abandonedBeforeAnswerToday,
  } satisfies TelephonyDashboardMetrics
}
