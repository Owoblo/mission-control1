import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { formatMoney, uid } from '@/lib/sales'
import { sendRepAlertEmail } from '@/lib/server/internal-notifications'
import { getAppBaseUrl } from '@/lib/server/runtime'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesQuote } from '@/lib/server/sales-repository'

const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function generateApprovalCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(6)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

function normalizeCode(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as {
      action?: 'request' | 'verify'
      quoteId?: string
      requestedAmount?: number
      originalSubtotal?: number
      projectedMargin?: number | null
      totalCost?: number | null
      reason?: string
      code?: string
    }

    const quoteId = String(payload.quoteId || '').trim()
    if (!quoteId) return NextResponse.json({ error: 'quoteId required' }, { status: 400 })

    const quote = await getSalesQuote(quoteId)
    if (!quote) return NextResponse.json({ error: 'Quote not found' }, { status: 404 })

    const lead = quote.leadId ? await getSalesLead(quote.leadId).catch(() => null) : null
    const now = new Date()

    if (payload.action === 'verify') {
      const code = normalizeCode(payload.code)
      if (!code) return NextResponse.json({ error: 'Approval code required' }, { status: 400 })

      const expiresAt = quote.priceOverrideApprovalExpiresAt ? new Date(quote.priceOverrideApprovalExpiresAt) : null
      if (
        !quote.priceOverrideApprovalCode ||
        quote.priceOverrideApprovalStatus !== 'pending' ||
        !expiresAt ||
        expiresAt.getTime() < now.getTime()
      ) {
        const expiredQuote = await saveSalesQuote({
          ...quote,
          priceOverrideApprovalStatus: quote.priceOverrideApprovalStatus === 'approved' ? 'approved' : 'expired',
        })
        return NextResponse.json({ error: 'Approval code is expired or unavailable.', quote: expiredQuote }, { status: 400 })
      }

      if (normalizeCode(quote.priceOverrideApprovalCode) !== code) {
        return NextResponse.json({ error: 'Invalid approval code.' }, { status: 400 })
      }

      const savedQuote = await saveSalesQuote({
        ...quote,
        priceOverrideApprovalStatus: 'approved',
        priceOverrideApprovalApprovedAt: now.toISOString(),
        priceOverrideApprovalApprovedBy: session?.name || 'Manager/Owner',
      })

      await saveFollowUpLog({
        id: uid('fu'),
        quoteId: quote.id,
        leadId: quote.leadId,
        type: 'note',
        date: now.toISOString(),
        createdAt: now.toISOString(),
        notes: `Price override approval verified with code ${code}. Approved by ${session?.name || 'manager/owner'} for ${formatMoney(savedQuote.priceOverrideApprovalAmount || 0)} pre-tax.`,
      }).catch(() => null)

      return NextResponse.json({ ok: true, quote: savedQuote })
    }

    const requestedAmount = Math.round(Number(payload.requestedAmount || 0) * 100) / 100
    if (requestedAmount <= 0) return NextResponse.json({ error: 'Requested override amount required.' }, { status: 400 })

    const code = generateApprovalCode()
    const approvalId = uid('approval')
    const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS)
    const reason = String(payload.reason || 'Manual price override').trim()
    const originalSubtotal = Math.round(Number(payload.originalSubtotal || quote.subtotal || 0) * 100) / 100
    const projectedMargin =
      payload.projectedMargin === null || payload.projectedMargin === undefined
        ? undefined
        : Math.round(Number(payload.projectedMargin || 0) * 10) / 10

    const savedQuote = await saveSalesQuote({
      ...quote,
      priceOverrideApprovalCode: code,
      priceOverrideApprovalId: approvalId,
      priceOverrideApprovalStatus: 'pending',
      priceOverrideApprovalRequestedAt: now.toISOString(),
      priceOverrideApprovalRequestedBy: session?.name || 'Sales rep',
      priceOverrideApprovalRequestedByUserId: session?.userId,
      priceOverrideApprovalExpiresAt: expiresAt.toISOString(),
      priceOverrideApprovalApprovedAt: undefined,
      priceOverrideApprovalApprovedBy: undefined,
      priceOverrideApprovalAmount: requestedAmount,
      priceOverrideApprovalOriginalSubtotal: originalSubtotal,
      priceOverrideApprovalProjectedMargin: projectedMargin,
      priceOverrideApprovalReason: reason,
    })

    const appUrl = getAppBaseUrl('https://go.quote2move.com')
    const quoteUrl = quote.leadId ? `${appUrl}/sales/leads/${encodeURIComponent(quote.leadId)}?estimate=1` : `${appUrl}/sales/quotes/${encodeURIComponent(quote.id)}`
    const marginLine = projectedMargin === undefined ? 'Unknown' : `${projectedMargin.toFixed(1)}%`
    const customer = lead?.name || quote.number
    await sendRepAlertEmail(
      `Price override approval needed — ${customer}`,
      `
<div style="font-family:sans-serif;max-width:620px;margin:0 auto;padding:24px">
  <div style="background:#071421;color:#d7f5e6;padding:14px 20px;border-radius:8px 8px 0 0;font-weight:700;font-size:16px">
    Price Override Approval Requested
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px;color:#071421;font-size:14px;line-height:1.6">
    <div><strong>Lead:</strong> ${escapeHtml(customer)}</div>
    <div><strong>Quote:</strong> ${escapeHtml(quote.number)}</div>
    <div><strong>Requested by:</strong> ${escapeHtml(session?.name || 'Sales rep')}</div>
    <div><strong>Calculated subtotal:</strong> ${escapeHtml(formatMoney(originalSubtotal))}</div>
    <div><strong>Requested override:</strong> ${escapeHtml(formatMoney(requestedAmount))} pre-tax</div>
    <div><strong>Projected margin:</strong> ${escapeHtml(marginLine)}</div>
    <div><strong>Reason:</strong> ${escapeHtml(reason)}</div>
    <div style="margin-top:18px;padding:16px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:20px;font-weight:800;letter-spacing:4px;text-align:center">
      ${escapeHtml(code)}
    </div>
    <div style="margin-top:8px;color:#64748b;font-size:12px">Code expires ${escapeHtml(expiresAt.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }))}. Give this code to the rep only if approved.</div>
    <div style="margin-top:18px">
      <a href="${quoteUrl}" style="background:#071421;color:#d7f5e6;padding:10px 18px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:700">Open Quote</a>
    </div>
  </div>
</div>`,
    )

    await saveFollowUpLog({
      id: uid('fu'),
      quoteId: quote.id,
      leadId: quote.leadId,
      type: 'note',
      date: now.toISOString(),
      createdAt: now.toISOString(),
      notes: `Price override approval requested by ${session?.name || 'sales rep'}: ${formatMoney(requestedAmount)} pre-tax, projected margin ${marginLine}, reason: ${reason}. Approval code expires ${expiresAt.toISOString()}.`,
    }).catch(() => null)

    return NextResponse.json({
      ok: true,
      quote: savedQuote,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process override approval' },
      { status: 400 },
    )
  }
}
