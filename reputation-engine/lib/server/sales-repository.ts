import {
  buildSalesSummary,
  isClosedLeadStage,
  normalizeClient,
  normalizeFollowUp,
  normalizeLead,
  normalizeQuote,
} from '@/lib/sales'
import { LEAD_ARCHIVED_NOTE, LEAD_RESTORED_NOTE } from '@/lib/server/sales-audit'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type {
  CallLogEntry,
  CRMClient,
  CRMEmail,
  CRMLead,
  CRMQuote,
  FollowUpLog,
  InboundLead,
  InventoryScanDraft,
  ListingMatch,
  SalesDashboardSummary,
} from '@/lib/types'

type TableName = 'crm_leads' | 'crm_quotes' | 'crm_clients' | 'crm_emails' | 'crm_followup_logs'
type PersistedRecord<T> = { id: string; data: T; updated_at?: string; deleted?: boolean }
type LeadIdentityLike = Pick<CRMLead, 'id' | 'stage' | 'phone' | 'email' | 'inboundId'>
type LeadLifecycleSnapshot = {
  leadId?: string
  notes?: string
  date?: string
  createdAt?: string
}
type LeadIdentityRow = {
  id: string
  name?: string | null
  stage?: string | null
  phone?: string | null
  email?: string | null
  inboundId?: string | null
}
type LeadInboxRow = LeadIdentityRow & {
  branch?: string | null
  originAddress?: string | null
  originCity?: string | null
  destAddress?: string | null
  destCity?: string | null
  moveType?: string | null
  totalCubicFeet?: number | string | null
  callLogs?: CallLogEntry[] | string | null
}

export type SalesLeadIdentitySnapshot = Pick<CRMLead, 'id' | 'name' | 'stage' | 'phone' | 'email' | 'inboundId'>
export type SalesLeadInboxSnapshot =
  SalesLeadIdentitySnapshot &
  Pick<CRMLead, 'branch' | 'originAddress' | 'originCity' | 'destAddress' | 'destCity' | 'moveType' | 'totalCubicFeet' | 'callLogs'>

