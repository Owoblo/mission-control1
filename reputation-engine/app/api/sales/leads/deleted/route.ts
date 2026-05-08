import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead } from '@/lib/types'

type PersistedRecord<T> = { id: string; data: T; updated_at?: string; deleted?: boolean }

export async function GET() {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { url, headers } = requireSupabaseEnv()
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(
      `${url}/rest/v1/crm_leads?select=id,data,updated_at,deleted&deleted=eq.true&updated_at=gte.${cutoff}&order=updated_at.desc&limit=50`,
      { headers, cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ leads: [] })
    const records = (await res.json()) as PersistedRecord<CRMLead>[]
    const leads = records.map(r => ({ ...r.data, id: r.id, _deletedAt: r.updated_at }))
    return NextResponse.json({ leads })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load deleted leads' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (session?.role !== 'owner' && session?.role !== 'manager') {
      return NextResponse.json({ error: 'Only managers and owners can restore leads.' }, { status: 403 })
    }

    const { leadId } = (await request.json()) as { leadId?: string }
    if (!leadId) return NextResponse.json({ error: 'leadId required' }, { status: 400 })

    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/crm_leads?id=eq.${encodeURIComponent(leadId)}`,
      {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ deleted: false, updated_at: new Date().toISOString() }),
      }
    )
    if (!res.ok) throw new Error('Failed to restore lead')
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to restore lead' },
      { status: 500 }
    )
  }
}
