import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { buildSaturnCommandContext, type SaturnContextRow } from '@/lib/saturn-command-context'
import { partnershipScopeFilter, partnershipRecordMatchesSession, canSeeAllPartnershipMarkets } from '@/lib/server/partnership-access'
import { readCompleteRest } from '@/lib/server/read-complete-rest'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user || !['owner', 'manager', 'partnership_manager'].includes(user.role || '')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const query = new URL(request.url).searchParams
  const offset = Number(query.get('offset') || 0)
  const limit = Number(query.get('limit') || 100)
  const contactId = query.get('contactId')
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500 ||
      (contactId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(contactId))) {
    return NextResponse.json({ error: 'Invalid context scope or pagination' }, { status: 400 })
  }
  const { url, headers } = requireSupabaseEnv()
  async function read(table: string, select: string, extra = ''): Promise<SaturnContextRow[]> {
    return readCompleteRest(`${url}/rest/v1/${table}?select=${encodeURIComponent(select)}${extra}`, headers)
  }
  try {
    const readStartedAt = new Date().toISOString()
    const scope = partnershipScopeFilter(user, ['city'], true).replace('id.eq.__no_partnership_market__', 'id.is.null') +
      (contactId ? `&and=(id.eq.${contactId})` : '')
    const contacts = (await read('market_contacts', 'id,name,company,city,stage,do_not_contact,tracking_code,owner_name,assigned_manager_user_id', scope))
      .filter(contact => partnershipRecordMatchesSession(user, contact))
    async function related(table: string, select: string, key: string, extra = '') {
      if (canSeeAllPartnershipMarkets(user) && !contactId) return read(table, select, extra)
      const rows: SaturnContextRow[] = []
      // Bound URL size and query only records belonging to the authorized portfolio.
      for (let offset = 0; offset < contacts.length; offset += 100) {
        const ids = contacts.slice(offset, offset + 100).map(c => encodeURIComponent(c.id)).join(',')
        rows.push(...await read(table, select, `&${key}=in.(${ids})${extra}`))
      }
      return rows
    }
    const [touches, tasks, jobs, referrals] = await Promise.all([
      related('market_touches', 'id,contact_id,direction,notes,created_at,outcome_code,metadata', 'contact_id'),
      related('crm_tasks', 'id,related_id,related_type,title,status,due_at,owner_name,owner_user_id,completed_at,outcome_note', 'related_id', '&related_type=in.(partner,relationship)'),
      related('sequence_jobs', 'id,contact_id,status,scheduled_at', 'contact_id', '&status=eq.pending'),
      related('partner_referrals', 'id,contact_id,job_id,job_status', 'contact_id'),
    ])
    const context = buildSaturnCommandContext({ generatedAt: new Date().toISOString(), contacts, touches, tasks, jobs, referrals,
      coverage: { complete: true, readStartedAt, scope: 'authorized_partnership_portfolio_nontransactional_read' },
    })
    return NextResponse.json({ ...context,
      relationships: context.relationships.slice(offset, offset + limit),
      constructiveQueue: context.constructiveQueue.slice(offset, offset + limit),
      pagination: { offset, limit, relationshipTotal: context.relationships.length, constructiveTotal: context.constructiveQueue.length },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Command center failed' }, { status: 500 })
  }
}