function requireSupabase() {
  return requireSupabaseEnv()
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function normalizeEmail(value?: string) {
  return (value || '').trim().toLowerCase()
}

function normalizeProjectedText(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function normalizeProjectedNumber(value?: number | string | null) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function normalizeProjectedCallLogs(value?: CallLogEntry[] | string | null) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value) as CallLogEntry[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeLeadIdentitySnapshot(row: LeadIdentityRow): SalesLeadIdentitySnapshot {
  return {
    id: row.id,
    name: normalizeProjectedText(row.name) || 'Unknown Lead',
    stage: (normalizeProjectedText(row.stage) || 'new') as CRMLead['stage'],
    phone: normalizeProjectedText(row.phone),
    email: normalizeProjectedText(row.email),
    inboundId: normalizeProjectedText(row.inboundId),
  }
}

function normalizeLeadInboxSnapshot(row: LeadInboxRow): SalesLeadInboxSnapshot {
  const identity = normalizeLeadIdentitySnapshot(row)
  return {
    ...identity,
    branch: normalizeProjectedText(row.branch) as CRMLead['branch'] | undefined,
    originAddress: normalizeProjectedText(row.originAddress),
    originCity: normalizeProjectedText(row.originCity),
    destAddress: normalizeProjectedText(row.destAddress),
    destCity: normalizeProjectedText(row.destCity),
    moveType: normalizeProjectedText(row.moveType) as CRMLead['moveType'] | undefined,
    totalCubicFeet: normalizeProjectedNumber(row.totalCubicFeet),
    callLogs: normalizeProjectedCallLogs(row.callLogs),
  }
}

function leadsShareIdentity(left: LeadIdentityLike, right: LeadIdentityLike) {
  if (left.id === right.id) return false

  if (left.inboundId && right.inboundId && left.inboundId === right.inboundId) {
    return true
  }

  const leftPhone = digitsOnly(left.phone)
  const rightPhone = digitsOnly(right.phone)
  if (leftPhone && rightPhone && (leftPhone === rightPhone || leftPhone.endsWith(rightPhone) || rightPhone.endsWith(leftPhone))) {
    return true
  }

  const leftEmail = normalizeEmail(left.email)
  const rightEmail = normalizeEmail(right.email)
  return !!leftEmail && !!rightEmail && leftEmail === rightEmail
}

function getArchivedLeadIds(logs: LeadLifecycleSnapshot[]) {
  const latestLifecycle = new Map<string, { archived: boolean; date: number }>()

  for (const log of logs) {
    if (!log.leadId) continue
    if (log.notes !== LEAD_ARCHIVED_NOTE && log.notes !== LEAD_RESTORED_NOTE) continue

    const timestamp = new Date(log.date || log.createdAt || 0).getTime()
    const current = latestLifecycle.get(log.leadId)
    if (current && current.date >= timestamp) continue

    latestLifecycle.set(log.leadId, {
      archived: log.notes === LEAD_ARCHIVED_NOTE,
      date: timestamp,
    })
  }

  return new Set(
    Array.from(latestLifecycle.entries())
      .filter(([, value]) => value.archived)
      .map(([leadId]) => leadId)
  )
}

const LEAD_IDENTITY_SELECT = [
  'id',
  'name:data->>name',
  'stage:data->>stage',
  'phone:data->>phone',
  'email:data->>email',
  'inboundId:data->>inboundId',
].join(',')

const LEAD_INBOX_SELECT = [
  'id',
  'name:data->>name',
  'stage:data->>stage',
  'phone:data->>phone',
  'email:data->>email',
  'inboundId:data->>inboundId',
  'branch:data->>branch',
  'originAddress:data->>originAddress',
  'originCity:data->>originCity',
  'destAddress:data->>destAddress',
  'destCity:data->>destCity',
  'moveType:data->>moveType',
  'totalCubicFeet:data->>totalCubicFeet',
  'callLogs:data->callLogs',
].join(',')

const LEAD_LIFECYCLE_SELECT = [
  'leadId:data->>leadId',
  'notes:data->>notes',
  'date:data->>date',
  'createdAt:data->>createdAt',
].join(',')

async function selectLeadLifecycleSnapshots() {
  try {
    const { url, headers } = requireSupabase()
    const response = await fetch(
      `${url}/rest/v1/crm_followup_logs?select=${encodeURIComponent(LEAD_LIFECYCLE_SELECT)}&deleted=eq.false&order=updated_at.desc`,
      { headers, cache: 'no-store' }
    )

    if (!response.ok) {
      throw new Error('Failed to read crm_followup_logs lifecycle rows')
    }

    const rows = (await response.json()) as Array<{
      leadId?: string | null
      notes?: string | null
      date?: string | null
      createdAt?: string | null
    }>

    return rows.map(row => ({
      leadId: normalizeProjectedText(row.leadId),
      notes: normalizeProjectedText(row.notes),
      date: normalizeProjectedText(row.date),
      createdAt: normalizeProjectedText(row.createdAt),
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isMissingRelationError(message)) {
      return [] as LeadLifecycleSnapshot[]
    }
    throw error
  }
}

async function selectProjectedLeadRows<T>(select: string): Promise<T[]> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=${encodeURIComponent(select)}&deleted=eq.false&order=updated_at.desc`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to read projected crm_leads rows')
  }

  return (await response.json()) as T[]
}

async function selectAll<T>(table: TableName): Promise<T[]> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/${table}?select=id,data,updated_at,deleted&deleted=eq.false&order=updated_at.desc`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read ${table}`)
  }

  const records = (await response.json()) as PersistedRecord<T>[]
  return records.map(record => record.data)
}

async function selectAllRecords<T>(table: TableName): Promise<PersistedRecord<T>[]> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/${table}?select=id,data,updated_at,deleted&deleted=eq.false&order=updated_at.desc`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read ${table}`)
  }

  return (await response.json()) as PersistedRecord<T>[]
}

function isMissingRelationError(message: string) {
  return message.includes('relation') || message.includes('does not exist') || message.includes('Failed to read')
}

async function selectById<T>(table: TableName, id: string): Promise<T | null> {
  const record = await selectRecordById<T>(table, id)
  return record && !record.deleted ? record.data : null
}

async function selectRecordById<T>(table: TableName, id: string): Promise<PersistedRecord<T> | null> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data,deleted&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read ${table}/${id}`)
  }

  const records = (await response.json()) as PersistedRecord<T>[]
  return records[0] ?? null
}

async function upsert<T extends { id: string }>(table: TableName, data: T): Promise<T> {
  const existing = await selectRecordById<T>(table, data.id)
  if (existing?.deleted) {
    throw new Error(`Cannot save deleted ${table}/${data.id}`)
  }

  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{ id: data.id, data, updated_at: new Date().toISOString(), deleted: false }]),
  })

  if (!response.ok) {
    throw new Error(`Failed to save ${table}`)
  }

  const records = (await response.json()) as PersistedRecord<T>[]
  return records[0]?.data ?? data
}

