import { NextResponse } from 'next/server'
import { buildSmsThreads, listSmsMessages, mergeInboundLeadSmsThreadMessages } from '@/lib/server/sms-threads'
import { listAllInboundLeads, listInboundLeadsByPhone, listSalesLeads } from '@/lib/server/sales-repository'

export { type SalesSmsThread as SmsThread, type SmsMessageRecord as SmsMessage } from '@/lib/server/sms-threads'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filterPhone = searchParams.get('phone') ?? ''
    const filterLeadId = searchParams.get('leadId') ?? ''
    const messages = await listSmsMessages(filterPhone || undefined, filterLeadId || undefined)

    if (filterPhone || filterLeadId) {
      const inboundLeads = filterPhone
        ? await listInboundLeadsByPhone(filterPhone).catch(() => [])
        : []
      return NextResponse.json(mergeInboundLeadSmsThreadMessages(messages, inboundLeads, filterPhone || undefined))
    }

    const [leads, inboundLeads] = await Promise.all([
      listSalesLeads().catch(() => []),
      listAllInboundLeads().catch(() => []),
    ])
    return NextResponse.json(buildSmsThreads(messages, leads, inboundLeads))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load SMS threads' },
      { status: 500 }
    )
  }
}
