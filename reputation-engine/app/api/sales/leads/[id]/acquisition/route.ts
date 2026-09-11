import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { validateAcquisitionInterview } from '@/lib/acquisition-interview'
import type { CRMLead } from '@/lib/types'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ id: string }> }

async function readLead(id: string) {
  const { url, headers } = requireSupabaseEnv()
  const params = new URLSearchParams({ id: `eq.${id}`, deleted: 'eq.false', select: 'id,data,updated_at', limit: '1' })
  const response = await fetch(`${url}/rest/v1/crm_leads?${params}`, { headers, cache: 'no-store' })
  if (!response.ok) throw new Error('Could not read the lead.')
  const rows = await response.json() as Array<{ id: string; data: CRMLead; updated_at: string }>
  return rows[0] || null
}

export async function GET(_: Request, props: Props) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const row = await readLead((await props.params).id)
    if (!row || !leadMatchesSessionBranch(row.data, session)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    return NextResponse.json({ interview: row.data.acquisitionInterview || null, canEdit: canEditLead(session, row.data) }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch { return NextResponse.json({ error: 'Source details could not be loaded.' }, { status: 502 }) }
}

export async function PUT(request: Request, props: Props) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const id = (await props.params).id
  let body: Record<string, unknown>
  let draft: ReturnType<typeof validateAcquisitionInterview>
  try {
    body = await request.json()
    draft = validateAcquisitionInterview(body.interview)
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) throw new Error('Reload the source details before saving.')
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid source details.' }, { status: 400 }) }
  try {
    const row = await readLead(id)
    if (!row || !leadMatchesSessionBranch(row.data, session)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (!canEditLead(session, row.data)) return NextResponse.json({ error: 'You cannot edit this lead.' }, { status: 403 })
    const previous = row.data.acquisitionInterview
    if ((previous?.revision || 0) !== body.expectedRevision) return NextResponse.json({ error: 'Someone updated these answers. Reload before saving.' }, { status: 409 })
    const { url, headers } = requireSupabaseEnv()
    let connectorName = '', connectorCompany = ''
    if (draft.connectorId) {
      const query = new URLSearchParams({ id: `eq.${draft.connectorId}`, select: 'id,name,company', limit: '1' })
      const response = await fetch(`${url}/rest/v1/market_contacts?${query}`, { headers, cache: 'no-store' })
      if (!response.ok) throw new Error('Connector lookup unavailable.')
      const [connector] = await response.json()
      if (!connector) return NextResponse.json({ error: 'Select an existing connector from the directory.' }, { status: 400 })
      connectorName = connector.name; connectorCompany = connector.company || ''
    }
    const now = new Date().toISOString()
    const interview = { ...draft, connectorName, connectorCompany, recordedAt: now, recordedBy: session?.name || session?.userId || 'Sales team', revision: (previous?.revision || 0) + 1 }
    const history = [...(row.data.acquisitionInterviewHistory || []), ...(previous ? [previous] : [])].slice(-20)
    const query = new URLSearchParams({ id: `eq.${id}`, deleted: 'eq.false', updated_at: `eq.${row.updated_at}` })
    const response = await fetch(`${url}/rest/v1/crm_leads?${query}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ data: { ...row.data, acquisitionInterview: interview, acquisitionInterviewHistory: history, updatedAt: now }, updated_at: now }) })
    if (!response.ok) throw new Error('Save failed.')
    if (!(await response.json()).length) return NextResponse.json({ error: 'The lead changed while saving. Reload and try again.' }, { status: 409 })
    // Saving an interview does not change the source, start sequences, send a
    // message, or rewrite primary-referral ownership.
    return NextResponse.json({ interview })
  } catch { return NextResponse.json({ error: 'Source details could not be saved. Please retry.' }, { status: 502 }) }
}
