import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { readEnv } from '@/lib/server/runtime'

interface ApprovalRequestBody {
  overrideAmount: number
  projectedMargin: number
  note?: string
  customerName?: string
  moveDate?: string
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const body = (await request.json()) as ApprovalRequestBody
    if (!body.overrideAmount || body.projectedMargin == null) {
      return NextResponse.json({ error: 'overrideAmount and projectedMargin are required' }, { status: 400 })
    }

    const token = crypto.randomUUID()
    const now = new Date().toISOString()
    const repName = session?.name || 'A sales rep'

    await saveSalesLead({
      ...lead,
      marginApprovalStatus: 'pending',
      marginApprovalToken: token,
      marginApprovalRequestedAt: now,
      marginApprovalRequestedBy: repName,
      marginApprovalContext: JSON.stringify({
        overrideAmount: body.overrideAmount,
        projectedMargin: body.projectedMargin,
        note: body.note || '',
      }),
    })

    const resendKey = readEnv('RESEND_API_KEY')
    if (!resendKey) {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
    }

    const appUrl = readEnv('NEXT_PUBLIC_APP_URL') || 'https://go.quote2move.com'
    const approveUrl = `${appUrl}/api/sales/leads/${params.id}/approve-margin?token=${token}`
    const customerName = body.customerName || lead.name || 'Unknown customer'
    const moveDate = body.moveDate || lead.moveDate || 'TBD'
    const marginColor = body.projectedMargin < 45 ? '#dc2626' : '#d97706'

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 32px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden;">
    <div style="background: #071421; padding: 24px 32px;">
      <div style="color: #C99700; font-size: 18px; font-weight: 700;">Saturn Star OS</div>
      <div style="color: #93c5fd; font-size: 13px; margin-top: 2px;">Manager Approval Required</div>
    </div>
    <div style="padding: 32px;">
      <p style="margin: 0 0 24px; color: #111827; font-size: 15px;">
        <strong>${repName}</strong> is requesting approval for a below-threshold estimate.
      </p>
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 0; color: #6b7280; font-size: 13px; width: 40%;">Customer</td>
          <td style="padding: 10px 0; color: #111827; font-size: 13px; font-weight: 600;">${customerName}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 0; color: #6b7280; font-size: 13px;">Move Date</td>
          <td style="padding: 10px 0; color: #111827; font-size: 13px;">${moveDate}</td>
        </tr>
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 10px 0; color: #6b7280; font-size: 13px;">Override Total</td>
          <td style="padding: 10px 0; color: #111827; font-size: 13px; font-weight: 600;">$${body.overrideAmount.toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #6b7280; font-size: 13px;">Projected Margin</td>
          <td style="padding: 10px 0; font-size: 13px; font-weight: 700; color: ${marginColor};">${body.projectedMargin.toFixed(1)}% <span style="font-weight: 400; color: #6b7280;">(threshold: 55%)</span></td>
        </tr>
      </table>
      ${body.note ? `<div style="background: #f9fafb; border-radius: 8px; padding: 14px 16px; margin-bottom: 24px; border-left: 3px solid #d1d5db;"><div style="font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">Rep's Note</div><div style="color: #374151; font-size: 13px;">${body.note}</div></div>` : ''}
      <a href="${approveUrl}" style="display: block; text-align: center; background: #16a34a; color: white; text-decoration: none; padding: 14px 24px; border-radius: 8px; font-size: 15px; font-weight: 600; margin-bottom: 16px;">
        ✅ Approve Override
      </a>
      <p style="margin: 0; color: #9ca3af; font-size: 11px; text-align: center;">
        This approval link is single-use and tied to this lead. If you have questions, reply to this email.
      </p>
    </div>
  </div>
</body>
</html>`

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Saturn Star OS <business@starmovers.ca>',
        to: ['business@starmovers.ca'],
        subject: `⚠️ Approval Needed — ${customerName} (${body.projectedMargin.toFixed(1)}% margin)`,
        html,
        reply_to: 'business@starmovers.ca',
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new Error(String(err?.message || 'Failed to send approval email'))
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to request approval' },
      { status: 400 }
    )
  }
}
