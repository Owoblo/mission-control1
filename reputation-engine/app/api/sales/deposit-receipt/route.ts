import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  void request
  return NextResponse.json({
    error: 'This unverified receipt endpoint is retired. Send receipts from a quote-linked payment record.',
  }, { status: 410 })
}
