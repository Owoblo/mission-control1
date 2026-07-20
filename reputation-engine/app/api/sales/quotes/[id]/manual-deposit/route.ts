import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { uid } from '@/lib/sales'
import { buildPaymentRecord } from '@/lib/payment-records'
import type { CRMLead, CRMQuote } from '@/lib/types'

const MANUAL_METHOD_LABELS = {
  cash: 'Cash',
  etransfer: 'Interac E-Transfer',
  cheque: 'Cheque',
} as const

type ManualDepositMethod = keyof typeof MANUAL_METHOD_LABELS

function manualQuoteMethod(method: ManualDepositMethod): NonNullable<CRMQuote['depositPaidMethod']> {
  if (method === 'cash') return 'cash'
  if (method === 'cheque') return 'cheque'
  return 'etransfer'
}

function money(value?: number | null) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(value || 0))
}

function firstName(name?: string | null) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function buildQuoteUrl(quote: CRMQuote) {
  if (!quote.acceptToken) return ''
  const baseUrl = getAppBaseUrl('https://go.quote2move.com')
  return `${baseUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken)}`
}

function buildReceiptSms(lead: CRMLead, quote: CRMQuote, amount: number, balanceAmount: number) {
  const quoteUrl = buildQuoteUrl(quote)
  return [
    `Hi ${firstName(lead.name)}, Saturn Star Moving received your ${money(amount)} deposit for ${quote.number}.`,
    `Your move is confirmed. Balance due after the move: ${money(balanceAmount)}.`,
    quoteUrl ? `Receipt/quote: ${quoteUrl}` : '',
  ].filter(Boolean).join(' ')
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      method?: ManualDepositMethod
      note?: string
      amount?: number
      sendReceipt?: boolean
      sendSmsReceipt?: boolean
      recordAccounting?: boolean
    }

    const method = body.method || 'etransfer'
    if (!MANUAL_METHOD_LABELS[method]) {
      return NextResponse.json({ error: 'Unsupported manual payment method' }, { status: 400 })
    }

    const quote = await getSalesQuote(params.id)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!quote.leadId) return NextResponse.json({ error: 'Quote is not attached to a lead' }, { status: 400 })

    const lead = await getSalesLead(quote.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const now = new Date()
    const paidAt = now.toISOString()
    const paidDate = paidAt.slice(0, 10)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Deposit amount must be greater than zero' }, { status: 400 })
    }

    const methodLabel = MANUAL_METHOD_LABELS[method]
    const note = (body.note || '').trim()
    const balanceAmount = Math.max(0, Math.round(((quote.total || 0) - amount) * 100) / 100)
    const paidInFull = balanceAmount <= 0

    const paymentRecord = buildPaymentRecord({
      quote,
      lead,
      amount,
      kind: 'deposit',
      method,
      paidAt,
      note: note || undefined,
      recordedBy: session?.name,
      recordedByUserId: session?.userId,
    })

    const savedQuote = await saveSalesQuote({
      ...quote,
      status: quote.status === 'declined' ? quote.status : 'accepted',
      acceptedAt: quote.acceptedAt || paidDate,
      respondedAt: quote.respondedAt || paidAt,
      depositPaidAt: quote.depositPaidAt || paidAt,
      depositPaidAmount: amount,
      depositPaidMethod: manualQuoteMethod(method),
      depositPaidNote: note || `Manually verified by ${session?.name || 'Saturn Star'}`,
      paymentRecords: [...(quote.paymentRecords || []), paymentRecord],
    })

    const savedLead = await saveSalesLead({
      ...lead,
      stage: lead.stage === 'completed' ? lead.stage : 'booked',
      bookedAt: lead.bookedAt || paidAt,
      paymentStatus: paidInFull ? 'paid_in_full' : 'deposit_received',
      depositAmount: amount,
      depositMethod: methodLabel,
      depositDate: paidDate,
      followUpDate: undefined,
      followUpNote: undefined,
    })

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: lead.id,
      quoteId: quote.id,
      type: 'status_change',
      date: paidAt,
      createdAt: paidAt,
      notes: [
        `Manual deposit verified: $${amount.toFixed(2)} via ${methodLabel}.`,
        note ? `Note: ${note}` : '',
      ].filter(Boolean).join(' '),
    })

    let receiptSent = false
    let receiptError: string | undefined
    if (body.sendReceipt !== false && savedLead.email) {
      try {
        await sendDepositReceipt({
          toEmail: savedLead.email,
          toName: savedLead.name,
          quoteNumber: savedQuote.number,
          moveDate: savedQuote.moveDate,
          originCity: savedQuote.originCity,
          destCity: savedQuote.destCity,
          depositAmount: amount,
          balanceAmount,
          totalAmount: savedQuote.total,
          paymentMethod: methodLabel,
        })
        receiptSent = true
      } catch (error) {
        receiptError = error instanceof Error ? error.message : 'Receipt failed'
      }
    }

    let smsReceiptSent = false
    let smsReceiptError: string | undefined
    if (body.sendSmsReceipt === true && savedLead.phone) {
      try {
        await sendSalesMessage({
          channel: 'sms',
          to: savedLead.phone,
          body: buildReceiptSms(savedLead, savedQuote, amount, balanceAmount),
          leadId: savedLead.id,
          quoteId: savedQuote.id,
          actor: 'human',
          actorName: session?.name || 'Saturn Star',
          actorUserId: session?.userId,
          notes: `Deposit receipt SMS sent to ${savedLead.phone}.`,
        })
        smsReceiptSent = true
      } catch (error) {
        smsReceiptError = error instanceof Error ? error.message : 'Receipt SMS failed'
      }
    }

    if (body.recordAccounting !== false) {
      const baseUrl = getAppBaseUrl()
      void fetch(`${baseUrl}/api/sales/stripe/record-cash`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: request.headers.get('cookie') || '',
        },
        body: JSON.stringify({
          leadId: savedLead.id,
          leadName: savedLead.name,
          leadEmail: savedLead.email,
          leadPhone: savedLead.phone,
          quoteNumber: savedQuote.number,
          amount,
          method,
          description: `Deposit - ${savedQuote.number} - ${savedLead.name} - ${methodLabel}`,
        }),
      }).catch(() => null)
    }

    return NextResponse.json({
      ok: true,
      lead: savedLead,
      quote: savedQuote,
      receiptSent,
      receiptError,
      smsReceiptSent,
      smsReceiptError,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Manual deposit verification failed' },
      { status: 500 }
    )
  }
}

