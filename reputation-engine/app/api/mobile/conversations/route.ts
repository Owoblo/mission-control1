import { getSmsContactPhone, normalizePhone } from '@/lib/sales-phones'
import { isPartnershipSenderNumber } from '@/lib/partnership-lines'
import { buildSmsThreads, listSmsThreadSummaryMessages } from '@/lib/server/sms-threads'
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

function matchesConversationSearch(values: Array<string | null | undefined>, search: string) {
  if (!search) return true
  const normalized = search.toLowerCase()
  const searchDigits = search.replace(/\D/g, '')
  return values.some(value => {
    const text = String(value || '')
    if (text.toLowerCase().includes(normalized)) return true
    return searchDigits.length >= 3 && text.replace(/\D/g, '').includes(searchDigits)
  })
}

async function loadContactsByIds(
  url: string,
  headers: Record<string, string>,
  ids: string[],
) {
  const contacts: Contact[] = []
  const batchSize = 100

  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize)
    const response = await fetch(
      `${url}/rest/v1/market_contacts?id=in.(${batch.map(encodeURIComponent).join(',')})&select=id,name,company,phone,city,stage,decision`,
      { headers, cache: 'no-store' },
    )
    if (!response.ok) throw new Error(`Partnership contact lookup failed: ${response.status}`)
    contacts.push(...await response.json() as Contact[])
  }

  return contacts
}

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const workspace = searchParams.get('workspace') === 'partnership' ? 'partnership' : 'sales'
  const search = (searchParams.get('q') || '').trim().slice(0, 100)
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
    const [directMessages, allRecentMessages, leads, inboundLeads] = await Promise.all([
      listSmsThreadSummaryMessages(250, 0, search),
      search ? Promise.all([0, 250, 500, 750].map(offset => listSmsThreadSummaryMessages(250, offset))) : Promise.resolve([]),
      listSalesLeads().catch(() => []),
      listAllInboundLeads().catch(() => []),
    ])
    const messages = [...directMessages, ...allRecentMessages.flat()]
      .filter((message, index, all) => {
        const key = `${message.direction}:${message.from_number}:${message.to_number}:${message.created_at}:${message.body}`
        return all.findIndex(candidate =>
          `${candidate.direction}:${candidate.from_number}:${candidate.to_number}:${candidate.created_at}:${candidate.body}` === key
        ) === index
      })
    const conversations = buildSmsThreads(messages, leads, inboundLeads)
      .filter(thread => lineNumbers.has(thread.businessNumber))
      .filter(thread => matchesConversationSearch([
        thread.leadName,
        thread.contactPhone,
        thread.branchLabel,
        thread.lastMessage,
      ], search))
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

  let contacts: Contact[]
  try {
    contacts = await loadContactsByIds(url, headers, ids)
  } catch {
    return Response.json({ error: 'Partnership contacts are temporarily unavailable.' }, { status: 503 })
  }
  const conversations = contacts
    .filter(contact => {
      const touch = latest.get(contact.id)
      return matchesConversationSearch([
        contact.name,
        contact.company,
        contact.phone,
        contact.city,
        contact.stage,
        contact.decision,
        touch?.notes,
      ], search)
    })
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
