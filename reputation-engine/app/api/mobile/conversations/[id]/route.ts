import { normalizePhone } from '@/lib/sales-phones'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { listMobilePhoneLines } from '@/lib/server/mobile-phone-access'
import { listInboundLeadsByPhone } from '@/lib/server/sales-repository'
import { listSmsMessages, mergeInboundLeadSmsThreadMessages } from '@/lib/server/sms-threads'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type Touch = {
  id: string
  direction: string | null
  notes: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace') === 'partnership' ? 'partnership' : 'sales'
  const line = normalizePhone(searchParams.get('line'))
  const allowedLine = listMobilePhoneLines(session)
    .find(candidate => candidate.number === line && candidate.workspace === workspace)
  if (!line || !allowedLine) {
    return Response.json({ error: 'You do not have access to this company line.' }, { status: 403 })
  }

  if (workspace === 'sales') {
    const phone = normalizePhone(id)
    const [messages, inboundLeads] = await Promise.all([
      listSmsMessages(phone),
      listInboundLeadsByPhone(phone).catch(() => []),
    ])
    const filtered = mergeInboundLeadSmsThreadMessages(messages, inboundLeads, phone)
      .filter(message => normalizePhone(
        message.direction === 'inbound' ? message.to_number : message.from_number,
      ) === line)
    return Response.json({ messages: filtered })
  }

  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(id)}&channel=eq.sms&select=id,direction,notes,created_at,metadata&order=created_at.asc&limit=1000`,
    { headers, cache: 'no-store' },
  )
  if (!response.ok) return Response.json({ error: 'Conversation is temporarily unavailable.' }, { status: 503 })
  const messages = (await response.json() as Touch[]).filter(touch => {
    const metadata = touch.metadata || {}
    const value = touch.direction === 'inbound'
      ? metadata.to || metadata.To || metadata.to_number
      : metadata.from || metadata.From || metadata.from_number
    return normalizePhone(typeof value === 'string' ? value : '') === line
  }).map(touch => ({
    id: touch.id,
    body: touch.notes || '',
    direction: touch.direction === 'inbound' ? 'inbound' : 'outbound',
    created_at: touch.created_at,
  }))
  return Response.json({ messages })
}