async function markDeleted(table: TableName, id: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ deleted: true, updated_at: new Date().toISOString() }),
  })

  if (!response.ok) {
    throw new Error(`Failed to delete ${table}/${id}`)
  }
}

export async function listSalesLeads() {
  const [leads, lifecycle] = await Promise.all([
    selectAll<CRMLead>('crm_leads'),
    selectLeadLifecycleSnapshots(),
  ])
  const archivedLeadIds = getArchivedLeadIds(lifecycle)
  return leads
    .map(lead => normalizeLead(lead))
    .filter(lead => !archivedLeadIds.has(lead.id))
}

export async function listSalesLeadIdentitySnapshots() {
  const [rows, lifecycle] = await Promise.all([
    selectProjectedLeadRows<LeadIdentityRow>(LEAD_IDENTITY_SELECT),
    selectLeadLifecycleSnapshots(),
  ])
  const archivedLeadIds = getArchivedLeadIds(lifecycle)
  return rows
    .map(normalizeLeadIdentitySnapshot)
    .filter(lead => !archivedLeadIds.has(lead.id))
}

export async function listSalesLeadInboxSnapshots() {
  const [rows, lifecycle] = await Promise.all([
    selectProjectedLeadRows<LeadInboxRow>(LEAD_INBOX_SELECT),
    selectLeadLifecycleSnapshots(),
  ])
  const archivedLeadIds = getArchivedLeadIds(lifecycle)
  return rows
    .map(normalizeLeadInboxSnapshot)
    .filter(lead => !archivedLeadIds.has(lead.id))
}

export async function listSalesLeadsPaginated(page: number, limit: number) {
  const { url, headers } = requireSupabase()
  const start = page * limit
  const end = start + limit - 1

  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data,updated_at,deleted&deleted=eq.false&order=updated_at.desc`,
    {
      headers: {
        ...headers,
        'Range-Unit': 'items',
        Range: `${start}-${end}`,
        Prefer: 'count=exact',
      },
      cache: 'no-store',
    }
  )

  if (!response.ok) {
    throw new Error('Failed to read crm_leads')
  }

  const contentRange = response.headers.get('Content-Range')
  const total = contentRange ? parseInt(contentRange.split('/')[1] || '0') : 0
  const records = (await response.json()) as PersistedRecord<CRMLead>[]

  return {
    leads: records.map(r => normalizeLead(r.data)),
    total,
    page,
    limit,
    hasMore: start + limit < total,
  }
}

export async function getSalesLead(id: string) {
  const lead = await selectById<CRMLead>('crm_leads', id)
  if (!lead) return null

  const archivedLeadIds = getArchivedLeadIds(await selectLeadLifecycleSnapshots())
  return archivedLeadIds.has(id) ? null : normalizeLead(lead)
}

export async function getSalesLeadByInboundId(inboundId: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data,deleted&data->>inboundId=eq.${encodeURIComponent(inboundId)}&deleted=eq.false&order=updated_at.desc&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read crm_leads by inboundId ${inboundId}`)
  }

  const records = (await response.json()) as PersistedRecord<CRMLead>[]
  const record = records.find(item => !item.deleted)
  return record?.data ? normalizeLead(record.data) : null
}

export async function listSalesOpportunityLeadsBySourceLeadId(sourceLeadId: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data,deleted&data->>sourceLeadId=eq.${encodeURIComponent(sourceLeadId)}&data->>leadKind=eq.realtor_opportunity&deleted=eq.false&order=updated_at.desc&limit=20`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read crm_leads opportunity list for source ${sourceLeadId}`)
  }

  const records = (await response.json()) as PersistedRecord<CRMLead>[]
  return records
    .filter(record => !record.deleted)
    .map(record => normalizeLead(record.data))
}

export async function saveSalesLead(lead: CRMLead) {
  return normalizeLead(await upsert<CRMLead>('crm_leads', normalizeLead(lead)))
}

export async function deleteSalesLead(id: string) {
  const current = await selectById<CRMLead>('crm_leads', id)
  await markDeleted('crm_leads', id)

  if (!current) {
    return [id]
  }

  const activeDuplicates = (await listSalesLeadIdentitySnapshots())
    .filter(lead => !isClosedLeadStage(lead.stage))
    .filter(lead => leadsShareIdentity(current, lead))

  if (activeDuplicates.length === 0) {
    return [id]
  }

  await Promise.all(activeDuplicates.map(lead => markDeleted('crm_leads', lead.id)))
  return [id, ...activeDuplicates.map(lead => lead.id)]
}

