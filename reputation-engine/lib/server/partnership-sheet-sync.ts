import { readEnv } from '@/lib/server/runtime'

export type PartnershipSheetAction =
  | 'active_partner'
  | 'drop_cards'
  | 'meeting_requested'
  | 'needs_follow_up'
  | 'not_interested'
  | 'wrong_number'

export type PartnershipSheetSyncPayload = {
  secret: string
  timestamp: string
  action: PartnershipSheetAction
  action_label: string
  status: string | null
  next_step: string | null
  rep: string
  latest_message: string | null
  latest_message_at: string | null
  app_contact_url: string | null
  contact: {
    id: string
    name: string | null
    company: string | null
    city: string | null
    phone: string | null
    email: string | null
    industry: string | null
    stage: string | null
    decision: string | null
    batch_id: string | null
    next_follow_up: string | null
  }
}

export async function syncPartnershipActionToSheet(payload: Omit<PartnershipSheetSyncPayload, 'secret'>) {
  const syncUrl = readEnv('PARTNERSHIP_SHEET_SYNC_URL')
  const secret = readEnv('PARTNERSHIP_SHEET_SYNC_SECRET')

  if (!syncUrl || !secret) {
    return { configured: false, ok: false }
  }

  const response = await fetch(syncUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, secret } satisfies PartnershipSheetSyncPayload),
  })

  if (!response.ok) {
    throw new Error(`Partnership sheet sync failed: ${response.status}`)
  }

  return { configured: true, ok: true }
}
