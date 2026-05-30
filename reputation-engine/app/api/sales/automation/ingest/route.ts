import { NextResponse } from 'next/server'
import { isAutomationRequestAuthorized } from '@/lib/server/automation-auth'
import { processInboundAutomationEvent } from '@/lib/server/sales-automation'

export async function POST(request: Request) {
  if (!(await isAutomationRequestAuthorized(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as Parameters<typeof processInboundAutomationEvent>[0]
    const result = await processInboundAutomationEvent(body)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to ingest automation event' },
      { status: 400 }
    )
  }
}