export async function DELETE(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const quote = await getSalesQuote(params.id)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!quote.leadId) return NextResponse.json({ error: 'Quote is not attached to a lead' }, { status: 400 })

    if (quote.depositPaidMethod === 'stripe' || quote.depositStripeSessionId || quote.depositStripePaymentIntentId) {
      return NextResponse.json({ error: 'Stripe deposits cannot be cleared manually from this action.' }, { status: 409 })
    }

    const lead = await getSalesLead(quote.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const savedQuote = await saveSalesQuote({
      ...quote,
      depositPaidAt: undefined,
      depositPaidAmount: undefined,
      depositPaidMethod: undefined,
      depositPaidNote: undefined,
    })

    const savedLead = await saveSalesLead({
      ...lead,
      paymentStatus: 'pending',
      depositAmount: undefined,
      depositMethod: undefined,
      depositDate: undefined,
    })

    const now = new Date().toISOString()
    await saveFollowUpLog({
      id: uid('fu'),
      leadId: lead.id,
      quoteId: quote.id,
      type: 'status_change',
      date: now,
      createdAt: now,
      notes: `Manual deposit mark cleared by ${session?.name || 'Saturn Star'}.`,
    })

    return NextResponse.json({ ok: true, lead: savedLead, quote: savedQuote })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Manual deposit clear failed' },
      { status: 500 }
    )
  }
}
