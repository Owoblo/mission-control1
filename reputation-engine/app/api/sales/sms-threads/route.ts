import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { buildSmsThreads, listSmsMessages, listSmsThreadSummaryMessages, mergeInboundLeadSmsThreadMessages } from '@/lib/server/sms-threads'
import { listAllInboundLeads, listInboundLeadsByPhone, listSalesLeadInboxSnapshots } from '@/lib/server/sales-repository'
import { findUniqueRelationshipContactsByPhones } from '@/lib/server/relationship-contact-link'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export { type SalesSmsThread as SmsThread, type SmsMessageRecord as SmsMessage } from '@/lib/server/sms-threads'

async function loadSmsThreadSummaries(limit = 150, offset = 0, search = '') {
  const [messages, leads, inboundLeads] = await Promise.all([
    listSmsThreadSummaryMessages(limit, offset, search),
    listSalesLeadInboxSnapshots().catch(() => []),
    listAllInboundLeads().catch(() => []),
  ])
  const threads = buildSmsThreads(messages, leads, inboundLeads, false)
  const unresolvedThreads = threads.filter(thread => !thread.leadName)
  const relationshipMatches = await findUniqueRelationshipContactsByPhones(
    unresolvedThreads.map(thread => thread.contactPhone)
  ).catch(() => new Map())
  for (const thread of unresolvedThreads) {
    const digits = thread.contactPhone.replace(/\D/g, '').slice(-10)
    const contact = relationshipMatches.get(digits)
    if (contact?.name?.trim()) {
      thread.leadName = contact.name.trim()
      thread.relationshipContactId = contact.id
    }
  }
  return threads.map(thread => ({ ...thread, messages: [] }))
}

const loadCachedSmsThreadSummaries = unstable_cache(loadSmsThreadSummaries, ['sales-sms-thread-summaries-v2'], {
  revalidate: 5,
})


export async function GET(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const filterPhone = searchParams.get('phone') ?? ''
    const filterLeadId = searchParams.get('leadId') ?? ''
    if (filterPhone || filterLeadId) {
      const messages = await listSmsMessages(filterPhone || undefined, filterLeadId || undefined)
      const inboundLeads = filterPhone
        ? await listInboundLeadsByPhone(filterPhone).catch(() => [])
        : []
      return NextResponse.json(mergeInboundLeadSmsThreadMessages(messages, inboundLeads, filterPhone || undefined))
    }

    const limit = Math.min(250, Math.max(1, Number(searchParams.get('limit')) || 150))
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)
    const search = (searchParams.get('search') || '').trim().slice(0, 80)
    return NextResponse.json(await loadCachedSmsThreadSummaries(limit, offset, search))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load SMS threads' },
      { status: 500 }
    )
  }
}
