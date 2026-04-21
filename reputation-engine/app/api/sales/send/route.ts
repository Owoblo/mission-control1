import { NextResponse } from 'next/server'
import { sendSalesMessage } from '@/lib/server/sales-messaging'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      channel?: 'email' | 'sms'
      to?: string
      subject?: string
      body?: string
      message?: string
      htmlBody?: string
      leadId?: string
      quoteId?: string
      notes?: string
      fromNumber?: string
      actor?: 'human' | 'automation'
    }

    const body = payload.body || payload.message

    if (!payload.channel || !payload.to || !body) {
      return NextResponse.json({ error: 'channel, to, and body are required' }, { status: 400 })
    }

    const result = await sendSalesMessage({
      channel: payload.channel,
      to: payload.to,
      subject: payload.subject,
      body,
      htmlBody: payload.htmlBody,
      leadId: payload.leadId,
      quoteId: payload.quoteId,
      notes: payload.notes,
      fromNumber: payload.fromNumber,
      actor: payload.actor || 'human',
    })

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 400 }
    )
  }
}
