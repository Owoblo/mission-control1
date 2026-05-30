/**
 * POST /api/sales/deposit-receipt
 * Sends a branded deposit confirmation receipt to the customer.
 */
import { NextResponse } from 'next/server'
import { sendDepositReceipt, type DepositReceiptPayload } from '@/lib/server/deposit-receipts'
import { hasInternalSession } from '@/lib/server/session'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  try {
    const payload = (await request.json()) as DepositReceiptPayload
    if (!payload.toEmail) {
      return NextResponse.json({ error: 'toEmail required' }, { status: 400 })
    }

    await sendDepositReceipt(payload)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Receipt failed' }, { status: 500 })
  }
}
