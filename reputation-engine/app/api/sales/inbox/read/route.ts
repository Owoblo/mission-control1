import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import {
  markInboundLeadRead,
  markLeadInboxChannelRead,
  markSalesEmailRead,
} from '@/lib/server/sales-repository'
import type { LeadInboxChannel } from '@/lib/types'

type SmsThreadTarget = {
  leadId?: string | null
  inboundId?: string | null
  channel?: LeadInboxChannel
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as {
      inboundIds?: string[]
      emailIds?: string[]
      smsThreads?: SmsThreadTarget[]
    }

    const actor = {
      userId: session?.userId,
      name: session?.name,
    }

    const inboundIds = Array.from(new Set((payload.inboundIds || []).filter(Boolean)))
    const emailIds = Array.from(new Set((payload.emailIds || []).filter(Boolean)))
    const smsThreads = (payload.smsThreads || []).filter(thread => !!thread.leadId || !!thread.inboundId)

    await Promise.all([
      ...inboundIds.map(inboundId => markInboundLeadRead(inboundId, actor)),
      ...emailIds.map(emailId => markSalesEmailRead(emailId, actor)),
      ...smsThreads.map(thread => {
        const channel = thread.channel || 'sms'
        if (thread.leadId) {
          return markLeadInboxChannelRead(thread.leadId, channel, actor)
        }
        if (thread.inboundId) {
          return markInboundLeadRead(thread.inboundId, actor, channel)
        }
        return Promise.resolve()
      }),
    ])

    return NextResponse.json({
      ok: true,
      counts: {
        inbound: inboundIds.length,
        emails: emailIds.length,
        smsThreads: smsThreads.length,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update inbox read state' },
      { status: 400 }
    )
  }
}
