import { createHash } from 'node:crypto'
import { extractConversationSignal, hasConversationSignal } from '@/lib/conversation-integrity'
import { requireSupabaseEnv } from './runtime'
import type { CRMLead } from '@/lib/types'

export async function completeCallback(lead: CRMLead, occurredAt: string, evidence: string, inbound = false) {
  if (lead.callbackCommitment?.status !== 'open') return
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/complete_crm_callback`, { method: 'POST', headers, body: JSON.stringify({ p_lead: lead.id, p_at: occurredAt, p_evidence: evidence, p_inbound: inbound }) })
  if (!response.ok) throw new Error('Callback completion could not be preserved')
}

export async function recordConversationSignal(lead: CRMLead, message: string, occurredAt: string, eventKey?: string) {
  const signal = extractConversationSignal(message, occurredAt, eventKey?.startsWith('call:') ? 'call' : 'sms')
  if (!hasConversationSignal(signal)) return lead
  const key = eventKey || `signal:${lead.id}:${createHash('sha256').update(message + occurredAt).digest('hex')}`
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/apply_crm_conversation_signal`, { method: 'POST', headers, body: JSON.stringify({ p_lead: lead.id, p_key: key, p_at: occurredAt, p_signal: signal }) })
  if (!response.ok) throw new Error('Customer timing/outcome could not be preserved')
  return response.json() as Promise<CRMLead>
}
