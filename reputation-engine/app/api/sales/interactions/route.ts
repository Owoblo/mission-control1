import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { interactionRpc } from '@/lib/server/interactions'
import { INTERACTION_ACTORS, INTERACTION_INTENTS, INTERACTION_DISPOSITIONS, type InteractionClassification } from '@/lib/interaction-classification'

// Raw communications include internal traffic, so cross-market review is owner-only.
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (session?.role !== 'owner') return Response.json({ error: 'Owner access required' }, { status: 403 })
  try {
    const params = new URL(request.url).searchParams
    const offset = Math.max(0, Math.floor(Number(params.get('offset')) || 0))
    const { url, headers } = requireSupabaseEnv()
    if (params.get('id')) {
      const query = new URLSearchParams({ select: '*', interaction_id: `eq.${params.get('id')}`, order: 'id.asc' })
      const response = await fetch(`${url}/rest/v1/crm_interaction_classifications?${query}`, { headers, cache: 'no-store' })
      if (!response.ok) throw new Error('Unable to load classification history')
      return Response.json({ history: await response.json() })
    }
    const query = new URLSearchParams({ select: '*', order: 'received_at.desc,id.asc', limit: '50', offset: String(offset) })
    if (params.get('pending') !== 'false') query.set('reviewer_id', 'is.null')
    const response = await fetch(`${url}/rest/v1/crm_interaction_review_queue?${query}`, { headers, cache: 'no-store' })
    if (!response.ok) throw new Error('Unable to load interaction review queue')
    return Response.json({ interactions: await response.json(), offset })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Review queue unavailable' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (session?.role !== 'owner') return Response.json({ error: 'Owner access required' }, { status: 403 })
  try {
    const payload = await request.json() as { id: string; expected: number; classification: InteractionClassification; promote?: boolean }
    const c = payload.classification
    if (!payload.id || !Number.isSafeInteger(payload.expected) || !c || !INTERACTION_ACTORS.includes(c.actor) || !INTERACTION_INTENTS.includes(c.intent)
      || !INTERACTION_DISPOSITIONS.includes(c.disposition) || !Number.isFinite(c.confidence) || c.confidence < 0 || c.confidence > 1 || !c.reason?.trim()) {
      return Response.json({ error: 'Valid classification, confidence, reason and current revision required' }, { status: 400 })
    }
    const result = await interactionRpc('review_crm_interaction', {
      p_id: payload.id, p_expected: payload.expected, p_classification: { ...c, reviewedByName: session.name },
      p_reviewer: session.userId, p_promote: payload.promote === true,
    })
    return Response.json(result)
  } catch {
    return Response.json({ error: 'Review could not be saved. Verify qualification evidence and reload if another reviewer changed this record.' }, { status: 409 })
  }
}
