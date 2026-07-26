import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { buildPaymentRecord } from '@/lib/payment-records'
import { scheduleMoveReminder } from '@/lib/server/sales-automation'
import { getAppBaseUrl, readEnv } from '@/lib/server/runtime'
import { getReceiptBrand, type ReceiptBrand } from '@/lib/receipt-brand'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote, saveFollowUpLog } from '@/lib/server/sales-repository'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { uid } from '@/lib/sales'
import { deriveLeadBranch, generateCrewBrief, mergeCrewBrief, pickAutoAssignedCrewIds } from '@/lib/server/crew-dispatch'
import { deriveOpsChecklist, getQuotedTruckCount } from '@/lib/operations'
import { assertQuoteStripeAccount, requireStripeWebhookAccount, resolveStripeAccountKeyForLead, webhookMetadataMatchesAccount, type StripeAccountKey } from '@/lib/server/stripe-accounts'

function buildBookingConfirmationSms(name: string, brand: ReceiptBrand, moveDate?: string) {
  const first = (name || 'there').split(' ')[0]
  const dateLine = moveDate ? ` on ${new Date(moveDate).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}` : ''
  return `Hi ${first}! Your move with ${brand.fullName} is CONFIRMED${dateLine}. We're excited to take care of you. Questions? Call or text us at ${brand.phone}. – The ${brand.name} Team`
}

function buildBookingConfirmationEmail(name: string, brand: ReceiptBrand, moveDate?: string, originCity?: string, destCity?: string) {
  const first = (name || 'there').split(' ')[0]
  const dateLine = moveDate ? new Date(moveDate).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD'
  const route = originCity && destCity ? `${originCity} → ${destCity}` : originCity || destCity || 'TBD'
  return {
    subject: `Your Move is Confirmed — ${brand.fullName}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#1a1a1a;"><div style="background:#071421;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;"><div style="color:#C99700;font-size:24px;font-weight:700;">${brand.fullName}</div></div><div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:32px 24px;border-radius:0 0 12px 12px;"><h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${first} — your move is confirmed!</h1><p style="color:#555;margin:0 0 24px;line-height:1.6;">We have everything locked in. Move date: <strong>${dateLine}</strong> · Route: <strong>${route}</strong>.</p><p style="color:#555;font-size:14px;line-height:1.6;">Our team will reach out 48 hours before your move with crew details. Questions? <strong>${brand.phone}</strong></p></div></div>`,
    text: `Hi ${first}, your move with ${brand.fullName} is confirmed for ${dateLine} (${route}). We'll reach out 48 hours before. Questions? ${brand.phone}`,
  }
}

