import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildMoveScopeSnapshot } from '@/lib/move-scope-version'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'

type ScopeRow = {
  id: string
  scope_code: string
  lead_id: string
  quote_id: string | null
  version: number
  predecessor_id: string | null
  change_reason: string | null
  snapshot: Record<string, unknown>
  snapshot_hash: string
  status: 'draft' | 'issued' | 'accepted' | 'superseded' | 'cancelled'
  issued_at: string | null
  accepted_at: string | null
  created_at: string
}

function allowed(session: Awaited<ReturnType<typeof getSessionUser>>) {
  return Boolean(session && (canAccessSalesWorkspace(session) || canAccessOperationsWorkspace(session)))
}

function hashSnapshot(snapshot: unknown) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

async function listVersions(leadId: string) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/move_scope_versions?lead_id=eq.${encodeURIComponent(leadId)}&select=*&order=version.desc`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error(`Could not load scope versions (${response.status})`)
  return response.json() as Promise<ScopeRow[]>
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!allowed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const lead = await getSalesLead(id)
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const versions = await listVersions(id)
  return NextResponse.json({ active: versions.find(version => version.status === 'accepted') || null, versions })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser()
  if (!allowed(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { action?: 'draft' | 'issue'; quoteId?: string; reason?: string }
  if (!body.action || !['draft', 'issue'].includes(body.action)) return NextResponse.json({ error: 'Choose draft or issue.' }, { status: 400 })

  const lead = await getSalesLead(id)
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  const quoteId = body.quoteId || lead.quoteId
  if (!quoteId) return NextResponse.json({ error: 'A quote is required before a scope can be created.' }, { status: 409 })
  const quote = await getSalesQuote(quoteId)
  if (!quote || quote.leadId !== lead.id) return NextResponse.json({ error: 'Quote does not belong to this move.' }, { status: 409 })

  const versions = await listVersions(id)
  const previous = versions[0]
  if (previous?.status === 'draft') return NextResponse.json({ error: 'Resolve the existing draft before creating another scope version.' }, { status: 409 })
  if (previous && !body.reason?.trim()) return NextResponse.json({ error: 'A change reason is required for a new version.' }, { status: 400 })

  const version = (previous?.version || 0) + 1
  const generatedAt = new Date().toISOString()
  const snapshot = buildMoveScopeSnapshot(lead, quote, generatedAt)
  const row = {
    scope_code: `SSM-${lead.id.replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase()}-V${version}`,
    lead_id: lead.id,
    quote_id: quote.id,
    version,
    predecessor_id: previous?.id || null,
    change_reason: body.reason?.trim() || (version === 1 ? 'Initial booked scope' : null),
    snapshot,
    snapshot_hash: hashSnapshot(snapshot),
    status: body.action === 'issue' ? 'issued' : 'draft',
    issued_at: body.action === 'issue' ? generatedAt : null,
    created_by: session?.name || session?.userId || 'CRM',
  }
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/move_scope_versions`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row),
  })
  if (!response.ok) return NextResponse.json({ error: `Could not create scope version (${response.status})` }, { status: 500 })
  const [saved] = await response.json() as ScopeRow[]
  return NextResponse.json({ scope: saved }, { status: 201 })
}
