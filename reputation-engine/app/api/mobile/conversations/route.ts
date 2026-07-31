import { getSmsContactPhone, normalizePhone } from '@/lib/sales-phones'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
import { buildSmsThreads, listSmsMessages } from '@/lib/server/sms-threads'
import { listAllInboundLeads, listSalesLeads } from '@/lib/server/sales-repository'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { canUseMobilePhoneLine, listMobilePhoneLines } from '@/lib/server/mobile-phone-access'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type Touch = {
  id: string
  contact_id: string
  direction: string | null
  notes: string | null
  created_at: string
  metadata: Record<string, unknown> | null
}

type Contact = {
  id: string
  name: string | null
  company: string | null
  phone: string | null
  city: string | null
  stage: string | null
  decision: string | null
}

function metadataPhone(touch: Touch, keys: string[]) {
  for (const key of keys) {
    const value = touch.metadata?.[key]
    if (typeof value === 'string' && value.trim()) return normalizePhone(value)
  }
  return ''
}

function touchLine(touch: Touch) {
  return touch.direction === 'inbound'
    ? metadataPhone(touch, ['to', 'To', 'to_number', 'toNumber'])
    : metadataPhone(touch, ['from', 'From', 'from_number', 'fromNumber'])
}

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace') === 'partnership' ? 'partnership' : 'sales'
  const selectedLine = normalizePhone(searchParams.get('line'))
  const allowedLines = listMobilePhoneLines(session).filter(line => line.workspace === workspace)
  if (selectedLine && !canUseMobilePhoneLine(session, selectedLine)) {
    return Response.json({ error: 'You do not have access to this company line.' }, { status: 403 })
  }
  const lineNumbers = new Set(
    (selectedLine ? allowedLines.filter(line => line.number === selectedLine) : allowedLines)
      .map(line => line.number),
  )

  if (workspace === 'sales') {
    const [messages, leads, inboundLeads] = await Promise.all([
      listSmsMessages(),
      listSalesLeads().catch(() => []),
      listAllInboundLeads().catch(() => []),
    ])
    const conversations = buildSmsThreads(messages, leads, inboundLeads)
      .filter(thread => lineNumbers.has(thread.businessNumber))
      .slice(0, 150)
      .map(thread => ({
        id: thread.contactPhone,
        workspace,
        name: thread.leadName || thread.contactPhone,
        subtitle: thread.branchLabel,
        phone: thread.contactPhone,
        line: thread.businessNumber,
        lastMessage: thread.lastMessage,
        lastAt: thread.lastAt,
        lastDirection: thread.lastDirection,
        unreadCount: thread.unreadCount,
        city: '',
        status: thread.lastDirection === 'inbound' ? 'needs_reply' : 'waiting',
        needsReply: thread.lastDirection === 'inbound',
        responded: thread.messages.some(message => message.direction === 'inbound'),
        activePartner: false,
      }))
    return Response.json({ conversations, lines: allowedLines })
  }

  const { url, headers } = requireSupabaseEnv()
  const touchesResponse = await fetch(
    `${url}/rest/v1/market_touches?channel=eq.sms&select=id,contact_id,direction,notes,created_at,metadata&order=created_at.desc&limit=3000`,
    { headers, cache: 'no-store' },
  )
  if (!touchesResponse.ok) {
    return Response.json({ error: 'Partnership messages are temporarily unavailable.' }, { status: 503 })
  }
  const touches = (await touchesResponse.json() as Touch[])
    .filter(touch => {
      const line = touchLine(touch)
      return lineNumbers.has(line) && isPartnershipSenderNumber(line, { includeRecovery: true })
    })
  const latest = new Map<string, Touch>()
  for (const touch of touches) if (!latest.has(touch.contact_id)) latest.set(touch.contact_id, touch)
  const ids = Array.from(latest.keys())
  if (!ids.length) return Response.json({ conversations: [], lines: allowedLines })

  const contactsResponse = await fetch(
    `${url}/rest/v1/market_contacts?id=in.(${ids.map(encodeURIComponent).join(',')})&select=id,name,company,phone,city,stage,decision`,
    { headers, cache: 'no-store' },
  )
  const contacts = contactsResponse.ok ? await contactsResponse.json() as Contact[] : []
  const conversations = contacts
    .map(contact => {
      const touch = latest.get(contact.id)
      if (!touch) return null
      return {
        id: contact.id,
        workspace,
        name: contact.name || contact.phone || 'Partnership contact',
        subtitle: contact.company || contact.city || 'Partnership',
        phone: normalizePhone(contact.phone),
        line: touchLine(touch),
        lastMessage: touch.notes || '',
        lastAt: touch.created_at,
        lastDirection: touch.direction === 'inbound' ? 'inbound' : 'outbound',
        unreadCount: touch.direction === 'inbound' ? 1 : 0,
        city: contact.city || '',
        status: touch.direction === 'inbound' ? 'needs_reply' : 'waiting',
        needsReply: touch.direction === 'inbound',
        responded: touches.some(candidate =>
          candidate.contact_id === contact.id && candidate.direction === 'inbound'
        ),
        activePartner:
          String(contact.decision || '').toLowerCase() === 'agreed' ||
          String(contact.stage || '').toLowerCase() === 'partnership_active',
      }
    })
    .filter(Boolean)
    .sort((left, right) => String(right!.lastAt).localeCompare(String(left!.lastAt)))
    .slice(0, 150)
  return Response.json({ conversations, lines: allowedLines })
}