export async function listSalesQuotes() {
  const records = await selectAllRecords<CRMQuote>('crm_quotes')
  const latestByLeadId = new Map<string, PersistedRecord<CRMQuote>>()
  const standaloneQuotes: PersistedRecord<CRMQuote>[] = []

  for (const record of records) {
    const leadId = record.data?.leadId
    if (!leadId) {
      standaloneQuotes.push(record)
      continue
    }

    if (!latestByLeadId.has(leadId)) {
      latestByLeadId.set(leadId, record)
    }
  }

  return [...standaloneQuotes, ...Array.from(latestByLeadId.values())].map(record => normalizeQuote(record.data))
}

export async function getSalesQuote(id: string) {
  const quote = await selectById<CRMQuote>('crm_quotes', id)
  return quote ? normalizeQuote(quote) : null
}

export async function getLatestSalesQuoteByLeadId(leadId: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/crm_quotes?select=id,data,updated_at,deleted&data->>leadId=eq.${encodeURIComponent(leadId)}&deleted=eq.false&order=updated_at.desc&limit=20`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read crm_quotes by leadId ${leadId}`)
  }

  const records = (await response.json()) as PersistedRecord<CRMQuote>[]
  const record = records.find(item => !item.deleted)
  return record?.data ? normalizeQuote(record.data) : null
}

export async function saveSalesQuote(quote: CRMQuote) {
  return normalizeQuote(await upsert<CRMQuote>('crm_quotes', normalizeQuote(quote)))
}

export async function listSalesClients() {
  const clients = await selectAll<CRMClient>('crm_clients')
  return clients.map(client => normalizeClient(client))
}

export async function getSalesClient(id: string) {
  const client = await selectById<CRMClient>('crm_clients', id)
  return client ? normalizeClient(client) : null
}

export async function saveSalesClient(client: CRMClient) {
  return normalizeClient(await upsert<CRMClient>('crm_clients', normalizeClient(client)))
}

export async function listFollowUpLogs() {
  try {
    const logs = await selectAll<FollowUpLog>('crm_followup_logs')
    return logs.map(log => normalizeFollowUp(log))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isMissingRelationError(message)) {
      return []
    }
    throw error
  }
}

export async function saveFollowUpLog(log: FollowUpLog) {
  return normalizeFollowUp(await upsert<FollowUpLog>('crm_followup_logs', normalizeFollowUp(log)))
}

export async function listSalesEmails() {
  return selectAll<CRMEmail>('crm_emails')
}

export async function saveSalesEmail(email: CRMEmail) {
  return upsert<CRMEmail>('crm_emails', email)
}

export async function getSalesOverview(): Promise<{
  leads: CRMLead[]
  quotes: CRMQuote[]
  clients: CRMClient[]
  followUps: FollowUpLog[]
  summary: SalesDashboardSummary
}> {
  const [leads, quotes, clients, followUps] = await Promise.all([
    listSalesLeads(),
    listSalesQuotes(),
    listSalesClients(),
    listFollowUpLogs(),
  ])

  const archivedLeadIds = getArchivedLeadIds(followUps)
  const activeLeads = leads.filter(lead => !archivedLeadIds.has(lead.id))
  const activeLeadIds = new Set(leads.map(lead => lead.id))
  const activeQuoteIds = new Set(quotes.map(quote => quote.id))
  const scopedFollowUps = followUps.filter(log => {
    if (log.leadId && archivedLeadIds.has(log.leadId)) {
      return false
    }

    if (log.leadId && !activeLeadIds.has(log.leadId)) {
      return false
    }

    if (log.quoteId && !activeQuoteIds.has(log.quoteId)) {
      return false
    }

    return true
  })

  return {
    leads: activeLeads,
    quotes,
    clients,
    followUps: scopedFollowUps,
    summary: buildSalesSummary(activeLeads, quotes),
  }
}

export async function saveInboundLead(lead: {
  id: string
  source: string
  name?: string
  phone?: string
  email?: string
  message?: string
  raw_data?: Record<string, unknown>
}) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...lead, claimed: false, created_at: new Date().toISOString() }),
  })
  if (!response.ok) {
    throw new Error('Failed to save inbound lead')
  }
}

export async function listInboundLeads() {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&claimed=eq.false&order=created_at.desc&limit=100`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to read inbound leads')
  }

  return (await response.json()) as InboundLead[]
}

export async function listInboundJunkLeads() {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&claimed=eq.true&message=eq.Marked as junk&order=claimed_at.desc&limit=100`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to read junk inbound leads')
  }

  return (await response.json()) as InboundLead[]
}

