import { NextResponse } from 'next/server'
import { buildSmsThreads, listSmsMessages, mergeInboundLeadSmsThreadMessages } from '@/lib/server/sms-threads'
import { getSalesLead, listAllInboundLeads, listInboundLeadsByPhone, listSalesLeads } from '@/lib/server/sales-repository'

function attachStoredMmsMedia<T extends { twilio_sid?: string | null }>(
  messages: T[],
  mediaAssets?: Array<{ url?: string; source?: string; notes?: string; removed?: boolean }>
) {
  if (!mediaAssets?.length) return messages
  return messages.map(message => {
    const sid = message.twilio_sid?.trim()
    if (!sid) return message
    const mediaUrls = mediaAssets
      .filter(asset => asset.source === 'mms' && !asset.removed && asset.notes?.startsWith(`twilio:${sid}:`) && asset.url)
      .sort((left, right) => String(left.notes).localeCompare(String(right.notes), undefined, { numeric: true }))
      .map(asset => asset.url as string)
    return mediaUrls.length > 0 ? { ...message, mediaUrls } : message
  })
}

export { type SalesSmsThread as SmsThread, type SmsMessageRecord as SmsMessage } from '@/lib/server/sms-threads'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const filterPhone = searchParams.get('phone') ?? ''
    const filterLeadId = searchParams.get('leadId') ?? ''
    let messages = await listSmsMessages(filterPhone || undefined, filterLeadId || undefined)

    if (filterLeadId) {
      const lead = await getSalesLead(filterLeadId).catch(() => null)
      messages = attachStoredMmsMedia(messages, lead?.mediaAssets)
    }

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
