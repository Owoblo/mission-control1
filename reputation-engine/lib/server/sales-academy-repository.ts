import { uid } from '@/lib/sales'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export interface AcademyProgressRecord {
  id: string
  userId: string
  moduleId: string
  completedLessons: string[]
  scenarioAnswers: Record<string, string>
  acknowledgedVersion: string | null
  lastOpenedAt: string | null
  completedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

interface AcademyProgressRow {
  id: string
  user_id: string
  module_id: string
  completed_lessons?: unknown
  scenario_answers?: unknown
  acknowledged_version?: string | null
  last_opened_at?: string | null
  completed_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

interface ProgressUpsertInput {
  userId: string
  moduleId: string
  completedLessons: string[]
  scenarioAnswers: Record<string, string>
  acknowledgedVersion?: string | null
  lastOpenedAt?: string | null
  completedAt?: string | null
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string')
}

function normalizeStringRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) => typeof item === 'string')
  ) as Record<string, string>
}

function mapProgressRow(row: AcademyProgressRow): AcademyProgressRecord {
  return {
    id: row.id,
    userId: row.user_id,
    moduleId: row.module_id,
    completedLessons: normalizeStringArray(row.completed_lessons),
    scenarioAnswers: normalizeStringRecord(row.scenario_answers),
    acknowledgedVersion: row.acknowledged_version || null,
    lastOpenedAt: row.last_opened_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  }
}

async function fetchProgressRows(path: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers,
    cache: 'no-store',
  })
  if (!response.ok) return null
  return response.json() as Promise<AcademyProgressRow[]>
}

export async function listSalesAcademyProgress(userId: string) {
  try {
    const rows = await fetchProgressRows(
      `sales_academy_progress?select=*&user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc`
    )
    if (!rows) return { rows: [] as AcademyProgressRecord[], storageAvailable: false }
    return {
      rows: rows.map(mapProgressRow),
      storageAvailable: true,
    }
  } catch {
    return { rows: [] as AcademyProgressRecord[], storageAvailable: false }
  }
}

export async function saveSalesAcademyProgress(input: ProgressUpsertInput) {
  const { url, headers } = requireSupabaseEnv()

  const existingResponse = await fetch(
    `${url}/rest/v1/sales_academy_progress?select=*&user_id=eq.${encodeURIComponent(input.userId)}&module_id=eq.${encodeURIComponent(input.moduleId)}&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!existingResponse.ok) {
    return { record: null as AcademyProgressRecord | null, storageAvailable: false }
  }

  const existingRows = await existingResponse.json() as AcademyProgressRow[]
  const now = new Date().toISOString()

  const payload = {
    user_id: input.userId,
    module_id: input.moduleId,
    completed_lessons: input.completedLessons,
    scenario_answers: input.scenarioAnswers,
    acknowledged_version: input.acknowledgedVersion ?? null,
    last_opened_at: input.lastOpenedAt ?? null,
    completed_at: input.completedAt ?? null,
    updated_at: now,
  }

  if (existingRows[0]?.id) {
    const updateResponse = await fetch(`${url}/rest/v1/sales_academy_progress?id=eq.${existingRows[0].id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })

    if (!updateResponse.ok) {
      return { record: null as AcademyProgressRecord | null, storageAvailable: false }
    }

    const rows = await updateResponse.json() as AcademyProgressRow[]
    return {
      record: rows[0] ? mapProgressRow(rows[0]) : null,
      storageAvailable: true,
    }
  }

  const createResponse = await fetch(`${url}/rest/v1/sales_academy_progress`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      id: uid('acad'),
      created_at: now,
      ...payload,
    }),
    cache: 'no-store',
  })

  if (!createResponse.ok) {
    return { record: null as AcademyProgressRecord | null, storageAvailable: false }
  }

  const rows = await createResponse.json() as AcademyProgressRow[]
  return {
    record: rows[0] ? mapProgressRow(rows[0]) : null,
    storageAvailable: true,
  }
}

