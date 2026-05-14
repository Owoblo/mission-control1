import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { deleteSalesLead, listSalesLeads } from '@/lib/server/sales-repository'

const JUNK_NAMES = new Set([
  'unknown caller', 'new caller', 'new contact', 'unknown', 'test', 'test lead',
  'caller', 'no name', '', 'n/a',
])

function isJunkName(name?: string | null) {
  return JUNK_NAMES.has((name || '').trim().toLowerCase())
}

function isStaleUnprogressed(lead: { createdAt?: string; stage?: string }) {
  if (!lead.createdAt) return false
  const age = Date.now() - new Date(lead.createdAt).getTime()
  const ninetyDays = 90 * 24 * 60 * 60 * 1000
  return age > ninetyDays && (lead.stage === 'new' || lead.stage === 'contacted')
}

export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leads = await listSalesLeads()

  const candidates = leads
    .filter(lead => {
      const hasNoContact = !lead.phone && !lead.email
      const junkName = isJunkName(lead.name)
      const stale = isStaleUnprogressed(lead)
      return junkName || hasNoContact || stale
    })
    .map(lead => {
      const reasons: string[] = []
      if (isJunkName(lead.name)) reasons.push('No real name')
      if (!lead.phone && !lead.email) reasons.push('No contact info')
      if (isStaleUnprogressed(lead)) reasons.push('90+ days, never progressed')
      return {
        id: lead.id,
        name: lead.name || '(no name)',
        phone: lead.phone || null,
        email: lead.email || null,
        source: lead.source || 'unknown',
        stage: lead.stage,
        createdAt: lead.createdAt,
        reasons,
      }
    })
    .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''))

  return NextResponse.json({ candidates, total: candidates.length })
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ids } = (await request.json()) as { ids: string[] }
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
  }
  if (ids.length > 100) {
    return NextResponse.json({ error: 'Max 100 at a time' }, { status: 400 })
  }

  const results = await Promise.allSettled(ids.map(id => deleteSalesLead(id)))
  const deleted = results.filter(r => r.status === 'fulfilled').length
  const failed = results.filter(r => r.status === 'rejected').length

  return NextResponse.json({ ok: true, deleted, failed })
}
