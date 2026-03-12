import {
  buildSalesSummary,
  normalizeClient,
  normalizeFollowUp,
  normalizeLead,
  normalizeQuote,
} from '@/lib/sales'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type {
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

function requireSupabase() {
  return requireSupabaseEnv()
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

function isMissingRelationError(message: string) {
  return message.includes('relation') || message.includes('does not exist') || message.includes('Failed to read')
}

async function selectById<T>(table: TableName, id: string): Promise<T | null> {
  const { url, headers } = requireSupabase()
  const response = await fetch(
    `${url}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}&select=id,data,deleted&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    throw new Error(`Failed to read ${table}/${id}`)
  }

  const records = (await response.json()) as PersistedRecord<T>[]
  const record = records.find(item => !item.deleted)
  return record?.data ?? null
}

async function upsert<T extends { id: string }>(table: TableName, data: T): Promise<T> {
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
  const leads = await selectAll<CRMLead>('crm_leads')
  return leads.map(lead => normalizeLead(lead))
}

export async function getSalesLead(id: string) {
  const lead = await selectById<CRMLead>('crm_leads', id)
  return lead ? normalizeLead(lead) : null
}

export async function saveSalesLead(lead: CRMLead) {
  return normalizeLead(await upsert<CRMLead>('crm_leads', normalizeLead(lead)))
}

export async function deleteSalesLead(id: string) {
  await markDeleted('crm_leads', id)
}

export async function listSalesQuotes() {
  const quotes = await selectAll<CRMQuote>('crm_quotes')
  return quotes.map(quote => normalizeQuote(quote))
}

export async function getSalesQuote(id: string) {
  const quote = await selectById<CRMQuote>('crm_quotes', id)
  return quote ? normalizeQuote(quote) : null
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

  return {
    leads,
    quotes,
    clients,
    followUps,
    summary: buildSalesSummary(leads, quotes),
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
        status: 'completed',
        inventory_items: scan.inventory,
        total_items: scan.totalItems,
        total_cubic_feet: scan.totalCubicFeet,
        room_breakdown: scan.roomBreakdown || {},
        scanned_at: new Date().toISOString(),
      },
    ]),
  })

  if (!response.ok) {
    throw new Error('Failed to save listing inventory scan')
  }

  return response.json()
}
