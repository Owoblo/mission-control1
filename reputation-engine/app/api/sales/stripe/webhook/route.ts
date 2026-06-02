import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { sendDepositReceipt } from '@/lib/server/deposit-receipts'
import { scheduleMoveReminder } from '@/lib/server/sales-automation'
import { readEnv } from '@/lib/server/runtime'
import { getSalesLead, getSalesQuote, saveSalesLead, saveSalesQuote, saveFollowUpLog } from '@/lib/server/sales-repository'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { uid } from '@/lib/sales'
import { deriveLeadBranch, generateCrewBrief, mergeCrewBrief, pickAutoAssignedCrewIds } from '@/lib/server/crew-dispatch'
import { deriveOpsChecklist, getQuotedTruckCount } from '@/lib/operations'

const SATURN_STAR_PHONE = '+12267732993'
const SATURN_STAR_EMAIL = 'business@starmovers.ca'

function buildBookingConfirmationSms(name: string, moveDate?: string) {
  const first = (name || 'there').split(' ')[0]
  const dateLine = moveDate ? ` on ${new Date(moveDate).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}` : ''
  return `Hi ${first}! Your move with Saturn Star Moving is CONFIRMED${dateLine}. We're excited to take care of you. Questions? Call or text us at ${SATURN_STAR_PHONE}. – The Saturn Star Team`
}

function buildBookingConfirmationEmail(name: string, moveDate?: string, originCity?: string, destCity?: string) {
  const first = (name || 'there').split(' ')[0]
  const dateLine = moveDate ? new Date(moveDate).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'TBD'
  const route = originCity && destCity ? `${originCity} → ${destCity}` : originCity || destCity || 'TBD'
  return {
    subject: `Your Move is Confirmed — Saturn Star Moving`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#1a1a1a;"><div style="background:#1a2744;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;"><div style="color:#f5a623;font-size:24px;font-weight:700;">Saturn Star Moving</div></div><div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:32px 24px;border-radius:0 0 12px 12px;"><h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${first} — your move is confirmed!</h1><p style="color:#555;margin:0 0 24px;line-height:1.6;">We have everything locked in. Move date: <strong>${dateLine}</strong> · Route: <strong>${route}</strong>.</p><p style="color:#555;font-size:14px;line-height:1.6;">Our team will reach out 48 hours before your move with crew details. Questions? <strong>${SATURN_STAR_PHONE}</strong></p></div></div>`,
    text: `Hi ${first}, your move with Saturn Star Moving is confirmed for ${dateLine} (${route}). We'll reach out 48 hours before. Questions? ${SATURN_STAR_PHONE}`,
  }
}

