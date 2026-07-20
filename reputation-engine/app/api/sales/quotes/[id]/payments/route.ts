import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesLead, saveSalesQuote } from '@/lib/server/sales-repository'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getQuotePaidSoFar } from '@/lib/server/job-billing'
import { getReceiptBrand } from '@/lib/receipt-brand'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import type { PaymentRecord, PaymentRecordKind, PaymentRecordMethod } from '@/lib/types'
import { deriveMoneyState } from '@/lib/payment-state'

const METHOD_LABELS: Record<PaymentRecordMethod, string> = {
  credit_card: 'Credit Card', debit: 'Debit', etransfer: 'Interac E-Transfer', cash: 'Cash',
  cheque: 'Cheque', bank_transfer: 'Bank Transfer', other: 'Other',
}

function money(value: number) {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(value)
}

function receiptNumber(quoteNumber: string, count: number) {
  return `SSR-${new Date().getFullYear()}-${quoteNumber.replace(/[^A-Z0-9]/gi, '').slice(-8).toUpperCase()}-${String(count + 1).padStart(2, '0')}`;
}

function paymentKindLabel(kind: PaymentRecordKind) {
  if (kind === 'deposit') return 'deposit'
  if (kind === 'balance' || kind === 'final') return 'balance'
  return 'payment'
}

function receiptUrl(quoteId: string, token: string) {
  return `${getAppBaseUrl('https://go.quote2move.com')}/receipt?id=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(token)}`
}

