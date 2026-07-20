import { NextResponse } from 'next/server'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { getQuotePaidSoFar } from '@/lib/server/job-billing'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { uid } from '@/lib/sales'
import { resolveDepositReceiptAmount } from '@/lib/payment-records'
import type { CRMLead, CRMQuote } from '@/lib/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function cleanEmail(value?: string | null) {
  const email = String(value || '').trim().toLowerCase()
  return EMAIL_RE.test(email) ? email : ''
}

function paymentMethodLabel(quote: CRMQuote, fallback?: string) {
  if (quote.depositPaidMethod === 'stripe') return 'Credit Card'
  if (quote.depositPaidMethod === 'etransfer') return 'Interac E-Transfer'
  if (quote.depositPaidMethod === 'cash') return 'Cash'
  if (quote.depositPaidMethod === 'cheque') return 'Cheque'
  return fallback || 'Payment'
}

function money(value?: number | null) {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(amount)
}

function firstName(name?: string | null) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function buildQuoteUrl(quote: CRMQuote) {
  if (!quote.acceptToken) return ''
  const baseUrl = getAppBaseUrl('https://go.quote2move.com')
  return `${baseUrl}/quote-accept?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(quote.acceptToken)}`
}

function buildReceiptSms(lead: CRMLead, quote: CRMQuote, depositAmount: number, balanceAmount: number) {
  const quoteUrl = buildQuoteUrl(quote)
  return [
    `Hi ${firstName(lead.name)}, Saturn Star Moving received your ${money(depositAmount)} deposit for ${quote.number}.`,
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
    const quote = await getSalesQuote(params.id)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })
    if (!quote.leadId) return NextResponse.json({ error: 'Quote is not attached to a lead' }, { status: 400 })

    const lead = await getSalesLead(quote.leadId)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const body = (await request.json().catch(() => ({}))) as {
      toEmail?: string
      updateLeadEmail?: boolean
      sendEmail?: boolean
      sendSms?: boolean
    }
    const shouldSendEmail = body.sendEmail !== false
    const shouldSendSms = body.sendSms === true
    if (!shouldSendEmail && !shouldSendSms) {
      return NextResponse.json({ error: 'Choose email, SMS, or both before sending the receipt.' }, { status: 400 })
    }

    const toEmail = cleanEmail(body.toEmail) || cleanEmail(lead.email)
    if (shouldSendEmail && !toEmail) {
      return NextResponse.json({ error: 'A valid customer email is required before sending the receipt.' }, { status: 400 })
    }
    if (shouldSendSms && !lead.phone) {
      return NextResponse.json({ error: 'A customer phone number is required before texting the receipt.' }, { status: 400 })
    }

    const paid = getQuotePaidSoFar(quote, lead)
    const receiptAmount = resolveDepositReceiptAmount(quote, lead)
    if (!quote.depositPaidAt && !lead.depositDate && paid.totalPaid <= 0) {
      return NextResponse.json({ error: 'No deposit has been recorded for this quote yet.' }, { status: 409 })
    }

    const savedLead = body.updateLeadEmail && toEmail !== cleanEmail(lead.email)
      ? await saveSalesLead({ ...lead, email: toEmail })
      : lead
    const balanceAmount = Math.max(0, Math.round((Number(quote.total || 0) - Math.max(receiptAmount, paid.totalPaid)) * 100) / 100)

    let receiptSent = false
    let receiptId: string | undefined
    let receiptError: string | undefined
    if (shouldSendEmail) {
      try {
        const result = await sendDepositReceipt({
          toEmail,
          toName: savedLead.name,
          quoteNumber: quote.number,
          moveDate: quote.moveDate,
          originCity: quote.originCity,
          destCity: quote.destCity,
          depositAmount: receiptAmount,
          balanceAmount,
          totalAmount: quote.total,
          paymentMethod: paymentMethodLabel(quote, savedLead.depositMethod),
          cardLast4: quote.depositStripeCardLast4,
        })
        receiptSent = true
        receiptId = result.id || undefined
      } catch (error) {
        receiptError = error instanceof Error ? error.message : 'Receipt email failed'
      }
    }

    let smsSent = false
    let smsError: string | undefined
    if (shouldSendSms) {
      try {
        await sendSalesMessage({
          channel: 'sms',
          to: savedLead.phone || '',
          body: buildReceiptSms(savedLead, quote, receiptAmount, balanceAmount),
          leadId: savedLead.id,
          quoteId: quote.id,
          actor: 'human',
          actorName: session?.name || 'Saturn Star',
          actorUserId: session?.userId,
          notes: `Deposit receipt SMS sent to ${savedLead.phone}.`,
        })
        smsSent = true
      } catch (error) {
        smsError = error instanceof Error ? error.message : 'Receipt SMS failed'
      }
    }

    if ((shouldSendEmail && !receiptSent) && (!shouldSendSms || !smsSent)) {
      return NextResponse.json(
        { error: receiptError || smsError || 'Receipt send failed', receiptSent, receiptError, smsSent, smsError },
        { status: 500 }
      )
    }

    const now = new Date().toISOString()
    const delivered = [
      receiptSent ? `email to ${toEmail}` : '',
      smsSent ? `SMS to ${savedLead.phone}` : '',
    ].filter(Boolean)
    const failed = [
      receiptError ? `email failed: ${receiptError}` : '',
      smsError ? `SMS failed: ${smsError}` : '',
    ].filter(Boolean)
    await saveFollowUpLog({
      id: uid('fu'),
      leadId: savedLead.id,
      quoteId: quote.id,
      type: 'status_change',
      date: now,
      createdAt: now,
      notes: [
        delivered.length ? `Deposit receipt sent by ${delivered.join(' and ')}${receiptId ? ` (${receiptId})` : ''}.` : '',
        failed.length ? failed.join(' ') : '',
      ].filter(Boolean).join(' '),
    })

    return NextResponse.json({
      ok: true,
      lead: savedLead,
      quote,
      email: toEmail,
      receiptId,
      receiptSent,
      receiptError,
      smsSent,
      smsError,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Receipt send failed' },
      { status: 500 }
    )
  }
}
