import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { isDateDue, normalizePartnershipStage, PARTNERSHIP_STAGE_ORDER } from '@/lib/marketing'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'

export const maxDuration = 60

type StatsContact = { id: string; city?: string | null; stage: string; next_follow_up?: string | null; tier?: string; industry?: string }

async function allScopedContacts(url: string, headers: Record<string, string>, scope: string) {
  const rows: StatsContact[] = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetch(`${url}/rest/v1/market_contacts?select=id,stage,next_follow_up,tier,industry,city&order=id&limit=${pageSize}&offset=${offset}${scope}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Could not load complete partnership statistics')
    const page = await response.json() as StatsContact[]
    rows.push(...page)
    if (page.length < pageSize) return rows
  }
}

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  let allContacts: StatsContact[]
  try {
    allContacts = await allScopedContacts(url, headers, partnershipScopeFilter(session))
  } catch {
    return NextResponse.json({ error: 'Complete partnership statistics are unavailable; retry shortly.' }, { status: 503 })
  }
  const byTier = allContacts
  const [signalsRes, campaignsRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_signals?select=status,signal_type&order=created_at.desc&limit=5`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=sent_date.desc&limit=5${partnershipScopeFilter(session, ['city', 'name'])}`, { headers, cache: 'no-store' }),
  ])

  const signals = signalsRes.ok ? await signalsRes.json() : []
  const campaigns = campaignsRes.ok ? await campaignsRes.json() : []

  // Stage counts
  const stageCounts = Object.fromEntries(PARTNERSHIP_STAGE_ORDER.map(stage => [stage, 0]))
  for (const c of allContacts) {
    const normalized = normalizePartnershipStage(c.stage)
    stageCounts[normalized] = (stageCounts[normalized] ?? 0) + 1
  }

  // Tier counts (non-DNC)
  const tierCounts: Record<string, number> = {}
  for (const c of byTier) {
    if (normalizePartnershipStage(c.stage) === 'closed_lost') continue
    const tier = c.tier || 'unassigned'
    tierCounts[tier] = (tierCounts[tier] ?? 0) + 1
  }

  const activePartners = stageCounts.partnership_active ?? 0
  const followUpDue = allContacts.filter(contact => isDateDue(contact.next_follow_up)).length
  const corporateCount = byTier.filter(contact => String(contact.tier || '').toUpperCase() === 'C').length

  return NextResponse.json({
    stageCounts,
    snapshotAt: new Date().toISOString(),
    complete: true,
    tierCounts,
    activePartners,
    totalContacts: allContacts.length,
    followUpDue,
    corporateCount,
    signals,
    campaigns,
  })
}