async function deliverReceipt(input: {
  payment: PaymentRecord
  quote: NonNullable<Awaited<ReturnType<typeof getSalesQuote>>>
  lead: NonNullable<Awaited<ReturnType<typeof getSalesLead>>>
  email?: string
  sendEmail: boolean
  sendSms: boolean
  actorName?: string
  actorUserId?: string
}) {
  const { payment, quote, lead } = input
  const brand = getReceiptBrand(lead, quote)
  const publicUrl = receiptUrl(quote.id, payment.publicToken)
  let emailSent = false
  let smsSent = false
  let emailError = ''
  let smsError = ''

  if (input.sendEmail && input.email) {
    try {
      await sendDepositReceipt({
        toEmail: input.email, toName: lead.name, quoteNumber: quote.number, moveDate: quote.moveDate,
        originCity: quote.originCity, destCity: quote.destCity, paymentKind: paymentKindLabel(payment.kind),
        depositAmount: payment.amount, balanceAmount: payment.balanceAfterPayment, totalAmount: quote.total,
        paymentMethod: payment.methodLabel, cardLast4: payment.cardLast4, receiptNumber: payment.receiptNumber,
        receiptUrl: publicUrl, paidAt: payment.paidAt, note: payment.note, reference: payment.reference, brand,
      })
      emailSent = true
    } catch (error) { emailError = error instanceof Error ? error.message : 'Email failed' }
  }

  if (input.sendSms && lead.phone) {
    try {
      const firstName = lead.name?.trim().split(/\s+/)[0] || 'there'
      await sendSalesMessage({
        channel: 'sms', to: lead.phone,
        body: `Hi ${firstName}, ${brand.name} received your ${money(payment.amount)} ${paymentKindLabel(payment.kind)} payment. Receipt ${payment.receiptNumber}: ${publicUrl} Balance: ${money(payment.balanceAfterPayment)}.`,
        leadId: lead.id, quoteId: quote.id, actor: 'human', actorName: input.actorName || brand.name,
        actorUserId: input.actorUserId, notes: `Payment receipt ${payment.receiptNumber} sent by SMS.`,
      })
      smsSent = true
    } catch (error) { smsError = error instanceof Error ? error.message : 'SMS failed' }
  }
  return { emailSent, smsSent, emailError, smsError, publicUrl }
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await request.json() as {
      amount?: number; kind?: PaymentRecordKind; method?: PaymentRecordMethod; paidAt?: string; note?: string;
      reference?: string; cardLast4?: string; email?: string; sendEmail?: boolean; sendSms?: boolean; paymentId?: string
    }
    const quote = await getSalesQuote(params.id)
    if (!quote?.leadId) return NextResponse.json({ error: 'Quote or attached lead not found' }, { status: 404 })
    const lead = await getSalesLead(quote.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    if (body.paymentId) {
      const payment = (quote.paymentRecords || []).find(item => item.id === body.paymentId)
      if (!payment) return NextResponse.json({ error: 'Payment receipt not found' }, { status: 404 })
      const delivery = await deliverReceipt({ payment, quote, lead, email: body.email || lead.email, sendEmail: body.sendEmail !== false, sendSms: body.sendSms === true, actorName: session?.name, actorUserId: session?.userId })
      const deliveredAt = new Date().toISOString()
      const updatedPayment = { ...payment, emailSentAt: delivery.emailSent ? deliveredAt : payment.emailSentAt, smsSentAt: delivery.smsSent ? deliveredAt : payment.smsSentAt }
      const savedQuote = await saveSalesQuote({ ...quote, paymentRecords: (quote.paymentRecords || []).map(item => item.id === payment.id ? updatedPayment : item) })
      return NextResponse.json({ ok: true, quote: savedQuote, lead, payment: updatedPayment, ...delivery })
    }

    const amount = Math.round(Number(body.amount || 0) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 })
    const kind = body.kind || 'partial'
    const method = body.method || 'etransfer'
    if (!METHOD_LABELS[method]) return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 })
    const paid = getQuotePaidSoFar(quote, lead)
    const paidAfterPayment = Math.round((paid.totalPaid + amount) * 100) / 100
    const balanceAfterPayment = Math.max(0, Math.round((Number(quote.total || 0) - paidAfterPayment) * 100) / 100)
    const now = new Date().toISOString()
    const payment: PaymentRecord = {
      id: uid('pay'), receiptNumber: receiptNumber(quote.number, (quote.paymentRecords || []).length), publicToken: crypto.randomUUID(),
      kind, method, methodLabel: METHOD_LABELS[method], amount, totalBeforePayment: quote.total, paidBeforePayment: paid.totalPaid,
      paidAfterPayment, balanceAfterPayment, paidAt: body.paidAt ? new Date(body.paidAt).toISOString() : now,
      note: body.note?.trim() || undefined, reference: body.reference?.trim() || undefined,
      cardLast4: body.cardLast4?.replace(/\D/g, '').slice(-4) || undefined, recordedBy: session?.name,
      recordedByUserId: session?.userId, status: 'captured',
    }
    let savedQuote = await saveSalesQuote({
      ...quote, status: quote.status === 'declined' ? quote.status : 'accepted', acceptedAt: quote.acceptedAt || now,
      paymentRecords: [...(quote.paymentRecords || []), payment],
      ...(kind === 'deposit' && !quote.depositPaidAt ? { depositPaidAt: payment.paidAt, depositPaidAmount: amount, depositPaidMethod: method === 'credit_card' ? 'stripe' : method === 'etransfer' ? 'etransfer' : method === 'cash' ? 'cash' : method === 'cheque' ? 'cheque' : 'other' } : {
        balancePaidAt: payment.paidAt, balancePaidAmount: Math.round((Number(quote.balancePaidAmount || 0) + amount) * 100) / 100,
        balancePaidMethod: method === 'credit_card' ? 'stripe' : method === 'etransfer' ? 'etransfer' : method === 'cash' ? 'cash' : method === 'cheque' ? 'cheque' : 'other',
      }),
    })
    const savedLead = await saveSalesLead({
      ...lead, stage: lead.stage === 'completed' ? lead.stage : 'booked', bookedAt: lead.bookedAt || now,
      paymentStatus: balanceAfterPayment <= 0 ? 'paid_in_full' : 'deposit_received',
      depositAmount: kind === 'deposit' ? amount : lead.depositAmount, depositMethod: kind === 'deposit' ? METHOD_LABELS[method] : lead.depositMethod,
      depositDate: kind === 'deposit' ? payment.paidAt.slice(0, 10) : lead.depositDate,
    })
    const delivery = await deliverReceipt({ payment, quote: savedQuote, lead: savedLead, email: body.email || savedLead.email, sendEmail: body.sendEmail !== false, sendSms: body.sendSms === true, actorName: session?.name, actorUserId: session?.userId })
    const deliveredAt = new Date().toISOString()
    const deliveredPayment = { ...payment, emailSentAt: delivery.emailSent ? deliveredAt : undefined, smsSentAt: delivery.smsSent ? deliveredAt : undefined }
    savedQuote = await saveSalesQuote({ ...savedQuote, paymentRecords: [...(savedQuote.paymentRecords || []).filter(item => item.id !== payment.id), deliveredPayment] })
    await saveFollowUpLog({ id: uid('fu'), leadId: lead.id, quoteId: quote.id, type: 'status_change', date: now, createdAt: now, notes: `${payment.receiptNumber}: ${money(amount)} ${paymentKindLabel(kind)} payment recorded via ${METHOD_LABELS[method]}. Balance ${money(balanceAfterPayment)}.` })
    return NextResponse.json({ ok: true, quote: savedQuote, lead: savedLead, payment: deliveredPayment, ...delivery })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Payment could not be recorded' }, { status: 500 })
  }
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const session = await getSessionUser()
  if (!session || (session.role !== 'owner' && session.role !== 'manager')) {
    return NextResponse.json({ error: 'Only an owner or manager can record a refund' }, { status: 403 })
  }

  try {
    const body = await request.json() as { paymentId?: string; amount?: number; reference?: string; reason?: string }
    const quote = await getSalesQuote(params.id)
    if (!quote?.leadId) return NextResponse.json({ error: 'Quote or attached lead not found' }, { status: 404 })
    const lead = await getSalesLead(quote.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    const payment = (quote.paymentRecords || []).find(item => item.id === body.paymentId)
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    const amount = Math.round(Number(body.amount || 0) * 100) / 100
    const alreadyRefunded = payment.status === 'refunded' ? payment.amount : Number(payment.refundedAmount || 0)
    const refundable = Math.max(0, Math.round((payment.amount - alreadyRefunded) * 100) / 100)
    if (!Number.isFinite(amount) || amount <= 0 || amount > refundable) {
      return NextResponse.json({ error: `Refund must be between $0.01 and ${money(refundable)}` }, { status: 400 })
    }
    if (!body.reason?.trim()) return NextResponse.json({ error: 'A refund reason is required' }, { status: 400 })

    const now = new Date().toISOString()
    const refundedAmount = Math.round((alreadyRefunded + amount) * 100) / 100
    const updatedPayment: PaymentRecord = {
      ...payment,
      status: refundedAmount >= payment.amount ? 'refunded' : 'partially_refunded',
      refundedAmount,
      refundedAt: now,
      refundReference: body.reference?.trim() || undefined,
      note: [payment.note, `Refund: ${body.reason.trim()} (${money(amount)})`].filter(Boolean).join(' · '),
    }
    const savedQuote = await saveSalesQuote({
      ...quote,
      paymentRecords: (quote.paymentRecords || []).map(item => item.id === payment.id ? updatedPayment : item),
    })
    const moneyState = deriveMoneyState(savedQuote, { ...lead, paymentStatus: undefined })
    const savedLead = await saveSalesLead({
      ...lead,
      paymentStatus: moneyState.balance <= 0 && moneyState.total > 0 ? 'paid_in_full' : moneyState.netPaid > 0 ? 'deposit_received' : 'pending',
    })
    await saveFollowUpLog({
      id: uid('fu'), leadId: lead.id, quoteId: quote.id, type: 'status_change', date: now, createdAt: now,
      notes: `${money(amount)} refund recorded against ${payment.receiptNumber} by ${session.name}. Reason: ${body.reason.trim()}${body.reference?.trim() ? ` Reference: ${body.reference.trim()}` : ''}`,
    })
    return NextResponse.json({ ok: true, quote: savedQuote, lead: savedLead, payment: updatedPayment, moneyState })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Refund could not be recorded' }, { status: 500 })
  }
}
