import { NextResponse } from 'next/server'
import { requireWorkerBaseUrl } from '@/lib/server/runtime'

export async function GET() {
  try {
    const workerBase = requireWorkerBaseUrl()
    const workerSecret = process.env.WORKER_SHARED_SECRET
    if (!workerSecret) {
      return NextResponse.json({ error: 'Missing WORKER_SHARED_SECRET' }, { status: 500 })
    }

    const response = await fetch(`${workerBase}/voice-token`, {
      cache: 'no-store',
      headers: {
        'x-internal-secret': workerSecret,
      },
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.error || 'Failed to initialize dialer' },
        { status: response.status || 500 }
      )
    }

    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize dialer' },
      { status: 500 }
    )
  }
}
