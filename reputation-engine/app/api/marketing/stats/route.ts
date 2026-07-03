import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { isDateDue, normalizePartnershipStage, PARTNERSHIP_STAGE_ORDER } from '@/lib/marketing'
import { partnershipScopeFilter } from '@/lib/server/partnership-access'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  const [stagesRes, tiersRes, signalsRes, campaignsRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?select=stage,next_follow_up,tier,industry,city&order=stage${partnershipScopeFilter(session)}`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_contacts?select=tier,stage,industry,next_follow_up,city${partnershipScopeFilter(session)}`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_signals?select=status,signal_type&order=created_at.desc&limit=5`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=sent_date.desc&limit=5${partnershipScopeFilter(session, ['city', 'name'])}`, { headers, cache: 'no-store' }),
  ])

  const allContacts = stagesRes.ok ? await stagesRes.json() as Array<{ stage: string; next_follow_up?: string | null; tier?: string; industry?: string }> : []
  const byTier = tiersRes.ok ? await tiersRes.json() as Array<{ tier: string; stage: string; industry?: string; next_follow_up?: string | null }> : []
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
    tierCounts[c.tier] = (tierCounts[c.tier] ?? 0) + 1
  }

  const activePartners = stageCounts.partnership_active ?? 0
  const followUpDue = allContacts.filter(contact => isDateDue(contact.next_follow_up)).length
  const corporateCount = byTier.filter(contact => String(contact.tier || '').toUpperCase() === 'C').length

  return NextResponse.json({
    stageCounts,
    tierCounts,
    activePartners,
    totalContacts: allContacts.length,
    followUpDue,
    corporateCount,
    signals,
    campaigns,
  })
}
