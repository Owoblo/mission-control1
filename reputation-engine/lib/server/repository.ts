import { hydratePartnerStats, normalizeJob, normalizePartner } from '@/lib/store'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { Job, Partner } from '@/lib/types'

type TableName = 'review_jobs' | 'review_partners'
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

async function softDelete(table: TableName, id: string): Promise<void> {
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

export async function listJobs(): Promise<Job[]> {
  const jobs = await selectAll<Job>('review_jobs')
  return jobs.map(job => normalizeJob(job))
}

export async function getJob(id: string): Promise<Job | null> {
  const job = await selectById<Job>('review_jobs', id)
  return job ? normalizeJob(job) : null
}

export async function saveJobRecord(job: Job): Promise<Job> {
  return normalizeJob(await upsert<Job>('review_jobs', normalizeJob(job)))
}

export async function deleteJobRecord(id: string): Promise<void> {
  await softDelete('review_jobs', id)
}

export async function listPartners(): Promise<Partner[]> {
  const [partners, jobs] = await Promise.all([
    selectAll<Partner>('review_partners'),
    selectAll<Job>('review_jobs'),
  ])

  return hydratePartnerStats(
    partners.map(partner => normalizePartner(partner)),
    jobs.map(job => normalizeJob(job))
  )
}

export async function savePartnerRecord(partner: Partner): Promise<Partner> {
  return normalizePartner(await upsert<Partner>('review_partners', normalizePartner(partner)))
}

export async function deletePartnerRecord(id: string): Promise<void> {
  await softDelete('review_partners', id)
}