export async function listClosedInboundLeads() {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&claimed=eq.true&order=claimed_at.desc&limit=100`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to read closed inbound leads')
  }

  return (await response.json()) as InboundLead[]
}

export async function listAllInboundLeads() {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&order=created_at.desc&limit=200`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to read all inbound leads')
  }

  return (await response.json()) as InboundLead[]
}

export async function getInboundLead(id: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}&select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read inbound lead ${id}`)
  }

  const records = (await response.json()) as InboundLead[]
  return records[0] || null
}

export async function getInboundLeadByPhone(phone: string) {
  const { url, headers } = requireSupabase()
  // Normalize to digits only for matching, then filter recent unclaimed leads by phone
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?phone=eq.${encodeURIComponent(phone)}&claimed=eq.false&select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&order=created_at.desc&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return null
  const records = (await response.json()) as InboundLead[]
  return records[0] || null
}

export async function appendSmsToInboundLead(
  id: string,
  smsBody: string,
  messageSid: string,
  media?: Array<{ url: string; contentType?: string }>
) {
  const existing = await getInboundLead(id)
  if (!existing) throw new Error(`Inbound lead ${id} not found`)

  const { url, headers } = requireSupabase()
  const raw = typeof existing.raw_data === 'object' && existing.raw_data ? existing.raw_data as Record<string, unknown> : {}
  const thread = Array.isArray(raw.smsThread) ? [...raw.smsThread as unknown[]] : []
  thread.push({
    direction: 'inbound',
    body: smsBody,
    messageSid,
    at: new Date().toISOString(),
    ...(media?.length ? { media } : {}),
  })

  const newMessage = `${existing.message || ''}\n\n[Reply] ${smsBody}`.trim()

  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ message: newMessage, raw_data: { ...raw, smsThread: thread } }),
  })
  if (!response.ok) throw new Error(`Failed to append SMS to inbound lead ${id}`)
}

export async function getInboundLeadByCallSid(callSid: string) {
  const { url, headers } = requireSupabase()
  // raw_data is stored as jsonb — filter by the callSid field inside it
  const response = await fetch(
    `${url}/rest/v1/inbound_leads?raw_data->>callSid=eq.${encodeURIComponent(callSid)}&select=id,source,name,phone,email,message,raw_data,created_at,claimed,claimed_at&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!response.ok) return null
  const records = (await response.json()) as InboundLead[]
  return records[0] || null
}

export async function updateInboundLeadRawData(id: string, patch: Record<string, unknown>) {
  const { url, headers } = requireSupabase()
  // First read current raw_data, then merge
  const existing = await getInboundLead(id)
  const current = typeof existing?.raw_data === 'object' && existing.raw_data ? existing.raw_data : {}
  const merged = { ...current, ...patch }
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ raw_data: merged }),
  })
  if (!response.ok) {
    throw new Error(`Failed to update inbound lead raw_data ${id}`)
  }
}

export async function markInboundLeadClaimed(id: string) {
  const existing = await getInboundLead(id)
  const raw = typeof existing?.raw_data === 'object' && existing.raw_data ? existing.raw_data as Record<string, unknown> : {}
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      claimed: true,
      claimed_at: new Date().toISOString(),
      raw_data: {
        ...raw,
        inboxDisposition: 'open',
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to claim inbound lead ${id}`)
  }
}

export async function setInboundLeadDisposition(id: string, disposition: 'junk' | 'lost' | 'not_interested') {
  const existing = await getInboundLead(id)
  const raw = typeof existing?.raw_data === 'object' && existing.raw_data ? existing.raw_data as Record<string, unknown> : {}
  const now = new Date().toISOString()
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      claimed: true,
      claimed_at: now,
      raw_data: {
        ...raw,
        inboxDisposition: disposition,
        inboxDispositionAt: now,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to mark inbound lead ${id} as ${disposition}`)
  }
}

export async function restoreInboundLead(id: string) {
  const existing = await getInboundLead(id)
  const raw = typeof existing?.raw_data === 'object' && existing.raw_data ? existing.raw_data as Record<string, unknown> : {}
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      claimed: false,
      claimed_at: null,
      raw_data: {
        ...raw,
        inboxDisposition: 'open',
        inboxDispositionAt: null,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to restore inbound lead ${id}`)
  }
}

export async function getCrmCallSidMapping(callSid: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/crm_call_sids?call_sid=eq.${encodeURIComponent(callSid)}&limit=1`,
    { headers }
  )
  if (!response.ok) return null
  const data = (await response.json()) as Array<{ lead_id: string; call_log_id: string }>
  if (!Array.isArray(data) || data.length === 0) return null
  return { leadId: data[0].lead_id, callLogId: data[0].call_log_id }
}

