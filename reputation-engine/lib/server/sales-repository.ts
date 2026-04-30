import {
  buildSalesSummary,
  normalizeClient,
  normalizeFollowUp,
  normalizeLead,
  normalizeQuote,
} from '@/lib/sales'
import { LEAD_ARCHIVED_NOTE, LEAD_RESTORED_NOTE } from '@/lib/server/sales-audit'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type {
  CRMClient,
  CRMEmail,
  CRMLead,
  CRMQuote,
  CRMWorker,
  FollowUpLog,
  InboundLead,
  InventoryScanDraft,
  ListingMatch,
  SalesDashboardSummary,
} from '@/lib/types'

type TableName = 'crm_leads' | 'crm_quotes' | 'crm_clients' | 'crm_emails' | 'crm_followup_logs' | 'crm_workers'
type PersistedRecord<T> = { id: string; data: T; updated_at?: string; deleted?: boolean }

function requireSupabase() {
  return requireSupabaseEnv()
}

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function normalizeEmail(value?: string) {
  return (value || '').trim().toLowerCase()
}

function leadsShareIdentity(left: CRMLead, right: CRMLead) {
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

function getArchivedLeadIds(logs: FollowUpLog[]) {
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
  const [leads, followUps] = await Promise.all([
    selectAll<CRMLead>('crm_leads'),
    listFollowUpLogs(),
  ])
  const archivedLeadIds = getArchivedLeadIds(followUps)
  return leads
    .map(lead => normalizeLead(lead))
    .filter(lead => !archivedLeadIds.has(lead.id))
}

export async function getSalesLead(id: string) {
  const lead = await selectById<CRMLead>('crm_leads', id)
  if (!lead) return null

  const archivedLeadIds = getArchivedLeadIds(await listFollowUpLogs())
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

export async function saveSalesLead(lead: CRMLead) {
  return normalizeLead(await upsert<CRMLead>('crm_leads', normalizeLead(lead)))
}

export async function deleteSalesLead(id: string) {
  const current = await selectById<CRMLead>('crm_leads', id)
  await markDeleted('crm_leads', id)

  if (!current) {
    return [id]
  }

  const activeDuplicates = (await listSalesLeads())
    .filter(lead => lead.stage !== 'booked' && lead.stage !== 'lost')
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

export async function appendSmsToInboundLead(id: string, smsBody: string, messageSid: string) {
  const existing = await getInboundLead(id)
  if (!existing) throw new Error(`Inbound lead ${id} not found`)

  const { url, headers } = requireSupabase()
  const raw = typeof existing.raw_data === 'object' && existing.raw_data ? existing.raw_data as Record<string, unknown> : {}
  const thread = Array.isArray(raw.smsThread) ? [...raw.smsThread as unknown[]] : []
  thread.push({ direction: 'inbound', body: smsBody, messageSid, at: new Date().toISOString() })

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
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ claimed: true, claimed_at: new Date().toISOString() }),
  })

  if (!response.ok) {
    throw new Error(`Failed to claim inbound lead ${id}`)
  }
}

export async function markInboundLeadJunk(id: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ claimed: true, claimed_at: new Date().toISOString(), message: 'Marked as junk' }),
  })

  if (!response.ok) {
    throw new Error(`Failed to junk inbound lead ${id}`)
  }
}

export async function restoreInboundLead(id: string) {
  const { url, headers } = requireSupabase()
  const response = await fetch(`${url}/rest/v1/inbound_leads?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ claimed: false, claimed_at: null }),
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

  const updatedCallLogs = (lead.callLogs || []).map(entry => {
    if (entry.id !== callLogId) return entry
    // Replace "Recording processing…" whenever the recording is actually ready
    // (either transcribed, or just saved with a URL when the call was too short to transcribe)
    let notes = entry.notes
    if (updates.recordingUrl || updates.transcript) {
      const replacement = updates.transcript ? ' Recording transcribed.' : ' Recording saved.'
      notes = (entry.notes || '').replace(' Recording processing…', replacement)
    }
    return { ...entry, ...updates, notes }
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
  const response = await fetch(
    `${url}/rest/v1/listings?address=ilike.${encoded}&select=zpid,address,city,is_furnished,furniture_scan_date,carouselphotos&limit=5`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error('Failed to look up listings')
  }

  const rows = (await response.json()) as Array<ListingMatch & { carouselphotos?: ListingMatch['carouselphotos'] | string | null }>
  return rows.map(row => {
    let carouselphotos = row.carouselphotos
    if (typeof carouselphotos === 'string') {
      try {
        carouselphotos = JSON.parse(carouselphotos) as ListingMatch['carouselphotos']
      } catch {
        carouselphotos = []
      }
    }

    return {
      ...row,
      carouselphotos: Array.isArray(carouselphotos) ? carouselphotos : [],
    }
  })
}

export async function lookupListingsByAddress(address: string): Promise<ListingMatch[]> {
  const variants = buildAddressLookupVariants(address)
  const seen = new Set<string>()

  for (const variant of variants) {
    const results = await queryListingsByAddressVariant(variant)
    for (const result of results) {
      if (!seen.has(result.zpid)) {
        seen.add(result.zpid)
      }
    }
    if (results.length > 0) {
      return results
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

// ─── Crew Workers ─────────────────────────────────────────────────────────

export async function listWorkers(): Promise<CRMWorker[]> {
  try {
    return await selectAll<CRMWorker>('crm_workers')
  } catch {
    return []
  }
}

export async function getWorker(id: string): Promise<CRMWorker | null> {
  try {
    return await selectById<CRMWorker>('crm_workers', id)
  } catch {
    return null
  }
}

export async function saveWorker(worker: CRMWorker): Promise<CRMWorker> {
  return upsert<CRMWorker>('crm_workers', worker)
}

export async function deleteWorker(id: string): Promise<void> {
  await markDeleted('crm_workers', id)
}
