import { NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { excludePartnershipMessages } from '@/lib/server/partnership-message-context'
import { buildSmsThreads, listSmsMessages, listSmsThreadSummaryMessages, mergeInboundLeadSmsThreadMessages } from '@/lib/server/sms-threads'
import { listAllInboundLeads, listInboundLeadsByPhone, listSalesLeadInboxSnapshots } from '@/lib/server/sales-repository'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'

export { type SalesSmsThread as SmsThread, type SmsMessageRecord as SmsMessage } from '@/lib/server/sms-threads'

const loadSummaries = unstable_cache(async (limit: number, offset: number, search: string) => {
  const [messages, leads, inboundLeads] = await Promise.all([
    listSmsThreadSummaryMessages(limit, offset, search),
    listSalesLeadInboxSnapshots(),
    listAllInboundLeads(),
  ])
  return buildSmsThreads(messages, leads, inboundLeads, false).map(thread => (
    limit === Number.MAX_SAFE_INTEGER ? thread : { ...thread, messages: [] }
  ))
}, ['sales-sms-owned-summaries-v1'], { revalidate: 5 })

export async function GET(request: Request) {
  try {
    if (!canAccessSalesWorkspace(await getSessionUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { searchParams } = new URL(request.url)
    const filterPhone = searchParams.get('phone') ?? ''
    const filterLeadId = searchParams.get('leadId') ?? ''
    if (filterPhone || filterLeadId) {
      const messages = await listSmsMessages(filterPhone || undefined, filterLeadId || undefined)
      const inboundLeads = filterPhone ? await listInboundLeadsByPhone(filterPhone) : []
      return NextResponse.json(await excludePartnershipMessages(mergeInboundLeadSmsThreadMessages(messages, inboundLeads, filterPhone || undefined)))
    }

    // Older inbox clients fetch the complete list with message bodies and search locally.
    // Paginated clients opt in explicitly; never silently hide their older rows.
    const limit = searchParams.has('limit')
      ? Math.min(250, Math.max(1, Math.floor(Number(searchParams.get('limit')) || 150)))
      : Number.MAX_SAFE_INTEGER
    const offset = Math.max(0, Math.floor(Number(searchParams.get('offset')) || 0))
    const search = (searchParams.get('search') || '').trim().slice(0, 80)
    return NextResponse.json(await loadSummaries(limit, offset, search))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load SMS threads' },
      { status: 500 }
    )
  }
}
