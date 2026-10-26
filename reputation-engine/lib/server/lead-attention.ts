import { createHash } from 'node:crypto'
import { requireSupabaseEnv } from './runtime'

export async function recordLeadAttention(input: { leadId?: string; inboundId?: string; action: 'lead_detail_displayed' | 'inbox_read' | 'inbound_claimed'; channel?: string; activityAt?: string }, actor?: { userId?: string | null; name?: string | null }) {
  if (!actor?.userId) return
  const { url, headers } = requireSupabaseEnv()
  const key = [actor.userId,input.leadId,input.inboundId,input.action,input.channel,input.activityAt].join(':')
  const response = await fetch(`${url}/rest/v1/analytics_events?on_conflict=id`, { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ id: `attention_${createHash('sha256').update(key).digest('hex')}`, event_type: 'lead_attention', rep_id: actor.userId, lead_id: input.leadId || null, ts: new Date().toISOString(), created_at: new Date().toISOString(), properties: { ...input, userName: actor.name, evidenceSource: input.action === 'lead_detail_displayed' ? 'authenticated_browser_report' : 'authenticated_server_action', version: 1 } }) })
  if (!response.ok) throw new Error('The follow-up evidence could not be recorded')
}
