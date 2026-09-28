import { requireSupabaseEnv } from './runtime'
import { isPartnershipSenderNumber } from '../partnership-lines'

export function isAutomatedLeasingNotice(body: string): boolean {
  return /reply\s+y\b[\s\S]{0,50}(?:tour|chat)/i.test(body) &&
    /(?:eliseai|leasing|apartments?|touring assistance)/i.test(body)
}

export function needsPartnershipRoutingReview(input: { businessPhone: string; body: string; salesReply: boolean; matched: boolean }): boolean {
  return isAutomatedLeasingNotice(input.body) ||
    (!input.salesReply && !input.matched && isPartnershipSenderNumber(input.businessPhone))
}

// Use the existing task store, not a customer lead or a new queue. Provider SID
// makes retries idempotent and avoids resetting an operator-completed task.
export async function savePartnershipRoutingReview(input: { from: string; to: string; body: string; sid: string; at: string }): Promise<boolean> {
  if (!input.sid) throw new Error('Message SID required for routing review')
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/crm_tasks?on_conflict=source_key`, {
    method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      id: `partner-sms-review-${input.sid}`, source_key: `partner-sms-review:${input.sid}`,
      title: isAutomatedLeasingNotice(input.body) ? 'Partnership: automated leasing response' : 'Partnership: resolve incoming SMS identity',
      description: `From: ${input.from}\nTo: ${input.to}\nReceived: ${input.at}\nProvider ID: ${input.sid}\n\n${input.body}\n\nVerify the organization and reply number before linking this message. This is not a qualified Sales lead. Do not opt in to a leasing bot or treat its STOP instructions as the partner opting out.`,
      category: 'partnerships', status: 'open', priority: 'normal', owner_name: 'John',
      related_type: 'relationship', related_id: input.from, related_label: input.from,
      source: 'condition', created_by_name: 'SMS routing review',
    }),
  })
  if (!response.ok) throw new Error(`Unable to preserve partnership routing review (${response.status})`)
  return (await response.json()).length > 0
}