export async function POST(request: Request) {
  const webhookAccountKey: StripeAccountKey = new URL(request.url).pathname.endsWith('/dexa') ? 'dexa' : 'saturn'
  let stripeAccount
  try {
    stripeAccount = requireStripeWebhookAccount(webhookAccountKey)
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Stripe webhook not configured', { status: 503 })
  }
  const stripeKey = stripeAccount.secretKey
  const webhookSecret = stripeAccount.webhookSecret

  const body = await request.text()
  const sig = request.headers.get('stripe-signature') || ''

  let event: Stripe.Event
  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover', httpClient: Stripe.createNodeHttpClient() })
    event = webhookSecret
      ? stripe.webhooks.constructEvent(body, sig, webhookSecret)
      : JSON.parse(body) as Stripe.Event
  } catch (err) {
    return new Response(`Webhook signature failed: ${err instanceof Error ? err.message : 'unknown'}`, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const quoteId = session.metadata?.quoteId
    const leadId = session.metadata?.leadId
    const metadataAccount = session.metadata?.stripeAccountKey
    if (!webhookMetadataMatchesAccount(metadataAccount, stripeAccount.key)) {
      return new Response('Webhook account metadata mismatch', { status: 400 })
    }

    if (quoteId) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover', httpClient: Stripe.createNodeHttpClient() })
        const now = new Date().toISOString()

        const quote = await getSalesQuote(quoteId)
        if (!quote) throw new Error('Webhook quote not found')
        assertQuoteStripeAccount(quote, stripeAccount.key)
        const targetLeadId = leadId || quote.leadId
        if (!targetLeadId) throw new Error('Webhook lead context missing')
        const lead = await getSalesLead(targetLeadId)
        if (!lead) throw new Error('Webhook lead not found')
        if (resolveStripeAccountKeyForLead(lead) !== stripeAccount.key) {
          throw new Error('Webhook branch/account mismatch')
        }

        // Retrieve payment intent — source of truth for actual amount charged
        let paymentMethodId: string | undefined
        let customerId: string | undefined
        let piAmountPaid: number | undefined
        if (session.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(
            typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id
          )
          paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id
          customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id
          // amount_received is in cents — this is what was actually charged, not the quote deposit
          if (pi.amount_received) piAmountPaid = pi.amount_received / 100
        }
        // Priority: PI amount_received > session amount_total > quote deposit
        const actualDepositPaid = piAmountPaid ?? (session.amount_total ? session.amount_total / 100 : undefined)

        // Update the quote with deposit payment info
        const receiptAlreadyRecorded = quote?.depositStripeSessionId === session.id && !!quote.depositPaidAt
        const paymentRecord = quote && !receiptAlreadyRecorded
          ? buildPaymentRecord({ quote, amount: actualDepositPaid ?? quote.deposit, kind: 'deposit', method: 'credit_card', paidAt: now, reference: typeof session.payment_intent === 'string' ? session.payment_intent : session.id, recordedBy: 'Stripe Checkout' })
          : null
        if (quote) {
          await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: actualDepositPaid ?? quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripeSessionId: session.id,
            depositStripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            depositStripeCustomerId: customerId,
            depositStripePaymentMethodId: paymentMethodId,
            stripeAccountKey: stripeAccount.key,
            paymentRecords: paymentRecord ? [...(quote.paymentRecords || []), paymentRecord] : quote.paymentRecords,
          })
        }

        // Update the lead: auto-book + mark deposit received
        if (targetLeadId) {
          if (lead) {
            const alreadyBooked = lead.stage === 'booked' || lead.stage === 'completed'
            const paymentBrand = getReceiptBrand(lead, quote)
            const depositAmt = actualDepositPaid ?? quote?.deposit
            const branch = deriveLeadBranch(lead)
            const autoAssignedCrew = (lead.assignedCrew?.length ?? 0) > 0 ? lead.assignedCrew! : await pickAutoAssignedCrewIds(branch).catch(() => [] as string[])
            const autoCrewBrief = await generateCrewBrief({ lead: { ...lead, branch }, quote: quote ?? null }).catch(() => '')
            const quotedTruckCount = getQuotedTruckCount(lead, quote ?? null)

            await saveSalesLead({
              ...lead,
              stage: alreadyBooked ? lead.stage : 'booked',
              tentativeReservationStatus: lead.tentativeReservationStatus === 'active' ? 'converted' : lead.tentativeReservationStatus,
              bookedAt: alreadyBooked ? lead.bookedAt : now,
              paymentStatus: 'deposit_received',
              depositAmount: depositAmt,
              depositMethod: 'Credit Card',
              depositDate: now.slice(0, 10),
              followUpDate: alreadyBooked ? lead.followUpDate : undefined,
              followUpNote: alreadyBooked ? lead.followUpNote : undefined,
              assignedCrew: autoAssignedCrew.length > 0 ? autoAssignedCrew : lead.assignedCrew,
              crewNote: mergeCrewBrief(lead.crewNote, autoCrewBrief),
              truckCountConfirmed: quotedTruckCount || lead.truckCountConfirmed,
              truckSize: quotedTruckCount ? (lead.truckSize || '26ft') : lead.truckSize,
              truckReservationStatus: quotedTruckCount ? (lead.truckReservationStatus || 'needs_booking') : lead.truckReservationStatus,
              opsChecklist: deriveOpsChecklist({ ...lead, assignedCrew: autoAssignedCrew.length > 0 ? autoAssignedCrew : lead.assignedCrew }),
            })

            // Log booking to timeline
            if (!alreadyBooked) {
              await saveFollowUpLog({
                id: uid('fu'),
                leadId: targetLeadId,
                type: 'status_change',
                date: now,
                createdAt: now,
                notes: `Job auto-confirmed via Stripe deposit payment ($${(depositAmt || 0).toFixed(2)}).`,
              }).catch(() => {})

              // Send booking confirmation to customer
              if (lead.phone) {
                void sendSalesMessage({ channel: 'sms', to: lead.phone, body: buildBookingConfirmationSms(lead.name, paymentBrand, lead.moveDate), leadId: targetLeadId, actor: 'automation', actorName: paymentBrand.name, notes: 'Booking confirmation SMS (auto on deposit)' }).catch(() => {})
              }
              if (lead.email && quote) {
                const emailContent = buildBookingConfirmationEmail(lead.name, paymentBrand, lead.moveDate, lead.originCity, lead.destCity)
                void sendSalesMessage({ channel: 'email', to: lead.email, subject: emailContent.subject, body: emailContent.text, htmlBody: emailContent.html, leadId: targetLeadId, actor: 'automation', actorName: paymentBrand.name, notes: 'Booking confirmation email (auto on deposit)' }).catch(() => {})
              }
            }

            void scheduleMoveReminder(targetLeadId)

            // Notify the team — deposit paid
            if (!receiptAlreadyRecorded) {
              const customerName = lead.name || 'Customer'
              const depositAmt = (actualDepositPaid ?? quote?.deposit) || 0
              const quoteNum = quote?.number || ''
              const crmUrl = `${readEnv('NEXT_PUBLIC_APP_URL') || 'https://go.quote2move.com'}/sales/leads/${lead.id}`
              void sendRepAlertEmail(
                `💳 ${customerName} paid deposit — ${quoteNum}`,
                `<div style="font-family:sans-serif;color:#071421;max-width:520px">
                  <p><strong>${customerName}</strong> just paid their deposit of <strong>$${depositAmt.toFixed(2)}</strong> via Stripe.</p>
                  <table style="font-size:14px;border-collapse:collapse;width:100%">
                    <tr><td style="padding:4px 0;color:#666">Quote</td><td style="padding:4px 0">${quoteNum}</td></tr>
                    <tr><td style="padding:4px 0;color:#666">Deposit paid</td><td style="padding:4px 0;font-weight:600;color:#0f6a53">$${depositAmt.toFixed(2)}</td></tr>
                    <tr><td style="padding:4px 0;color:#666">Balance due</td><td style="padding:4px 0">$${Math.max(0,(quote?.total||0)-depositAmt).toFixed(2)}</td></tr>
                    ${lead.phone ? `<tr><td style="padding:4px 0;color:#666">Phone</td><td style="padding:4px 0">${lead.phone}</td></tr>` : ''}
                  </table>
                  <p style="margin-top:16px"><a href="${crmUrl}" style="background:#071421;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM →</a></p>
                </div>`
              ).catch(() => {})
            }

            if (!receiptAlreadyRecorded && lead.email && quote) {
              void sendDepositReceipt({
                toEmail: lead.email,
                toName: lead.name,
                quoteNumber: quote.number,
                moveDate: quote.moveDate,
                originCity: quote.originCity,
                destCity: quote.destCity,
                depositAmount: actualDepositPaid ?? quote.deposit,
                balanceAmount: Math.max(
                  0,
                  Math.round(((quote.total || 0) - (actualDepositPaid ?? quote.deposit)) * 100) / 100
                ),
                totalAmount: quote.total,
                paymentMethod: 'Credit Card',
                receiptNumber: paymentRecord?.receiptNumber,
                receiptUrl: paymentRecord ? `${getAppBaseUrl('https://go.quote2move.com')}/receipt?id=${encodeURIComponent(quote.id)}&token=${encodeURIComponent(paymentRecord.publicToken)}` : undefined,
                paidAt: paymentRecord?.paidAt,
                reference: paymentRecord?.reference,
                brand: getReceiptBrand(lead, quote),
              }).catch(() => null)
            }
          }
        }
      } catch (err) {
        console.error('Stripe webhook processing error:', err)
        // Non-2xx is intentional: Stripe retries transient processing failures.
        // Returning 200 here previously acknowledged events even when CRM booking
        // or payment persistence failed.
        return new Response('Webhook processing failed', { status: 500 })
      }
    }
  }

  return NextResponse.json({ received: true })
}
