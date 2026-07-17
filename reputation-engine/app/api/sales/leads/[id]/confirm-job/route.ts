import { NextResponse } from 'next/server'
import { deriveOpsChecklist, getQuotedTruckCount } from '@/lib/operations'
import { deriveLeadBranch, generateCrewBrief, mergeCrewBrief, pickAutoAssignedCrewIds } from '@/lib/server/crew-dispatch'
import { scheduleMoveReminder } from '@/lib/server/sales-automation'
import { sendSalesMessage } from '@/lib/server/sales-messaging'
import { getSalesLead, getSalesQuote, saveSalesLead, saveFollowUpLog, saveSalesQuote } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { uid } from '@/lib/sales'
import { buildPaymentRecord } from '@/lib/payment-records'
import type { PaymentRecordMethod } from '@/lib/types'

const SATURN_STAR_PHONE = '+12267732993'
const SATURN_STAR_EMAIL = 'business@starmovers.ca'

function normalizePaymentMethod(value?: string): PaymentRecordMethod {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z]/g, '')
  if (normalized.includes('credit')) return 'credit_card'
  if (normalized.includes('debit')) return 'debit'
  if (normalized.includes('cash')) return 'cash'
  if (normalized.includes('cheque') || normalized.includes('check')) return 'cheque'
  if (normalized.includes('bank')) return 'bank_transfer'
  if (normalized.includes('transfer')) return 'etransfer'
  return 'other'
}

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
    html: `
<div style="font-family:system-ui,sans-serif;max-width:540px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#1a2744;padding:32px 24px;border-radius:12px 12px 0 0;text-align:center;">
    <div style="color:#f5a623;font-size:24px;font-weight:700;letter-spacing:-0.5px;">Saturn Star Moving</div>
    <div style="color:#ffffff80;font-size:13px;margin-top:4px;">Your Trusted Moving Partner</div>
  </div>
  <div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;padding:32px 24px;border-radius:0 0 12px 12px;">
    <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;">Hi ${first} — your move is confirmed!</h1>
    <p style="color:#555;margin:0 0 24px;line-height:1.6;">We have everything locked in on our end. Here's your booking summary:</p>
    <div style="background:#f8f9fb;border-radius:8px;padding:20px;margin-bottom:24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
        <span style="color:#888;font-size:13px;">Move Date</span>
        <span style="font-weight:600;font-size:13px;">${dateLine}</span>
      </div>
      <div style="display:flex;justify-content:space-between;">
        <span style="color:#888;font-size:13px;">Route</span>
        <span style="font-weight:600;font-size:13px;">${route}</span>
      </div>
    </div>
    <p style="color:#555;margin:0 0 24px;line-height:1.6;font-size:14px;">Our team will reach out 48 hours before your move with crew details and a final confirmation. In the meantime, don't hesitate to reach out.</p>
    <div style="background:#1a2744;border-radius:8px;padding:16px;text-align:center;">
      <div style="color:#f5a623;font-weight:700;font-size:15px;">Questions? We're here.</div>
      <div style="color:#ffffffb0;font-size:13px;margin-top:4px;">${SATURN_STAR_PHONE} &nbsp;·&nbsp; ${SATURN_STAR_EMAIL}</div>
    </div>
  </div>
</div>`.trim(),
    text: `Hi ${first}, your move with Saturn Star Moving is confirmed for ${dateLine} (${route}). We'll reach out 48 hours before. Questions? ${SATURN_STAR_PHONE}`,
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await request.json()) as {
      depositAmount?: number
      depositMethod?: string
      sendConfirmation?: boolean
    }
    const session = await getSessionUser().catch(() => null)

    const lead = await getSalesLead(id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const now = new Date().toISOString()
    const explicitDepositAmount = Number(body.depositAmount || 0) > 0 ? Number(body.depositAmount) : undefined
    const depositAlreadyConfirmed = lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full'
    const branch = deriveLeadBranch(lead)
    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null
    const autoAssignedCrew = (lead.assignedCrew?.length ?? 0) > 0 ? lead.assignedCrew! : await pickAutoAssignedCrewIds(branch)
    const autoCrewBrief = await generateCrewBrief({
      lead: { ...lead, branch },
      quote,
    }).catch(() => '')
    const quotedTruckCount = getQuotedTruckCount(lead, quote)

    const updated = await saveSalesLead({
      ...lead,
      branch: branch || lead.branch,
      stage: 'booked',
      bookedAt: now,
      depositAmount: explicitDepositAmount ?? (depositAlreadyConfirmed ? lead.depositAmount : undefined),
      depositMethod: explicitDepositAmount ? (body.depositMethod || lead.depositMethod) : (depositAlreadyConfirmed ? lead.depositMethod : undefined),
      depositDate: explicitDepositAmount ? now.slice(0, 10) : (depositAlreadyConfirmed ? lead.depositDate : undefined),
      paymentStatus: explicitDepositAmount ? 'deposit_received' : (depositAlreadyConfirmed ? lead.paymentStatus : 'pending'),
      followUpDate: undefined, // clear follow-up — job is confirmed
      followUpNote: undefined,
      assignedCrew: autoAssignedCrew.length > 0 ? autoAssignedCrew : lead.assignedCrew,
      crewNote: mergeCrewBrief(lead.crewNote, autoCrewBrief),
      truckCountConfirmed: quotedTruckCount,
      truckSize: quotedTruckCount ? lead.truckSize || '26ft' : undefined,
      truckReservationStatus: quotedTruckCount ? (lead.truckReservationStatus || 'needs_booking') : 'not_needed',
      opsChecklist: deriveOpsChecklist({
        ...lead,
        assignedCrew: autoAssignedCrew.length > 0 ? autoAssignedCrew : lead.assignedCrew,
        truckReservationStatus: quotedTruckCount ? (lead.truckReservationStatus || 'needs_booking') : 'not_needed',
      }),
    })

    if (explicitDepositAmount && quote) {
      const paymentMethod = normalizePaymentMethod(body.depositMethod)
      const paymentRecord = buildPaymentRecord({
        quote,
        lead,
        amount: explicitDepositAmount,
        kind: 'deposit',
        method: paymentMethod,
        paidAt: now,
        note: 'Recorded while confirming booking',
        recordedBy: session?.name,
        recordedByUserId: session?.userId,
      })
      await saveSalesQuote({
        ...quote,
        status: quote.status === 'declined' ? quote.status : 'accepted',
        acceptedAt: quote.acceptedAt || now,
        depositPaidAt: now,
        depositPaidAmount: explicitDepositAmount,
        depositPaidMethod: paymentMethod === 'credit_card'
          ? 'stripe'
          : paymentMethod === 'etransfer' || paymentMethod === 'cash' || paymentMethod === 'cheque'
            ? paymentMethod
            : 'other',
        paymentRecords: [...(quote.paymentRecords || []), paymentRecord],
      })
    }

    // Log to timeline
    const depositNote = explicitDepositAmount
      ? ` Deposit of $${explicitDepositAmount.toLocaleString()} received via ${body.depositMethod || 'unknown'}.`
      : ''

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: id,
      type: 'status_change',
      date: now,
      createdAt: now,
      notes: `Job confirmed and booked.${depositNote}`,
    })

    // Send confirmation messages if requested
    const errors: string[] = []
    if (body.sendConfirmation !== false) {
      const smsBody = buildBookingConfirmationSms(lead.name, lead.moveDate)
      const emailContent = buildBookingConfirmationEmail(lead.name, lead.moveDate, lead.originCity, lead.destCity)

      const sends = []
      if (lead.phone) {
        sends.push(
          sendSalesMessage({
            channel: 'sms',
            to: lead.phone,
            body: smsBody,
            leadId: id,
            actor: session ? 'human' : 'automation',
            actorName: session?.name,
            actorUserId: session?.userId,
            notes: `Booking confirmation SMS sent to ${lead.phone}`,
          }).catch(err => errors.push(`SMS: ${(err as Error).message}`))
        )
      }
      if (lead.email) {
        sends.push(
          sendSalesMessage({
            channel: 'email',
            to: lead.email,
            subject: emailContent.subject,
            body: emailContent.text,
            htmlBody: emailContent.html,
            leadId: id,
            actor: session ? 'human' : 'automation',
            actorName: session?.name,
            actorUserId: session?.userId,
            notes: `Booking confirmation email sent to ${lead.email}`,
          }).catch(err => errors.push(`Email: ${(err as Error).message}`))
        )
      }
      await Promise.allSettled(sends)
    }

    void scheduleMoveReminder(id)

    return NextResponse.json({ ok: true, lead: updated, errors: errors.length ? errors : undefined })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to confirm job' },
      { status: 500 }
    )
  }
}
