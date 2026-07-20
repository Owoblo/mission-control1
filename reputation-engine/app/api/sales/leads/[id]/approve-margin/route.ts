import { NextResponse } from 'next/server'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  function html(title: string, message: string, success: boolean) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 48px 16px; text-align: center;">
  <div style="max-width: 420px; margin: 0 auto; background: white; border-radius: 16px; border: 1px solid #e5e7eb; padding: 48px 32px;">
    <div style="font-size: 48px; margin-bottom: 16px;">${success ? '✅' : '❌'}</div>
    <div style="color: #071421; font-size: 22px; font-weight: 700; margin-bottom: 8px;">${title}</div>
    <div style="color: #6b7280; font-size: 14px; line-height: 1.6;">${message}</div>
    <div style="margin-top: 32px; color: #9ca3af; font-size: 12px;">Saturn Star OS · Mission Control</div>
  </div>
</body>
</html>`
  }

  if (!token) {
    return new NextResponse(html('Invalid Link', 'This approval link is missing a token.', false), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  try {
    const lead = await getSalesLead(params.id)

    if (!lead) {
      return new NextResponse(html('Lead Not Found', 'This lead no longer exists.', false), {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      })
    }

    if (lead.marginApprovalStatus === 'approved') {
      return new NextResponse(
        html('Already Approved', 'This override was already approved. The rep can proceed.', true),
        { status: 200, headers: { 'Content-Type': 'text/html' } }
      )
    }

    if (!lead.marginApprovalToken || lead.marginApprovalToken !== token) {
      return new NextResponse(
        html('Invalid Token', 'This approval link is invalid or has expired. Ask the rep to request a new one.', false),
        { status: 403, headers: { 'Content-Type': 'text/html' } }
      )
    }

    const ctx = lead.marginApprovalContext
      ? JSON.parse(lead.marginApprovalContext) as { overrideAmount?: number; projectedMargin?: number }
      : {}

    await saveSalesLead({
      ...lead,
      marginApprovalStatus: 'approved',
      marginApprovedAt: new Date().toISOString(),
      marginApprovalToken: undefined,
    })

    const detail = ctx.overrideAmount
      ? `Override of $${ctx.overrideAmount.toLocaleString()} at ${ctx.projectedMargin?.toFixed(1)}% margin has been approved.`
      : 'The margin override has been approved.'

    return new NextResponse(
      html('Override Approved', `${detail} The rep can now finalize and send the estimate.`, true),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    )
  } catch (error) {
    return new NextResponse(
      html('Error', error instanceof Error ? error.message : 'Something went wrong.', false),
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    )
  }
}

export async function POST() {
  return NextResponse.json({ error: 'Use GET with ?token=' }, { status: 405 })
}