export async function updateLeadCallLogEntry(
  leadId: string,
  callLogId: string,
  updates: Partial<import('@/lib/types').CallLogEntry>
) {
  const lead = await getSalesLead(leadId)
  if (!lead) throw new Error(`Lead ${leadId} not found`)

  const normalizedUpdates = { ...updates }
  if (updates.recordingUrl || updates.recordingSid || updates.transcript) {
    normalizedUpdates.recordingUnavailable = false
    normalizedUpdates.recordingUnavailableAt = undefined
    normalizedUpdates.recordingUnavailableReason = undefined
  }

  const updatedCallLogs = (lead.callLogs || []).map(entry => {
    if (entry.id !== callLogId) return entry
    // Replace "Recording processing…" whenever the recording is actually ready
    // (either transcribed, or just saved with a URL when the call was too short to transcribe)
    let notes = normalizedUpdates.notes ?? entry.notes
    if (normalizedUpdates.recordingUrl || normalizedUpdates.recordingSid || normalizedUpdates.transcript) {
      const replacement = normalizedUpdates.transcript ? ' Recording transcribed.' : ' Recording saved.'
      notes = (notes || '').replace(' Recording processing…', replacement)
    } else if (normalizedUpdates.recordingUnavailable) {
      notes = (notes || '').replace(' Recording processing…', ' Recording unavailable.')
    }
    return { ...entry, ...normalizedUpdates, notes }
  })

  return saveSalesLead({ ...lead, callLogs: updatedCallLogs })
}

