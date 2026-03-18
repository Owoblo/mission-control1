import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()

  const [stagesRes, tiersRes, signalsRes, campaignsRes] = await Promise.all([
    fetch(`${url}/rest/v1/market_contacts?select=stage&order=stage`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_contacts?select=tier,stage`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_signals?select=status,signal_type&order=created_at.desc&limit=5`, { headers, cache: 'no-store' }),
    fetch(`${url}/rest/v1/market_campaigns?select=*&order=sent_date.desc&limit=5`, { headers, cache: 'no-store' }),
  ])

  const allContacts = stagesRes.ok ? await stagesRes.json() as { stage: string }[] : []
  const byTier = tiersRes.ok ? await tiersRes.json() as { tier: string; stage: string }[] : []
  const signals = signalsRes.ok ? await signalsRes.json() : []
  const campaigns = campaignsRes.ok ? await campaignsRes.json() : []

  // Stage counts
  const stages = ['cold','contacted','engaged','qualified','partnered','referring','revisit','dnc']
  const stageCounts = Object.fromEntries(stages.map(s => [s, 0]))
  for (const c of allContacts) stageCounts[c.stage] = (stageCounts[c.stage] ?? 0) + 1

  // Tier counts (non-DNC)
  const tierCounts: Record<string, number> = {}
  for (const c of byTier) {
    if (c.stage === 'dnc') continue
    tierCounts[c.tier] = (tierCounts[c.tier] ?? 0) + 1
  }

  // Partner count (partnered + referring)
  const activePartners = (stageCounts.partnered ?? 0) + (stageCounts.referring ?? 0)

  return NextResponse.json({
    stageCounts,
    tierCounts,
    activePartners,
    totalContacts: allContacts.length,
    signals,
    campaigns,
  })
}