export async function POST(request: Request) {
  const stripeKey = readEnv('STRIPE_SECRET_KEY')
  const webhookSecret = readEnv('STRIPE_WEBHOOK_SECRET')
  if (!stripeKey) return new Response('Stripe not configured', { status: 503 })

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

    if (quoteId) {
      try {
        const stripe = new Stripe(stripeKey, { apiVersion: '2026-02-25.clover', httpClient: Stripe.createNodeHttpClient() })
        const now = new Date().toISOString()

        // Retrieve payment intent to get payment method ID for future balance charge
        let paymentMethodId: string | undefined
        let customerId: string | undefined
        if (session.payment_intent) {
          const pi = await stripe.paymentIntents.retrieve(
            typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id
          )
          paymentMethodId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id
          customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id
        }

        // Update the quote with deposit payment info
        const quote = await getSalesQuote(quoteId)
        const receiptAlreadyRecorded = quote?.depositStripeSessionId === session.id && !!quote.depositPaidAt
        if (quote) {
          await saveSalesQuote({
            ...quote,
            depositPaidAt: now,
            depositPaidAmount: session.amount_total ? session.amount_total / 100 : quote.deposit,
            depositPaidMethod: 'stripe',
            depositStripeSessionId: session.id,
            depositStripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
            depositStripeCustomerId: customerId,
            depositStripePaymentMethodId: paymentMethodId,
          })
        }

        // Update the lead: auto-book + mark deposit received
        const targetLeadId = leadId || quote?.leadId
        if (targetLeadId) {
          const lead = await getSalesLead(targetLeadId)
          if (lead) {
            const alreadyBooked = lead.stage === 'booked' || lead.stage === 'completed'
            const depositAmt = session.amount_total ? session.amount_total / 100 : quote?.deposit
            const branch = deriveLeadBranch(lead)
            const autoAssignedCrew = (lead.assignedCrew?.length ?? 0) > 0 ? lead.assignedCrew! : await pickAutoAssignedCrewIds(branch).catch(() => [] as string[])
            const autoCrewBrief = await generateCrewBrief({ lead: { ...lead, branch }, quote: quote ?? null }).catch(() => '')
            const quotedTruckCount = getQuotedTruckCount(lead, quote ?? null)

            await saveSalesLead({
              ...lead,
              stage: alreadyBooked ? lead.stage : 'booked',
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
                void sendSalesMessage({ channel: 'sms', to: lead.phone, body: buildBookingConfirmationSms(lead.name, lead.moveDate), leadId: targetLeadId, actor: 'automation', actorName: 'Saturn Star', notes: 'Booking confirmation SMS (auto on deposit)' }).catch(() => {})
              }
              if (lead.email && quote) {
                const emailContent = buildBookingConfirmationEmail(lead.name, lead.moveDate, lead.originCity, lead.destCity)
                void sendSalesMessage({ channel: 'email', to: lead.email, subject: emailContent.subject, body: emailContent.text, htmlBody: emailContent.html, leadId: targetLeadId, actor: 'automation', actorName: 'Saturn Star', notes: 'Booking confirmation email (auto on deposit)' }).catch(() => {})
              }
            }

            void scheduleMoveReminder(targetLeadId)

            // Notify the team — deposit paid
            if (!receiptAlreadyRecorded) {
              const customerName = lead.name || 'Customer'
              const depositAmt = session.amount_total ? session.amount_total / 100 : quote?.deposit || 0
              const quoteNum = quote?.number || ''
              const crmUrl = `${readEnv('NEXT_PUBLIC_APP_URL') || 'https://go.quote2move.com'}/sales/leads/${lead.id}`
              void sendRepAlertEmail(
                `💳 ${customerName} paid deposit — ${quoteNum}`,
                `<div style="font-family:sans-serif;color:#1a2744;max-width:520px">
                  <p><strong>${customerName}</strong> just paid their deposit of <strong>$${depositAmt.toFixed(2)}</strong> via Stripe.</p>
                  <table style="font-size:14px;border-collapse:collapse;width:100%">
                    <tr><td style="padding:4px 0;color:#666">Quote</td><td style="padding:4px 0">${quoteNum}</td></tr>
                    <tr><td style="padding:4px 0;color:#666">Deposit paid</td><td style="padding:4px 0;font-weight:600;color:#0f6a53">$${depositAmt.toFixed(2)}</td></tr>
                    <tr><td style="padding:4px 0;color:#666">Balance due</td><td style="padding:4px 0">$${Math.max(0,(quote?.total||0)-depositAmt).toFixed(2)}</td></tr>
                    ${lead.phone ? `<tr><td style="padding:4px 0;color:#666">Phone</td><td style="padding:4px 0">${lead.phone}</td></tr>` : ''}
                  </table>
                  <p style="margin-top:16px"><a href="${crmUrl}" style="background:#1a2744;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">Open in CRM →</a></p>
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
                depositAmount: session.amount_total ? session.amount_total / 100 : quote.deposit,
                balanceAmount: Math.max(
                  0,
                  Math.round(((quote.total || 0) - (session.amount_total ? session.amount_total / 100 : quote.deposit)) * 100) / 100
                ),
                totalAmount: quote.total,
                paymentMethod: 'Credit Card',
              }).catch(() => null)
            }
          }
        }
      } catch (err) {
        console.error('Stripe webhook processing error:', err)
        // Don't fail — Stripe will retry if we return non-200
      }
    }
  }

  return NextResponse.json({ received: true })
}