export async function saveCrmCallSidMapping(callSid: string, leadId: string, callLogId: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/crm_call_sids`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ call_sid: callSid, lead_id: leadId, call_log_id: callLogId }),
  })

  if (!response.ok) {
    throw new Error('Failed to save call SID mapping')
  }
}

function normalizeAddressInput(address: string) {
  return address
    .replace(/[,\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STREET_SUFFIX_CANONICAL: Record<string, string> = {
  street: 'st',
  st: 'st',
  avenue: 'ave',
  ave: 'ave',
  road: 'rd',
  rd: 'rd',
  drive: 'dr',
  dr: 'dr',
  boulevard: 'blvd',
  blvd: 'blvd',
  lane: 'ln',
  ln: 'ln',
  court: 'crt',
  crt: 'crt',
  crescent: 'cres',
  cres: 'cres',
  place: 'pl',
  pl: 'pl',
  terrace: 'terr',
  terr: 'terr',
  trail: 'trl',
  trl: 'trl',
  circle: 'cir',
  cir: 'cir',
  parkway: 'pkway',
  pkway: 'pkway',
}

function buildAddressLookupVariants(address: string) {
  const normalized = normalizeAddressInput(address)
  const variants = new Set<string>()
  const lower = normalized.toLowerCase()
  const tokens = normalized.split(' ').filter(Boolean)
  const provincePattern = /^[A-Z]{2}$/
  const streetSuffixMap = new Map<string, string>([
    ['street', 'st'],
    ['st', 'street'],
    ['avenue', 'ave'],
    ['ave', 'avenue'],
    ['road', 'rd'],
    ['rd', 'road'],
    ['drive', 'dr'],
    ['dr', 'drive'],
    ['boulevard', 'blvd'],
    ['blvd', 'boulevard'],
    ['lane', 'ln'],
    ['ln', 'lane'],
    ['court', 'crt'],
    ['crt', 'court'],
    ['crescent', 'cres'],
    ['cres', 'crescent'],
    ['place', 'pl'],
    ['pl', 'place'],
    ['terrace', 'terr'],
    ['terr', 'terrace'],
    ['trail', 'trl'],
    ['trl', 'trail'],
    ['circle', 'cir'],
    ['cir', 'circle'],
    ['parkway', 'pkway'],
    ['pkway', 'parkway'],
  ])
  const streetSuffixes = new Set(streetSuffixMap.keys())

  variants.add(normalized)

  if (tokens.length > 1 && provincePattern.test(tokens[tokens.length - 1])) {
    variants.add(tokens.slice(0, -1).join(' '))
  }

  const withoutProvince = Array.from(variants).find(value => {
    const parts = value.split(' ')
    return parts.length > 1 && !provincePattern.test(parts[parts.length - 1])
  }) || normalized

  const withoutProvinceTokens = withoutProvince.split(' ').filter(Boolean)
  const suffixIndex = withoutProvinceTokens.findIndex(token => streetSuffixes.has(token.toLowerCase()))
  if (suffixIndex >= 1) {
    const streetOnly = withoutProvinceTokens.slice(0, suffixIndex + 1)
    variants.add(streetOnly.join(' '))
    const alternateSuffix = streetSuffixMap.get(streetOnly[streetOnly.length - 1].toLowerCase())
    if (alternateSuffix) {
      variants.add([...streetOnly.slice(0, -1), alternateSuffix].join(' '))
    }
  }

  if (suffixIndex >= 1 && withoutProvinceTokens.length > suffixIndex + 1) {
    variants.add(withoutProvinceTokens.slice(0, suffixIndex + 2).join(' '))
  }

  if (tokens.length >= 3) {
    variants.add(tokens.slice(0, 3).join(' '))
  }

  if (!lower.includes(',')) {
    const commaIndex = normalized.lastIndexOf(' ')
    if (commaIndex > 0) {
      variants.add(normalized.slice(0, commaIndex).trim())
    }
  }

  return Array.from(variants).filter(value => value.length >= 5)
}

async function queryListingsByAddressVariant(address: string): Promise<ListingMatch[]> {
  const { url, headers } = requireSupabase()
  const encoded = encodeURIComponent(`%${address}%`)
  const baseSelect = 'zpid,address,city,brokername,is_furnished,furniture_scan_date,carouselphotos,carousel_photos_composable'
  const extendedSelect = `${baseSelect},bedrooms,bathrooms,beds,baths`
  let response = await fetch(
    `${url}/rest/v1/listings?address=ilike.${encoded}&select=${extendedSelect}&limit=20`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    response = await fetch(
      `${url}/rest/v1/listings?address=ilike.${encoded}&select=${baseSelect}&limit=20`,
      { headers, cache: 'no-store' }
    )
  }

  if (!response.ok) {
    throw new Error('Failed to look up listings')
  }

  const rows = (await response.json()) as Array<ListingMatch & {
    carouselphotos?: ListingMatch['carouselphotos'] | string | null
    carousel_photos_composable?: { baseUrl?: string; photoData?: Array<{ photoKey?: string }> } | string | null
  }>
  return rows.map(row => {
    let carouselphotos = row.carouselphotos
    if (typeof carouselphotos === 'string') {
      try {
        carouselphotos = JSON.parse(carouselphotos) as ListingMatch['carouselphotos']
      } catch {
        carouselphotos = []
      }
    }

    // carouselphotos column is null for all Zillow-sourced listings — derive from carousel_photos_composable
    if (!Array.isArray(carouselphotos) || carouselphotos.length === 0) {
      try {
        let composable = row.carousel_photos_composable
        if (typeof composable === 'string') {
          composable = JSON.parse(composable) as typeof composable
        }
        if (composable && typeof composable === 'object') {
          const baseUrl = composable.baseUrl || ''
          const photoData = composable.photoData || []
          if (baseUrl && photoData.length > 0) {
            carouselphotos = photoData
              .map((p: { photoKey?: string }) => (p?.photoKey ? baseUrl.replace('{photoKey}', p.photoKey) : null))
              .filter((u: string | null): u is string => !!u)
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    const { carousel_photos_composable: _cpc, ...rest } = row
    return {
      ...rest,
      carouselphotos: Array.isArray(carouselphotos) ? carouselphotos : [],
    }
  })
}

function normalizeAddressMatchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(token => STREET_SUFFIX_CANONICAL[token] || token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTrailingLocation(value: string) {
  return normalizeAddressMatchValue(value.split(',')[0] || value)
}

function extractAddressUnit(value: string) {
  const normalized = stripTrailingLocation(value)
  const hashMatch = normalized.match(/#\s*([a-z0-9-]+)/i)
  if (hashMatch?.[1]) return hashMatch[1].toLowerCase()
  const namedUnitMatch = normalized.match(/\b(?:unit|apt|apartment|suite|ste)\s*([a-z0-9-]+)/i)
  if (namedUnitMatch?.[1]) return namedUnitMatch[1].toLowerCase()
  return null
}

function stripAddressUnit(value: string) {
  return stripTrailingLocation(value)
    .replace(/#\s*[a-z0-9-]+\b/ig, ' ')
    .replace(/\b(?:unit|apt|apartment|suite|ste)\s*[a-z0-9-]+\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getListingPhotoCount(listing: ListingMatch) {
  return Array.isArray(listing.carouselphotos) ? listing.carouselphotos.length : 0
}

function scoreListingAddressMatch(query: string, listing: ListingMatch) {
  const queryNormalized = stripTrailingLocation(query)
  const queryBase = stripAddressUnit(query)
  const queryUnit = extractAddressUnit(query)
  const listingNormalized = stripTrailingLocation(listing.address || '')
  const listingBase = stripAddressUnit(listing.address || '')
  const listingUnit = extractAddressUnit(listing.address || '')
  const photoCount = getListingPhotoCount(listing)

  let score = 0

  if (listingNormalized === queryNormalized) score += 400
  if (listingBase === queryBase) {
    score += 220
  } else if (listingBase.includes(queryBase) || queryBase.includes(listingBase)) {
    score += 120
  }

  if (queryUnit && listingUnit) {
    score += queryUnit === listingUnit ? 160 : 20
  } else if (queryUnit && !listingUnit) {
    score += 60
  } else if (!queryUnit && listingUnit) {
    score += 30
  }

  if (photoCount > 0) {
    score += 80 + Math.min(photoCount, 50)
  }
  if (listing.furniture_scan_date) score += 20
  if (listing.is_furnished) score += 10

  return score
}

export async function lookupListingsByAddress(address: string): Promise<ListingMatch[]> {
  const variants = buildAddressLookupVariants(address)
  const seen = new Set<string>()

  for (const variant of variants) {
    const results = await queryListingsByAddressVariant(variant)
    const deduped: ListingMatch[] = []
    for (const result of results) {
      if (!seen.has(result.zpid)) {
        seen.add(result.zpid)
        deduped.push(result)
      }
    }
    if (deduped.length > 0) {
      return deduped.sort((left, right) => {
        const scoreDelta = scoreListingAddressMatch(address, right) - scoreListingAddressMatch(address, left)
        if (scoreDelta !== 0) return scoreDelta
        return getListingPhotoCount(right) - getListingPhotoCount(left)
      })
    }
  }

  return []
}

export async function getListingInventoryScan(zpid: string): Promise<InventoryScanDraft | null> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/listing_inventory_scans?zpid=eq.${encodeURIComponent(zpid)}&status=eq.completed&order=scanned_at.desc&limit=1&select=*`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to fetch listing inventory scan')
  }

  const rows = (await response.json()) as Array<Record<string, unknown>>
  const scan = rows[0]
  if (!scan) return null

  let inventory = scan.inventory_items as InventoryScanDraft['inventory']
  if (typeof inventory === 'string') {
    try { inventory = JSON.parse(inventory) } catch { inventory = [] }
  }

  let roomBreakdown = scan.room_breakdown as Record<string, number>
  if (typeof roomBreakdown === 'string') {
    try { roomBreakdown = JSON.parse(roomBreakdown) } catch { roomBreakdown = {} }
  }

  return {
    inventory: Array.isArray(inventory) ? inventory : [],
    totalItems: Number(scan.total_items || 0),
    totalCubicFeet: Number(scan.total_cubic_feet || 0),
    roomBreakdown: roomBreakdown || {},
    source: 'existing_scan',
    confidence: 'medium',
    specialtyFlags: [],
    notes: 'Loaded from latest completed listing inventory scan.',
  }
}

export async function saveListingInventoryScan(zpid: string, scan: InventoryScanDraft) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/listing_inventory_scans`, {
    method: 'POST',
    headers: {
      ...headers,
      Prefer: 'return=representation',
    },
    body: JSON.stringify([
      {
        zpid,
        scan_id: crypto.randomUUID(),
        scanned_by: 'crm_app',
        photos_analyzed: Array.isArray((scan as { photoUrls?: unknown }).photoUrls)
          ? ((scan as { photoUrls?: unknown[] }).photoUrls || []).length
          : null,
        photo_urls: Array.isArray((scan as { photoUrls?: unknown }).photoUrls)
          ? ((scan as { photoUrls?: unknown[] }).photoUrls || []).filter(Boolean)
          : null,
        status: 'completed',
        inventory_items: scan.inventory,
        total_items: scan.totalItems,
        total_cubic_feet: scan.totalCubicFeet,
        room_breakdown: scan.roomBreakdown || {},
        scanned_at: new Date().toISOString(),
        error_message: null,
      },
    ]),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Failed to save listing inventory scan${details ? `: ${details}` : ''}`)
  }

  return response.json()
}
